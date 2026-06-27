import { z } from "zod";

/**
 * Users — DTO hồ sơ người dùng. Module 2a: self-service (cập nhật hồ sơ của chính mình).
 * Nền cho Module 2b (admin user CRUD) mở rộng sau.
 */

/**
 * Cập nhật hồ sơ của CHÍNH user (self-service). CHỈ field non-sensitive — `email` là định danh (immutable
 * theo tenant), `status` do admin quản. `fullName` trim + bắt buộc ≥ 1 ký tự (không cho xoá trắng tên).
 */
export const updateProfileRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

// ─── Module 2b: Admin user CRUD (ACCT-2) ─────────────────────────────────────

/**
 * Permission keys quản trị user (đồng bộ seed migration 0430 + @RequirePermission ở controller).
 *   - VIEW/UPDATE: `manage:user` (is_sensitive=false) — đọc danh sách + sửa hồ sơ.
 *   - SUSPEND/DELETE: SENSITIVE (is_sensitive=true ở CẢ seed lẫn decorator) → chống *:* wildcard bypass.
 * resourceType chung = 'user'.
 */
export const ADMIN_USER_RESOURCE_TYPE = "user" as const;
export const MANAGE_USER_ACTION = "manage" as const;
export const SUSPEND_USER_ACTION = "suspend" as const;
/** Action xoá-mềm user — tách khỏi 'delete' non-sensitive sẵn có để gắn is_sensitive=true riêng. */
export const DELETE_USER_ACTION = "delete-user" as const;

/** Trạng thái tài khoản admin quản (đồng bộ CHECK migration 0430). 'active' | 'suspended'. */
export const USER_STATUSES = ["active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * DTO view 1 user (admin). KHÔNG passwordHash/tokenHash (mask ở SERVER — repo SELECT cột tường minh).
 * `deletedAt` để FE phân biệt user đã xoá-mềm (nếu list bao gồm — mặc định list chỉ live).
 */
export const adminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().nullable(),
  status: z.enum(USER_STATUSES),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type AdminUserDto = z.infer<typeof adminUserSchema>;

/** GET /users/admin — danh sách + tổng (cho pagination). Route: AdminUsersController @Controller('users/admin'). */
export const adminUserListSchema = z.object({
  users: z.array(adminUserSchema),
  total: z.number().int().nonnegative(),
});
export type AdminUserListDto = z.infer<typeof adminUserListSchema>;

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MIN = 1;
const LIST_LIMIT_MAX = 100;

/**
 * Query GET /users/admin — filter status?/q? + phân trang. limit clamp [1..100] default 50; offset ≥0 default 0.
 * `coerce` để nhận query-string (vd ?limit=10). `.catch` để input rác → default (không 400 cho list đọc).
 */
export const listUsersQuerySchema = z.object({
  status: z.enum(USER_STATUSES).optional(),
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
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/**
 * PATCH /users/:id — CHỈ field non-sensitive. `status` đổi qua suspend/reactivate (cổng nhạy cảm riêng);
 * `email` là định danh tenant (immutable); KHÔNG bao giờ nhận passwordHash/role qua đây. `.strict` chống
 * field lạ leo thang.
 */
export const updateUserRequestSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
  })
  .strict();
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

/** POST /users/:id/suspend — reason optional (ghi vào audit). `.strict` chống field lạ. */
export const suspendUserRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type SuspendUserRequest = z.infer<typeof suspendUserRequestSchema>;
