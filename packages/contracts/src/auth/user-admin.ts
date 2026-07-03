import { z } from "zod";

/**
 * S2-AUTH-BE-3 — User admin DTOs cho /auth/users (list/get/create/update/lock/unlock).
 *
 * NGUỒN SỰ THẬT permission-pair (seed mig 0444/0450): backend gate trên CẶP CANONICAL
 *   view:user · create:user · update:user · lock:user · unlock:user (resource_type='user').
 * KHÔNG dùng legacy manage:user/suspend:user/delete-user (đó là surface ACCT-2 users/admin cũ).
 *
 * Tách subdir auth/ (additive) khỏi flat users.ts để KHÔNG đụng AdminUser* (ACCT-2) — TÊN export
 * RIÊNG (auth*) tránh trùng ở barrel re-export. masking = việc SERVER: DTO view KHÔNG passwordHash.
 */

/** resource_type chung cho mọi permission user-admin (đồng bộ catalog 0005/0444/0450). */
export const AUTH_USER_RESOURCE_TYPE = "user" as const;

/**
 * Permission-pair canonical (action, resourceType) — gate @RequirePermission ở controller PHẢI khớp
 * cặp THỰC trong seed (bài học s1-fnd drift: BE gate trên cặp seed, KHÔNG theo tên FE). lock/unlock
 * KHÔNG is_sensitive theo §13 (catalog 0444/0450 is_sensitive=false) — đừng khai isSensitive ở decorator.
 */
export const AUTH_USER = {
  RESOURCE: AUTH_USER_RESOURCE_TYPE,
  VIEW: { action: "view", resource: AUTH_USER_RESOURCE_TYPE },
  CREATE: { action: "create", resource: AUTH_USER_RESOURCE_TYPE },
  UPDATE: { action: "update", resource: AUTH_USER_RESOURCE_TYPE },
  LOCK: { action: "lock", resource: AUTH_USER_RESOURCE_TYPE },
  UNLOCK: { action: "unlock", resource: AUTH_USER_RESOURCE_TYPE },
  // S2-AUTH-BE-12 — reset 2FA của user khác (privileged). Cặp seed THẬT is_sensitive=true (mig 0466) ⇒
  // controller PHẢI khai isSensitive ở decorator (wildcard *:* KHÔNG thoả cổng sensitive).
  RESET_2FA: { action: "reset-2fa", resource: AUTH_USER_RESOURCE_TYPE },
} as const;

/**
 * Trạng thái tài khoản — đồng bộ users_status_chk (mig 0002 + widen 0450 thêm 'locked').
 * 'locked' do admin khoá (chặn login qua allow-list status==='active' ở AuthService). 'suspended'
 * = surface ACCT-2 cũ (giữ để tương thích CHECK). 'invited' = chờ kích hoạt (CS-10).
 */
export const AUTH_USER_STATUSES = ["active", "invited", "suspended", "locked"] as const;
export type AuthUserStatus = (typeof AUTH_USER_STATUSES)[number];

/**
 * DTO view 1 user (auth admin). KHÔNG passwordHash/normalizedEmail (mask ở SERVER — repo SELECT cột
 * tường minh). lockedAt/lockedReason để FE hiển thị trạng thái khoá; KHÔNG bao giờ phơi failedLoginCount
 * nhạy cảm-vận hành trừ khi spec yêu cầu (ẩn mặc định).
 */
