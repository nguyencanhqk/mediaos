import { z } from "zod";

/**
 * S2-AUTH-BE-3 — read-only catalogs cho UI gán quyền (GET /auth/roles · GET /auth/permissions).
 *
 * CHỈ ĐỌC — không mutate. roles: tenant-own + system (company_id NULL) nhưng LOẠI operator-audience
 * (platform-admin) ở repository (chống leo thang chéo tenant — mirror notOperatorRole). permissions =
 * global catalog (no RLS, app role SELECT-only).
 */

/** Pair permission canonical cho cổng read 2 catalog (đồng bộ seed 0444). */
export const AUTH_ROLE = { action: "view", resource: "role" } as const;
export const AUTH_PERMISSION = { action: "view", resource: "permission" } as const;

/**
 * 1 role (catalog gán quyền). isSystem=true ⇒ role hệ thống (company_id NULL).
 *
 * `requiresTwoFactor` (S7-SEC-ROLE2FA-UI-1): phản chiếu roles.requires_two_factor. Endpoint này là
 * ĐƯỜNG ĐỌC DUY NHẤT của cờ ở tầng quản trị — KHÔNG có GET /auth/roles/:id, màn "Sửa vai trò"
 * prefill bằng list + find-by-id. Thiếu cột ở đây ⇒ form mặc định false ⇒ hiển thị sai VÀ khoá luôn
 * chiều TẮT (patch chỉ gửi field dirty). Bắt buộc (không `.optional()`) để mọi nơi dựng RoleDto phải
 * khai tường minh — mặc-định-ngầm chính là lỗi đang vá. ⚠️ Deploy: BE TRƯỚC FE (FE parse schema này).
 */
export const roleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  requiresTwoFactor: z.boolean(),
});
export type RoleDto = z.infer<typeof roleSchema>;

export const roleListSchema = z.object({
  roles: z.array(roleSchema),
});
export type RoleListDto = z.infer<typeof roleListSchema>;

/** 1 permission trong catalog. isSensitive=true ⇒ cổng nhạy cảm (không kế thừa qua '*:*'). */
export const permissionSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  resourceType: z.string(),
  isSensitive: z.boolean(),
});
export type PermissionCatalogDto = z.infer<typeof permissionSchema>;

export const permissionListSchema = z.object({
  permissions: z.array(permissionSchema),
});
export type PermissionListDto = z.infer<typeof permissionListSchema>;

/**
 * S2-AUTH-ROLEMEM-1 — GET /auth/roles/:id/members (tab Thành viên trên RoleDetailPage).
 * CHỈ trường account-level đã lộ sẵn qua GET /auth/users — KHÔNG PII HR (lương/CCCD…).
 * Membership là PER-TENANT (user_roles.company_id) kể cả với system role dùng chung.
 */
export const roleMemberSchema = z.object({
  userId: z.string().uuid(),
  /**
   * S6-SEC-IDENTITY-PROJ-1 (KI-053) — `.optional()`, KHÔNG `.nullable()`: server BỎ HẲN KHOÁ khi actor
   * ở ngoài `data_scope` của cặp danh bạ `view:user`. Dùng `null` để mang tin "ngoài scope" là lẫn
   * nghĩa với "không có giá trị" — đúng bẫy KI-052 (`leaderUserName`).
   *
   * ⚠️ FE PHẢI khai `.optional()` theo, nếu không server bỏ khoá = ZodError runtime dù HTTP 200, tức
   * vỡ TRẮNG màn hình cho đúng vai mà bản vá bảo vệ (memory `server-masking-needs-optional-fe-schema`).
   */
  email: z.string().optional(),
  fullName: z.string().nullable().optional(),
  status: z.string(),
  /** Hết hạn grant (null = vô hạn). Hàng đã hết hạn KHÔNG xuất hiện trong list. */
  expiresAt: z.coerce.date().nullable(),
  grantedAt: z.coerce.date(),
});
export type RoleMemberDto = z.infer<typeof roleMemberSchema>;

export const roleMemberListSchema = z.object({
  members: z.array(roleMemberSchema),
});
export type RoleMemberListDto = z.infer<typeof roleMemberListSchema>;

/**
 * S2-AUTH-PERMUX-1 — GET /auth/roles/:id/permissions (RolePermissionsPage v2 đọc trạng thái
 * ĐÃ GÁN thật). effect gồm cả DENY (hiển thị read-only ở UI — mutation vẫn ALLOW-only qua
 * POST/DELETE :id/permissions sẵn có).
 */
export const rolePermissionGrantRowSchema = z.object({
  action: z.string(),
  resourceType: z.string(),
  effect: z.enum(["ALLOW", "DENY"]),
  dataScope: z.string(),
  isSensitive: z.boolean(),
});
export type RolePermissionGrantRowDto = z.infer<typeof rolePermissionGrantRowSchema>;

export const rolePermissionGrantsSchema = z.object({
  grants: z.array(rolePermissionGrantRowSchema),
});
export type RolePermissionGrantsDto = z.infer<typeof rolePermissionGrantsSchema>;
