import { Injectable, Optional } from "@nestjs/common";
import { loadEnv } from "../config/env.schema";
import { ValkeyService } from "../permission/valkey.service";
import { rlKey } from "../common/valkey/valkey-key";

interface AttemptState {
  count: number;
  lockedUntilMs: number;
}

/**
 * Giới hạn brute-force login: N lần sai liên tiếp → khoá tạm (plan G2-6). Khoá theo `key`:
 *  - per-IP   `key(companySlug,email,ip)`        — chống dò mật khẩu từ 1 nguồn (ngưỡng `LOGIN_MAX_ATTEMPTS`).
 *  - per-account `accountKey(companySlug,email)` — bắt credential-stuffing phân tán nhiều IP lên 1 account
 *    (ngưỡng cao hơn `LOGIN_ACCOUNT_MAX_ATTEMPTS`). Login orchestrate cả hai bucket; reauth chỉ dùng 1 key.
 *
 * **S10-AUTH-IPTRUST-1 — hai ngưỡng này chỉ có nghĩa khi `req.ip` là IP THẬT.** Khoá per-IP nhúng
 * `ip` vào key, nên nếu `ip` là hằng số (PROD chạy sau proxy mà `TRUST_PROXY` chưa đặt ⇒ mọi request
 * = `::1`) thì bucket "per-IP" thoái hoá thành bucket per-account với ngưỡng THẤP: trần khoá một
 * email trở thành 5 cho MỌI nguồn gộp lại, và bucket per-account 20 KHÔNG BAO GIỜ chạm tới. Sau khi
 * `TRUST_PROXY=loopback` (18/08/2026), phân vai đúng thiết kế: **trần khoá một email từ MỘT nguồn
 * giờ mới thực sự là 5** — nguồn khác vẫn đăng nhập được — còn 20 là backstop cho credential-stuffing
 * rải nhiều nguồn. Đóng đinh bởi 4 ca cuối `login-rate-limiter.spec.ts`; bối cảnh: KI-066.
 *
 * **Multi-instance:** khi `VALKEY_URL` có → đếm trên Valkey (mọi instance thấy chung). **Fail-soft:** Valkey
 * chưa cấu hình → fallback `Map` in-memory (đúng cho 1 instance + reset khi restart). KHÔNG fail-open: mất
 * Valkey thì hạ về memory chứ không bỏ rate-limit (đây là control chống brute-force, BẤT BIẾN an ninh).
 */
@Injectable()
export class LoginRateLimiter {
  private readonly env = loadEnv();
  private readonly attempts = new Map<string, AttemptState>();

  /**
   * S10-SEC-LOGINLOG429-1 — fallback in-memory của `claimFirstOfWindow`: `key → mốc hết hạn (ms)`.
   * TÁCH HẲN `attempts`: `reset()` xoá `attempts` sau mỗi lần đăng nhập thành công, còn cửa sổ gộp
   * phải sống trọn TTL của nó (gộp mà bị reset theo login thành công thì mỗi lượt sai lại ghi lại
   * từ đầu). Dọn hết hạn bằng `pruneDedupWindows`.
   */
  private readonly dedupWindows = new Map<string, number>();

  constructor(@Optional() private readonly valkey?: ValkeyService) {}

  /** Ngưỡng bucket tài khoản — login truyền vào `recordFailure(accountKey, …)`. */
  get accountMaxAttempts(): number {
    return this.env.LOGIN_ACCOUNT_MAX_ATTEMPTS;
  }

  /**
   * Độ dài cửa sổ khoá (giây) — nguồn sự thật DUY NHẤT cho TTL của khoá gộp nhật ký.
   *
   * ⚠️ Cửa sổ này KHÔNG được gia hạn: `recordFailure` set `:lock` ĐÚNG MỘT LẦN lúc chạm ngưỡng rồi
   * xoá counter, và đường đã-khoá `return` TRƯỚC `recordFailure` ⇒ khoá sống đúng `LOGIN_LOCKOUT_SEC`.
   * Nhờ vậy TTL khoá gộp bằng đúng giá trị này là khớp pha, không phải xấp xỉ.
   */
  get lockoutSec(): number {
    return this.env.LOGIN_LOCKOUT_SEC;
  }

