import { Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";

/** Handshake-only SMTP timeout (ms) — `verify()` chỉ bắt tay, KHÔNG gửi mail. */
const SMTP_VERIFY_TIMEOUT_MS = 8000;

/** Tham số kết nối SMTP để test (plaintext password chỉ trong RAM). */
export interface SmtpTestParams {
  host: string;
  port: number;
  username: string;
  secure: boolean;
  /** Plaintext — KHÔNG log, KHÔNG echo. */
  password: string;
}

export interface SmtpTestResult {
  ok: boolean;
  errorMessage?: string;
}

/**
 * Sanitize 1 chuỗi lỗi SMTP trước khi trả/log (BẤT BIẾN #4 plan §4):
 *   - thay MỌI lần xuất hiện của username/password (nếu non-empty) bằng '***';
 *   - lỗi auth (EAUTH / 535 / "auth"/"credentials"/"username and password") → message CHUNG, không chi tiết.
 * KHÔNG bao giờ để credential lọt vào message trả về hay log.
 */
export function sanitizeSmtpError(rawMessage: string, username: string, password: string): string {
  const lower = rawMessage.toLowerCase();
  // Lỗi xác thực → message chung, KHÔNG kèm bất kỳ chi tiết server nào.
  if (
    lower.includes("eauth") ||
    lower.includes("invalid login") ||
    lower.includes("authentication") ||
    lower.includes("credentials") ||
    lower.includes("username and password") ||
    /\b535\b/.test(rawMessage)
  ) {
    return "Xác thực SMTP thất bại";
  }

  let safe = rawMessage;
  // Thay credential nếu lỡ xuất hiện trong message (host/port/timeout error đôi khi nhúng URI có cred).
  for (const secret of [password, username]) {
    if (secret && secret.length > 0) {
      safe = safe.split(secret).join("***");
    }
  }
  return safe;
}

/**
 * MailTransportService — kiểm tra kết nối SMTP bằng nodemailer `transporter.verify()` (handshake-only,
 * KHÔNG `sendMail`). Plaintext password chỉ tồn tại trong RAM lúc test (KHÔNG lưu, KHÔNG log). Kết quả lỗi
 * ĐÃ sanitize (KHÔNG chứa username/password). CẤM log credential.
 */
@Injectable()
export class MailTransportService {
  private readonly logger = new Logger(MailTransportService.name);

  async test(params: SmtpTestParams): Promise<SmtpTestResult> {
    const transporter = nodemailer.createTransport({
      host: params.host,
      port: params.port,
      secure: params.secure,
      auth: { user: params.username, pass: params.password },
      connectionTimeout: SMTP_VERIFY_TIMEOUT_MS,
      greetingTimeout: SMTP_VERIFY_TIMEOUT_MS,
      socketTimeout: SMTP_VERIFY_TIMEOUT_MS,
    });

    try {
      await transporter.verify(); // handshake only — KHÔNG gửi mail
      return { ok: true };
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      const errorMessage = sanitizeSmtpError(raw, params.username, params.password);
      // Log dạng ĐÃ sanitize (no-credential). Diagnostic = kết nối thất bại; KHÔNG kèm password/username.
      this.logger.warn(`SMTP verify thất bại: ${errorMessage}`);
      return { ok: false, errorMessage };
    } finally {
      transporter.close();
    }
  }
}
