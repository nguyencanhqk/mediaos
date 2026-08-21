import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ChatCallDto, CreateChatCallInput, WsChatCallAction } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { loadEnv } from "../config/env.schema";
import type { ChatCallOutcome, ChatCallStatus } from "../db/schema/communication";
import { ChatAccessService, type ChatCallAccess } from "./chat-access.service";
import { CHAT_CALL_COOLDOWN_SCOPE, ChatCallCooldownService } from "./chat-call-cooldown.service";
import {
  CHAT_CALL_LIVE_STATUSES,
  ChatCallsRepository,
  isActiveCallOutcome,
  isCallStateViolation,
  isLiveCallConflict,
  type ChatCallExpiredRow,
  type ChatCallParticipantRow,
} from "./chat-calls.repository";
import type { ChatActor } from "./chat-rooms.service";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { CHAT_AUDIT, CHAT_ERR, CHAT_MODULE_CODE } from "./chat.errors";
import { toChatCallDto, type ChatCallProjection } from "./chat.mapper";

/**
 * Đổ chuông tối đa **45 giây** rồi thành `missed`.
 *
 * Hằng có tên, KHÔNG lấy từ env: SPEC-15 §15a không cấp biến môi trường nào cho nó, và một núm vặn không
 * ai chỉnh là một núm vặn sẽ trôi khỏi tài liệu. Đổi giá trị = đổi hành vi nghiệp vụ ⇒ sửa ở đây và sửa
 * cả ca test đo nó.
 */
export const CHAT_CALL_RING_TIMEOUT_MS = 45_000;

/**
 * Trần số người được mời (ghi hàng `chat_call_participants`) cho MỘT lời mời.
 *
 * VÁ S7-CALL-BE-FIX-1 (MEDIUM-3, **vế KÍCH THƯỚC**). Mỗi invite ghi `1 + N` hàng append-only (N = thành
 * viên đang hoạt động của phòng) — phòng phòng-ban/dự án có thể có hàng trăm thành viên, và không có job
 * dọn cho bảng này. Người khởi tạo LUÔN nằm trong tập được cắt (họ không cần "được mời" — xem
 * `insertParticipants`).
 *
 * ⚠️ Trần này MỘT MÌNH KHÔNG đủ: nó chặn một lần ghi phình to, không chặn `10.000` lần ghi nhỏ. Vế còn
 * lại là `CHAT_CALL_INVITE_*` ngay bên dưới — hai vế của CÙNG MỘT hàng rào, đừng gỡ vế nào mà giữ vế kia.
 */
export const CHAT_CALL_MAX_INVITEES = 20;

/**
 * VÁ S7-CALL-BE-FIX-1 (MEDIUM-3, **vế TẦN SUẤT**) — trần số LỜI MỜI/phút/người, cộng dồn MỌI phòng.
 *
 * ┌─ VÌ SAO KHÔNG DỰNG BỘ ĐẾM RIÊNG Ở ĐÂY ──────────────────────────────────────────────────────────┐
 * │ Ghi chú cũ của MEDIUM-3 hoãn vế này sang lane RT-1 với lý do "dựng bản thứ hai là lỗi             │
 * │ duplicate-sibling". Lý do đó vẫn đúng, nhưng tiền đề đã đổi: `ChatCallCooldownService` (S7-CALL-  │
 * │ SEC-1) nay sống NGAY TRONG module này. Dùng lại nó với `scope` RIÊNG = một hiện thực, hai bucket  │
 * │ — không phải bản sao. Bucket tách bởi scope là bắt buộc: dùng chung với `ice-config` sẽ khiến ai  │
 * │ gọi nhiều bị cắt luôn cấu hình TURN (và ngược lại) — xem `CHAT_CALL_COOLDOWN_SCOPE`.              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Khoá theo **NGƯỜI**, không theo (người, phòng): kẻ lạm dụng có bao nhiêu phòng thì bơm bấy nhiêu lần
 * hạn mức nếu chia theo phòng — trần per-user chặn tổng lượng ghi bất kể trải trên mấy phòng.
 *
 * Trần lấy từ env (`CHAT_CALL_INVITE_MAX_PER_MIN`, mặc định 10) chứ không phải hằng cứng như
 * `CHAT_CALL_MAX_INVITEES`: xem lý do ở `env.schema.ts` (ngưỡng chống-lạm-dụng ≠ rule nghiệp vụ).
 */
const CHAT_CALL_INVITE_COOLDOWN_WINDOW_SEC = 60;

/**
 * Thông điệp 429 — **KHÔNG mang mã `CHAT-ERR-xxx`**, và đó là chủ ý.
 *
 * SPEC-15 §12 chốt ĐÚNG 30 mã nghiệp vụ (census `chat-error-code-census.spec.ts` ép con số đó); vượt
 * hạn mức tần suất KHÔNG phải một rule nghiệp vụ của CHAT mà là hàng rào hạ tầng, nên nó đi theo mã
 * CHUNG của nền: `AllExceptionsFilter` ánh xạ 429 → `SYSTEM-ERR-RATE-LIMIT` (`httpStatusToCode`), đúng
 * thứ `openapi-enrich` đã tài liệu hoá sẵn ("429 — vượt giới hạn tần suất"). Đẻ mã CHAT-ERR-031 ở đây
 * sẽ làm census ĐỎ và buộc phải sửa spec owner đã ký cho một thứ không thuộc trục nghiệp vụ.
 *
 * Thông điệp KHÔNG nêu con số trần: nó là núm vặn theo môi trường, nói ra là hứa một hợp đồng API mà
 * `.env` có thể đổi bất cứ lúc nào.
 */
