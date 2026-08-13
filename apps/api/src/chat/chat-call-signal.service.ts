import { Injectable, NotFoundException } from "@nestjs/common";
import type { ChatCallStatus } from "../db/schema/communication";
import { DatabaseService } from "../db/db.service";
import { ChatAccessService } from "./chat-access.service";
import {
  CHAT_CALL_LIVE_STATUSES,
  ChatCallsRepository,
  isActiveCallOutcome,
} from "./chat-calls.repository";

/** Ảnh chụp tư cách của MỘT actor trong MỘT cuộc gọi, tại đúng thời điểm một khung tín hiệu tới. */
export interface ChatCallSignalAccess {
  callId: string;
  roomId: string;
  status: ChatCallStatus;
  /** `status ∈ ('ringing','active')` — cùng tập với partial unique index `chat_calls_one_live_per_room_uq`. */
  isLive: boolean;
  /** Actor có hàng participant còn hiệu lực không (xem `activeUserIds`). */
  actorIsActive: boolean;
  /**
   * Actor có hàng participant **BẤT KỂ kết cục** — kể cả `left`/`rejected`/`missed`.
   *
   * ⚠️ Tách khỏi `actorIsActive` là điều kiện để phân biệt "dò cửa" với "đua vòng đời", và nó KHÔNG phải
   * tinh chỉnh cho đẹp: sau khi actor gác máy, `setParticipantOutcome` ghi `outcome='left'` ⇒ họ rơi khỏi
   * `activeUserIds`. Một ICE candidate còn trên đường bay (chuyện xảy ra ở MỌI cuộc gọi) sẽ biến người
   * vừa gác máy thành "người ngoài đang đẩy tín hiệu vào cuộc gọi" ⇒ ghi hàng an ninh + ngắt kết nối một
   * người dùng hoàn toàn hợp lệ. Bộ test bắt được đúng ca này.
   */
  actorIsParticipant: boolean;
  /**
   * Người **đang trong cuộc gọi** = có hàng participant với `outcome IS NULL` (chưa ngã ngũ) hoặc
   * `'accepted'` (đang nói chuyện). Bốn kết cục còn lại (`rejected`/`cancelled`/`missed`/`left`) là hấp
   * thụ — ĐÚNG tập mà `ChatCallsRepository.setParticipantOutcome` cho phép ghi tiếp, không phải một định
   * nghĩa thứ hai của "còn trong cuộc gọi".
   */
  activeUserIds: readonly string[];
  /** MỌI người từng được mời vào cuộc gọi này — dùng cho cùng phép phân biệt ở trục người NHẬN relay. */
  participantUserIds: readonly string[];
}