export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().nullable(),
  status: z.enum(AUTH_USER_STATUSES),
  lockedAt: z.string().datetime().nullable(),
  lockedReason: z.string().nullable(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AuthUserDto = z.infer<typeof authUserSchema>;

/** GET /auth/users — danh sách + tổng (pagination). */
export const authUserListSchema = z.object({
  users: z.array(authUserSchema),
  total: z.number().int().nonnegative(),
});
export type AuthUserListDto = z.infer<typeof authUserListSchema>;

/**
 * S2-AUTH-BE-12 — DTO view CHI TIẾT 1 user (GET /auth/users/:id). Mở rộng authUserSchema thêm khối
 * `twoFactor` với 3 CỜ TÁCH NGUỒN (KHÔNG lẫn nhau):
 *   - enabled        : user_totp.enabled_at != null (đã bật 2FA thật).
 *   - requiredByRole : join roles.requires_two_factor (ÉP theo ROLE, mig 0120) qua active user_roles — CHỈ role.
 *   - requiredByUser : users.require_two_factor (ÉP PER-USER, mig 0466) — đọc thẳng cột.
 * DTO RIÊNG cho GET /:id (KHÔNG chạm authUserSchema dùng cho list → tránh N+1 lộ 2FA mỗi row). TUYỆT ĐỐI
 * KHÔNG chứa secret TOTP (secret_ciphertext/encrypted_dek/iv_nonce/auth_tag) — mask ở SERVER (BẤT BIẾN #3).
 */
export const authUserTwoFactorSchema = z.object({
  enabled: z.boolean(),
  requiredByRole: z.boolean(),
  requiredByUser: z.boolean(),
});
export type AuthUserTwoFactorDto = z.infer<typeof authUserTwoFactorSchema>;

export const authUserDetailSchema = authUserSchema.extend({
  twoFactor: authUserTwoFactorSchema,
});
export type AuthUserDetailDto = z.infer<typeof authUserDetailSchema>;

/** POST /auth/users/:id/2fa/reset — kết quả reset (KHÔNG secret): số phiên bị thu hồi (forensic). */
export const authUserTwoFactorResetSchema = z.object({
  revokedSessionCount: z.number().int().nonnegative(),
});
export type AuthUserTwoFactorResetDto = z.infer<typeof authUserTwoFactorResetSchema>;

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MIN = 1;
const LIST_LIMIT_MAX = 100;

/**
 * Query GET /auth/users — filter status?/q? + phân trang. limit clamp [1..100] default 50; offset ≥0.
 * `coerce` để nhận query-string; `.catch` để input rác → default (list đọc KHÔNG nên 400 vì limit rác).
 */
export const listAuthUsersQuerySchema = z.object({
  status: z.enum(AUTH_USER_STATUSES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .catch(LIST_LIMIT_DEFAULT)
    .transform((n) => Math.min(LIST_LIMIT_MAX, Math.max(LIST_LIMIT_MIN, n)))
    .default(LIST_LIMIT_DEFAULT),
  offset: z.coerce
    .number()
    .int()
    .catch(0)
    .transform((n) => Math.max(0, n))
    .default(0),
});
export type ListAuthUsersQuery = z.infer<typeof listAuthUsersQuerySchema>;

/**
 * Độ mạnh mật khẩu khi tạo user (chặn weak ở DTO boundary — BẤT BIẾN input-validation). ≥10 ký tự,
 * có chữ thường + chữ hoa + số. Plaintext CHỈ dùng để hash ở service (PasswordService.hash), KHÔNG
 * lưu/log/return (BẤT BIẾN #3).
 */
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN)
  .max(PASSWORD_MAX)
  .regex(/[a-z]/, "Mật khẩu phải có chữ thường.")
  .regex(/[A-Z]/, "Mật khẩu phải có chữ hoa.")
  .regex(/[0-9]/, "Mật khẩu phải có chữ số.");

/**
 * POST /auth/users — tạo user. email = định danh tenant; password = plaintext (hash ở service).
 * `.strict` chặn field lạ leo thang (vd passwordHash/status/role qua body). status mặc định 'active'
 * ở DB — KHÔNG nhận qua đây.
 */
export const createAuthUserRequestSchema = z
  .object({
    email: z.string().trim().email().max(255),
    password: newPasswordSchema,
    fullName: z.string().trim().min(1).max(200),
  })
  .strict();
export type CreateAuthUserRequest = z.infer<typeof createAuthUserRequestSchema>;

/**
 * PATCH /auth/users/:id — field non-sensitive (fullName) + cờ ép 2FA per-user (requireTwoFactor, mig 0466).
 * `email` immutable (định danh tenant); `status` đổi qua lock/unlock (cổng riêng); KHÔNG bao giờ nhận
 * password/role. `.strict` chống field lạ leo thang.
 *
 * S2-AUTH-BE-12: `fullName` → OPTIONAL (non-breaking — client có thể PATCH chỉ requireTwoFactor); thêm
 * `requireTwoFactor` optional. Cả 2 optional ⇒ body rỗng {} hợp lệ (service phát hiện no-op → KHÔNG audit).
 */
export const updateAuthUserRequestSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    requireTwoFactor: z.boolean().optional(),
  })
  .strict();
export type UpdateAuthUserRequest = z.infer<typeof updateAuthUserRequestSchema>;

/** POST /auth/users/:id/lock — reason optional (ghi vào audit + lockedReason). `.strict`. */
export const lockAuthUserRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type LockAuthUserRequest = z.infer<typeof lockAuthUserRequestSchema>;