export const CHAT_CALL_INVITE_COOLDOWN_MESSAGE =
  "Bạn đang gọi quá nhiều lần — chờ một lát rồi thử lại.";

/**
 * S7-CALL-BE-1 — vòng đời cuộc gọi (`CHAT-API-026..028`), **hàng rào R4** của `CHAT-DEC-020`.
 *
 * ┌─ VÌ SAO VÒNG ĐỜI ĐI REST CHỨ KHÔNG ĐI WEBSOCKET ────────────────────────────────────────────────┐
 * │ Đây là điểm CỐ Ý không sao chép LMS (`server.mjs:895..1099` xử lý invite/accept/reject/hangup    │
 * │ ngay trong handler socket rồi ghi thẳng SQLite). `DECISIONS-07 §2`: cửa WS không có `PermissionGuard`,│
 * │ không có DTO/masking, và **không có chỗ tự nhiên để ghi `audit_logs`**. Nới `CHAT-DEC-005` được   │
 * │ owner ký ĐỔI LẤY cam kết R4 này — mọi ghi nghiệp vụ vẫn qua controller REST.                     │
 * │ ⇒ Thêm một `@SubscribeMessage` nào ghi vòng đời ở `/ws-call` là **huỷ điều kiện của chữ ký**,    │
 * │   không phải một tối ưu độ trễ.                                                                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ BỐN LUẬT giữ khi sửa file này:
 *
 * 1. **Vị từ trạng thái nằm trong `WHERE`, không trong `if`.** Mọi chuyển trạng thái đi qua
 *    `repo.transition(..., fromStatuses, ...)`; 0 hàng khớp ⇒ 422. Đọc `status` rồi `if` rồi ghi là
 *    đường đua: hai người bấm "từ chối" và "kết thúc" cùng lúc đều thấy `ringing` và cái sau lùi im lặng
 *    kết quả cái trước.
 * 2. **Hai vế quyền, không phải một.** `assertCallAccess` chứng minh actor thuộc PHÒNG; `findParticipant`
 *    chứng minh actor có mặt TRONG CUỘC GỌI. Người vào phòng sau khi cuộc gọi bắt đầu thoả vế một mà
 *    không thoả vế hai.
 * 3. **404 cho người ngoài, 403 cho người trong sai vai, 422 cho sai pha.** Trộn ba loại này là hoặc mở
 *    oracle dò (403 ở chỗ đáng 404), hoặc làm FE không phân biệt được "thử lại sau" với "không bao giờ".
 * 4. **Phát WebSocket CHỈ SAU COMMIT.** (S7-CALL-RT-1 đã gắn đường phát mà BE-1 cố ý để trống.) Sáu lối
 *    phát: `invite` → `ringing`, bước dọn trong `invite` → `missed`, và bốn đường vòng đời qua
 *    `lifecycleTx`. Gọi `emitChatCall` bên trong `withTenant` là phát một sự thật có thể bị rollback —
 *    ratchet `chat-realtime-after-commit.spec.ts` đếm đúng số lối và đóng đinh vị trí.
 */
