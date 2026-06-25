import { Injectable, Logger } from "@nestjs/common";
import { loadEnv } from "../config/env.schema";

/** Lý do KHÔNG gửi được (máy-đọc, cho log — KHÔNG lộ ra client). */
export type ResetMailFailReason = "no_reset_url" | "send_failed";

export interface SendResetParams {
  companyId: string;
  email: string;
  /** Plaintext reset token (scoped). CHỈ trong RAM để nhúng vào link — TUYỆT ĐỐI KHÔNG log (BẤT BIẾN #3). */
  token: string;
}

export interface SendResetResult {
  sent: boolean;
  reason?: ResetMailFailReason;
}

/**
 * ResetPasswordMailService — gửi email "đặt lại mật khẩu" (MVP = MOCK/no-op nếu chưa cấu hình URL).
 *
 * BẤT BIẾN #3 (no-secret-log): plaintext token CHỈ nhúng vào link gửi cho user; KHÔNG BAO GIỜ đưa token
 * (hay URL nhúng token) vào logger.* / console.*. Log chỉ mang recipient (email) + eventId tổng hợp —
 * đủ để quan sát mà KHÔNG rò secret. Caller (forgotPassword) gọi NGOÀI tx best-effort; lỗi gửi mail KHÔNG
 * được biến thành oracle 200-vs-500 (caller .catch redact + nuốt-có-log).
 *
 * Mirror log-discipline của InviteMailService: mọi nhánh thất bại trả {sent:false, reason} + log đã sanitize.
 * Link = `${RESET_PASSWORD_URL}?token=<token>` (URLSearchParams encode an toàn). Chưa cấu hình URL → no-op.
 */
@Injectable()
export class ResetPasswordMailService {
  private readonly logger = new Logger(ResetPasswordMailService.name);

  async sendResetEmail(params: SendResetParams): Promise<SendResetResult> {
    const eventId = this.eventId(params);
    const resetBase = loadEnv().RESET_PASSWORD_URL.trim();
    if (!resetBase) {
      // KHÔNG log token. Chỉ recipient + eventId.
      this.logger.warn(
        `RESET_PASSWORD_URL chưa cấu hình — bỏ qua gửi email đặt lại mật khẩu (sent:false) [to=${params.email} event=${eventId}].`,
      );
      return { sent: false, reason: "no_reset_url" };
    }

    // MVP mock: build link (token CHỈ trong RAM, KHÔNG log) rồi log đã-gửi với metadata an toàn.
    // Khi tích hợp SMTP thật (mirror InviteMailService), thay khối này bằng transporter.sendMail —
    // GIỮ NGUYÊN nguyên tắc: KHÔNG bao giờ log `link`/`token`.
    void this.buildResetLink(resetBase, params.token);
    this.logger.log(`Đã gửi email đặt lại mật khẩu [to=${params.email} event=${eventId}].`);
    return { sent: true };
  }

  /** Ghép link an toàn (URLSearchParams encode token). KHÔNG log giá trị trả về. */
  private buildResetLink(base: string, token: string): string {
    const qs = new URLSearchParams({ token }).toString();
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}${qs}`;
  }

  /**
   * Định danh sự kiện log-safe: KHÔNG chứa token. Dùng companyId + email (recipient đã ở phạm vi log của
   * server) — đủ để truy vết mà không rò secret.
   */
  private eventId(params: SendResetParams): string {
    return `${params.companyId}:reset`;
  }
}
