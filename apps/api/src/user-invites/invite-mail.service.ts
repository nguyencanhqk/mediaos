import { Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import { SMTP_SECRET_PURPOSE } from "@mediaos/contracts";
import { loadEnv } from "../config/env.schema";
import { SecretEncryptionService } from "../crypto/secret-encryption.service";
import { MailConfigRepository } from "../settings/mail-config.repository";

/** Handshake+gửi timeout (ms). */
const SMTP_SEND_TIMEOUT_MS = 10000;
const DEFAULT_SCOPE = "default";

/** Lý do KHÔNG gửi được (máy-đọc, cho log — KHÔNG lộ ra client ngoài cờ emailSent). */
export type InviteMailFailReason =
  | "no_mail_config"
  | "no_activation_url"
  | "decrypt_failed"
  | "send_failed";

export interface SendInviteParams {
  companyId: string;
  companySlug: string;
  companyName: string;
  email: string;
  fullName: string;
  /** Plaintext token — CHỈ trong RAM, nhúng vào link. KHÔNG log. */
  token: string;
}

export interface SendInviteResult {
  sent: boolean;
  reason?: InviteMailFailReason;
}

/**
 * InviteMailService — gửi email kích hoạt qua SMTP CÔNG TY (CS-8 config), BEST-EFFORT.
 *
 * Tái dùng `MailConfigRepository` (đọc config + envelope) + `SecretEncryptionService` (decrypt password JIT).
 * KHÔNG nuốt lỗi (silent-failure): mọi nhánh thất bại trả `{sent:false, reason}` + log ĐÃ sanitize (KHÔNG
 * token/password/credential). Caller (service) đưa `emailSent` ra cho admin biết để xử lý.
 *
 * Link kích hoạt = `${INVITE_ACTIVATION_URL}?company=<slug>&token=<token>` (URLSearchParams encode an toàn).
 */
@Injectable()
export class InviteMailService {
  private readonly logger = new Logger(InviteMailService.name);

  constructor(
    private readonly mailConfig: MailConfigRepository,
    private readonly secrets: SecretEncryptionService,
  ) {}

  async sendActivationEmail(params: SendInviteParams): Promise<SendInviteResult> {
    const activationBase = loadEnv().INVITE_ACTIVATION_URL.trim();
    if (!activationBase) {
      this.logger.warn(
        "INVITE_ACTIVATION_URL chưa cấu hình — bỏ qua gửi email mời (emailSent:false).",
      );
      return { sent: false, reason: "no_activation_url" };
    }

    const config = await this.mailConfig.findByScope(params.companyId, DEFAULT_SCOPE);
    if (!config) {
      this.logger.warn(
        `Công ty ${params.companyId} chưa cấu hình SMTP — bỏ qua gửi email mời (emailSent:false).`,
      );
      return { sent: false, reason: "no_mail_config" };
    }

    let password: string;
    try {
      // Decrypt JIT — plaintext chỉ trong RAM; AAD bind theo cột PERSISTED (config.companyId/config.id).
      password = await this.secrets.decryptSecret(config, {
        companyId: config.companyId,
        recordId: config.id,
        purpose: SMTP_SECRET_PURPOSE,
      });
    } catch {
      // KHÔNG lộ chi tiết crypto. Tamper/corruption → không gửi được.
      this.logger.warn(
        `Giải mã mật khẩu SMTP của ${params.companyId} thất bại — không gửi được email mời.`,
      );
      return { sent: false, reason: "decrypt_failed" };
    }

    const link = this.buildActivationLink(activationBase, params.companySlug, params.token);
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: password },
      connectionTimeout: SMTP_SEND_TIMEOUT_MS,
      greetingTimeout: SMTP_SEND_TIMEOUT_MS,
      socketTimeout: SMTP_SEND_TIMEOUT_MS,
    });

    try {
      await transporter.sendMail({
        from: config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail,
        to: params.email,
        subject: `[${params.companyName}] Lời mời kích hoạt tài khoản`,
        text: this.buildBodyText(params.fullName, params.companyName, link),
        html: this.buildBodyHtml(params.fullName, params.companyName, link),
      });
      return { sent: true };
    } catch (err: unknown) {
      // Log diagnostic KHÔNG kèm credential/token (chỉ host + lý do chung).
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Gửi email mời tới ${config.host} thất bại: ${reason}`);
      return { sent: false, reason: "send_failed" };
    } finally {
      transporter.close();
    }
  }

  /** Ghép link an toàn (URLSearchParams encode token/slug). Nếu base không phải URL hợp lệ → fallback string. */
  private buildActivationLink(base: string, slug: string, token: string): string {
    const qs = new URLSearchParams({ company: slug, token }).toString();
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}${qs}`;
  }

  private buildBodyText(fullName: string, companyName: string, link: string): string {
    return [
      `Xin chào ${fullName},`,
      ``,
      `Bạn được mời tạo tài khoản tại ${companyName}.`,
      `Nhấn vào liên kết sau để đặt mật khẩu và kích hoạt tài khoản (hết hạn sau 72 giờ):`,
      link,
      ``,
      `Nếu bạn không yêu cầu lời mời này, vui lòng bỏ qua email.`,
    ].join("\n");
  }

  private buildBodyHtml(fullName: string, companyName: string, link: string): string {
    // link đã do server sinh (token + slug encode) — không nội suy input client thô vào HTML khác.
    return [
      `<p>Xin chào ${escapeHtml(fullName)},</p>`,
      `<p>Bạn được mời tạo tài khoản tại <strong>${escapeHtml(companyName)}</strong>.</p>`,
      `<p>Nhấn vào liên kết sau để đặt mật khẩu và kích hoạt tài khoản (hết hạn sau 72 giờ):</p>`,
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
      `<p>Nếu bạn không yêu cầu lời mời này, vui lòng bỏ qua email.</p>`,
    ].join("");
  }
}

/** Escape ký tự HTML-nhạy (fullName/companyName là dữ liệu công ty — phòng injection vào body email). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
