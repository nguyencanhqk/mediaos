import { z } from "zod";

/**
 * CS-8 Cấu hình mail server (SMTP, 🔴 SECRET) — nguồn sự thật contract api ↔ console.
 *
 * BẤT BIẾN SECRET (#1 plan §4):
 *   - SMTP password = reversible → envelope-KMS server-side (purpose 'smtp_password'). DTO view (GET) KHÔNG
 *     bao giờ chứa password hay cột envelope; chỉ host/port/username/from/secure/scope + cờ `hasPassword`.
 *   - PUT: password OPTIONAL. Có → re-encrypt; vắng → giữ envelope cũ (KHÔNG xoá secret) — CHỈ khi đích
 *     (host/port/username/secure) khớp nguyên hàng đã lưu (S19-SEC-MAILCREDEXFIL-1).
 *   - Mật khẩu ĐÃ LƯU chỉ dùng cho ĐÚNG đích đã lưu: đổi đích ⇒ phải gửi password mới, không thì 400
 *     `FOUNDATION-ERR-MAIL-PASSWORD-REQUIRED` (PUT lẫn test). `secure` vắng = `true` khi so.
 *   - test connection: `errorMessage` là câu cố định theo loại lỗi — KHÔNG mang chữ nào của server.
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
 *   - có → re-encrypt thành envelope mới (đổi đích được);
 *   - vắng (undefined) → giữ envelope cũ NẾU đã tồn tại VÀ host/port/username/secure khớp nguyên hàng đã lưu
 *     (chỉ đổi from_name/from_email); đổi đích hoặc tạo MỚI mà vắng password → 400
 *     `FOUNDATION-ERR-MAIL-PASSWORD-REQUIRED`. `secure` vắng = `true` ⇒ client khác FE phải gửi `secure`
 *     tường minh khi hàng đang `false`.
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
 * Có `password` → test đích trong body bằng password đó. Vắng `password` → server decrypt envelope đã lưu
 * và test ĐÍCH CỦA HÀNG ĐÃ LƯU; đích trong body khác hàng (hoặc chưa có cấu hình) → 400
 * `FOUNDATION-ERR-MAIL-PASSWORD-REQUIRED`, không kết nối đi đâu cả.
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
 * Kết quả test. `errorMessage` = câu cố định theo loại lỗi (dựng từ trường máy-sinh) — KHÔNG mang byte nào
 * do đầu bên kia gửi (banner, lời từ chối, chuỗi OpenSSL), nên route test không thành công cụ đọc banner
 * dịch vụ nội bộ.
 */
export const mailTestResultSchema = z.object({
  ok: z.boolean(),
  errorMessage: z.string().nullable().optional(),
});
export type MailTestResult = z.infer<typeof mailTestResultSchema>;

/** Permission key CS-8 (sensitive — cấu hình mail server tenant self-service). */
export const CONFIGURE_MAIL_ACTION = "configure-mail" as const;
export const CONFIGURE_MAIL_RESOURCE_TYPE = "company" as const;