  static key(companySlug: string, email: string, ip: string): string {
    return rlKey("ip", `${companySlug}|${email.toLowerCase()}|${ip}`);
  }

  /** Bucket theo tài khoản (mọi IP). Bucket `acct` tách biệt với per-IP key. */
  static accountKey(companySlug: string, email: string): string {
    return rlKey("acct", `${companySlug}|${email.toLowerCase()}`);
  }

  /**
   * S2-AUTH-HARDEN-1 — namespace RIÊNG cho forgot-password (`rl:forgot:*`), TÁCH HẲN bucket login
   * (`rl:ip:`/`rl:acct:`). Lý do: dùng chung bucket ⇒ spam forgot cho email của victim sẽ khoá luôn LOGIN
   * của victim (DoS qua endpoint công khai). Tách namespace ⇒ rate-limit forgot KHÔNG ảnh hưởng login.
   * Giữ NGUYÊN cơ chế/ngưỡng kép (per-IP `LOGIN_MAX_ATTEMPTS` + per-account `accountMaxAttempts`).
   */
  static forgotKey(companySlug: string, email: string, ip: string): string {
    return rlKey("forgot:ip", `${companySlug}|${email.toLowerCase()}|${ip}`);
  }

  static forgotAccountKey(companySlug: string, email: string): string {
    return rlKey("forgot:acct", `${companySlug}|${email.toLowerCase()}`);
  }

  async isLocked(key: string, nowMs: number = Date.now()): Promise<boolean> {
    if (this.useValkey()) {
      if ((await this.valkey!.get(this.lockKey(key))) !== null) return true;
      // Valkey trả null = CHƯA khoá HOẶC Valkey rớt (get nuốt lỗi → null). Khi rớt, recordFailure đã ghi
      // vào memory (incr null → recordFailureMem) → KHÔNG fail-open: rơi xuống kiểm luôn map in-memory.
    }
    const state = this.attempts.get(key);
    return state !== undefined && state.lockedUntilMs > nowMs;
  }

  /** Ghi nhận 1 lần sai; chạm `maxAttempts` ⇒ khoá tạm `LOGIN_LOCKOUT_SEC`. */
  async recordFailure(
    key: string,
    maxAttempts: number = this.env.LOGIN_MAX_ATTEMPTS,
    nowMs: number = Date.now(),
  ): Promise<void> {
    if (this.useValkey()) {
      const lockSec = this.env.LOGIN_LOCKOUT_SEC;
      const count = await this.valkey!.incr(this.countKey(key), lockSec);
      // incr trả null = Valkey rớt giữa chừng → fail-soft sang memory cho lần này (không bỏ đếm).
      if (count === null) {
        this.recordFailureMem(key, maxAttempts, nowMs);
        return;
      }
      if (count >= maxAttempts) {
        await this.valkey!.set(this.lockKey(key), "1", lockSec);
        await this.valkey!.del(this.countKey(key));
      }
      return;
    }
    this.recordFailureMem(key, maxAttempts, nowMs);
  }

  /** Xoá trạng thái sau login thành công (cả counter + lock). Luôn xoá map in-memory (fallback có thể đã
   *  ghi trong lúc Valkey rớt) để không khoá nhầm sau khi đã đăng nhập thành công. */
  async reset(key: string): Promise<void> {
    this.attempts.delete(key);
    if (this.useValkey()) {
      await this.valkey!.del(this.countKey(key), this.lockKey(key));
    }
  }

