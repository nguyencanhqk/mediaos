import { createHmac, randomUUID } from "node:crypto";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";

/**
 * Cầu SSO MediaOS → LMS (fmc-app). Phát token HMAC ngắn hạn cho CHÍNH user đang đăng nhập;
 * LMS verify bằng shared secret rồi tự tạo phiên (route /api/auth/sso phía LMS).
 *
 * Token: base64url(JSON {email, iat, exp, jti}) + "." + base64url(HMAC-SHA256(payload, secret)).
 * TTL 60s + jti một-lần (LMS ghi bảng sso_consumed_tokens) → chặn replay/chia sẻ link.
 *
 * Env (đều optional — thiếu thì endpoint trả 503, không chặn boot):
 *   LMS_SSO_SECRET — shared secret ≥32 ký tự, PHẢI khớp MEDIAOS_SSO_SECRET phía LMS.
 *   LMS_BASE_URL   — gốc public của LMS (vd https://lms.example.com).
 * Đọc process.env trực tiếp theo mẫu ObjectStorageService (validate ở env.schema lúc boot).
 */
const TOKEN_TTL_MS = 60 * 1000;

@Injectable()
export class LmsSsoService {
  private readonly secret = process.env.LMS_SSO_SECRET ?? null;
  private readonly baseUrl = process.env.LMS_BASE_URL?.replace(/\/+$/, "") ?? null;

  isEnabled(): boolean {
    return Boolean(this.secret && this.baseUrl);
  }

  /** Trả URL SSO đầy đủ cho user hiện tại (email lấy từ JWT, KHÔNG nhận từ input). */
  buildSsoUrl(email: string): { url: string } {
    if (!this.secret || !this.baseUrl) {
      throw new ServiceUnavailableException("LMS SSO chưa được cấu hình");
    }
    const now = Date.now();
    const payload = {
      email: email.toLowerCase(),
      iat: now,
      exp: now + TOKEN_TTL_MS,
      jti: randomUUID(),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.secret).update(payloadB64).digest("base64url");
    const token = `${payloadB64}.${sig}`;
    return { url: `${this.baseUrl}/api/auth/sso?token=${encodeURIComponent(token)}` };
  }
}
