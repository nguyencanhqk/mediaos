import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * FS-1a — tiện ích cookie SSO THUẦN (pure), KHÔNG phụ thuộc cookie-parser (giảm bề mặt, dễ test). Đọc cookie
 * từ raw header `Cookie`; phát `Set-Cookie` tự dựng chuỗi để kiểm soát CHÍNH XÁC HttpOnly/Secure/Domain/
 * SameSite/Max-Age (mục tiêu bảo mật: refresh token NGOÀI tầm với JS; CSRF double-submit; SameSite=Strict).
 */

export interface CookieOptions {
  /** JS KHÔNG đọc được (refresh token). CSRF cookie thì KHÔNG HttpOnly (client phải echo qua header). */
  httpOnly?: boolean;
  /** Chỉ gửi qua HTTPS. Prod = true; dev không-TLS có thể false. */
  secure?: boolean;
  /** Cookie Domain attribute (vd `.mediaos.example`). Rỗng/undefined → cookie host-only (bỏ Domain). */
  domain?: string;
  /** Mặc định Strict (subdomain same-site vẫn tự gửi; chống cross-site). */
  sameSite?: "Strict" | "Lax" | "None";
  /** Mặc định "/". */
  path?: string;
  /** Tuổi thọ (giây). Bỏ → session cookie. 0 → hết hạn ngay (xoá). */
  maxAgeSec?: number;
}

/**
 * Parse raw `Cookie` header → map name→value. Giá trị percent-decoded (đối xứng với serializeCookie). Cookie
 * có thể bọc dấu nháy kép (RFC6265) → bỏ nháy. Phần không có `=` bị bỏ qua. KHÔNG throw (đầu vào không tin cậy).
 */
export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    let raw = part.slice(eq + 1).trim();
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1);
    }
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw; // giá trị không phải percent-encoding hợp lệ → giữ nguyên (không nuốt lỗi câm)
    }
  }
  return out;
}

/**
 * Dựng chuỗi `Set-Cookie`. Value qua encodeURIComponent (token base64url vốn an toàn, vẫn encode phòng xa).
 * SameSite mặc định Strict. Domain CHỈ thêm khi có (rỗng → host-only). Max-Age clamp ≥ 0.
 */
export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const segs = [`${name}=${encodeURIComponent(value)}`];
  segs.push(`Path=${opts.path ?? "/"}`);
  if (opts.domain) segs.push(`Domain=${opts.domain}`);
  if (opts.maxAgeSec !== undefined) {
    segs.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`);
  }
  if (opts.httpOnly) segs.push("HttpOnly");
  if (opts.secure) segs.push("Secure");
  segs.push(`SameSite=${opts.sameSite ?? "Strict"}`);
  return segs.join("; ");
}

/**
 * Cookie xoá: Max-Age=0 + value rỗng. GIỮ NGUYÊN Path/Domain/flags để trình duyệt khớp đúng cookie mà xoá
 * (sai Domain/Path → cookie không bị xoá). Dùng khi logout / reuse-detection / refresh thất bại.
 */
export function clearCookie(name: string, opts: CookieOptions = {}): string {
  return serializeCookie(name, "", { ...opts, maxAgeSec: 0 });
}

/** Sinh CSRF token (32 byte entropy → base64url). Double-submit: đặt vào cookie + so với header bắt buộc. */
export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * So sánh CSRF HẰNG-THỜI-GIAN (chống timing attack). Thiếu một trong hai HOẶC khác độ dài → false (KHÔNG
 * throw, KHÔNG rò độ dài qua exception). Dùng cho gate double-submit ở endpoint cookie-based (refresh/logout).
 */
export function csrfTokensMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
