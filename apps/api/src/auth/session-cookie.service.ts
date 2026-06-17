import { Injectable } from "@nestjs/common";
import {
  CSRF_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from "@mediaos/contracts";
import { loadEnv } from "../config/env.schema";
import {
  type CookieOptions,
  clearCookie,
  generateCsrfToken,
  serializeCookie,
} from "./cookie.util";
import { parseRedirectAllowlist, validateRedirect } from "./redirect.util";

/**
 * FS-1a — cấu hình phiên SSO từ env (1 nơi duy nhất): dựng/xoá refresh + CSRF cookie (HttpOnly/Secure/Domain/
 * SameSite=Strict) và validate `?redirect` theo allowlist. Đọc env MỘT LẦN lúc khởi tạo (mirror TokenService).
 *
 * Refresh cookie = HttpOnly (JS không đọc) chứa refresh token. CSRF cookie = KHÔNG HttpOnly (client đọc + echo
 * qua header `x-csrf-token`) — double-submit. Cả hai SameSite=Strict + Domain=.<domain> để dùng chung subdomain.
 */
@Injectable()
export class SessionCookieService {
  private readonly env = loadEnv();
  private readonly redirectAllowlist = parseRedirectAllowlist(this.env.AUTH_REDIRECT_ALLOWLIST);

  /** Thuộc tính cookie nền (Domain/Secure/SameSite/Path) dùng chung — KHÔNG gồm HttpOnly/Max-Age. */
  private baseOpts(): CookieOptions {
    return {
      domain: this.env.AUTH_COOKIE_DOMAIN || undefined,
      secure: this.env.AUTH_COOKIE_SECURE === "true",
      sameSite: "Strict",
      path: "/",
    };
  }

  /** Set-Cookie refresh token: HttpOnly + Max-Age = refresh TTL. */
  buildRefreshCookie(value: string): string {
    return serializeCookie(REFRESH_COOKIE_NAME, value, {
      ...this.baseOpts(),
      httpOnly: true,
      maxAgeSec: this.env.REFRESH_TOKEN_TTL_SEC,
    });
  }

  /** Set-Cookie CSRF token: KHÔNG HttpOnly (client phải đọc để echo header) + cùng Max-Age. */
  buildCsrfCookie(value: string): string {
    return serializeCookie(CSRF_COOKIE_NAME, value, {
      ...this.baseOpts(),
      httpOnly: false,
      maxAgeSec: this.env.REFRESH_TOKEN_TTL_SEC,
    });
  }

  /** Set-Cookie xoá refresh token (Max-Age=0, GIỮ Domain/Path/HttpOnly để khớp & xoá đúng). */
  clearRefreshCookie(): string {
    return clearCookie(REFRESH_COOKIE_NAME, { ...this.baseOpts(), httpOnly: true });
  }

  /** Set-Cookie xoá CSRF token. */
  clearCsrfCookie(): string {
    return clearCookie(CSRF_COOKIE_NAME, { ...this.baseOpts(), httpOnly: false });
  }

  /** Sinh CSRF token mới (phát kèm mỗi lần đặt cookie phiên: login/2fa/refresh). */
  newCsrfToken(): string {
    return generateCsrfToken();
  }

  /** Trả target an toàn nếu origin ∈ allowlist; ngược lại null (chống open-redirect). */
  resolveSafeRedirect(target?: string | null): string | null {
    return validateRedirect(target, this.redirectAllowlist);
  }
}
