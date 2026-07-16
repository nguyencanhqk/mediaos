/**
 * S1-FND-MODULE-1 — MODULE_APP_METADATA: metadata hiển-thị-app per module (BACKEND-04 §8.2).
 *
 * Bảng `modules` (mig 0435) seed name/group/active NHƯNG cột metadata jsonb để NULL ⇒ nguồn route/icon/
 * requiredAny = HẰNG này (merge trên row DB). KHÔNG bịa cột modules.required_permissions.
 *
 * ⚠️ DRIFT-GUARD (memory: 'leave-request' ≠ seeded 'leave'): backend LỌC theo **cặp engine** (action,
 * resourceType) — KHÔNG theo FE display code. Mỗi cặp dưới đây grep-verified KHỚP SEED THẬT (mig 0340
 * view:audit-log · 0435 view:foundation-setting · 0444 view:user/view:role · 0454 view-*:attendance ·
 * 0455 view-own:leave) — KHÔNG bịa, KHÔNG dùng cặp legacy read:user/read:role/read:attendance/read:leave.
 *
 * ⚠️ SENSITIVE MIX (S2-FND-BE-5 — sửa khẳng định 'đã VERIFY … non-sensitive' TRƯỚC ĐÂY SAI): một số cặp
 * LÀ is_sensitive=true (view:audit-log 0340, view-own/team/company:attendance 0454). getCapabilities() CỐ Ý
 * lọc bỏ MỌI grant sensitive ⇒ nếu getMyApps chỉ dùng getCapabilities() thì app ATT (chỉ gate bằng cặp
 * sensitive) BỊ ẨN-NGẦM cho MỌI role. Vì vậy getMyApps hiện MERGE getCapabilities() +
 * getAllowlistedSensitiveCapabilities() (Option B) — 3 cặp view-*:attendance + view:audit-log đã nằm trong
 * SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts). Đây là cờ HIỂN THỊ (UI-hint), KHÔNG phải cổng
 * enforcement — cổng THẬT vẫn là can()/PermissionGuard per-resource ở từng controller.
 *
 * `feCodes` chỉ để TRẢ RA trường `required_permissions` (FE display) + truy vết — KHÔNG dùng để enforce.
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
  // requiredAny KHỚP SEED THẬT: view:user/view:role (0444, non-sensitive, hr+company-admin/company-admin),
  // view:foundation-setting (0435, non-sensitive, company-admin), view:audit-log (0340, SENSITIVE,
  // company-admin) — cặp audit CANONICAL = view:audit-log; foundation-audit-log (0435) DEPRECATE cho
  // app-surface (KHÔNG route nào enforce — xem audit.controller.ts). ⇒ AUTH hiện cho hr + company-admin.
  AUTH: {
    route: "/system",
    icon: "settings",
    requiredAny: [
      { action: "view", resourceType: "user" }, // AUTH.USER.VIEW (mig 0444)
      { action: "view", resourceType: "role" }, // AUTH.ROLE.VIEW (mig 0444)
      { action: "view", resourceType: "foundation-setting" }, // FOUNDATION.SETTING.VIEW (mig 0435)
      { action: "view", resourceType: "audit-log" }, // AUTH.AUDIT_LOG.VIEW (mig 0340, SENSITIVE)
    ],
    feCodes: ["AUTH.USER.VIEW", "AUTH.ROLE.VIEW", "FOUNDATION.SETTING.VIEW", "AUTH.AUDIT_LOG.VIEW"],
  },
  HR: {
    route: "/hr",
    icon: "users",
    requiredAny: [{ action: "read", resourceType: "employee" }], // HR.EMPLOYEE.VIEW
    feCodes: ["HR.EMPLOYEE.VIEW"],
  },
  // ATT — CANONICAL 0454: view-own/view-team/view-company:attendance (TẤT CẢ is_sensitive=true). view-own
  // grant Own cho CẢ 4 role ⇒ ATT hiện cho mọi role — NHƯNG chỉ khi getMyApps merge sensitive-allowlist
  // (Option B), vì getCapabilities() lọc sensitive. Cặp legacy read:attendance KHÔNG tồn tại trong seed.
  ATT: {
    route: "/attendance",
    icon: "clock",
    requiredAny: [
      { action: "view-own", resourceType: "attendance" }, // ATT.ATTENDANCE.VIEW_OWN (mig 0454, SENSITIVE)
      { action: "view-team", resourceType: "attendance" }, // ATT.ATTENDANCE.VIEW_TEAM (mig 0454, SENSITIVE)
      { action: "view-company", resourceType: "attendance" }, // ATT.ATTENDANCE.VIEW_COMPANY (mig 0454, SENSITIVE)
    ],
    feCodes: ["ATT.ATTENDANCE.VIEW_OWN", "ATT.ATTENDANCE.VIEW_TEAM", "ATT.ATTENDANCE.VIEW_COMPANY"],
  },
  // LEAVE — CANONICAL 0455: view-own:leave (is_sensitive=false, grant Own cho CẢ 4 role) ⇒ LEAVE hiện cho
  // mọi role qua getCapabilities() (KHÔNG cần allowlist). Cặp legacy read:leave KHÔNG khớp (0455 dùng view-own).
  LEAVE: {
    route: "/leave",
    icon: "calendar-days",
    requiredAny: [{ action: "view-own", resourceType: "leave" }], // LEAVE.REQUEST.VIEW_OWN (mig 0455)
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
  // ME — Personal Hub (S5-ME-FE-1, SPEC-09 §6.1/§8.2). requiredAny RỖNG CHỦ Ý (KHÔNG như module khác):
  // module ME luôn hiện cho MỌI user đã đăng nhập ("Tất cả người dùng đã đăng nhập hợp lệ") — module active
  // mặc định (mig 0495 seed is_active=true). hasAnyCapability([]) === true ⇒ card luôn xuất hiện trong
  // getMyApps() khi module chưa bị company tắt qua setting module.ME.enabled. Route THẬT (/api/v1/me/*)
  // VẪN gate cặp access:me qua PermissionGuard (me.controller.ts) — đây chỉ là metadata HIỂN THỊ app card.
  ME: {
    route: "/me",
    icon: "user-circle",
    requiredAny: [],
    feCodes: [],
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