  /**
   * S10-SEC-LOGINLOG429-1 (KI-048) — "tôi có phải NGƯỜI ĐẦU TIÊN của cửa sổ này không?"
   *
   * Trả `true` ĐÚNG MỘT LẦN cho mỗi `key` trong mỗi `ttlSec`; các lượt sau trả `false`. Người gọi
   * dùng nó để ghi hàng nhật ký ĐẦU cửa sổ rồi thôi — thay vì bồi một hàng cho MỖI request bị chặn
   * vào bảng append-only KHÔNG THU HỒI ĐƯỢC (`login_logs` ∈ PROTECTED_TABLES).
   *
   * ⚠️ GỘP = KHÔNG GHI THÊM, tuyệt đối KHÔNG phải UPDATE hàng cũ: `login_logs` bị REVOKE
   * UPDATE/DELETE ở DB (mig 0443, BẤT BIẾN #2). Thiết kế nào cần UPDATE là đã phá bất biến.
   *
   * ⚠️ FAIL-**OPEN**, NGƯỢC CHIỀU `ReplayGuardService`. Đó là control an ninh nên nghi ngờ ⇒ TỪ CHỐI;
   * đây là nhật ký nên nghi ngờ ⇒ **GHI**. Mất một chút gộp còn hơn mất dấu vết. Vì thế KHÔNG tái
   * dùng `ReplayGuardService` cho việc này dù hình dạng `setNx` giống hệt.
   *
   * ⚠️ VÌ SAO PHẢI CÓ FALLBACK MEMORY, không phải "fail-open thuần trên setNx". `ValkeyService.setNx`
   * trả `null` khi Valkey **CHƯA CẤU HÌNH**, không chỉ khi rớt — và `VALKEY_URL` thường VẮNG trong
   * test. Fail-open thuần ⇒ trong mọi int-spec khoá gộp không bao giờ giữ ⇒ cơ chế gộp lên PROD mà
   * chưa từng có một ca nào chứng minh nó chạy. Memory-fallback (mirror `recordFailureMem` ngay dưới)
   * làm nó ĐO ĐƯỢC; fail-open thật chỉ còn khi cả hai đường hỏng.
   */
  async claimFirstOfWindow(
    key: string,
    ttlSec: number,
    nowMs: number = Date.now(),
  ): Promise<boolean> {
    if (this.useValkey()) {
      const res = await this.valkey!.setNx(key, "1", ttlSec);
      // BA giá trị, không hai: `null` = chưa cấu hình HOẶC rớt ⇒ KHÔNG kết luận, rơi xuống memory.
      if (res !== null) return res;
    }
    return this.claimFirstOfWindowMem(key, ttlSec, nowMs);
  }

  private claimFirstOfWindowMem(key: string, ttlSec: number, nowMs: number): boolean {
    const expiresAtMs = this.dedupWindows.get(key);
    if (expiresAtMs !== undefined && expiresAtMs > nowMs) return false;
    this.dedupWindows.set(key, nowMs + ttlSec * 1000);
    this.pruneDedupWindows(nowMs);
    return true;
  }

  /**
   * Dọn marker hết hạn — BẮT BUỘC, không phải tối ưu. Khoá gộp của nhánh replay-jti mang chính `jti`
   * ⇒ số khoá phân biệt tăng theo số TOKEN đã thấy, không bị chặn bởi số bucket như `attempts`.
   * Không dọn thì đây là chỗ rò bộ nhớ tuyến tính theo lưu lượng. Mirror `ReplayGuardService.pruneExpired`.
   */
  private pruneDedupWindows(nowMs: number): void {
    for (const [k, expiresAtMs] of this.dedupWindows) {
      if (expiresAtMs <= nowMs) this.dedupWindows.delete(k);
    }
  }

  private recordFailureMem(key: string, maxAttempts: number, nowMs: number): void {
    const state = this.attempts.get(key) ?? { count: 0, lockedUntilMs: 0 };
    state.count += 1;
    if (state.count >= maxAttempts) {
      state.lockedUntilMs = nowMs + this.env.LOGIN_LOCKOUT_SEC * 1000;
      state.count = 0;
    }
    this.attempts.set(key, state);
  }

  private useValkey(): boolean {
    return this.valkey?.isEnabled() === true;
  }

  private countKey(key: string): string {
    return `${key}:cnt`;
  }

  private lockKey(key: string): string {
    return `${key}:lock`;
  }
}
