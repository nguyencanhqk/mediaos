/**
 * Hằng quyền module System (AUTH + FOUNDATION) — S2-FE-HR-3.
 * Cấu trúc: MODULE.RESOURCE.ACTION (CLAUDE.md §5 quy ước mã).
 * Dùng trong useCan(action, resourceType) qua engine pairs bên dưới.
 * KHÔNG dùng chuỗi inline / so sánh role trực tiếp.
 */
export const SYSTEM_PERMS = {
  USER: {
    VIEW: "AUTH.USER.VIEW",
    UPDATE: "AUTH.USER.UPDATE",
    SUSPEND: "AUTH.USER.SUSPEND",
    DELETE: "AUTH.USER.DELETE",
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
 * (migration 0444_s2_authseed1_canonical_roles_perms.sql):
 *   - AUTH.USER.VIEW  → view:user  (hr + company-admin được cấp scope Company)
 *   - AUTH.ROLE.VIEW  → view:role  (chỉ company-admin được cấp scope Company)
 * BE enforce theo đúng cặp seed thật; FE PHẢI khớp cặp này (KHÔNG manage:user/read:role).
 * Đồng bộ với PERMISSION_CODE_TO_PAIR trong packages/web-core/src/lib/registry.ts.
 */
export const SYSTEM_ENGINE_PAIRS = {
  READ_USER: { action: "view", resourceType: "user" },
  READ_ROLE: { action: "view", resourceType: "role" },
  // S2-FE-AUTH-4 (lane FE batch C) — nguồn: apps/api/src/permission/role-admin.controller.ts +
  // auth-roles-permissions.controller.ts (mig 0005/0444/0460). assign:permission is_sensitive=true
  // (ANTI-ESCALATION) — component dùng useCanExact, KHÔNG useCan (không kế thừa wildcard).
  CREATE_ROLE: { action: "create", resourceType: "role" },
  UPDATE_ROLE: { action: "update", resourceType: "role" },
  READ_PERMISSION: { action: "view", resourceType: "permission" },
  ASSIGN_PERMISSION: { action: "assign", resourceType: "permission" },
  // S2-FE-FND-5 (lane FE batch C) — nguồn: apps/api/src/foundation/sequences/sequence.controller.ts +
  // apps/api/src/foundation/seed/seed.controller.ts (mig 0435). view:foundation-seed is_sensitive=true
  // (System scope) — component dùng useCanExact.
  READ_SEQUENCE: { action: "view", resourceType: "foundation-sequence" },
  UPDATE_SEQUENCE: { action: "update", resourceType: "foundation-sequence" },
  READ_SEED: { action: "view", resourceType: "foundation-seed" },
} as const;
