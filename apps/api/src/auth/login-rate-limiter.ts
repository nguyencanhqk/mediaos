import { Injectable } from "@nestjs/common";
import { loadEnv } from "../config/env.schema";

interface AttemptState {
  count: number;
  lockedUntilMs: number;
}

/**
 * Giới hạn brute-force login: N lần sai liên tiếp → khoá tạm (plan G2-6). Khoá theo
 * key = companySlug|email|ip để không cho dò mật khẩu.
 *
 * ⚠️ In-memory: chỉ đúng cho 1 instance + reset khi restart. Prod nhiều instance → thay bằng Valkey
 * (stack §4). Giữ interface này để hoán sink mà không đổi AuthService.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly env = loadEnv();
  private readonly attempts = new Map<string, AttemptState>();

  static key(companySlug: string, email: string, ip: string): string {
    return `${companySlug}|${email.toLowerCase()}|${ip}`;
  }

  isLocked(key: string, nowMs: number = Date.now()): boolean {
    const state = this.attempts.get(key);
    return state !== undefined && state.lockedUntilMs > nowMs;
  }

  /** Ghi nhận 1 lần sai; chạm ngưỡng ⇒ khoá tạm LOGIN_LOCKOUT_SEC. */
  recordFailure(key: string, nowMs: number = Date.now()): void {
    const state = this.attempts.get(key) ?? { count: 0, lockedUntilMs: 0 };
    state.count += 1;
    if (state.count >= this.env.LOGIN_MAX_ATTEMPTS) {
      state.lockedUntilMs = nowMs + this.env.LOGIN_LOCKOUT_SEC * 1000;
      state.count = 0;
    }
    this.attempts.set(key, state);
  }

  /** Xoá trạng thái sau login thành công. */
  reset(key: string): void {
    this.attempts.delete(key);
  }
}
