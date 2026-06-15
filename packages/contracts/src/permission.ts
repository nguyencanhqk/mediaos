import { z } from "zod";

/**
 * G3 mutation-path — runtime permission management DTOs.
 *
 * Hai mutation: (A) gán/thu role cho user (`user_roles`), (B) set/xoá object-permission
 * (`object_permissions`). Mọi mutation NHẠY CẢM (leo thang đặc quyền) → server ép quyền
 * `assign-role:user` / `grant-object-permission:permission` + audit + emit `permission.changed`.
 */

export const permissionEffectEnum = z.enum(["ALLOW", "DENY"]);
export type PermissionEffect = z.infer<typeof permissionEffectEnum>;

export const objectSubjectTypeEnum = z.enum(["user", "role"]);
export type ObjectSubjectType = z.infer<typeof objectSubjectTypeEnum>;

// ─── (A) gán role cho user ─────────────────────────────────────────────────────

/** POST /permissions/users/:userId/roles — body. expiresAt null/absent = role vĩnh viễn. */
export const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
  /** Thời điểm role hết hạn (ISO datetime). null/bỏ trống = không hết hạn. */
  expiresAt: z.string().datetime().nullable().optional(),
});
export type AssignRoleRequest = z.infer<typeof assignRoleSchema>;

/** DTO 1 user_role grant trả về sau khi gán. */
export const userRoleSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  companyId: z.string().uuid(),
  grantedBy: z.string().uuid().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type UserRoleDto = z.infer<typeof userRoleSchema>;

// ─── (B) object-permission (override theo từng object) ─────────────────────────

/**
 * PUT /permissions/object — set (insert/upsert) 1 object-permission.
 * action/resourceType khớp catalog `permissions`; objectType/objectId = object đích.
 */
export const setObjectPermissionSchema = z.object({
  subjectType: objectSubjectTypeEnum,
  subjectId: z.string().uuid(),
  action: z.string().min(1).max(100),
  resourceType: z.string().min(1).max(100),
  objectType: z.string().min(1).max(100),
  objectId: z.string().uuid(),
  effect: permissionEffectEnum,
});
export type SetObjectPermissionRequest = z.infer<typeof setObjectPermissionSchema>;

/**
 * DELETE /permissions/object — body để xác định chính xác hàng cần xoá.
 * (Không nhận `effect` — xoá cả ALLOW lẫn DENY của bộ key này là sai ngữ nghĩa;
 *  effect là một phần khoá định danh override.)
 */
export const removeObjectPermissionSchema = z.object({
  subjectType: objectSubjectTypeEnum,
  subjectId: z.string().uuid(),
  action: z.string().min(1).max(100),
  resourceType: z.string().min(1).max(100),
  objectType: z.string().min(1).max(100),
  objectId: z.string().uuid(),
  effect: permissionEffectEnum,
});
export type RemoveObjectPermissionRequest = z.infer<typeof removeObjectPermissionSchema>;

/** DTO 1 object_permission grant trả về sau khi set. */
export const objectPermissionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  subjectType: objectSubjectTypeEnum,
  subjectId: z.string().uuid(),
  permissionId: z.string().uuid(),
  objectType: z.string(),
  objectId: z.string().uuid(),
  effect: permissionEffectEnum,
  grantedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type ObjectPermissionDto = z.infer<typeof objectPermissionSchema>;
