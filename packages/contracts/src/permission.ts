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

// ─── (C) role write (S2-AUTH-BE-6) — create/update role + assign/revoke permission cho role ────

/**
 * POST /auth/roles — tạo role company-scope. system role (is_system=true) KHÔNG tạo qua đây (server
 * luôn set is_system=false — field không nhận từ client, chống giả mạo role hệ thống).
 */
export const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  // S2-AUTH-BE-11 (additive): cờ ép 2FA cho MỌI user mang role này (roles.requires_two_factor).
  // Optional ⇒ client cũ không gửi vẫn hợp lệ (server mặc định false) — non-breaking.
  requiresTwoFactor: z.boolean().optional(),
});
export type CreateRoleRequest = z.infer<typeof createRoleSchema>;

/**
 * PATCH /auth/roles/:id — sửa name/description. role system-defined (is_system=true) → server REJECT
 * (400) — KHÔNG cho sửa. Cả 2 field optional (dirty-fields patch).
 */
export const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  // S2-AUTH-BE-11 (additive): bật/tắt ép 2FA cho role. Optional (dirty-fields patch); gửi kèm cho role
  // system-defined (is_system=true) vẫn bị server REJECT 400 như các field khác — non-breaking.
  requiresTwoFactor: z.boolean().optional(),
});
export type UpdateRoleRequest = z.infer<typeof updateRoleSchema>;

/** DTO 1 role trả về sau khi create/update (KHÔNG lộ role operator-audience qua đường write này). */
export const roleWriteResultSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  // S2-AUTH-BE-11 (additive): phản chiếu roles.requires_two_factor sau create/update để FE render trạng thái.
  requiresTwoFactor: z.boolean(),
});
export type RoleWriteResultDto = z.infer<typeof roleWriteResultSchema>;

/**
 * DELETE /auth/roles/:id — kết quả xoá MỀM role (soft-delete, BẤT BIẾN #2). CASCADE: mọi gán vai trò
 * (user_roles) đang active bị soft-delete kèm ⇒ thành viên MẤT quyền của vai trò này ngay ở request kế
 * (engine đọc thẳng DB, không cache). `revokedMembers` = số thành viên bị gỡ (FE báo lại). system role
 * (is_system=true) → server REJECT 400 (KHÔNG cho xoá).
 */
export const roleDeleteResultSchema = z.object({
  id: z.string().uuid(),
  revokedMembers: z.number().int().nonnegative(),
});
export type RoleDeleteResultDto = z.infer<typeof roleDeleteResultSchema>;

/**
 * POST /auth/roles/:id/permissions — gán 1 cặp permission (action+resourceType) cho role, kèm data_scope.
 * SCOPE CEILING (CHỐT 2026-07-02): dataScope PHẢI ≤ Company — 'System' → REJECT 400 (tenant-admin KHÔNG
 * được gán System = mở lại đúng cái mig 0441 tránh nới scope role hệ thống).
 */
export const assignRolePermissionSchema = z.object({
  action: z.string().min(1).max(100),
  resourceType: z.string().min(1).max(100),
  dataScope: z.enum(["Own", "Team", "Department", "Company"]),
});
export type AssignRolePermissionRequest = z.infer<typeof assignRolePermissionSchema>;

/** DELETE /auth/roles/:id/permissions — body xác định chính xác cặp cần gỡ (action+resourceType). */
export const revokeRolePermissionSchema = z.object({
  action: z.string().min(1).max(100),
  resourceType: z.string().min(1).max(100),
});
export type RevokeRolePermissionRequest = z.infer<typeof revokeRolePermissionSchema>;

/** DTO 1 role_permission grant trả về sau khi assign (role_permissions không có uuid PK riêng). */
export const rolePermissionGrantSchema = z.object({
  roleId: z.string().uuid(),
  permissionId: z.string().uuid(),
  action: z.string(),
  resourceType: z.string(),
  effect: permissionEffectEnum,
  dataScope: z.enum(["Own", "Team", "Department", "Company", "System"]),
});
export type RolePermissionGrantDto = z.infer<typeof rolePermissionGrantSchema>;

// ─── (C.rule) S2-AUTH-PERMRULE-1 — gán quyền theo LUẬT khớp mẫu (rule builder) ──────────────────
// Bung 1 luật (match trên catalog × action-preset × scope) → grant khớp; xem trước (dryRun) rồi áp.
// KHÔNG cổng ghi mới: server áp qua assignPermissionToRole (assign:permission isSensitive, ceiling ≤ Company).

/** Preset nhóm action: read-only (view/read/list*) · crud · custom (dùng match.actions). */
export const permissionRuleActionPresetEnum = z.enum(["read-only", "crud", "custom"]);
export type PermissionRuleActionPreset = z.infer<typeof permissionRuleActionPresetEnum>;

/**
 * POST /auth/roles/:id/permissions/apply-rule — request. effect CHỈ 'ALLOW' (MVP; DENY thủ công).
 * dataScope KHÔNG có 'System' (scope-ceiling). includeSensitive default false; server CHẶN
 * (includeSensitive && resourceTypes rỗng) để không "gán mọi quyền nhạy cảm 1 phát".
 */
export const applyPermissionRuleSchema = z.object({
  match: z.object({
    resourceTypes: z.array(z.string().min(1).max(100)).max(300).default([]),
    actionPreset: permissionRuleActionPresetEnum,
    actions: z.array(z.string().min(1).max(100)).max(300).default([]),
    includeSensitive: z.boolean().default(false),
  }),
  effect: z.literal("ALLOW"),
  dataScope: z.enum(["Own", "Team", "Department", "Company"]),
  dryRun: z.boolean(),
});
export type ApplyPermissionRuleRequest = z.infer<typeof applyPermissionRuleSchema>;

const permissionRulePairSchema = z.object({
  action: z.string(),
  resourceType: z.string(),
  isSensitive: z.boolean(),
});

/** Kết quả bung luật (preview khi dryRun; kèm applied[] khi áp thật). */
export const permissionRulePreviewSchema = z.object({
  dryRun: z.boolean(),
  /** Cặp chưa có ALLOW → sẽ thêm ở dataScope mục tiêu. */
  toAdd: z.array(permissionRulePairSchema.extend({ dataScope: z.string() })),
  /** Cặp đã có ALLOW khác scope → đổi (DELETE+INSERT); fromScope→toScope để FE nêu hướng. */
  toChangeScope: z.array(
    permissionRulePairSchema.extend({ fromScope: z.string(), toScope: z.string() }),
  ),
  /** Bỏ qua: 'already-granted' (đã ALLOW cùng scope) | 'denied' (đang có DENY, rule không ghi đè). */
  skipped: z.array(
    permissionRulePairSchema.extend({ reason: z.enum(["already-granted", "denied"]) }),
  ),
  /** Loại do nhạy cảm khi includeSensitive=false. */
  excludedSensitive: z.array(permissionRulePairSchema),
  counts: z.object({
    toAdd: z.number().int().nonnegative(),
    toChangeScope: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    excludedSensitive: z.number().int().nonnegative(),
  }),
  /** null khi dryRun; khi áp thật = kết quả từng grant. */
  applied: z
    .array(
      z.object({
        action: z.string(),
        resourceType: z.string(),
        status: z.enum(["ok", "error"]),
        detail: z.string().nullable(),
      }),
    )
    .nullable(),
});
export type PermissionRulePreview = z.infer<typeof permissionRulePreviewSchema>;
