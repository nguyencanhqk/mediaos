/**
 * Hằng quyền module System (AUTH + FOUNDATION) — S2-FE-HR-3.
 * Cấu trúc: MODULE.RESOURCE.ACTION (CLAUDE.md §5 quy ước mã).
 * Dùng trong useCan(action, resourceType) qua engine pairs bên dưới.
 * KHÔNG dùng chuỗi inline / so sánh role trực tiếp.
 */
export const SYSTEM_PERMS = {
  USER: {
    VIEW: "AUTH.USER.VIEW",
    CREATE: "AUTH.USER.CREATE",
    UPDATE: "AUTH.USER.UPDATE",
    LOCK: "AUTH.USER.LOCK",
    UNLOCK: "AUTH.USER.UNLOCK",
    ASSIGN_ROLE: "AUTH.USER.ASSIGN_ROLE",
    SUSPEND: "AUTH.USER.SUSPEND",
    DELETE: "AUTH.USER.DELETE",
    // S2-FE-SYS-SEC-1 — admin gỡ 2FA của user khác (privileged, is_sensitive=true — mig 0466).
    RESET_2FA: "AUTH.USER.RESET_2FA",
    // S2-AUTH-USEROPS-1 — khôi phục user đã xóa mềm + admin đặt lại mật khẩu (is_sensitive=true — mig 0476).
    RESTORE: "AUTH.USER.RESTORE",
    RESET_PASSWORD: "AUTH.USER.RESET_PASSWORD",
  },
  ROLE: {
    VIEW: "AUTH.ROLE.VIEW",
    CREATE: "AUTH.ROLE.CREATE",
    UPDATE: "AUTH.ROLE.UPDATE",
    DELETE: "AUTH.ROLE.DELETE",
  },
  // S2-FE-AUTH-4 (lane FE batch C) — permission catalog (đọc) + assign/revoke cho role.
  PERMISSION: {
    VIEW: "AUTH.PERMISSION.VIEW",
    ASSIGN: "AUTH.PERMISSION.ASSIGN",
  },
  AUDIT_LOG: {
    VIEW: "FOUNDATION.AUDIT_LOG.VIEW",
  },
  SETTING: {
    VIEW: "FOUNDATION.SETTING.VIEW",
    UPDATE: "FOUNDATION.SETTING.UPDATE",
  },
  // S2-FE-FND-5 (lane FE batch C) — sequence counters + seed run status (ops admin).
  SEQUENCE: {
    VIEW: "FOUNDATION.SEQUENCE.VIEW",
    UPDATE: "FOUNDATION.SEQUENCE.UPDATE",
  },
  SEED: {
    VIEW: "FOUNDATION.SEED.VIEW",
  },
} as const;

/**
 * Engine pairs (action:resourceType) — CANONICAL theo DB-02 §9.1 + seed §13
 * (migration 0444_s2_authseed1_canonical_roles_perms.sql) + S2-AUTH-BE-3 (0450, controller
 * AuthUsersController @Controller('auth/users')) + G3-4 mutation-path (PermissionAdminController
 * @Controller('permissions'), assign-role:user isSensitive=true):
 *   - AUTH.USER.VIEW        → view:user          (hr + company-admin, scope Company)
 *   - AUTH.USER.CREATE      → create:user
 *   - AUTH.USER.UPDATE      → update:user
 *   - AUTH.USER.LOCK        → lock:user
 *   - AUTH.USER.UNLOCK      → unlock:user
 *   - AUTH.USER.ASSIGN_ROLE → assign-role:user   (SENSITIVE — useCanExact ở BE, KHÔNG wildcard kế thừa)
 *   - AUTH.ROLE.VIEW        → view:role          (chỉ company-admin, scope Company)
 * BE enforce theo đúng cặp seed thật; FE PHẢI khớp cặp này (KHÔNG manage:user/read:role/suspend-user cũ).
 * Đồng bộ với PERMISSION_CODE_TO_PAIR trong packages/web-core/src/lib/registry.ts.
 */
export const SYSTEM_ENGINE_PAIRS = {
  READ_USER: { action: "view", resourceType: "user" },
  CREATE_USER: { action: "create", resourceType: "user" },
  UPDATE_USER: { action: "update", resourceType: "user" },
  LOCK_USER: { action: "lock", resourceType: "user" },
  UNLOCK_USER: { action: "unlock", resourceType: "user" },
  ASSIGN_ROLE: { action: "assign-role", resourceType: "user" },
  // S2-FE-SYS-SEC-1 — nguồn: apps/api AuthUsersController POST /auth/users/:id/2fa/reset (S2-AUTH-BE-12).
  // Cặp seed THẬT reset-2fa:user is_sensitive=true (mig 0466) → component dùng useCanExact, KHÔNG useCan
  // (wildcard '*:*' KHÔNG thoả cổng sensitive — chống leo thang; mirror ASSIGN_ROLE/ASSIGN_PERMISSION).
  RESET_2FA_USER: { action: "reset-2fa", resourceType: "user" },
  // S2-AUTH-USEROPS-1 — nguồn: AuthUsersController DELETE /auth/users/:id · POST :id/restore ·
  // POST :id/password/reset. Cặp seed THẬT is_sensitive=true (mig 0476: restore/reset-password INSERT
  // mới; delete:user NÂNG từ 0005 false→true) + đã APPEND SENSITIVE_CAPABILITY_ALLOWLIST → component
  // PHẢI dùng useCanExact (wildcard '*:*' KHÔNG thoả cổng sensitive; mirror RESET_2FA_USER).
  DELETE_USER: { action: "delete", resourceType: "user" },
  RESTORE_USER: { action: "restore", resourceType: "user" },
  RESET_PASSWORD_USER: { action: "reset-password", resourceType: "user" },
  READ_ROLE: { action: "view", resourceType: "role" },
  // S2-FE-AUTH-4 (lane FE batch C) — nguồn: apps/api/src/permission/role-admin.controller.ts +
  // auth-roles-permissions.controller.ts (mig 0005/0444/0460). assign:permission is_sensitive=true
  // (ANTI-ESCALATION) — component dùng useCanExact, KHÔNG useCan (không kế thừa wildcard).
  CREATE_ROLE: { action: "create", resourceType: "role" },
  UPDATE_ROLE: { action: "update", resourceType: "role" },
  // Nguồn: role-admin.controller.ts DELETE /auth/roles/:id (delete:role, seed 0005 is_sensitive=FALSE →
  // PermissionGate/useCan thường dùng được, wildcard kế thừa; company-admin có ALLOW/Company sẵn). Xoá mềm
  // + cascade gỡ khỏi mọi thành viên. Nút ẩn với vai trò hệ thống (row.isSystem) — server cũng REJECT 400.
  DELETE_ROLE: { action: "delete", resourceType: "role" },
  READ_PERMISSION: { action: "view", resourceType: "permission" },
  ASSIGN_PERMISSION: { action: "assign", resourceType: "permission" },
  // S2-FE-FND-5 (lane FE batch C) — nguồn: apps/api/src/foundation/sequences/sequence.controller.ts +
  // apps/api/src/foundation/seed/seed.controller.ts (mig 0435). view:foundation-seed is_sensitive=true
  // (System scope) — component dùng useCanExact.
  READ_SEQUENCE: { action: "view", resourceType: "foundation-sequence" },
  UPDATE_SEQUENCE: { action: "update", resourceType: "foundation-sequence" },
  READ_SEED: { action: "view", resourceType: "foundation-seed" },
} as const;
