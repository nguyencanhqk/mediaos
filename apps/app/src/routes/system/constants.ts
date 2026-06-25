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
 * Engine pairs (action:resourceType) — khớp seed DB + PERMISSION_CODE_TO_PAIR registry.
 */
export const SYSTEM_ENGINE_PAIRS = {
  READ_USER: { action: "manage", resourceType: "user" },
  READ_ROLE: { action: "read", resourceType: "role" },
} as const;
