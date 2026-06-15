import { Injectable } from "@nestjs/common";
import { authenticator } from "otplib";

/** Issuer hiển thị trong app authenticator (Google Authenticator/Authy…). */
const TOTP_ISSUER = "MediaOS";

/**
 * TotpService — TOTP RFC 6238 (otplib). Thuần tính toán, KHÔNG chạm DB/secret-at-rest. Secret base32 do
 * service này sinh; caller (TwoFactorService) lo envelope-encrypt trước khi lưu (BẤT BIẾN #3).
 *
 * `window: 1` → chấp nhận mã của bước trước/sau (±30s) để dung sai lệch đồng hồ client. Dùng instance
 * CLONE riêng — KHÔNG mutate singleton `authenticator` toàn cục (tránh ảnh hưởng chéo nếu nơi khác dùng).
 */
@Injectable()
export class TotpService {
  private readonly authenticator = authenticator.clone({ window: 1 });

  /** Secret base32 ngẫu nhiên cho 1 user. */
  generateSecret(): string {
    return this.authenticator.generateSecret();
  }

  /** otpauth:// URI để FE render QR (chứa secret — chỉ trả cho chính user enroll, 1 lần, qua HTTPS). */
  keyUri(accountName: string, secret: string): string {
    return this.authenticator.keyuri(accountName, TOTP_ISSUER, secret);
  }

  /** True nếu `token` khớp secret trong cửa sổ thời gian. Input rác (token sai định dạng) → false (deny). */
  verify(token: string, secret: string): boolean {
    try {
      return this.authenticator.check(token, secret);
    } catch {
      return false;
    }
  }

  /** CHỈ dùng trong test: sinh mã hiện tại từ secret (round-trip verify). */
  generate(secret: string): string {
    return this.authenticator.generate(secret);
  }
}
