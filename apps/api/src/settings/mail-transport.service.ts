import { Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import {
  classifySmtpTestError,
  describeSmtpError,
  isProgrammerError,
  stackFramesOf,
} from "./smtp-error-summary";

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
 * MailTransportService — kiểm tra kết nối SMTP bằng nodemailer `transporter.verify()` (handshake-only,
 * KHÔNG `sendMail`). Plaintext password chỉ tồn tại trong RAM lúc test (KHÔNG lưu, KHÔNG log). CẤM log
 * credential.
 *
 * `errorMessage` = câu CỐ ĐỊNH theo loại lỗi (`classifySmtpTestError`), KHÔNG phải lời văn server: route
 * test cho người giữ `configure-mail` trỏ tới bất kỳ host:port nào API với tới, nên lời văn = đọc được
 * banner dịch vụ nội bộ (S19-SEC-MAILCREDEXFIL-1 §2). Thứ còn lại — phân biệt cổng mở/đóng/im lặng — được
 * chấp nhận có chủ ý (owner D3: tác nhân đã giữ quyền nhạy cảm; chặn dải nội bộ phá relay nội bộ hợp lệ).
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
      // Cả log lẫn câu trả client CHỈ từ trường máy-sinh (allowlist — `smtp-error-summary.ts`), KHÔNG
      // `err.message`: nodemailer nối phản hồi server vào đó (banner, echo username, blob AUTH PLAIN).
      // Lỗi lập trình ⇒ `error` + frame (KHÔNG dòng đầu stack — nó lặp message); còn lại là lỗi SMTP ⇒ `warn`
      // (cùng mẫu InviteMailService). KHÔNG ném lại: lỗi ERR_INVALID_ARG_* mang tới 25 ký tự của giá trị.
      const summary = `SMTP verify thất bại (${describeSmtpError(err)})`;
      if (isProgrammerError(err)) this.logger.error(summary, stackFramesOf(err));
      else this.logger.warn(summary);
      return { ok: false, errorMessage: classifySmtpTestError(err) };
    } finally {
      transporter.close();
    }
  }
}
