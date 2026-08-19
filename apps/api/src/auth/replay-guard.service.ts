import { Injectable, Optional } from "@nestjs/common";
import { ValkeyService } from "../permission/valkey.service";
import { replayKey, type ReplayMarker } from "../common/valkey/valkey-key";

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
 * Ngữ nghĩa: `claim(marker, rest)` trả `true` nếu caller là NGƯỜI ĐẦU TIÊN giữ key (được phép tiếp),
 * `false` nếu key ĐÃ bị giữ (replay → từ chối). FAIL-CLOSED khác với cache:
 *   - Valkey BẬT → dùng `setNx` nguyên tử (mọi instance thấy chung). Outage → `setNx` trả null → fallback memory.
 *   - Valkey TẮT (no URL) → `setNx` null → fallback `Map` in-memory (single-instance, reset khi restart).
 * KHÔNG fail-open: mất Valkey thì hạ về memory chứ KHÔNG bỏ qua replay-guard (đây là control an ninh, BẤT BIẾN).
 *
 * ══ CHU KỲ CHUYỂN TIẾP ĐÃ GỠ 19/08/2026 (S10-FND-VALKEYSCOPE-2) ═════════════════════════════════════
 * Từ 18/08 tới 19/08, `claim()` ĐỌC + GHI cả hình dạng khoá cũ (không envScope) để marker tiêu thụ
 * quanh mốc deploy không sống lại theo cả hai chiều. Sau khi đo trên Valkey PROD `--scan --pattern
 * 'replay:2fa-jti:*'` = 0 dòng, vế legacy ĐÃ XOÁ: còn đúng MỘT `setNx` trên khoá đã scoped.
 * ⛔ ĐỪNG thêm lại một vế ghi thứ hai không mang envScope — bốn môi trường dùng chung một Valkey db0
 * (KI-067), khoá không scoped là đường để môi trường này tiêu marker của môi trường kia.
 *
 * Mirror LoginRateLimiter (Valkey-first, memory-fallback) để hành vi nhất quán + test không cần Valkey.
 */
@Injectable()
export class ReplayGuardService {
  private readonly seen = new Map<string, MemEntry>();

  constructor(@Optional() private readonly valkey?: ValkeyService) {}

  /**
   * Đánh dấu marker đã dùng. Trả `true` nếu đây là LẦN ĐẦU (cho phép tiếp); `false` nếu đã từng (replay).
   *
   * @param marker họ marker (`2fa-jti` | `totp-step`) — quyết định hình dạng khoá ở cả hai chu kỳ.
   * @param rest   phần định danh (vd `<jti>` hoặc `<userId>:<step>`).
   */
  async claim(
    marker: ReplayMarker,
    rest: string,
    ttlSec: number = DEFAULT_TTL_SEC,
    nowMs: number = Date.now(),
  ): Promise<boolean> {
    const key = replayKey(marker, rest);

    if (this.valkey?.isEnabled() === true) {
      const res = await this.valkey.setNx(key, "1", ttlSec);
      // BA giá trị, không hai: `null` nghĩa là Valkey rớt giữa chừng — KHÔNG phải "chưa ai giữ". Chỉ
      // `true`/`false` mới là kết luận; `null` rơi xuống memory bên dưới (fail-soft, KHÔNG fail-open).
      if (res !== null) return res;
    }

    // Memory fallback khoá theo chuỗi ĐÃ scoped: hai môi trường chạy trên cùng một máy không được dùng
    // chung ô nhớ, y như chúng không được dùng chung khoá Valkey.
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
}
