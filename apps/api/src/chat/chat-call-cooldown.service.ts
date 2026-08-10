import { Injectable, Optional } from "@nestjs/common";
import { ValkeyService } from "../permission/valkey.service";

interface MemoryWindow {
  count: number;
  resetAtMs: number;
}

/** Trần sổ in-memory khi Valkey tắt — chặn một vòng lặp gọi làm phình bộ nhớ vô hạn (mirror `ChatTypingService`). */
const FALLBACK_MAX_ENTRIES = 10_000;

/**
 * SỔ ĐĂNG KÝ scope — MỘT chỗ duy nhất liệt kê mọi bucket đang dùng lớp này.
 *
 * Lý do tồn tại: `key()` nhận `scope` là chuỗi tự do, nên hai caller lỡ truyền CÙNG một chuỗi sẽ âm thầm
 * DÙNG CHUNG hạn mức — người gọi điện nhiều sẽ bị cắt `ice-config` và ngược lại, mà không có gì đỏ.
 * Bắt buộc đi qua hằng ở đây thì một va chạm scope là một dòng trùng nhìn thấy được trong file này.
 */
export const CHAT_CALL_COOLDOWN_SCOPE = {
  /** `GET /chat/calls/ice-config` (CHAT-API-029) — S7-CALL-SEC-1 HIGH-2 vế 2. */
  ICE_CONFIG: "ice-config",
  /** `POST /chat/rooms/:id/calls` (CHAT-API-026) — S7-CALL-BE-FIX-1 MEDIUM-3 vế TẦN SUẤT. */
  INVITE: "call-invite",
  /**
   * Khung `/ws-call` bị từ chối (S7-CALL-RT-1) — trần cho chính đường GHI `user_security_events`.
   * Vượt trần ⇒ vẫn ngắt kết nối nhưng KHÔNG ghi: hàng rào chống bơm không được tự trở thành đường bơm
   * vào một bảng append-only không có job dọn.
   */
  SIGNALLING_VIOLATION: "call-signal-violation",
  /**
   * Handshake `/ws-call` (S7-CALL-RT-1) — mỗi lần bắt tay tốn một `permissions.can()` (đọc DB), nên
   * "ngắt khi vi phạm" một mình không đủ: kẻ dò chỉ cần nối lại. Trần rộng (mạng chập chờn làm FE
   * reconnect thật), nhưng có trần.
   */
  SIGNALLING_CONNECT: "call-signal-connect",
} as const;

/**
 * ChatCallCooldownService — cooldown "N lần / cửa sổ" DÙNG CHUNG cho các endpoint CALL của CHAT.
 *
 * Hai caller hiện tại, hai bucket TÁCH BIỆT (xem `CHAT_CALL_COOLDOWN_SCOPE`):
 *   • `ice-config` (S7-CALL-SEC-1, HIGH-2 vế 2) — chống thu hoạch credential TURN bên thứ ba.
 *   • `call-invite` (S7-CALL-BE-FIX-1, MEDIUM-3 vế tần suất) — chống một actor bơm hàng append-only vào
 *     `chat_call_participants` (mỗi lời mời ghi `1 + N` hàng, KHÔNG có job dọn).
 *
 * ⚠️ **Lớp này KHÔNG quyết định chuyện gì xảy ra khi hết hạn mức** — `allow()` chỉ trả `true/false`, và
 * hai caller cố ý xử lý KHÁC NHAU: `ice-config` **thoái lui về STUN, không lỗi** (chặn cứng ở đó là tự
 * DoS người đang cố gọi); `invite` trả **429** (không có "một nửa lời mời" để thoái lui về — im lặng
 * thành công sẽ là một cuộc gọi không bao giờ đổ chuông). Đừng suy từ caller này sang caller kia.
 *
 * Khuôn CHÍNH LÀ `LoginRateLimiter`/`ChatTypingService`: Valkey `INCR` + `EXPIRE` tại lần tăng đầu (cửa
 * sổ tự hết hạn) khi có; fallback `Map` in-memory (đúng 1 instance, mất khi restart) khi Valkey tắt/lỗi.
 * **KHÔNG fail-open**: mất Valkey thì hạ về đếm in-memory, không bỏ hẳn giới hạn — đây là control chống
 * lạm dụng, khác với tiết lưu mỹ thuật của `ChatTypingService` (ở đó lệch giữa instance vô hại).
 */
@Injectable()
export class ChatCallCooldownService {
  private readonly memory = new Map<string, MemoryWindow>();

  constructor(@Optional() private readonly valkey?: ValkeyService) {}

  /** Khoá theo (scope, company, user) — `scope` tách namespace giữa các endpoint dùng chung service này. */
  static key(scope: string, companyId: string, userId: string): string {
    return `chat:cooldown:${scope}:co:${companyId}:user:${userId}`;
  }

  /** `true` = còn hạn mức trong cửa sổ (được phép thực hiện). `false` = đã chạm ngưỡng (phải chặn/thoái lui). */
  async allow(
    key: string,
    maxRequests: number,
    windowSec: number,
    nowMs: number = Date.now(),
  ): Promise<boolean> {
    if (this.useValkey()) {
      const count = await this.valkey!.incr(key, windowSec);
      // `incr` trả null = Valkey rớt giữa chừng → fail-soft sang memory cho lần NÀY (không bỏ đếm).
      if (count !== null) return count <= maxRequests;
    }
    return this.allowMemory(key, maxRequests, windowSec, nowMs);
  }

  private allowMemory(key: string, maxRequests: number, windowSec: number, nowMs: number): boolean {
    const win = this.memory.get(key);
    if (win === undefined || win.resetAtMs <= nowMs) {
      this.evictIfFull();
      this.memory.set(key, { count: 1, resetAtMs: nowMs + windowSec * 1000 });
      return true;
    }
    win.count += 1;
    return win.count <= maxRequests;
  }

  /** Dọn rác theo hạn TRƯỚC khi thêm nếu sổ đã đầy; vẫn đầy sau quét (toàn hạn còn hiệu lực) ⇒ bỏ hẳn sổ. */
  private evictIfFull(): void {
    if (this.memory.size < FALLBACK_MAX_ENTRIES) return;
    const now = Date.now();
    for (const [k, w] of this.memory) if (w.resetAtMs <= now) this.memory.delete(k);
    if (this.memory.size >= FALLBACK_MAX_ENTRIES) this.memory.clear();
  }

  private useValkey(): boolean {
    return this.valkey?.isEnabled() === true;
  }
}