/**
 * S7-CALL-RT-1 — bề mặt **CHỈ ĐỌC** mà gateway `/ws-call` được phép chạm vào module CHAT.
 *
 * ┌─ VÌ SAO KHÔNG export thẳng `ChatCallsRepository` ────────────────────────────────────────────────┐
 * │ `chat.module.ts` ghi tường minh: 4 provider CALL **CỐ Ý KHÔNG export** — repository mang          │
 * │ `insertCall` · `transition` · `setParticipantOutcome` · `closeOpenParticipants`, tức TOÀN BỘ bề   │
 * │ mặt GHI vòng đời. Đưa nó ra ngoài module là đưa đường bắt đầu/kết thúc cuộc gọi ra khỏi cổng      │
 * │ `PermissionGuard` + audit — đúng hàng rào **R4** mà chữ ký owner ở `DECISIONS-07` đổi lấy.        │
 * │ Service này export **HAI phép ĐỌC, 0 phép GHI** (S7-CALL-RT-FIX-2 thêm `wasCallParticipant`).     │
 * │ Phép thứ hai bị khoá cứng vào hàng của **CHÍNH actor** (`user_id = actor`) nên nó không mở thêm   │
 * │ bề mặt quan sát nào; thêm phép đọc thứ BA phải qua cùng lập luận đó, không phải một dòng tiện tay.│
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * KHÔNG cache (`DECISIONS-07` §3.2: *"mỗi sự kiện kiểm lại tư cách tham gia cuộc gọi — không tin vào
 * việc socket đang ở trong room"*, memory `ws-permission-gate-needs-its-own-room`). Đó là đánh đổi CÓ
 * CHỦ ĐÍCH đổi lấy việc **không có bản sao thứ hai của luật membership** — `assertCallAccess` vẫn là
 * điểm khẳng định duy nhất (bất biến #3 của `chat-access.service.ts`, có grep test đóng đinh).
 *
 * **Chi phí, theo NHÁNH** (S7-CALL-RT-FIX-2 — con số, không phải lời trấn an):
 *  • đường THÀNH CÔNG: 2 truy vấn điểm mỗi khung (`assertCallAccess` + `listParticipants`) — không đổi;
 *  • nhánh TỪ CHỐI: 🔴 **KHÔNG được đọc thành "1 → 2 mỗi khung"**. Thứ đổi nhiều nhất là SỐ KHUNG chạm
 *    DB, không phải số truy vấn trên mỗi khung. TRƯỚC bản vá, người bị gỡ rơi vào lớp B ngay khung ĐẦU:
 *    `deny()` đặt `state.violated = true` rồi NGẮT, và mọi khung sau ngắn mạch ở `handleFrame`
 *    (`if (state.violated) return null`) với **0** truy vấn ⇒ **1 truy vấn cho cả đời một socket**;
 *    với `CHAT_CALL_CONNECT_MAX_PER_MIN = 30` socket/người/phút ⇒ **~30 truy vấn/người/phút**.
 *    SAU bản vá họ là lớp C: **không** `violated`, **không** bị ngắt ⇒ socket SỐNG, và mỗi khung tới
 *    được DB tốn 2 truy vấn.
 *    ⚠️ Trần đúng là `CALL_SIGNAL_FRAMES_PER_WINDOW` = **120 khung/socket/10 s, KHÔNG phải 360**: khung
 *    121–360 nhận verdict `"drop"` và `handleFrame` `return null` ngay ở bước (1) — **trước** bước (5)
 *    đọc DB; 360 (`× CALL_SIGNAL_HARD_MULTIPLIER`) chỉ là ngưỡng NGẮT, không phải trần truy vấn.
 *    ⇒ 120 × 6 cửa sổ × 2 = **1.440 truy vấn/socket/phút**, DUY TRÌ ĐƯỢC (không tự tắt như trước), và
 *    socket còn CỘNG DỒN ở 30 socket mới/người/phút — chặn trên là TTL của access-token, vì sau bản vá
 *    `scheduleTokenExpiry` mới là thứ đóng một socket lớp C.
 *    Đây là cái GIÁ CÓ CHỦ ĐÍCH của việc thôi đóng dấu người vô tội (bảng append-only, không job dọn —
 *    xem `S7-CALL-RT-FIX-2` §0.3). Ai nới `CALL_SIGNAL_*` hoặc `CHAT_CALL_CONNECT_MAX_PER_MIN` phải
 *    tính lại con số này.
 */
