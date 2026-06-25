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
  AUDIT_LOG: {
    VIEW: "FOUNDATION.AUDIT_LOG.VIEW",
  },
  SETTING: {
    VIEW: "FOUNDATION.SETTING.VIEW",
    UPDATE: "FOUNDATION.SETTING.UPDATE",
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
} as const;
