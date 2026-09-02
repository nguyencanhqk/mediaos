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

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // S14-FND-MODULEMETA-1 — APPEND 5 module đã `is_active=true` ở HEAD nhưng THIẾU metadata (khối 8
  // key trên KHÔNG sửa 1 ký tự — CLAUDE.md §9.3 hot-file = APPEND).
  //
  // ⚠️ `route` = ĐÍCH ĐIỀU HƯỚNG, mirror `APP_REGISTRY.defaultRoute` (packages/web-core/src/lib/
  // registry.ts) — KHÔNG phải rootPath. Dùng rootPath ('/recruit', '/payroll') chỉ đổi trục lỗi
  // 403→404 chứ không vá gì. Đây là HẰNG CHÉO-PACKAGE (apps/api không phụ thuộc @mediaos/web-core)
  // ⇒ KHÔNG có cổng runtime tự so; cổng duy nhất = check literal trong
  // apps/api/test/foundation/module-app-metadata-ratchet.unit-spec.ts (BLOCKING 3).
  //
  // ⚠️ VÌ SAO chọn cặp TẢI-TRANG (view:X) thay vì cặp cổng-nav (access:X): `requiredAny` chỉ có ngữ
  // nghĩa OR, trong khi FE gate 4 thẻ này bằng `requiredPermissions` (AND access+view). Nếu BE gate
  // bằng mình `access:X` thì manager có 'access:recruit' (0560:105) nhưng KHÔNG 'view:job-opening'
  // sẽ THẤY thẻ rồi ăn 403 khi bấm. KHÔNG OR cả hai cặp — nới lỏng = dựng lại đúng cái lỗ đó.
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  // GOAL — mig 0506:46 ('access','goal', is_sensitive=false); grant 0506:63-66 Own cho CẢ 4 role
  // canonical (employee·manager·hr·company-admin) ⇒ thẻ hiện cho mọi role. Ngoại lệ CÓ CHỦ Ý của luật
  // "chọn cặp tải-trang": catalog GOAL chỉ seed cặp 'access:goal' làm cổng module — KHÔNG có cặp
  // view:goal, nên access:goal CHÍNH LÀ cặp tải-trang. requiredAny KHÔNG rỗng (khác ME) ⇒ caps rỗng
  // vẫn KHÔNG thấy thẻ.
  GOAL: {
    route: "/goals", // = APP_REGISTRY.defaultRoute (registry.ts:671)
    icon: "target",
    requiredAny: [{ action: "access", resourceType: "goal" }], // GOAL.ACCESS (mig 0506:46)
    // ⚠️ NỢ: 'GOAL.ACCESS' là mã TRUY VẾT, chưa map trong PERMISSION_CODE_TO_PAIR (permission.service).
    feCodes: ["GOAL.ACCESS"],
  },

  // ASSET — mig 0550:62 ('view','asset', is_sensitive=false); grant 0550:81-102 employee@Own ·
  // manager@Department · hr@Company · company-admin@Company · asset-manager@Company. Cặp cổng-nav
  // 'access:asset' (0550:61) CỐ Ý không dùng: role có access nhưng thiếu view sẽ thấy thẻ rồi ăn 403.
  ASSET: {
    route: "/assets", // = APP_REGISTRY.defaultRoute (registry.ts:778)
    icon: "package",
    requiredAny: [{ action: "view", resourceType: "asset" }], // ASSET.ASSET.VIEW (mig 0550:62)
    feCodes: ["ASSET.ASSET.VIEW"], // đã map trong PERMISSION_CODE_TO_PAIR:225
  },

  // ROOM — mig 0554:58 ('view','room', is_sensitive=false); grant 0554:71-92 @Company cho employee ·
  // manager · hr · company-admin · office-admin. Cặp cổng-nav 'access:room' (0554:57) không dùng.
  ROOM: {
    route: "/rooms", // = APP_REGISTRY.defaultRoute (registry.ts:799)
    icon: "calendar-clock",
    requiredAny: [{ action: "view", resourceType: "room" }], // ROOM.ROOM.VIEW (mig 0554:58)
    feCodes: ["ROOM.ROOM.VIEW"], // đã map trong PERMISSION_CODE_TO_PAIR:249
  },

  // RECRUIT — mig 0560:81 ('view','job-opening', is_sensitive=false); grant 0560:110/118/135
  // hr·company-admin·recruiter @Company. manager CHỈ có 'access:recruit' (0560:105) ⇒ CỐ Ý KHÔNG thấy
  // thẻ (khớp FE requiredPermissions AND). employee: 0 grant RECRUIT (least privilege).
  RECRUIT: {
    route: "/recruit/job-openings", // = APP_REGISTRY.defaultRoute (registry.ts:820) — KHÔNG '/recruit'
    icon: "user-plus",
    requiredAny: [{ action: "view", resourceType: "job-opening" }], // RECRUIT.JOB.VIEW (mig 0560:81)
    // ⚠️ NỢ: 'RECRUIT.JOB.VIEW' là mã TRUY VẾT, chưa map trong PERMISSION_CODE_TO_PAIR.
    feCodes: ["RECRUIT.JOB.VIEW"],
  },

  // PAYROLL — mig 0565:189 ('view','payroll-period', is_sensitive=false — KHÔNG số tiền; cặp CÓ TIỀN
  // là 'view-line':payroll-period 0565:191 is_sensitive=TRUE, CỐ Ý không đưa vào đây). Grant
  // 0565:232/247 payroll-officer·company-admin @Company. employee chỉ có 'access:payroll' @Own ⇒ CỐ Ý
  // KHÔNG thấy thẻ. Vì cặp này non-sensitive nên getCapabilities() đã surface ⇒ KHÔNG cần Option B
  // (SENSITIVE_CAPABILITY_ALLOWLIST giữ nguyên).
  PAYROLL: {
    route: "/payroll/periods", // = APP_REGISTRY.defaultRoute (registry.ts:843) — KHÔNG '/payroll'
    icon: "wallet",
    requiredAny: [{ action: "view", resourceType: "payroll-period" }], // PAYROLL.PERIOD.VIEW (0565:189)
    // ⚠️ NỢ: 'PAYROLL.PERIOD.VIEW' là mã TRUY VẾT, chưa map trong PERMISSION_CODE_TO_PAIR.
    feCodes: ["PAYROLL.PERIOD.VIEW"],
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
