import { Injectable, Optional } from "@nestjs/common";
import { ValkeyService } from "../permission/valkey.service";

interface MemEntry {
  expiresAtMs: number;
}

/** TTL mặc định cho marker single-use (giây). Đủ bao trùm cửa sổ challenge 2FA (5') + dung sai TOTP step. */
const DEFAULT_TTL_SEC = 600;

/**
 * ReplayGuardService — marker SINGLE-USE fail-closed cho phòng-thủ-theo-chiều-sâu (G16-1b):
 *  - challenge JWT jti: 1 challengeToken chỉ verify-bước-2 ĐÚNG 1 LẦN (replay → reject).
 *  - TOTP step-replay: 1 (user, time-step) chỉ tiêu thụ 1 lần (dùng lại cùng mã trong cùng step → reject).
 *
 * Ngữ nghĩa: `claim(key)` trả `true` nếu caller là NGƯỜI ĐẦU TIÊN giữ key (được phép tiếp), `false` nếu key
 * ĐÃ bị giữ (replay → từ chối). FAIL-CLOSED khác với cache:
 *   - Valkey BẬT → dùng `setNx` nguyên tử (mọi instance thấy chung). Outage → `setNx` trả null → fallback memory.
 *   - Valkey TẮT (no URL) → `setNx` null → fallback `Map` in-memory (single-instance, reset khi restart).
 * KHÔNG fail-open: mất Valkey thì hạ về memory chứ KHÔNG bỏ qua replay-guard (đây là control an ninh, BẤT BIẾN).
 *
 * Mirror LoginRateLimiter (Valkey-first, memory-fallback) để hành vi nhất quán + test không cần Valkey.
 */
@Injectable()
export class ReplayGuardService {
  private readonly seen = new Map<string, MemEntry>();

  constructor(@Optional() private readonly valkey?: ValkeyService) {}

  /**
   * Đánh dấu `key` đã dùng. Trả `true` nếu đây là LẦN ĐẦU (cho phép tiếp); `false` nếu đã từng (replay → từ chối).
   * @param key  định danh single-use (vd `2fa-jti:<jti>` hoặc `totp-step:<userId>:<step>`).
   */
  async claim(
    key: string,
    ttlSec: number = DEFAULT_TTL_SEC,
    nowMs: number = Date.now(),
  ): Promise<boolean> {
    if (this.valkey?.isEnabled() === true) {
      const res = await this.valkey.setNx(this.nsKey(key), "1", ttlSec);
      // res === true  → giữ được (lần đầu). res === false → đã tồn tại (replay).
      // res === null  → Valkey rớt giữa chừng → fail-soft sang memory (KHÔNG fail-open).
      if (res !== null) return res;
    }
    return this.claimMem(key, ttlSec, nowMs);
  }

  private claimMem(key: string, ttlSec: number, nowMs: number): boolean {
    const existing = this.seen.get(key);
    if (existing && existing.expiresAtMs > nowMs) return false; // đã giữ + còn hạn → replay
    this.seen.set(key, { expiresAtMs: nowMs + ttlSec * 1000 });
    this.pruneExpired(nowMs);
    return true;
  }

  /** Dọn entry hết hạn để Map không phình vô hạn (control an ninh chạy nhiều lần). */
  private pruneExpired(nowMs: number): void {
    for (const [k, v] of this.seen) {
      if (v.expiresAtMs <= nowMs) this.seen.delete(k);
    }
  }

  private nsKey(key: string): string {
    return `replay:${key}`;
  }
}
