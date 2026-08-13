import { Injectable, Logger } from "@nestjs/common";
import type { TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { ChatCallsRepository } from "./chat-calls.repository";
import { CHAT_AUDIT, CHAT_MODULE_CODE } from "./chat.errors";

/** Một phần-tham-gia vừa bị đóng — caller dùng `callId` để evict (trong tx) rồi phát `peer-left` (sau commit). */
export interface ClosedCallParticipation {
  callId: string;
}

/**
 * S7-CALL-RT-FIX-2 (B2) — đóng phần tham gia cuộc gọi của một người khi họ **rời hoặc bị gỡ khỏi PHÒNG**.
 *
 * ┌─ LỖ ĐƯỢC VÁ ────────────────────────────────────────────────────────────────────────────────────┐
 * │ Gỡ một người khỏi phòng giữa cuộc gọi chỉ đặt `chat_room_members.left_at`, KHÔNG chạm            │
 * │ `chat_call_participants`. Hệ quả là một ĐỐI XỨNG SAI:                                            │
 * │  • chiều NHẬN — họ vẫn nằm trong `activeUserIds` ⇒ `assertPeer` cho qua ⇒ gateway VẪN relay      │
 * │    SDP/ICE tới họ (SDP mang IP nội bộ + mốc thời gian của bên kia). Chiều RÒ, MỞ.                │
 * │  • chiều GỬI — browser họ tự trickle ICE ⇒ `assertCallAccess` ném 404 (hết là thành viên phòng)  │
 * │    ⇒ xếp `probe` ⇒ ghi `user_security_events` + NGẮT. Một người hoàn toàn vô tội bị đóng dấu.    │
 * │ Vế NHẬN vá ở đây (đóng participant, dùng lại đúng đường `hangup`); vế GỬI vá ở                   │
 * │ `ChatCallSignalService.wasCallParticipant`.                                                     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **CỐ Ý KHÔNG kết thúc cuộc gọi** (`chat_calls.status` giữ nguyên). Ghi `chat_calls` từ đường THÀNH
 * VIÊN là kéo bề mặt ghi vòng đời (`transition`/`ended_at`/phát `chat:call{ended}`) ra ngoài
 * `ChatCallsService` — đúng hàng rào **R4** của `DECISIONS-07`. Hệ quả đã biết: một cuộc gọi `active`
 * không còn ai hoạt động sẽ kẹt (`expireStaleRinging` chỉ quét `ringing`) và partial unique
 * `chat_calls_one_live_per_room_uq` khoá phòng đó. **Lỗ này CÓ SẴN TỪ TRƯỚC** — hôm nay gỡ cả hai người
 * đang gọi cũng làm họ hết `hangup` nổi (404) và cuộc gọi kẹt y hệt; bản vá đổi HÌNH DẠNG trạng thái kẹt
 * chứ không mở rộng tập ca tới được. Có ca test đóng đinh hành vi hiện tại + KI riêng.
 *
 * ⚠️ File sống ở `src/chat/` chứ không `src/realtime/`: `chat-error-code-census.spec.ts` chỉ
 * `readdirSync(src/chat)`, nên `CHAT_AUDIT.CALL_PARTICIPANT_CLOSED` có caller duy nhất nằm ngoài thư mục
 * đó sẽ bị đo là **hằng chết** ⇒ census đỏ ở một file WO không định sửa.
 *
 * Một file riêng KHÔNG cấp bảo đảm kỹ thuật nào (cả ba service cùng nằm trong `ChatModule`) — nó thuần
 * tuý gom một phép ghi có tên tự mô tả phạm vi vào một chỗ, thay vì rải hai bản sao qua hai service.
 */
@Injectable()
export class ChatCallRoomExitService {
  private readonly logger = new Logger(ChatCallRoomExitService.name);

  constructor(
    private readonly calls: ChatCallsRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Gọi **TRONG transaction** của caller, ngay sau `setMemberLeft`.
   *
   * Cùng tx là điều kiện đúng đắn, không phải tối ưu: tách ra thì tồn tại trạng thái "đã đóng phần tham
   * gia cuộc gọi nhưng vẫn là thành viên phòng" (hoặc ngược lại) mà không ai dọn được.
   *
   * @param actorUserId người BẤM gỡ/rời — đi vào `audit.actor_user_id`. Ở cửa `removeMember` đây KHÔNG
   *   phải người bị đóng; hai giá trị được ghi tách bạch để dòng audit trả lời được cả "ai làm" lẫn
   *   "làm lên ai".
   * @returns các cuộc gọi ĐÃ THỰC SỰ đóng được — caller evict socket (trong tx) rồi phát `peer-left`
   *   (sau commit). Rỗng = không có gì xảy ra, và caller KHÔNG được phát gì.
   */
  async closeCallParticipationOnRoomExit(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    userId: string,
    actorUserId: string,
    now: Date,
  ): Promise<ClosedCallParticipation[]> {
    const open = await this.calls.findOpenParticipantCallsInRoom(tx, companyId, roomId, userId);
    const closed: ClosedCallParticipation[] = [];

    for (const row of open) {
      // 🔴 KẾT CỤC THEO TỪNG HÀNG — KHÔNG một hằng cho cả lô.
      //
      // `'left'` nghĩa là "đã VÀO rồi rời". Người được mời mà chưa bấm nhận có `joined_at IS NULL` — họ
      // chưa từng ở trong cuộc gọi để mà rời. Codebase đã viết luật này hai lần: `promoteJoinedTo` chỉ
      // nâng `'left'` cho hàng TỰ NÓ có `joined_at`, và docblock cùng chỗ ghi rõ một hàng `'left'` mà
      // `left_at IS NULL` "tự nó là một sự KHÔNG NHẤT QUÁN".
      //
      // ⚠️ Ghi sai ở đây là VĨNH VIỄN: bốn kết cục là HẤP THỤ (`WHERE` của `setParticipantOutcome` chỉ
      // cho ghi tiếp khi `outcome IS NULL OR 'accepted'`) và bảng KHÔNG có DELETE (mig `0546` khối C chỉ
      // `GRANT SELECT, INSERT` + column-GRANT). Không có vòng hai, không có đường lùi bằng revert code.
      // ⚠️ **Vị từ KÉP — bỏ vế thứ hai là lỗi ĐÃ XẢY RA ở vòng gate (security-reviewer, 13/08).**
      // `insertParticipants` đặt `joined_at = now` cho **người khởi tạo ngay lúc MỜI** (họ "tự vào cuộc
      // gọi của chính mình"), nên một cuộc gọi còn `ringing` LUÔN đã có sẵn một hàng `joined_at` khác
      // NULL. Lấy đó làm "đã vào rồi rời" là đóng dấu `'left'` + `left_at` lên người **chưa hề nói
      // chuyện với ai** — ca tới được không cần quyền gì: A mời → `ringing` → A tự bấm
      // `POST /rooms/:id/leave`.
      //
      // Vế `accepted_at` là CÙNG vị từ mà `hangup` dùng (`wasConnected = call.acceptedAt !== null`) và
      // cùng luật mà docblock `closeOpenParticipants` viết ra cho `reject`/`cancel`. Ba đường phải nói
      // cùng một thứ. Detector: ca "NGƯỜI KHỞI TẠO trên cuộc gọi còn ringing ⇒ missed" (đột biến `j`).
      const wasConnected = row.acceptedAt !== null;
      const joined = row.joinedAt !== null && wasConnected;
      const outcome = joined ? "left" : "missed";

      const ok = await this.calls.setParticipantOutcome(
        tx,
        companyId,
        row.callId,
        userId,
        outcome,
        // `left_at` CHỈ đi kèm `'left'`. Đặt nó cho `'missed'` là dựng đúng sự không nhất quán đối xứng:
        // "cuộc gọi nhỡ" mà có mốc rời.
        joined ? { leftAt: now } : {},
      );

      // Hàng đã bị ai đó đóng giữa `SELECT` và `UPDATE` (nạn nhân tự `hangup`/`reject` đúng khe đó).
      // KHÔNG audit (không có gì xảy ra để mà ghi) và KHÔNG đưa vào danh sách phát: một `peer-left` cho
      // một phần tham gia mà tx này không hề đóng là nói dối về nguyên nhân.
      if (!ok) {
        // ⚠️ **`warn`, KHÔNG phải `debug`** (FULL gate `silent-failure-hunter`, 13/08). Đây là nhánh
        // DUY NHẤT phát hiện "một lần gỡ thành viên KHÔNG đóng được phần tham gia" — và khi nó chạy thì
        // `closed` rỗng ⇒ KHÔNG evict, KHÔNG `peer-left`, tức **đúng cái lỗ WO này vá đang tái mở** cho
        // lần đó. Thiết kế giả định nó HIẾM (đua với `hangup` của chính nạn nhân); nếu giả định đó sai —
        // predicate hỏng, hai request trùng, admin bấm hai lần — thì ở mức `debug` (không thu ở
        // production) sẽ KHÔNG AI BIẾT. `warn` chứ không `error`: fail-safe theo thiết kế, nhưng phải
        // đếm được.
        this.logger.warn(
          `closeCallParticipationOnRoomExit: hàng participant đã đóng bởi tx khác — KHÔNG evict, ` +
            `KHÔNG phát peer-left cho lần này (callId=${row.callId} userId=${userId} roomId=${roomId})`,
        );
        continue;
      }

      await this.audit.record(tx, {
        action: CHAT_AUDIT.CALL_PARTICIPANT_CLOSED,
        objectType: "chat_call",
        objectId: row.callId,
        actorUserId,
        actorType: "User",
        moduleCode: CHAT_MODULE_CODE,
        resultStatus: "Success",
        newValues: { userId, roomId, outcome, reason: "room_exit" },
      });

      closed.push({ callId: row.callId });
    }

    return closed;
  }
}
