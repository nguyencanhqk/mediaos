import { z } from "zod";

/**
 * CS-8 Cấu hình mail server (SMTP, 🔴 SECRET) — nguồn sự thật contract api ↔ console.
 *
 * BẤT BIẾN SECRET (#1 plan §4):
 *   - SMTP password = reversible → envelope-KMS server-side (purpose 'smtp_password'). DTO view (GET) KHÔNG
 *     bao giờ chứa password hay cột envelope; chỉ host/port/username/from/secure/scope + cờ `hasPassword`.
 *   - PUT: password OPTIONAL. Có → re-encrypt; vắng → giữ envelope cũ (KHÔNG xoá secret).
 *   - test connection: kết quả ĐÃ sanitize — KHÔNG echo credential vào message/log.
 *
 * companyId LẤY TỪ JWT (server) — KHÔNG nhận từ body/param (chống cross-tenant).
 */

/** Purpose KMS cho SMTP password (mirror KeyPurpose union ở api/src/crypto). */
export const SMTP_SECRET_PURPOSE = "smtp_password" as const;

/**
 * scope: 'default' (cấu hình mặc định toàn công ty) | 'app:<KEY>' (override theo app, vd 'app:studio').
 * KEY = chữ thường/số/`-`/`_` (1..40). 1 config / scope / công ty (UNIQUE(company_id, scope)).
 */
export const mailConfigScopeSchema = z
  .string()
  .max(64)
  .regex(/^(default|app:[a-z0-9_-]{1,40})$/, {
    message: "scope phải là 'default' hoặc 'app:<KEY>' (KEY chữ thường/số/-/_).",
  });
export type MailConfigScope = z.infer<typeof mailConfigScopeSchema>;

/** Cổng SMTP hợp lệ (1..65535). */
const smtpPortSchema = z.number().int().min(1).max(65535);

/**
 * DTO view 1 cấu hình mail (GET) — KHÔNG password / KHÔNG cột envelope. `hasPassword` = đã có secret lưu chưa.
 */
export const mailConfigSchema = z.object({
  scope: mailConfigScopeSchema,
  host: z.string().min(1),
  port: smtpPortSchema,
  username: z.string().min(1),
  secure: z.boolean(),
  fromName: z.string().nullable(),
  fromEmail: z.string().email(),
  /** TRUE khi đã có password envelope lưu (KHÔNG bao giờ trả password thật). */
  hasPassword: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type MailConfigDto = z.infer<typeof mailConfigSchema>;

/** GET /settings/mail-config trả danh sách các scope đã thiết lập (rỗng = chưa thiết lập). */
export const mailConfigListSchema = z.object({
  configs: z.array(mailConfigSchema),
});
export type MailConfigListDto = z.infer<typeof mailConfigListSchema>;

/**
 * PUT /settings/mail-config — upsert theo (company, scope). `password` OPTIONAL:
 *   - có → re-encrypt thành envelope mới;
 *   - vắng (undefined) → giữ envelope cũ NẾU đã tồn tại; nếu tạo MỚI mà vắng password → server từ chối.
 * companyId KHÔNG nhận từ client (lấy từ JWT).
 */
export const upsertMailConfigSchema = z.object({
  scope: mailConfigScopeSchema.optional(),
  host: z.string().min(1).max(255),
  port: smtpPortSchema,
  username: z.string().min(1).max(255),
  secure: z.boolean().optional(),
  fromName: z.string().max(255).nullable().optional(),
  fromEmail: z.string().email().max(320),
  /** Plaintext SMTP password — chỉ tồn tại trong RAM (encrypt). KHÔNG bao giờ trả về / log. */
  password: z.string().min(1).max(1024).optional(),
});
export type UpsertMailConfigRequest = z.infer<typeof upsertMailConfigSchema>;

/**
 * POST /settings/mail-config/test — kiểm tra kết nối SMTP (handshake `verify()`, KHÔNG gửi mail).
 * Dùng config đang gửi; nếu vắng `password` thì server decrypt từ envelope đã lưu để test.
 */
export const testMailConfigSchema = z.object({
  scope: mailConfigScopeSchema.optional(),
  host: z.string().min(1).max(255),
  port: smtpPortSchema,
  username: z.string().min(1).max(255),
  secure: z.boolean().optional(),
  password: z.string().min(1).max(1024).optional(),
});
export type TestMailConfigRequest = z.infer<typeof testMailConfigSchema>;

/**
 * Kết quả test — ĐÃ sanitize. `errorMessage` KHÔNG chứa username/password (server lọc trước khi trả).
 */
export const mailTestResultSchema = z.object({
  ok: z.boolean(),
  errorMessage: z.string().nullable().optional(),
});
export type MailTestResult = z.infer<typeof mailTestResultSchema>;

/** Permission key CS-8 (sensitive — cấu hình mail server tenant self-service). */
export const CONFIGURE_MAIL_ACTION = "configure-mail" as const;
export const CONFIGURE_MAIL_RESOURCE_TYPE = "company" as const;
