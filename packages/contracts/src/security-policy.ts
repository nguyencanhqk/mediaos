import { z } from "zod";

/**
 * CS-9 Bảo mật nâng cao (per-company security policy) — nguồn sự thật contract api ↔ console.
 *
 * Chính sách bảo mật MỖI CÔNG TY (1 hàng/tenant), enforce THẬT ở tầng auth (login/refresh/2FA) +
 * lúc tạo tài khoản (email-domain). Validate CHẶT ở contract (CIDR / HH:MM / domain) để logic
 * enforce KHÔNG fail-mở vì parse rác (BẤT BIẾN enforcement #ip-time, rủi ro §6 "regex sai → fail mở").
 *
 * QUY TẮC rỗng (xem evaluate() server-side — fail-OPEN cho IP, fail-CLOSED cho time):
 *   - ip_restriction_enabled=true + allowlist_cidrs=[]  ⇒ coi như TẮT (chưa cấu hình, không tự khoá).
 *   - time_restriction_enabled=true + time_windows=[]    ⇒ CHẶN (không cửa sổ hợp lệ).
 */

/** Mã lỗi máy-đọc-được khi login/refresh bị chặn bởi chính sách IP/giờ. FE hiển thị thông báo phù hợp. */
export const ACCESS_RESTRICTED_CODE = "ACCESS_RESTRICTED" as const;

/**
 * CIDR (IPv4 hoặc IPv6) — validate CHẶT cú pháp + bound prefix. Server (evaluate) so khớp IP-in-CIDR;
 * contract chỉ chặn rác (chống fail-open do parse lỗi). Chấp nhận cả IPv4 (/0–/32) và IPv6 (/0–/128).
 */
const ipv4Octet = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const ipv4Address = `${ipv4Octet}(\\.${ipv4Octet}){3}`;
const ipv4Cidr = new RegExp(`^${ipv4Address}/(3[0-2]|[12]?\\d)$`);
// IPv6: chấp nhận dạng đầy đủ/nén (::) — kiểm cấu trúc cơ bản + prefix 0–128. Không cố bắt mọi biến thể
// hiếm (server dùng cùng matcher); mục tiêu là chặn rác, không phải validator IPv6 RFC đầy đủ.
const ipv6Cidr = /^([0-9a-fA-F:]+:+[0-9a-fA-F]*)(\/(12[0-8]|1[01]\d|\d?\d))$/;

export const cidrSchema = z
  .string()
  .trim()
  .min(1)
  .max(49)
  .refine((v) => ipv4Cidr.test(v) || ipv6Cidr.test(v), {
    message: "CIDR không hợp lệ (vd 203.0.113.0/24 hoặc 2001:db8::/32).",
  });

/** "HH:MM" 24h (00:00–23:59). */
const hhmmRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const hhmmSchema = z
  .string()
  .trim()
  .regex(hhmmRegex, { message: "Giờ không hợp lệ (định dạng HH:MM 24h, vd 08:30)." });

/**
 * 1 cửa sổ thời gian được phép. `day` 0–6 (0=Chủ nhật … 6=Thứ bảy, khớp Date.getUTCDay/getDay). Cho phép
 * end < start (cửa sổ qua nửa đêm) — server xử lý wrap. start === end ⇒ KHÔNG hợp lệ (cửa sổ rỗng) → từ chối.
 */
export const timeWindowSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    start: hhmmSchema,
    end: hhmmSchema,
  })
  .refine((w) => w.start !== w.end, {
    message: "Cửa sổ thời gian rỗng (start trùng end).",
  });
export type TimeWindow = z.infer<typeof timeWindowSchema>;

/**
 * Tên miền email (vd "company.com") — chữ thường, không '@', ít nhất 1 dấu chấm. So khớp suffix server-side
 * (user@x.company.com khớp domain "company.com"). Chuẩn hoá về lowercase.
 */
export const emailDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, {
    message: "Tên miền không hợp lệ (vd company.com).",
  });

/** apply_scope — phạm vi áp chính sách: tất cả app, hoặc chỉ app được chọn (apply_app_keys). */
export const applyScopeEnum = z.enum(["all", "selected"]);
export type ApplyScope = z.infer<typeof applyScopeEnum>;

/**
 * DTO chính sách bảo mật đầy đủ (GET /settings/security-policy). 1 hàng/công ty. Khi công ty CHƯA cấu
 * hình, server trả default (mọi cờ false / null) — KHÔNG 404 (policy mặc định = không enforce).
 */
export const securityPolicySchema = z.object({
  /** null = tắt tự-động-đăng-xuất. >0 = số phút idle trước khi web-core gọi logout. */
  autoLogoutMinutes: z.number().int().positive().max(1440).nullable(),
  ipRestrictionEnabled: z.boolean(),
  allowlistCidrs: z.array(cidrSchema),
  timeRestrictionEnabled: z.boolean(),
  timeWindows: z.array(timeWindowSchema),
  applyScope: applyScopeEnum,
  applyAppKeys: z.array(z.string().min(1).max(64)),
  exemptUserIds: z.array(z.string().uuid()),
  emailDomainRestrictionEnabled: z.boolean(),
  allowedEmailDomains: z.array(emailDomainSchema),
  /** null = theo sàn global (TWO_FACTOR_ENFORCEMENT_ENABLED). true = ép thêm cho công ty. KHÔNG hạ global. */
  twoFactorEnforced: z.boolean().nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type SecurityPolicyDto = z.infer<typeof securityPolicySchema>;

/**
 * PATCH /settings/security-policy — cập nhật (upsert). Mọi field OPTIONAL (partial update). companyId
 * LẤY TỪ JWT (KHÔNG nhận từ body). Validate CHẶT cùng schema CIDR/HH:MM/domain ở trên (fail-fast tại biên).
 *
 * exemptUserIds nhận uuid[] — server KHÔNG kiểm các id có thuộc công ty (RLS lọc khi áp); danh sách thừa
 * id-ngoài-tenant vô hại (không khớp user nào). Người gọi PATCH luôn được miễn (server tự thêm — chống tự khoá).
 */
export const updateSecurityPolicySchema = z
  .object({
    autoLogoutMinutes: z.number().int().positive().max(1440).nullable().optional(),
    ipRestrictionEnabled: z.boolean().optional(),
    allowlistCidrs: z.array(cidrSchema).max(256).optional(),
    timeRestrictionEnabled: z.boolean().optional(),
    timeWindows: z.array(timeWindowSchema).max(128).optional(),
    applyScope: applyScopeEnum.optional(),
    applyAppKeys: z.array(z.string().min(1).max(64)).max(64).optional(),
    exemptUserIds: z.array(z.string().uuid()).max(1024).optional(),
    emailDomainRestrictionEnabled: z.boolean().optional(),
    allowedEmailDomains: z.array(emailDomainSchema).max(256).optional(),
    twoFactorEnforced: z.boolean().nullable().optional(),
  })
  .strict();
export type UpdateSecurityPolicyRequest = z.infer<typeof updateSecurityPolicySchema>;