@Injectable()
export class ChatCallsService {
  private readonly logger = new Logger(ChatCallsService.name);
  /** Đọc MỘT LẦN lúc dựng provider — mirror `LoginRateLimiter`. Đọc lại mỗi request sẽ cho phép đổi trần
   *  giữa chừng bằng cách sửa `process.env`, và biến một ngưỡng an ninh thành trạng thái thay đổi được. */
  private readonly inviteMaxPerMin = loadEnv().CHAT_CALL_INVITE_MAX_PER_MIN;
  /** S10-CHAT-CALLSWEEP-1 (KI-063) — hai ngưỡng gặt cuộc gọi `active`. Đọc MỘT LẦN, cùng lý do trên. */
  private readonly orphanGraceMs = loadEnv().CHAT_CALL_ORPHAN_GRACE_MS;
  private readonly activeMaxMs = loadEnv().CHAT_CALL_ACTIVE_MAX_MS;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChatCallsRepository,
    private readonly access: ChatAccessService,
    private readonly audit: AuditService,
    private readonly cooldown: ChatCallCooldownService,
    // S7-CALL-RT-1 (additive) — đường PHÁT vòng đời. `RealtimeEmitterModule` là module LÁ (đã import
    // sẵn); CẤM đổi thành `RealtimeModule` (vòng Realtime→Chat→Realtime, có ratchet cấm).
    private readonly realtime: RealtimeEmitterService,
  ) {}

  /**
   * `CHAT-API-026` — **mời**. Tạo cuộc gọi `ringing` + hàng người-tham-gia cho toàn bộ thành viên đang
   * hoạt động của phòng.
   *
   * ⚠️ **Dọn hàng quá hạn TRƯỚC khi INSERT** (không phải để tiết kiệm, mà để tính năng không tự khoá).
   * Job quét chạy theo nhịp `SYSTEM_JOBS_POLL_MS` (mặc định 60s). Nếu chỉ dựa vào job, một cuộc gọi không
   * ai nhấc để lại hàng `ringing` sống tới ~60s, và partial unique index biến nó thành **khoá phòng**:
   * mọi lời mời tiếp theo 409 dù không còn ai đang gọi. Đó chính là "phòng kẹt" mà SPEC-15 §15a cảnh báo,
   * chỉ đổi nguyên nhân. Cùng vị từ, cùng hàm với job — một bản sao duy nhất.
   *
   * @throws HttpException 429 vượt trần lời mời/phút của NGƯỜI GỌI (MEDIUM-3 vế tần suất).
   * @throws NotFoundException 404 (CHAT-ERR-001) người ngoài phòng — giống hệt phòng không tồn tại.
   * @throws UnprocessableEntityException 422 (CHAT-ERR-005) phòng đã lưu trữ.
   * @throws ConflictException 409 (CHAT-ERR-028) phòng đang có cuộc gọi sống.
   */
  async invite(actor: ChatActor, roomId: string, dto: CreateChatCallInput): Promise<ChatCallDto> {
    await this.assertInviteCooldown(actor);

    const { call, expired } = await this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);

      // Phòng lưu trữ = CHỈ ĐỌC (SPEC-15 §3.1 · CHAT-ERR-005), cùng luật với `sendMessage`. Chặn ở đây
      // và CHỈ ở đây: `accept`/`reject`/`hangup` vẫn phải chạy được trên phòng vừa bị lưu trữ giữa cuộc
      // gọi, nếu không cuộc gọi đó kẹt `ringing` cho tới khi job dọn.
      if (acc.room.isArchived) {
        throw new UnprocessableEntityException(CHAT_ERR.CALL_ROOM_ARCHIVED);
      }

      const now = new Date();
      const expired = await this.expireStaleTx(tx, actor.companyId, now, {
        roomId,
        actorUserId: actor.id,
      });

      const call = await this.insertOrConflict(tx, roomId, actor.id, dto.kind);

      // Đọc thành viên TẠI CHỖ GHI, trong cùng tx — danh sách này quyết định ai đổ chuông và (ở RT-1) ai
      // được vào relay `/ws-call`. Cắt trần TRƯỚC khi ghi (MEDIUM-3) — người khởi tạo luôn được giữ lại.
      const memberIds = await this.repo.activeMemberIds(tx, actor.companyId, roomId);
      const invitees = capInvitees(memberIds, actor.id, CHAT_CALL_MAX_INVITEES);
      await this.repo.insertParticipants(tx, call.id, invitees, actor.id, now);

      await this.audit.record(tx, {
        action: CHAT_AUDIT.CALL_INVITED,
        objectType: "chat_call",
        objectId: call.id,
        actorUserId: actor.id,
        moduleCode: CHAT_MODULE_CODE,
        actorType: "User",
        resultStatus: "Success",
        // Siêu dữ liệu quản trị, KHÔNG có nội dung media (hàng rào R3).
        newValues: {
          roomId,
          kind: call.kind,
          status: call.status,
          invitedCount: invitees.length,
          roomMemberCount: memberIds.length,
        },
      });

      return { call: await this.dtoOf(tx, actor.companyId, call), expired };
    });

    // ⚠️ SAU COMMIT — hai đường phát, và đường `missed` KHÔNG được quên: bước dọn-trước-khi-mời ở trên
    // vừa đánh nhỡ những cuộc gọi treo của phòng này. Không báo ⇒ máy người được gọi cũ **vẫn đổ chuông
    // cho một cuộc gọi đã chết**, và hai nguồn sự thật (màn hình vs DB) lệch nhau vĩnh viễn.
    this.emitExpired(actor.companyId, expired);
    this.emitLifecycle(actor.companyId, call, "ringing");
    return call;
  }

  /**
   * `CHAT-API-027` — **nhận**. Chỉ người **được mời** (SPEC-15 §15a); người khởi tạo nhận lời mời của
   * chính mình → 403.
   *
   * ⚠️ **VÁ S7-CALL-BE-FIX-1 (MEDIUM-4).** Bản gốc dùng `fromStatuses = LIVE` (gồm cả `active`) — nghĩa là
   * BẤT KỲ thành viên phòng nào có mặt trong `chat_call_participants` (mọi thành viên phòng đang hoạt
   * động đều được auto-insert ở `invite`, xem `activeMemberIds`) đều nhảy vào được một cuộc gọi ĐÃ nối
   * máy và tự đóng dấu `outcome='accepted'` — 1-1 (SPEC-15 §5.1c) lọt thành "ai bấm accept trước cũng vào
   * được, ai bấm sau cũng vào được luôn". Docblock cũ giải thích lý do KHÔNG chặn là "không có mã lỗi cho
   * 'cuộc gọi đã đủ người'" — nhưng không cần mã mới: `fromStatuses=["ringing"]` để `mustTransition` tự
   * trả **422 CALL_NOT_ACTIONABLE** (mã sẵn có, đúng nghĩa "sai pha") cho MỌI accept nhắm vào cuộc gọi
   * không còn `ringing`, kể cả của chính người đã accept trước đó (không có luồng "bấm lại/kết nối lại"
   * nào trong wave này dựa vào accept-khi-active — nếu cần sau này thì đó là tính năng mới, tự có test).
   */
  async accept(actor: ChatActor, callId: string): Promise<ChatCallDto> {
    return this.lifecycleTx(actor, callId, "accepted", async (tx, acc, now) => {
      if (acc.call.initiatorUserId === actor.id) {
        throw new ForbiddenException(CHAT_ERR.CALL_ACTION_FORBIDDEN);
      }

      const call = await this.mustTransition(tx, actor.companyId, callId, ["ringing"], {
        status: "active",
        acceptedAtIfNull: now,
      });
      await this.repo.setParticipantOutcome(tx, actor.companyId, callId, actor.id, "accepted", {
        joinedAt: now,
      });
      await this.recordLifecycle(tx, actor, acc, call, CHAT_AUDIT.CALL_ACCEPTED);
      return call;
    });
  }

  /**
   * `CHAT-API-027` — **từ chối**. Chỉ khi còn `ringing`: từ chối một cuộc gọi đã nối máy là vô nghĩa
   * (dùng `hangup`), và cho phép sẽ ghi `rejected` đè lên một cuộc gọi đã có người nói chuyện.
   *
   * ⚠️ Một lời từ chối KẾT THÚC cuộc gọi, kể cả khi phòng có nhiều người được mời — v1 là 1-1 (SPEC-15
   * §5.1c). Ngày nào làm gọi nhóm ≥3 thì đây là chỗ phải đổi: lúc đó "một người từ chối" chỉ đóng hàng
   * participant của họ, không đóng cuộc gọi.
   */
  async reject(actor: ChatActor, callId: string): Promise<ChatCallDto> {
    return this.lifecycleTx(actor, callId, "rejected", async (tx, acc, now) => {
      if (acc.call.initiatorUserId === actor.id) {
        throw new ForbiddenException(CHAT_ERR.CALL_ACTION_FORBIDDEN);
      }

      const call = await this.mustTransition(tx, actor.companyId, callId, ["ringing"], {
        status: "rejected",
        endedAt: now,
      });
      await this.repo.setParticipantOutcome(tx, actor.companyId, callId, actor.id, "rejected");
      // Cuộc gọi CHƯA từng `active` (fromStatuses chỉ `ringing`) ⇒ không ai, kể cả người khởi tạo, từng
      // thật sự "ở trong" một cuộc gọi sống — `missed` đúng cho MỌI hàng còn treo, mirror job hết hạn
      // (`expireStaleTx`: "Mọi người còn treo đều là 'nhỡ' — kể cả người khởi tạo"). Khác hẳn `hangup` bên
      // dưới, nơi cuộc gọi CÓ THỂ đã `active`.
      await this.closeOthers(tx, actor.companyId, callId, "missed", actor.id);
      await this.recordLifecycle(tx, actor, acc, call, CHAT_AUDIT.CALL_REJECTED);
      return call;
    });
  }

  /**
   * `CHAT-API-028` — **huỷ**: người gọi rút lại TRƯỚC khi có ai nhận. Sau khi nối máy thì dùng `hangup`
   * (`fromStatuses` chỉ có `ringing` ⇒ huỷ một cuộc gọi đang diễn ra là 422, không phải im lặng thành công).
   */
  async cancel(actor: ChatActor, callId: string): Promise<ChatCallDto> {
    return this.lifecycleTx(actor, callId, "cancelled", async (tx, acc, now) => {
      if (acc.call.initiatorUserId !== actor.id) {
        throw new ForbiddenException(CHAT_ERR.CALL_ACTION_FORBIDDEN);
      }

      const call = await this.mustTransition(tx, actor.companyId, callId, ["ringing"], {
        status: "cancelled",
        endedAt: now,
      });
      await this.repo.setParticipantOutcome(tx, actor.companyId, callId, actor.id, "cancelled");
      await this.closeOthers(tx, actor.companyId, callId, "cancelled", actor.id);
      await this.recordLifecycle(tx, actor, acc, call, CHAT_AUDIT.CALL_CANCELLED);
      return call;
    });
  }

  /**
   * `CHAT-API-028` — **kết thúc**: bên nào cũng gác được, ở cả `ringing` lẫn `active`.
   *
   * ⚠️ **VÁ S7-CALL-BE-FIX-1 (HIGH-1) — bug đã xác minh, hai lớp:**
   * 1. `setParticipantOutcome(actor.id, "left", …)` bản gốc chỉ ghi khi `outcome IS NULL`. Khi actor CHÍNH
   *    LÀ người vừa `accept` (outcome đã là `'accepted'`, không còn `NULL`) thì lệnh này khớp **0 hàng**:
   *    `left_at` không bao giờ được ghi, actor giữ nguyên `'accepted'`. Vá ở tầng repo (xem
   *    `setParticipantOutcome` — nới `WHERE` cho `'accepted'`, vì nó không phải kết cục ngã ngũ).
   * 2. `closeOthers` quét MỌI hàng `outcome IS NULL` thành `outcome` truyền vào. Người KHỞI TẠO luôn có
   *    `outcome IS NULL` cho tới khi tự họ cancel/hangup (xem `insertParticipants`) — kể cả khi cuộc gọi
   *    đã `active` và họ đang thật sự nói chuyện. Truyền cứng `"missed"` như bản gốc gắn "cuộc gọi nhỡ"
   *    lên người vừa nói chuyện 5 phút, chỉ vì người KIA là người gác máy.
   *
   * Phân biệt **theo TỪNG hàng**, không phải theo cuộc gọi: `call.acceptedAt` cho biết cuộc gọi CÓ TỪNG
   * `active` không; `promoteJoinedTo` của `closeOpenParticipants` chỉ nâng `'left'` cho hàng nào TỰ NÓ đã
   * có `joined_at` (người khởi tạo — luôn có, từ lúc mời). Người được mời nhưng CHƯA từng bấm gì (phòng
   * ≥3, `joined_at IS NULL`) vẫn là `'missed'` dù cuộc gọi đã `active` cho HAI người kia — họ chưa từng ở
   * trong cuộc gọi để mà "rời". Nhầm sang so-sánh theo TOÀN cuộc gọi (mọi hàng còn treo → `'left'` một
   * loạt) sẽ làm CA 11 (test đã có, `uNoCallPair` phải giữ `'missed'`) đỏ.
   */
  async hangup(actor: ChatActor, callId: string): Promise<ChatCallDto> {
    return this.lifecycleTx(actor, callId, "ended", async (tx, acc, now) => {
      const call = await this.mustTransition(tx, actor.companyId, callId, CHAT_CALL_LIVE_STATUSES, {
        status: "ended",
        endedAt: now,
      });
      await this.repo.setParticipantOutcome(tx, actor.companyId, callId, actor.id, "left", {
        leftAt: now,
      });
      const wasConnected = call.acceptedAt !== null;
      await this.closeOthers(
        tx,
        actor.companyId,
        callId,
        "missed",
        actor.id,
        wasConnected ? "left" : undefined,
        wasConnected ? now : undefined,
      );
      await this.recordLifecycle(tx, actor, acc, call, CHAT_AUDIT.CALL_ENDED);
      return call;
    });
  }

  /**
   * `ringing` quá hạn → `missed`, kèm audit MỖI cuộc gọi. Dùng bởi CẢ HAI đường: job theo nhịp
   * (`actorType:'Job'`, không người nào đứng sau) và bước dọn-trước-khi-mời (`actorType:'System'`, có
   * `actorUserId` của người vừa bấm gọi) — mirror quy ước `CHAT_AUDIT.ROOM_AUTO_*` của BE-5.
   *
   * Idempotent theo cấu trúc: hàng đã đổi không còn khớp `status='ringing'` ⇒ lần chạy kế tiếp trả rỗng.
   *
   * ⚠️ **Trả DANH SÁCH, không phải số đếm** (S7-CALL-RT-1). Người được gọi phải nhận `chat:call{missed}`
   * — thiếu nó thì máy họ **vẫn đổ chuông cho một cuộc gọi đã chết**, và không có sự kiện nào đính chính.
   * Caller phát SAU commit của tx mình sở hữu; hàm này KHÔNG tự phát (nó chạy TRONG tx).
   *
   * @returns các cuộc gọi vừa bị đánh nhỡ, kèm danh sách người cần được báo.
   */
  async expireStaleTx(
    tx: TenantTx,
    companyId: string,
    now: Date,
    opts: { roomId?: string; actorUserId?: string } = {},
  ): Promise<ChatCallExpiry[]> {
    const cutoff = new Date(now.getTime() - CHAT_CALL_RING_TIMEOUT_MS);
    const expiredRows = await this.repo.expireStaleRinging(tx, companyId, cutoff, now, opts.roomId);
    const expiredIds = expiredRows.map((r) => r.id);

    for (const callId of expiredIds) {
      await this.audit.record(tx, {
        action: CHAT_AUDIT.CALL_MISSED,
        objectType: "chat_call",
        objectId: callId,
        // KHÔNG có `actorUserId` ở đường job: không người nào đứng sau. Ở đường mời, người bấm gọi là
        // nguyên nhân gần nhất nên ghi họ vào — nhưng `actorType` vẫn là 'System', không phải 'User':
        // họ không chủ động đánh nhỡ cuộc gọi cũ.
        ...(opts.actorUserId ? { actorUserId: opts.actorUserId } : {}),
        moduleCode: CHAT_MODULE_CODE,
        actorType: opts.actorUserId ? "System" : "Job",
        resultStatus: "Success",
        newValues: {
          status: "missed",
          reason: "ring_timeout",
          timeoutMs: CHAT_CALL_RING_TIMEOUT_MS,
        },
      });
    }

    // Đọc người tham gia TRONG tx: sau commit thì `tx` đã đóng, và mở một transaction thứ hai chỉ để
    // biết bắn cho ai là mở một cửa sổ mà danh sách có thể đã đổi.
    const expiries: ChatCallExpiry[] = [];
    for (const row of expiredRows) {
      const participants = await this.repo.listParticipants(tx, companyId, row.id);
      expiries.push({ call: row, participantUserIds: participants.map((p) => p.userId) });
    }
    return expiries;
  }

  /**
   * S10-CHAT-CALLSWEEP-1 (KI-063) — gặt cuộc gọi `active` mồ côi/quá thọ → `ended`, kèm audit MỖI cuộc
   * gọi và đóng nốt phần tham gia còn treo. Gọi TRONG tx của caller; caller phát WS SAU commit.
   *
   * HAI nhánh chạy TUẦN TỰ và `max_duration` đi TRƯỚC — xem `expireStaleActive` cho lý do (một hàng thoả
   * cả hai chỉ bị gặt một lần, và được quy cho nguyên nhân mạnh hơn).
   *
   * ⚠️ **Kết cục participant tính THEO TỪNG HÀNG, không một hằng cho cả lô** — cùng luật mà
   * `ChatCallRoomExitService` đã viết ra và `closeOpenParticipants` mirror: `'left'` nghĩa là "đã VÀO rồi
   * rời", nên nó CHỈ dành cho hàng tự nó có `joined_at`. Người được mời mà chưa bấm nhận chưa từng ở
   * trong cuộc gọi để mà rời ⇒ `'missed'`, và **KHÔNG** kèm `left_at` (một "cuộc gọi nhỡ" có mốc rời tự
   * nó là một sự không nhất quán). Vế `wasConnected` của ba đường kia ở đây LUÔN đúng: một hàng `active`
   * kéo theo `accepted_at IS NOT NULL` (`chat_calls_accepted_at_chk`).
   *
   * ⚠️ Dùng `setParticipantOutcome` từng hàng chứ KHÔNG `closeOpenParticipants`: `WHERE` của hàm đó chỉ
   * nhận `outcome IS NULL`, nên nó **bỏ sót đúng người đang nói chuyện** (`'accepted'`) — tức người duy
   * nhất chắc chắn có mặt trong một cuộc gọi `active` quá thọ. Số hàng mỗi cuộc gọi là vài đơn vị.
   */
  async expireStaleActiveTx(
    tx: TenantTx,
    companyId: string,
    now: Date,
    opts: { roomId?: string } = {},
  ): Promise<ChatCallExpiry[]> {
    const branches = [
      { reason: "max_duration" as const, cutoff: new Date(now.getTime() - this.activeMaxMs) },
      { reason: "orphan" as const, cutoff: new Date(now.getTime() - this.orphanGraceMs) },
    ];

    const expiries: ChatCallExpiry[] = [];
    for (const { reason, cutoff } of branches) {
      const rows = await this.repo.expireStaleActive(
        tx,
        companyId,
        cutoff,
        now,
        reason,
        opts.roomId,
      );

      for (const row of rows) {
        const participants = await this.repo.listParticipants(tx, companyId, row.id);
        for (const p of participants) {
          // Hàng đã hấp thụ (`rejected`/`cancelled`/`missed`/`left`) KHÔNG được ghi đè — bốn kết cục đó
          // là chung cuộc, và `WHERE` của `setParticipantOutcome` cũng khoá đường đó ở tầng SQL. Kiểm ở
          // đây để không phát ra một phép ghi vô nghĩa cho mỗi hàng lịch sử.
          if (!isActiveCallOutcome(p.outcome)) continue;
          const joined = p.joinedAt !== null;
          await this.repo.setParticipantOutcome(
            tx,
            companyId,
            row.id,
            p.userId,
            joined ? "left" : "missed",
            joined ? { leftAt: now } : {},
          );
        }

        await this.audit.record(tx, {
          action: CHAT_AUDIT.CALL_AUTO_ENDED,
          objectType: "chat_call",
          objectId: row.id,
          // KHÔNG `actorUserId`: không người nào đứng sau (mirror `CALL_MISSED` của job ring-timeout).
          moduleCode: CHAT_MODULE_CODE,
          actorType: "Job",
          resultStatus: "Success",
          newValues: {
            status: "ended",
            reason,
            thresholdMs: reason === "orphan" ? this.orphanGraceMs : this.activeMaxMs,
          },
        });

        expiries.push({ call: row, participantUserIds: participants.map((p) => p.userId) });
      }
    }

    return expiries;
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  /**
   * Trần lời mời/phút/người (MEDIUM-3 vế tần suất). Vượt ⇒ **429**, KHÔNG tạo cuộc gọi.
   *
   * ⚠️ **BA quyết định ở đây, cả ba đều cố ý và cả ba đều dễ bị "sửa cho gọn" theo hướng sai:**
   *
   * 1. **Chạy TRƯỚC `withTenant`, tức trước cả `assertMember`.** Đây là điểm của một rate-limit: chặn
   *    trước khi tiêu tài nguyên. Đặt sau membership thì mỗi lần bị chặn vẫn phải mở transaction +
   *    query — đúng thứ hàng rào này dựng ra để tránh. Không có rò rỉ: phản hồi 429 giống hệt nhau
   *    dù phòng có thật hay không, nên nó KHÔNG trở thành oracle dò phòng như 403-thay-404 sẽ là.
   *    (Khác `LmsServiceIntakeGuard` — ở đó bucket DÙNG CHUNG nên phải xác thực trước, kẻo người lạ
   *    đốt hạn mức của caller hợp lệ. Ở đây bucket theo TỪNG người và `PermissionGuard` đã chạy xong,
   *    nên không ai đốt được hạn mức của người khác.)
   *
   * 2. **Đếm MỌI lần thử, kể cả lần kết thúc bằng 404/409/422.** Một vòng lặp mời-vào-phòng-đang-bận
   *    (409) không ghi hàng nào nhưng vẫn đốt CPU/DB round-trip; tha cho nhánh thất bại là để hở đúng
   *    con đường rẻ nhất của kẻ lạm dụng.
   *
   * 3. **KHÔNG ghi `audit_logs`/`user_security_events` ở nhánh bị chặn — chỉ `warn`.** Ghi một hàng
   *    audit cho mỗi lần bị chặn sẽ biến hàng rào chống-bơm-dữ-liệu thành MỘT ĐƯỜNG BƠM DỮ LIỆU khác:
   *    kẻ tấn công đổi `chat_call_participants` (có trần, có 429) lấy `audit_logs` (append-only, không
   *    trần) với chi phí thấp hơn. Nhánh này không có bí mật để che, nên log ứng dụng là đủ dấu vết.
   */
  private async assertInviteCooldown(actor: ChatActor): Promise<void> {
    const allowed = await this.cooldown.allow(
      ChatCallCooldownService.key(CHAT_CALL_COOLDOWN_SCOPE.INVITE, actor.companyId, actor.id),
      this.inviteMaxPerMin,
      CHAT_CALL_INVITE_COOLDOWN_WINDOW_SEC,
    );
    if (allowed) return;

    // KHÔNG log `actor.id` — nhánh này lặp nhiều lần liên tiếp khi bị lạm dụng, và ghi định danh người
    // dùng mỗi lần biến log ứng dụng thành sổ theo dõi hành vi cá nhân (mirror `ChatCallIceService`).
    this.logger.warn(
      `CHAT-API-026: vượt trần ${this.inviteMaxPerMin} lời mời/${CHAT_CALL_INVITE_COOLDOWN_WINDOW_SEC}s — trả 429.`,
    );
    throw new HttpException(CHAT_CALL_INVITE_COOLDOWN_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
  }

  /**
   * Khung chung của 4 route nhận `callId`: mở tenant → **hai vế quyền** → thân → DTO.
   *
   * Cả hai vế nằm ở ĐÂY chứ không rải trong từng route: một route quên gọi `findParticipant` sẽ cho phép
   * người mới vào phòng gác máy cuộc gọi của người khác, và không có gì trong kiểu dữ liệu bắt được thiếu sót đó.
   */
  private async lifecycleTx(
    actor: ChatActor,
    callId: string,
    action: WsChatCallAction,
    body: (tx: TenantTx, acc: ChatCallAccess, now: Date) => Promise<ChatCallProjection>,
  ): Promise<ChatCallDto> {
    const dto = await this.db.withTenant(actor.companyId, async (tx) => {
      // Vế 1 — thành viên PHÒNG chứa cuộc gọi. Người ngoài (kể cả người có `view:chat-oversight`) → 404
      // giống hệt cuộc gọi không tồn tại.
      const acc = await this.access.assertCallAccess(tx, actor.companyId, callId, actor.id);

      // Vế 2 — có mặt TRONG cuộc gọi. 403 (không phải 404): actor đã chứng minh được tư cách thành viên
      // phòng ở vế 1, giấu thêm không che được gì.
      const mine = await this.repo.findParticipant(tx, actor.companyId, callId, actor.id);
      if (!mine) throw new ForbiddenException(CHAT_ERR.CALL_ACTION_FORBIDDEN);

      const call = await body(tx, acc, new Date());
      return this.dtoOf(tx, actor.companyId, call);
    });

    // ⚠️ SAU COMMIT, và ở ĐÂY chứ không trong từng route: bốn đường vòng đời dùng chung khung này, nên
    // đặt lời gọi phát ở một chỗ duy nhất làm "quên phát ở một route" thành chuyện không thể xảy ra.
    // Trong `withTenant` thì đó là phát một sự thật có thể bị rollback ngay sau đó — client vẽ một cuộc
    // gọi đã kết thúc mà không có sự kiện nào đính chính (ratchet `chat-realtime-after-commit.spec.ts`).
    this.emitLifecycle(actor.companyId, dto, action);
    return dto;
  }

  /** `INSERT` + dịch đúng MỘT loại xung đột thành 409; mọi 23505 khác vẫn nổ ra để điều tra được. */
  private async insertOrConflict(
    tx: TenantTx,
    roomId: string,
    initiatorUserId: string,
    kind: CreateChatCallInput["kind"],
  ) {
    try {
      return await this.repo.insertCall(tx, roomId, initiatorUserId, kind);
    } catch (err) {
      if (isLiveCallConflict(err)) {
        throw new ConflictException(CHAT_ERR.CALL_ALREADY_LIVE);
      }
      throw err;
    }
  }

  /**
   * Chuyển trạng thái hoặc **422**. 0 hàng khớp = trạng thái đã đổi (đã kết thúc, hoặc sai pha).
   *
   * `isCallStateViolation` bắt `23514` của trigger `chat_calls_forbid_revive_trg` — lưới cuối cho hàng
   * thua cuộc đua, để nó thành 422 chứ không phải 500. Nếu nhánh này được kích hoạt THƯỜNG XUYÊN thì vị
   * từ `fromStatuses` ở trên đang sai; đừng coi nó là đường bình thường.
   */
  private async mustTransition(
    tx: TenantTx,
    companyId: string,
    callId: string,
    fromStatuses: readonly ChatCallStatus[],
    to: { status: ChatCallStatus; acceptedAtIfNull?: Date; endedAt?: Date },
  ): Promise<ChatCallProjection> {
    let updated: Awaited<ReturnType<ChatCallsRepository["transition"]>>;
    try {
      updated = await this.repo.transition(tx, companyId, callId, fromStatuses, to);
    } catch (err) {
      if (isCallStateViolation(err)) {
        throw new UnprocessableEntityException(CHAT_ERR.CALL_NOT_ACTIONABLE);
      }
      throw err;
    }
    if (!updated) throw new UnprocessableEntityException(CHAT_ERR.CALL_NOT_ACTIONABLE);
    return updated;
  }

  /**
   * Đóng sổ những người chưa ngã ngũ. `exceptUserId` loại trừ TƯỜNG MINH hàng của actor (đã được
   * `setParticipantOutcome` ghi kết cục riêng ngay trước lệnh gọi này) — không còn dựa vào thứ tự gọi
   * (VÁ S7-CALL-BE-FIX-1, xem docblock `closeOpenParticipants`).
   *
   * `promoteJoinedTo` chỉ `hangup()` truyền — xem cảnh báo ở `closeOpenParticipants`.
   */
  private async closeOthers(
    tx: TenantTx,
    companyId: string,
    callId: string,
    outcome: ChatCallOutcome,
    exceptUserId?: string,
    promoteJoinedTo?: ChatCallOutcome,
    promoteAt?: Date,
  ): Promise<void> {
    await this.repo.closeOpenParticipants(
      tx,
      companyId,
      callId,
      outcome,
      exceptUserId,
      promoteJoinedTo,
      promoteAt,
    );
  }

  private async recordLifecycle(
    tx: TenantTx,
    actor: ChatActor,
    acc: ChatCallAccess,
    call: ChatCallProjection,
    action: string,
  ): Promise<void> {
    await this.audit.record(tx, {
      action,
      objectType: "chat_call",
      objectId: call.id,
      actorUserId: actor.id,
      moduleCode: CHAT_MODULE_CODE,
      actorType: "User",
      resultStatus: "Success",
      oldValues: { status: acc.call.status },
      newValues: { status: call.status, roomId: acc.call.roomId },
    });
  }

  /** DTO đọc participants TRONG cùng tx — ảnh chụp sau ghi, không phải một lần đọc thứ hai ngoài tx. */
  private async dtoOf(
    tx: TenantTx,
    companyId: string,
    call: ChatCallProjection,
  ): Promise<ChatCallDto> {
    const participants: ChatCallParticipantRow[] = await this.repo.listParticipants(
      tx,
      companyId,
      call.id,
    );
    return toChatCallDto(call, participants);
  }

  // ─── S7-CALL-RT-1 — đường PHÁT vòng đời (LUÔN gọi SAU commit) ────────────────

  /**
   * Phát `chat:call` cho ĐÚNG những người tham gia cuộc gọi.
   *
   * Đích lấy từ `dto.participants` — tức bảng `chat_call_participants`, KHÔNG phải danh sách thành viên
   * phòng: người vào phòng sau khi cuộc gọi bắt đầu không có hàng participant và không cần biết cuộc gọi
   * tồn tại. (Đó cũng chính là tập mà `/ws-call` dùng để quyết ai được relay — một nguồn sự thật.)
   */
  private emitLifecycle(companyId: string, dto: ChatCallDto, action: WsChatCallAction): void {
    this.realtime.emitChatCall(
      companyId,
      (dto.participants ?? []).map((p) => p.userId),
      {
        callId: dto.id,
        roomId: dto.roomId,
        kind: dto.kind,
        status: dto.status,
        initiatorUserId: dto.initiatorUserId,
        startedAt: dto.startedAt,
        action,
      },
    );
  }

  /** Phát `chat:call{missed}` cho các cuộc gọi vừa bị bước dọn/job đánh nhỡ. Gọi SAU commit. */
  emitExpired(companyId: string, expiries: readonly ChatCallExpiry[]): void {
    for (const { call, participantUserIds } of expiries) {
      this.realtime.emitChatCall(companyId, participantUserIds, {
        callId: call.id,
        roomId: call.roomId,
        kind: call.kind,
        status: "missed",
        initiatorUserId: call.initiatorUserId,
        startedAt: call.startedAt.toISOString(),
        action: "missed",
      });
    }
  }

  /**
   * S10-CHAT-CALLSWEEP-1 — phát `chat:call{ended}` cho các cuộc gọi vừa bị job gặt. Gọi SAU commit.
   *
   * Bỏ dòng này = máy người dùng giữ khung cuộc gọi của một cuộc gọi ĐÃ CHẾT, và không sự kiện nào đính
   * chính — đúng lỗ mà `emitExpired` được thêm để vá ở S7-CALL-RT-1. `action:"ended"` (không phải
   * `"missed"`) vì cuộc gọi này đã từng được nhận; client phân biệt hai màn hình theo trường đó.
   */
  emitAutoEnded(companyId: string, expiries: readonly ChatCallExpiry[]): void {
    for (const { call, participantUserIds } of expiries) {
      this.realtime.emitChatCall(companyId, participantUserIds, {
        callId: call.id,
        roomId: call.roomId,
        kind: call.kind,
        status: "ended",
        initiatorUserId: call.initiatorUserId,
        startedAt: call.startedAt.toISOString(),
        action: "ended",
      });
    }
  }
}

/** Một cuộc gọi vừa hết hạn + những người phải được báo (S7-CALL-RT-1). */
export interface ChatCallExpiry {
  call: ChatCallExpiredRow;
  participantUserIds: readonly string[];
}

/**
 * Cắt danh sách thành viên-được-mời còn tối đa `max` người, LUÔN giữ người khởi tạo dù họ ở đâu trong
 * mảng gốc — `activeMemberIds` không cam kết thứ tự, nên `slice` trần không đủ để không rớt initiator ra
 * ngoài (MEDIUM-3 · `chat-calls.service.ts`).
 *
 * Hàm THUẦN, tách khỏi class để test được không cần DB.
 */
export function capInvitees(
  memberIds: readonly string[],
  initiatorId: string,
  max: number,
): string[] {
  if (memberIds.length <= max) return [...memberIds];
  const rest = memberIds.filter((id) => id !== initiatorId).slice(0, Math.max(max - 1, 0));
  return [initiatorId, ...rest];
}
