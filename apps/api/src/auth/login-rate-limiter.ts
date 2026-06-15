import { Injectable, Optional } from "@nestjs/common";
import { loadEnv } from "../config/env.schema";
import { ValkeyService } from "../permission/valkey.service";

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
 * **Multi-instance:** khi `VALKEY_URL` có → đếm trên Valkey (mọi instance thấy chung). **Fail-soft:** Valkey
 * chưa cấu hình → fallback `Map` in-memory (đúng cho 1 instance + reset khi restart). KHÔNG fail-open: mất
 * Valkey thì hạ về memory chứ không bỏ rate-limit (đây là control chống brute-force, BẤT BIẾN an ninh).
 */
@Injectable()
export class LoginRateLimiter {
  private readonly env = loadEnv();
  private readonly attempts = new Map<string, AttemptState>();

  constructor(@Optional() private readonly valkey?: ValkeyService) {}

  /** Ngưỡng bucket tài khoản — login truyền vào `recordFailure(accountKey, …)`. */
  get accountMaxAttempts(): number {
    return this.env.LOGIN_ACCOUNT_MAX_ATTEMPTS;
  }

  static key(companySlug: string, email: string, ip: string): string {
    return `rl:ip:${companySlug}|${email.toLowerCase()}|${ip}`;
  }

  /** Bucket theo tài khoản (mọi IP). Prefix `rl:acct:` tách biệt với per-IP key. */
  static accountKey(companySlug: string, email: string): string {
    return `rl:acct:${companySlug}|${email.toLowerCase()}`;
  }

  async isLocked(key: string, nowMs: number = Date.now()): Promise<boolean> {
    if (this.useValkey()) {
      return (await this.valkey!.get(this.lockKey(key))) !== null;
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

  /** Xoá trạng thái sau login thành công (cả counter + lock). */
  async reset(key: string): Promise<void> {
    if (this.useValkey()) {
      await this.valkey!.del(this.countKey(key), this.lockKey(key));
      return;
    }
    this.attempts.delete(key);
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
