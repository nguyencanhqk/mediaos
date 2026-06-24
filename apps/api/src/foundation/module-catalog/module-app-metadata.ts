/**
 * S1-FND-MODULE-1 — MODULE_APP_METADATA: metadata hiển-thị-app per module (BACKEND-04 §8.2).
 *
 * Bảng `modules` (mig 0435) seed name/group/active NHƯNG cột metadata jsonb để NULL ⇒ nguồn route/icon/
 * requiredAny = HẰNG này (merge trên row DB). KHÔNG bịa cột modules.required_permissions.
 *
 * ⚠️ DRIFT-GUARD (memory: 'leave-request' ≠ seeded 'leave'): backend LỌC theo **cặp engine** (action,
 * resourceType) — KHÔNG theo FE display code. Mỗi cặp dưới đây đã VERIFY tồn tại trong
 * apps/api/migrations/*permissions_seed*.sql VÀ là non-sensitive (⇒ getCapabilities() phủ đủ). `feCodes` chỉ
 * để TRẢ RA trường `required_permissions` (FE display) + truy vết — KHÔNG dùng để enforce.
 */

export interface EnginePair {
  action: string;
  resourceType: string;
}

export interface ModuleAppMeta {
  route: string;
  icon: string;
  /** Cặp engine (đã verify seed). requiredAny rỗng ⇒ module HIỆN cho mọi user (không yêu cầu quyền). */
  requiredAny: readonly EnginePair[];
  /** FE display code (MODULE.RESOURCE.ACTION) — chỉ để response required_permissions + truy vết. */
  feCodes: readonly string[];
}

/** Keyed theo module_code của bảng `modules` (mig 0435): AUTH HR ATT LEAVE TASK DASH NOTI. */
export const MODULE_APP_METADATA: Readonly<Record<string, ModuleAppMeta>> = {
  // AUTH = app "Hệ thống/Quản trị" (FE app FOUNDATION/system) — gom user/role/setting/audit.
  AUTH: {
    route: "/system",
    icon: "settings",
    requiredAny: [
      { action: "read", resourceType: "user" }, // AUTH.USER.VIEW
      { action: "read", resourceType: "role" }, // AUTH.ROLE.VIEW
      { action: "view", resourceType: "foundation-setting" }, // FOUNDATION.SETTING.VIEW
      { action: "view", resourceType: "foundation-audit-log" }, // FOUNDATION.AUDIT_LOG.VIEW
    ],
    feCodes: [
      "AUTH.USER.VIEW",
      "AUTH.ROLE.VIEW",
      "FOUNDATION.SETTING.VIEW",
      "FOUNDATION.AUDIT_LOG.VIEW",
    ],
  },
  HR: {
    route: "/hr",
    icon: "users",
    requiredAny: [{ action: "read", resourceType: "employee" }], // HR.EMPLOYEE.VIEW
    feCodes: ["HR.EMPLOYEE.VIEW"],
  },
  ATT: {
    route: "/attendance",
    icon: "clock",
    requiredAny: [{ action: "read", resourceType: "attendance" }], // ATT.ATTENDANCE.VIEW_*
    feCodes: ["ATT.ATTENDANCE.VIEW_OWN"],
  },
  LEAVE: {
    route: "/leave",
    icon: "calendar-days",
    requiredAny: [{ action: "read", resourceType: "leave" }], // LEAVE.REQUEST.VIEW_*
    feCodes: ["LEAVE.REQUEST.VIEW_OWN"],
  },
  TASK: {
    route: "/tasks",
    icon: "kanban-square",
    requiredAny: [
      { action: "read", resourceType: "task" }, // TASK.TASK.VIEW
      { action: "read", resourceType: "project" }, // TASK.PROJECT.VIEW
    ],
    feCodes: ["TASK.TASK.VIEW", "TASK.PROJECT.VIEW"],
  },
  DASH: {
    route: "/dashboard",
    icon: "layout-dashboard",
    requiredAny: [{ action: "read", resourceType: "dashboard" }], // DASH.DASHBOARD.VIEW
    feCodes: ["DASH.DASHBOARD.VIEW"],
  },
  NOTI: {
    route: "/notifications",
    icon: "bell",
    requiredAny: [{ action: "read", resourceType: "notification" }], // NOTI.NOTIFICATION.VIEW_OWN
    feCodes: ["NOTI.NOTIFICATION.VIEW_OWN"],
  },
};

/**
 * Cặp pair (luôn exact) có thoả capabilities map (key "action:resourceType", có thể chứa wildcard) — mirror
 * PermissionService/guard wildcard match. requiredAny rỗng ⇒ true (HIỆN). caps rỗng (vd getCapabilities lỗi
 * → {} fail-safe) ⇒ chỉ module requiredAny rỗng mới hiện (an toàn, không rò).
 */
export function hasAnyCapability(
  caps: Record<string, boolean>,
  requiredAny: readonly EnginePair[],
): boolean {
  if (requiredAny.length === 0) return true;
  return requiredAny.some(
    (p) =>
      caps[`${p.action}:${p.resourceType}`] === true ||
      caps[`*:${p.resourceType}`] === true ||
      caps[`${p.action}:*`] === true ||
      caps["*:*"] === true,
  );
}
