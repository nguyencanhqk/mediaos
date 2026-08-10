import { Injectable } from "@nestjs/common";
import { SecurityEventWriter } from "../auth/security-event-writer.service";
import { DatabaseService } from "../db/db.service";
import type { SignalViolationPayload } from "../chat/chat-call-signal-deny";

/**
 * S7-CALL-RT-1 — đường GHI **DUY NHẤT** mà `CallSignallingGateway` được phép chạm tới.
 *
 * ┌─ VÌ SAO TỒN TẠI: biến hàng rào R4 từ KỶ LUẬT thành CẤU TRÚC ────────────────────────────────────┐
 * │ Bản đầu của WO tiêm thẳng `DatabaseService` vào gateway để ghi `user_security_events`. Nó chạy   │
 * │ đúng — nhưng `db.withTenant` cấp cho gateway quyền ghi **MỌI bảng**, kể cả `chat_calls`. Tức là  │
 * │ hàng rào R4 ("vòng đời cuộc gọi chỉ đi REST, qua PermissionGuard + audit") chỉ còn được giữ bởi  │
 * │ lời hứa trong docblock, và không ratchet nào bắt được một `tx.insert(chatCalls)` viết thêm vào    │
 * │ file gateway sau này. FULL gate chỉ ra đúng chỗ này: WO đã tốn công KHÔNG export                 │
 * │ `ChatCallsRepository`, rồi lại mở một cửa rộng hơn ở ngay bên cạnh.                              │
 * │                                                                                                  │
 * │ Với provider này, bề mặt ghi của gateway thu về ĐÚNG một phép: một hàng append-only vào           │
 * │ `user_security_events`. Không có `withTenant` trong gateway ⇒ không có gì để "chỉ thêm một chút". │
 * │ Ratchet ở `chat-realtime-structure.spec.ts` đóng đinh điều đó.                                    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Sống ở `realtime/` chứ không ở `chat/`: nó là hạ tầng của gateway. Phần thuộc NGHIỆP VỤ (hình dạng
 * payload đóng + mã `CHAT-ERR-030`) vẫn ở `chat/chat-call-signal-deny.ts`, để census `CHAT_ERR` thấy
 * caller của hằng đó.
 */
@Injectable()
export class CallSignallingViolationWriter {
  constructor(
    private readonly db: DatabaseService,
    private readonly events: SecurityEventWriter,
  ) {}

  /**
   * Ghi MỘT hàng `user_security_events` cho một khung `/ws-call` bị từ chối.
   *
   * `payload` đã được dựng bởi `buildSignalViolationPayload` — bộ ĐÓNG 4 khoá, không bao giờ chứa
   * `sdp`/`candidate` (R3). Provider này KHÔNG tự dựng payload: làm thế là mở lại đúng đường cho một
   * bản sửa sau nhét khung vi phạm vào "cho đủ ngữ cảnh".
   */
  async record(companyId: string, userId: string, payload: SignalViolationPayload): Promise<void> {
    await this.db.withTenant(companyId, (tx) =>
      this.events.record(tx, {
        eventType: "CALL_SIGNALLING_VIOLATION",
        userId,
        actorUserId: userId,
        payload,
      }),
    );
  }
}