@Injectable()
export class ChatCallSignalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: ChatAccessService,
    private readonly calls: ChatCallsRepository,
  ) {}

  /**
   * `null` = actor **không nhìn thấy** cuộc gọi này: không tồn tại · thuộc tenant khác · phòng đã xoá
   * mềm · actor không (còn) là thành viên phòng. Bốn lý do trả CÙNG một giá trị, giống hệt cách
   * `assertCallAccess` trả cùng một 404 — gateway không được phép nói cho client biết lý do nào.
   *
   * ⚠️ Chỉ nuốt `NotFoundException`. Mọi lỗi khác (DB rớt, RLS chặn, bug) **ném tiếp** cho filter của
   * gateway: coi một sự cố hạ tầng là "không có quyền" sẽ biến một cuộc gọi hỏng vì Postgres thành một
   * cuộc gọi trông như bị từ chối, và xoá sạch dấu vết điều tra.
   */
  async resolveSignalAccess(
    companyId: string,
    callId: string,
    actorUserId: string,
  ): Promise<ChatCallSignalAccess | null> {
    return this.db.withTenant(companyId, async (tx) => {
      let call;
      try {
        const acc = await this.access.assertCallAccess(tx, companyId, callId, actorUserId);
        call = acc.call;
      } catch (err) {
        if (err instanceof NotFoundException) return null;
        throw err;
      }

      const participants = await this.calls.listParticipants(tx, companyId, callId);
      // `isActiveCallOutcome` — MỘT bản sao của vị từ, dùng chung với `WHERE` của
      // `setParticipantOutcome` và của `findOpenParticipantCallsInRoom` (xem docblock của hằng).
      const activeUserIds = participants
        .filter((p) => isActiveCallOutcome(p.outcome))
        .map((p) => p.userId);

      const participantUserIds = participants.map((p) => p.userId);

      return {
        callId: call.id,
        roomId: call.roomId,
        status: call.status,
        isLive: (CHAT_CALL_LIVE_STATUSES as readonly string[]).includes(call.status),
        actorIsActive: activeUserIds.includes(actorUserId),
        actorIsParticipant: participantUserIds.includes(actorUserId),
        activeUserIds,
        participantUserIds,
      };
    });
  }

  /**
   * S7-CALL-RT-FIX-2 (A2) — actor **đã từng** được mời vào cuộc gọi này chưa?
   *
   * ┌─ VÌ SAO CẦN MỘT PHÉP ĐỌC RIÊNG, KHÔNG SUY RA TỪ `resolveSignalAccess` ──────────────────────────┐
   * │ `resolveSignalAccess` trả `null` cho BỐN lý do gộp lại, trong đó có "actor không CÒN là thành    │
   * │ viên phòng". Người vừa bị gỡ khỏi phòng GIỮA cuộc gọi rơi đúng vào đó ⇒ mọi thông tin về việc họ │
   * │ từng là người tham gia bị xoá sạch trước khi gateway kịp phân lớp. Browser của họ **tự** trickle │
   * │ ICE (WebRTC làm, không cần thao tác người nào) ⇒ mỗi khung đó bị xếp `probe` ⇒ ghi               │
   * │ `user_security_events` + NGẮT một người hoàn toàn vô tội. Bảng đó **append-only, không job dọn** │
   * │ (bất biến #2) ⇒ hàng ghi sai là VĨNH VIỄN.                                                      │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ **KHÔNG mở oracle nào.** Vị từ khoá cứng `user_id = actorUserId`: actor chỉ biết được về CHÍNH
   * MÌNH. Người chưa từng được mời không có hàng ⇒ luôn `false` ⇒ vẫn là lớp B (ghi + ngắt), tức ranh
   * giới chống dò cửa **giữ nguyên**. Khác biệt hành vi duy nhất mà actor quan sát được là "tôi từng
   * được mời vào cuộc gọi này" — điều họ **đã biết** từ lúc nhận `chat:call{ringing}`.
   *
   * ⚠️ **TÁI DÙNG `findParticipant`, không viết `SELECT` thứ ba.** Repo đã có đúng phép đọc
   * `company_id + call_id + user_id LIMIT 1`. Một bản sao viết tay ở đây là đường trôi thứ ba của cùng
   * một luật — đúng thứ mà `activeParticipantOutcomeSql` vừa được rút ra để chấm dứt.
   *
   * `withTenant` bắt buộc (bất biến #1): đây là một phép đọc dữ liệu nghiệp vụ, RLS phải được nạp
   * `app.current_company_id` — không có lối tắt "chỉ đọc nên thôi".
   */
  async wasCallParticipant(
    companyId: string,
    callId: string,
    actorUserId: string,
  ): Promise<boolean> {
    const row = await this.db.withTenant(companyId, (tx) =>
      this.calls.findParticipant(tx, companyId, callId, actorUserId),
    );
    return row !== null;
  }
}
