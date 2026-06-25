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

/** 1 role (catalog gán quyền). isSystem=true ⇒ role hệ thống (company_id NULL). */
export const roleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
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
