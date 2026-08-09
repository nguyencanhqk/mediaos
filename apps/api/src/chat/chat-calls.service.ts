import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ChatCallDto, CreateChatCallInput } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import type { ChatCallOutcome, ChatCallStatus } from "../db/schema/communication";
import { ChatAccessService, type ChatCallAccess } from "./chat-access.service";
import {
  ChatCallsRepository,
  isCallStateViolation,
  isLiveCallConflict,
  type ChatCallParticipantRow,
} from "./chat-calls.repository";
import type { ChatActor } from "./chat-rooms.service";
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

/** Trạng thái còn "sống" — ĐÚNG tập của partial unique index (mig `0546` khối A2). */
const LIVE: readonly ChatCallStatus[] = ["ringing", "active"];

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
 * 4. **Không phát WebSocket ở WO này.** Đường phát là của `S7-CALL-RT-1` và nó gắn SAU commit. Cắm sẵn
 *    một emitter "để đó" là cắm một payload chưa qua DTO/masking (CLAUDE.md §5).
 */
@Injectable()
export class ChatCallsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChatCallsRepository,
    private readonly access: ChatAccessService,
    private readonly audit: AuditService,
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
   * @throws NotFoundException 404 (CHAT-ERR-001) người ngoài phòng — giống hệt phòng không tồn tại.
   * @throws UnprocessableEntityException 422 (CHAT-ERR-005) phòng đã lưu trữ.
   * @throws ConflictException 409 (CHAT-ERR-028) phòng đang có cuộc gọi sống.
   */
  async invite(actor: ChatActor, roomId: string, dto: CreateChatCallInput): Promise<ChatCallDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);

      // Phòng lưu trữ = CHỈ ĐỌC (SPEC-15 §3.1 · CHAT-ERR-005), cùng luật với `sendMessage`. Chặn ở đây
      // và CHỈ ở đây: `accept`/`reject`/`hangup` vẫn phải chạy được trên phòng vừa bị lưu trữ giữa cuộc
      // gọi, nếu không cuộc gọi đó kẹt `ringing` cho tới khi job dọn.
      if (acc.room.isArchived) {
        throw new UnprocessableEntityException(CHAT_ERR.CALL_ROOM_ARCHIVED);
      }

      const now = new Date();
      await this.expireStaleTx(tx, actor.companyId, now, { roomId, actorUserId: actor.id });

      const call = await this.insertOrConflict(tx, roomId, actor.id, dto.kind);

      // Đọc thành viên TẠI CHỖ GHI, trong cùng tx — danh sách này quyết định ai đổ chuông và (ở RT-1) ai
      // được vào relay `/ws-call`.
      const memberIds = await this.repo.activeMemberIds(tx, actor.companyId, roomId);
      await this.repo.insertParticipants(tx, call.id, memberIds, actor.id, now);

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
          invitedCount: memberIds.length,
        },
      });

      return this.dtoOf(tx, actor.companyId, call);
    });
  }

  /**
   * `CHAT-API-027` — **nhận**. Chỉ người **được mời** (SPEC-15 §15a); người khởi tạo nhận lời mời của
   * chính mình → 403.
   *
   * Nhận một cuộc gọi ĐANG `active` (người khác đã nhấc) vẫn hợp lệ: v1 giới hạn 1-1 là ràng buộc
   * **topology media** do FE/`/ws-call` giữ, không phải bất biến dữ liệu — §12 chốt đúng 30 mã và không
   * có mã nào cho "cuộc gọi đã đủ người", nên chặn ở đây sẽ phải bịa mã ngoài sổ (xem plan D2).
   */
  async accept(actor: ChatActor, callId: string): Promise<ChatCallDto> {
    return this.lifecycleTx(actor, callId, async (tx, acc, now) => {
      if (acc.call.initiatorUserId === actor.id) {
        throw new ForbiddenException(CHAT_ERR.CALL_ACTION_FORBIDDEN);
      }

      const call = await this.mustTransition(tx, actor.companyId, callId, LIVE, {
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
    return this.lifecycleTx(actor, callId, async (tx, acc, now) => {
      if (acc.call.initiatorUserId === actor.id) {
        throw new ForbiddenException(CHAT_ERR.CALL_ACTION_FORBIDDEN);
      }

      const call = await this.mustTransition(tx, actor.companyId, callId, ["ringing"], {
        status: "rejected",
        endedAt: now,
      });
      await this.repo.setParticipantOutcome(tx, actor.companyId, callId, actor.id, "rejected");
      await this.closeOthers(tx, actor.companyId, callId, "missed");
      await this.recordLifecycle(tx, actor, acc, call, CHAT_AUDIT.CALL_REJECTED);
      return call;
    });
  }

  /**
   * `CHAT-API-028` — **huỷ**: người gọi rút lại TRƯỚC khi có ai nhận. Sau khi nối máy thì dùng `hangup`
   * (`fromStatuses` chỉ có `ringing` ⇒ huỷ một cuộc gọi đang diễn ra là 422, không phải im lặng thành công).
   */
  async cancel(actor: ChatActor, callId: string): Promise<ChatCallDto> {
    return this.lifecycleTx(actor, callId, async (tx, acc, now) => {
      if (acc.call.initiatorUserId !== actor.id) {
        throw new ForbiddenException(CHAT_ERR.CALL_ACTION_FORBIDDEN);
      }

      const call = await this.mustTransition(tx, actor.companyId, callId, ["ringing"], {
        status: "cancelled",
        endedAt: now,
      });
      await this.repo.setParticipantOutcome(tx, actor.companyId, callId, actor.id, "cancelled");
      await this.closeOthers(tx, actor.companyId, callId, "cancelled");
      await this.recordLifecycle(tx, actor, acc, call, CHAT_AUDIT.CALL_CANCELLED);
      return call;
    });
  }

  /** `CHAT-API-028` — **kết thúc**: bên nào cũng gác được, ở cả `ringing` lẫn `active`. */
  async hangup(actor: ChatActor, callId: string): Promise<ChatCallDto> {
    return this.lifecycleTx(actor, callId, async (tx, acc, now) => {
      const call = await this.mustTransition(tx, actor.companyId, callId, LIVE, {
        status: "ended",
        endedAt: now,
      });
      await this.repo.setParticipantOutcome(tx, actor.companyId, callId, actor.id, "left", {
        leftAt: now,
      });
      // Ai chưa kịp bấm gì thì là "nhỡ" — không phải "rời", vì họ chưa từng vào.
      await this.closeOthers(tx, actor.companyId, callId, "missed");
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
   * @returns số cuộc gọi vừa bị đánh nhỡ.
   */
  async expireStaleTx(
    tx: TenantTx,
    companyId: string,
    now: Date,
    opts: { roomId?: string; actorUserId?: string } = {},
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - CHAT_CALL_RING_TIMEOUT_MS);
    const expiredIds = await this.repo.expireStaleRinging(tx, companyId, cutoff, now, opts.roomId);

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

    return expiredIds.length;
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  /**
   * Khung chung của 4 route nhận `callId`: mở tenant → **hai vế quyền** → thân → DTO.
   *
   * Cả hai vế nằm ở ĐÂY chứ không rải trong từng route: một route quên gọi `findParticipant` sẽ cho phép
   * người mới vào phòng gác máy cuộc gọi của người khác, và không có gì trong kiểu dữ liệu bắt được thiếu sót đó.
   */
  private async lifecycleTx(
    actor: ChatActor,
    callId: string,
    body: (tx: TenantTx, acc: ChatCallAccess, now: Date) => Promise<ChatCallProjection>,
  ): Promise<ChatCallDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
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

  /** Đóng sổ những người chưa ngã ngũ (hàng của chính actor đã được ghi ngay trước đó). */
  private async closeOthers(
    tx: TenantTx,
    companyId: string,
    callId: string,
    outcome: ChatCallOutcome,
  ): Promise<void> {
    await this.repo.closeOpenParticipants(tx, companyId, callId, outcome);
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
}
