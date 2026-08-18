import { Injectable, Optional } from "@nestjs/common";
import { ValkeyService } from "../permission/valkey.service";
import { legacyReplayKey, replayKey, type ReplayMarker } from "../common/valkey/valkey-key";

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
 * ══ ĐỌC KÉP + GHI KÉP — ĐÚNG MỘT CHU KỲ DEPLOY (S10-FND-VALKEYSCOPE-1) ══════════════════════════════
 * Việc thêm `envScope` vào tên khoá làm MỌI marker cũ thành mồ côi. Với marker single-use, "mồ côi"
 * KHÔNG vô hại như cache:
 *   · CHIỀU TIẾN — một challenge JWT đã tiêu thụ TRƯỚC deploy sẽ claim LẠI được sau deploy (khoá mới
 *     chưa từng được ghi) trong phần đời còn lại của token ⇒ hở tính single-use của bước-2 2FA.
 *   · CHIỀU LÙI — nếu chỉ ghi khoá MỚI thì sau khi rollback, mọi marker tiêu thụ trong cửa sổ chạy bản
 *     mới cũng sống lại y hệt (bản cũ chỉ đọc khoá cũ).
 * Vì thế ở chu kỳ này `claim()` ĐỌC và GHI cả hai hình dạng. Cả hai đường đi qua `valkey-key.ts` (khoá
 * cũ nằm trong miễn trừ tường minh của cổng runtime, KHÔNG phải một literal dựng tại chỗ).
 *
 * ⛔ Giá phải trả: mỗi lần claim tốn 2 round-trip Valkey trên đường 2FA. Chấp nhận có chủ ý — không phải
 * lỗi hiệu năng để ai đó "tối ưu" bằng cách bỏ một vế đi. Việc gỡ đã seed thành `S10-FND-VALKEYSCOPE-2`.
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
      // Thứ tự mới-trước-legacy-sau là CỐ Ý: khoá mới là nguồn sự thật của chu kỳ hiện tại.
      const newRes = await this.valkey.setNx(key, "1", ttlSec);
      const legacyRes = await this.valkey.setNx(legacyReplayKey(marker, rest), "1", ttlSec);

      // BẢNG CHÂN TRỊ (ba giá trị — `null` nghĩa là Valkey rớt giữa chừng, KHÔNG phải "chưa ai giữ"):
      //   true  + true  → lần đầu ở CẢ HAI hình dạng           ⇒ cho phép
      //   false ở BẤT KỲ vế nào → đã bị giữ (trước hoặc sau deploy) ⇒ REPLAY, từ chối
      //   còn lại (có null) → không kết luận được ⇒ fail-soft xuống memory, TUYỆT ĐỐI không trả true
      // ⚠️ Nếu viết `if (newRes !== null) return newRes` như bản một-khoá trước đây thì tổ hợp
      //    (true, null) sẽ cho qua một jti có thể đã tiêu ở khoá cũ = FAIL-OPEN.
      if (newRes === true && legacyRes === true) return true;
      if (newRes === false || legacyRes === false) return false;
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
