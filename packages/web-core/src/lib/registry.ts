/**
 * Registry trung tâm: App Registry, Sidebar Registry, Route Metadata, Permission Checker.
 *
 * Nguồn spec: FRONTEND-03 §10–§17, UI-02 §8–§13.
 *
 * Quy tắc sử dụng:
 * - Permission lọc menu/guard route qua `createPermissionChecker` (không hard-code role).
 * - App Switcher: chỉ hiện app `status==='active'` VÀ user có ≥1 quyền yêu cầu.
 * - Route guard: `evaluateRouteAccess` trả action chỉ dẫn component render (ALLOW / SHOW_403 / …).
 */

// ---------------------------------------------------------------------------
// Module codes (SPEC-01 §9)
// ---------------------------------------------------------------------------

export type ModuleCode =
  | "AUTH"
  | "FOUNDATION"
  | "DASH"
  | "HR"
  | "ATT"
  | "LEAVE"
  | "TASK"
  | "NOTI"
  | "PAYROLL"
  | "RECRUIT"
  | "ASSET"
  | "ROOM"
  | "CHAT"
  | "SOCIAL"
  | "AI";

// ---------------------------------------------------------------------------
// Data scope (FRONTEND-03 §9.2–§9.3)
// ---------------------------------------------------------------------------

export type DataScope = "Own" | "Team" | "Department" | "Project" | "Company" | "System";

// Chuỗi scope tuyến tính: Own ⊂ Team ⊂ Department ⊂ Company ⊂ System
// `Project` là scope ngang — chỉ khớp tường minh.
const LINEAR_SCOPE_RANK: Partial<Record<DataScope, number>> = {
  Own: 0,
  Team: 1,
  Department: 2,
  Company: 3,
  System: 4,
};

function satisfiesScope(userScopes: Set<DataScope>, required: DataScope): boolean {
  if (userScopes.has(required)) return true;
  const requiredRank = LINEAR_SCOPE_RANK[required];
  if (requiredRank === undefined) return false; // Project — phải khớp tường minh
  for (const s of userScopes) {
    const rank = LINEAR_SCOPE_RANK[s];
    if (rank !== undefined && rank >= requiredRank) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Permission requirement (FRONTEND-03 §10.1)
// ---------------------------------------------------------------------------

export type PermissionCode = string;

export interface PermissionRequirement {
  /** User phải có TẤT CẢ permission này. */
  requiredPermissions?: PermissionCode[];
  /** User chỉ cần có MỘT trong các permission này. */
  requiredAnyPermissions?: PermissionCode[];
  /** Scope tối thiểu (chỉ UX — backend vẫn guard). */
  requiredScopes?: DataScope[];
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?:
    | "NO_PERMISSION"
    | "NO_SCOPE"
    | "NO_SESSION"
    | "USER_INACTIVE"
    | "COMPANY_INACTIVE"
    | "MODULE_DISABLED"
    | "FEATURE_DISABLED";
  missingPermissions?: PermissionCode[];
}

// ---------------------------------------------------------------------------
// User permission item (từ /auth/me response)
// ---------------------------------------------------------------------------

export interface UserPermission {
  permission: PermissionCode;
  scopes: DataScope[];
}

// ---------------------------------------------------------------------------
// Permission checker (FRONTEND-03 §10.2)
// ---------------------------------------------------------------------------

/**
 * Ánh xạ FE permission code (`MODULE.RESOURCE.ACTION` — dùng trong registry/route/sidebar) → cặp engine
 * `action:resourceType` mà backend trả trong `/auth/me` capabilities (permission.service `getCapabilities`).
 *
 * LÝ DO: bảng `permissions` chỉ có (action, resource_type), KHÔNG có cột `code`. FE gate HIỂN THỊ theo code,
 * BE enforce theo cặp → cần cầu nối ở TẦNG HIỂN THỊ (KHÔNG đụng engine enforcement — BE vẫn là cổng thật).
 * Cặp lấy từ seed thật (migrations *_permissions_seed.sql + attendance/leave-permissions.const).
 *
 * QUAN TRỌNG (pair-as-gate): mỗi SCOPE-LEVEL là MỘT CẶP RIÊNG trong catalog `permissions`, KHÔNG gộp về một
 * "cặp đọc" chung. ATT: view-own / view-team / view-company : attendance là 3 cặp is_sensitive độc lập ⇒ chính
 * SỰ HIỆN DIỆN của cặp = cổng (manager có view-team KHÔNG kế thừa view-company). LEAVE: view-own:leave (self)
 * KHÁC view:leave (đọc chéo, sensitive) KHÁC approve:leave. `requiredScopes` chỉ là gợi ý UX phụ (scope từ
 * /auth/me lọc bỏ cặp sensitive nên có thể rỗng) — KHÔNG dùng làm cổng-cứng cho cặp scope-level. Code chưa có
 * trong bảng → checker thử khớp TRỰC TIẾP (phòng khi BE trả thẳng cặp). Bổ sung code mới ở đây khi thêm app/route.
 */
export const PERMISSION_CODE_TO_PAIR: Readonly<Record<PermissionCode, string>> = {
  "DASH.DASHBOARD.VIEW": "read:dashboard",
  "HR.EMPLOYEE.VIEW": "read:employee",
  "ATT.ATTENDANCE.VIEW_OWN": "view-own:attendance",
  "ATT.ATTENDANCE.VIEW_TEAM": "view-team:attendance",
  "ATT.ATTENDANCE.VIEW_COMPANY": "view-company:attendance",
  // S3-ATT-BE-3 shift/rule/assignment (attendance-permissions.const.ts — mig 0454). Cặp scope-level RIÊNG,
  // KHÔNG gộp: view:shift (non-sensitive) khác create/update:shift; view/update:shift-assignment; view/config:attendance-rule.
  "ATT.SHIFT.VIEW": "view:shift",
  "ATT.SHIFT.CREATE": "create:shift",
  "ATT.SHIFT.UPDATE": "update:shift",
  "ATT.SHIFT_ASSIGNMENT.VIEW": "view:shift-assignment",
  "ATT.SHIFT_ASSIGNMENT.UPDATE": "update:shift-assignment",
  "ATT.RULE.VIEW": "view:attendance-rule",
  "ATT.RULE.CONFIG": "config:attendance-rule",
  "LEAVE.REQUEST.VIEW_OWN": "view-own:leave",
  "LEAVE.REQUEST.VIEW": "view:leave",
  "LEAVE.REQUEST.APPROVE": "approve:leave",
  "TASK.TASK.VIEW": "read:task",
  "TASK.PROJECT.VIEW": "read:project",
  "NOTI.NOTIFICATION.VIEW_OWN": "read:notification",
  // Canonical theo DB-02 §9.1 + seed §13 (migration 0444): cặp đọc là view:user / view:role.
  "AUTH.USER.VIEW": "view:user",
  "AUTH.ROLE.VIEW": "view:role",
  "FOUNDATION.SETTING.VIEW": "view:foundation-setting",
  // S2-FE-FND-2: cặp seed THẬT dùng bởi AuditController (mig 0340, is_sensitive=true) là `view:audit-log`
  // (KHÔNG `view:foundation-audit-log` — cặp đó chỉ seed ở mig 0435 nhưng KHÔNG controller nào enforce nó;
  // dùng nhầm sẽ tạo hố FE-cho-phép/BE-403). PIN đúng cặp AuditController thật đọc — cùng kỹ thuật
  // system.login-logs (AUTH_AUDIT_LOG từ packages/contracts).
  "FOUNDATION.AUDIT_LOG.VIEW": "view:audit-log",
  // S2-FE-FND-2: cặp seed THẬT mig 0435 — FilesController dùng view:foundation-file (is_sensitive=false,
  // bulk-grant company-admin qua LIKE 'foundation-%').
  "FOUNDATION.FILE.VIEW": "view:foundation-file",
  // S2-FE-FND-1 (FND1-WC): cặp seed THẬT mig 0435 — controller Foundation dùng *:foundation-* (view/update:
  // foundation-company, update:foundation-setting). KHÔNG dùng nhãn-ma FRONTEND-13 §7.1 (FOUNDATION.SYSTEM.VIEW /
  // SETTING.SYSTEM_MANAGE chưa seed) và KHÔNG namespace CŨ read/update:company (0005). Đọc≠sửa (pair-as-gate).
  "FOUNDATION.COMPANY.VIEW": "view:foundation-company",
  "FOUNDATION.COMPANY.UPDATE": "update:foundation-company",
  "FOUNDATION.SETTING.UPDATE": "update:foundation-setting",
};

export function createPermissionChecker(userPermissions: readonly UserPermission[]) {
  const map = new Map<PermissionCode, Set<DataScope>>();
  for (const item of userPermissions) {
    map.set(item.permission, new Set(item.scopes));
  }

  /** Key khớp trong map: chính `permission` (đã là cặp / khớp trực tiếp) hoặc cặp engine ánh xạ từ FE code. */
  function resolveKey(permission: PermissionCode): PermissionCode | undefined {
    if (map.has(permission)) return permission;
    const pair = PERMISSION_CODE_TO_PAIR[permission];
    if (pair && map.has(pair)) return pair;
    return undefined;
  }

  function can(permission: PermissionCode): boolean {
    return resolveKey(permission) !== undefined;
  }

  function canAll(permissions: readonly PermissionCode[]): boolean {
    return permissions.every(can);
  }

  function canAny(permissions: readonly PermissionCode[]): boolean {
    if (permissions.length === 0) return true;
    return permissions.some(can);
  }

  function getScopes(permission: PermissionCode): DataScope[] {
    const key = resolveKey(permission);
    return key ? Array.from(map.get(key) ?? []) : [];
  }

  function hasScope(permission: PermissionCode, scope: DataScope): boolean {
    const key = resolveKey(permission);
    const scopes = key ? map.get(key) : undefined;
    if (!scopes) return false;
    return satisfiesScope(scopes, scope);
  }

  function hasAnyScope(permission: PermissionCode, required: readonly DataScope[]): boolean {
    if (required.length === 0) return true;
    const key = resolveKey(permission);
    const scopes = key ? map.get(key) : undefined;
    if (!scopes) return false;
    return required.some((s) => satisfiesScope(scopes, s));
  }

  function checkRequirement(req: PermissionRequirement): PermissionCheckResult {
    const allPerms = req.requiredPermissions ?? [];
    const anyPerms = req.requiredAnyPermissions ?? [];
    const requiredScopes = req.requiredScopes ?? [];

    if (allPerms.length > 0 && !canAll(allPerms)) {
      return {
        allowed: false,
        reason: "NO_PERMISSION",
        missingPermissions: allPerms.filter((p) => !can(p)),
      };
    }

    if (anyPerms.length > 0 && !canAny(anyPerms)) {
      return {
        allowed: false,
        reason: "NO_PERMISSION",
        missingPermissions: anyPerms,
      };
    }

    if (requiredScopes.length > 0) {
      const candidatePerms = [...allPerms, ...anyPerms].filter(can);
      const scopeOk = candidatePerms.some((p) => hasAnyScope(p, requiredScopes));
      if (!scopeOk) {
        return { allowed: false, reason: "NO_SCOPE" };
      }
    }

    return { allowed: true };
  }

  return { can, canAll, canAny, getScopes, hasScope, hasAnyScope, checkRequirement };
}

export type PermissionChecker = ReturnType<typeof createPermissionChecker>;

// ---------------------------------------------------------------------------
// Module access item (từ /auth/me response)
// ---------------------------------------------------------------------------

export type ModuleStatus = "active" | "locked" | "coming_soon" | "maintenance" | "hidden";

export interface ModuleAccessItem {
  moduleCode: ModuleCode;
  status: ModuleStatus;
  featureFlags?: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Session context (tóm gọn — web-core cần để evaluateRouteAccess)
// ---------------------------------------------------------------------------

export type AuthStatus =
  | "unknown"
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "expired"
  | "forbidden";

export interface SessionUser {
  id: string;
  email: string;
  status: "Active" | "Inactive" | "Locked" | "Pending Activation";
  companyId: string;
}

/**
 * Chuẩn hoá `status` user THÔ từ API (`/auth/me` trả enum DB chữ THƯỜNG: 'active' | 'suspended' —
 * users.status DEFAULT 'active' mig 0002, CHECK mig 0430) về union canonical Title-case của FE.
 *
 * LÝ DO: guard `evaluateRouteAccess` so khớp đúng "Active" (Title-case). BE trả "active" (thường) ⇒
 * "active" !== "Active" ⇒ MỌI user đã đăng nhập (login chỉ cho status='active') bị gắn USER_INACTIVE ⇒
 * 403 ở mọi route module. Bug không bị test bắt vì fixture hard-code "Active".
 *
 * Fail-closed: giá trị lạ/thiếu → "Inactive" (guard chặn) — server vẫn là cổng quyền THẬT, đây chỉ là
 * tầng hiển thị. Cũng map 'suspended' → "Locked" (trước đây fallback "Active" = fail-OPEN).
 */
export function normalizeUserStatus(raw: string | null | undefined): SessionUser["status"] {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "active":
      return "Active";
    case "suspended":
    case "locked":
      return "Locked";
    case "inactive":
      return "Inactive";
    case "pending activation":
    case "pending":
      return "Pending Activation";
    default:
      return "Inactive";
  }
}

export interface SessionCompany {
  id: string;
  name: string;
  status: "Active" | "Inactive" | "Suspended";
}

export interface SessionContext {
  status: AuthStatus;
  user: SessionUser | null;
  company: SessionCompany | null;
  modules: ModuleAccessItem[];
}

// ---------------------------------------------------------------------------
// Route metadata (FRONTEND-03 §12, UI-02 §8.3)
// ---------------------------------------------------------------------------

export type LayoutType = "AUTH" | "HOME_PORTAL" | "MODULE_WORKSPACE" | "ACCOUNT" | "ERROR";

export interface RouteMeta extends PermissionRequirement {
  /** Key duy nhất, stable, dùng cho breadcrumb / QA / analytics. */
  routeKey: string;
  path: string;
  layout: LayoutType;
  moduleCode?: ModuleCode;
  /** Mã màn hình theo SPEC (MODULE-SCREEN-XXX). */
  screenCode?: string;
  titleKey: string;
  isPublic?: boolean;
  showInSidebar?: boolean;
  showInAppSwitcher?: boolean;
  featureFlag?: string;
  order?: number;
}

// ---------------------------------------------------------------------------
// Route guard (FRONTEND-03 §14)
// ---------------------------------------------------------------------------

export type RouteGuardAction =
  | "ALLOW"
  | "REDIRECT_LOGIN"
  | "SHOW_403"
  | "SHOW_404"
  | "SHOW_DISABLED"
  | "SHOW_LOADING";

export interface RouteGuardResult {
  allowed: boolean;
  action: RouteGuardAction;
  redirectTo?: string;
  reason?: string;
}

export function evaluateRouteAccess(
  session: SessionContext,
  route: RouteMeta,
  permission: PermissionChecker,
): RouteGuardResult {
  if (route.isPublic) {
    return { allowed: true, action: "ALLOW" };
  }

  if (session.status === "unknown" || session.status === "loading") {
    return { allowed: false, action: "SHOW_LOADING" };
  }

  if (!session.user || session.status === "unauthenticated" || session.status === "expired") {
    return {
      allowed: false,
      action: "REDIRECT_LOGIN",
      redirectTo: `/login?returnUrl=${encodeURIComponent(route.path)}`,
      reason: "NO_SESSION",
    };
  }

  if (session.user.status !== "Active") {
    return { allowed: false, action: "SHOW_403", reason: "USER_INACTIVE" };
  }

  if (session.company && session.company.status !== "Active") {
    return { allowed: false, action: "SHOW_403", reason: "COMPANY_INACTIVE" };
  }

  if (route.moduleCode) {
    const mod = session.modules.find((m) => m.moduleCode === route.moduleCode);
    const moduleStatus = mod?.status ?? "hidden";

    if (moduleStatus === "hidden") {
      return { allowed: false, action: "SHOW_404", reason: "MODULE_HIDDEN" };
    }

    if (moduleStatus !== "active") {
      return { allowed: false, action: "SHOW_DISABLED", reason: "MODULE_DISABLED" };
    }

    if (route.featureFlag && mod?.featureFlags?.[route.featureFlag] === false) {
      return { allowed: false, action: "SHOW_DISABLED", reason: "FEATURE_DISABLED" };
    }
  }

  const result = permission.checkRequirement(route);
  if (!result.allowed) {
    return { allowed: false, action: "SHOW_403", reason: result.reason };
  }

  return { allowed: true, action: "ALLOW" };
}

// ---------------------------------------------------------------------------
// App registry (FRONTEND-03 §16, UI-02 §10–§11)
// ---------------------------------------------------------------------------

export interface AppRegistryItem extends PermissionRequirement {
  moduleCode: ModuleCode;
  /** Key ổn định dùng trong router / analytics. */
  appKey: string;
  /** i18n key (namespace nav, prefix "app."). */
  nameKey: string;
  /** i18n key mô tả ngắn (namespace nav, prefix "appDesc."). */
  descKey: string;
  /** Lucide icon name (string — layout dùng dynamic import). */
  icon: string;
  /** Route root của app (router prefix). */
  rootPath: string;
  /** Route mặc định khi user mở app. */
  defaultRoute: string;
  category: "core" | "hr" | "operation" | "collaboration" | "system" | "future";
  aliases?: readonly string[];
  status: ModuleStatus;
  order: number;
}

/** App Registry MVP — khớp FRONTEND-03 §16.3 + UI-02 §10. */
export const APP_REGISTRY: readonly AppRegistryItem[] = [
  {
    appKey: "dashboard",
    moduleCode: "DASH",
    nameKey: "app.dashboard",
    descKey: "appDesc.dashboard",
    icon: "layout-dashboard",
    rootPath: "/dashboard",
    defaultRoute: "/dashboard",
    category: "core",
    aliases: ["tong quan", "bao cao", "dashboard"],
    requiredAnyPermissions: ["DASH.DASHBOARD.VIEW"],
    status: "active",
    order: 10,
  },
  {
    appKey: "hr",
    moduleCode: "HR",
    nameKey: "app.hr",
    descKey: "appDesc.hr",
    icon: "users",
    rootPath: "/hr",
    defaultRoute: "/hr",
    category: "hr",
    aliases: ["nhan su", "employee", "hr"],
    requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
    status: "active",
    order: 20,
  },
  {
    appKey: "attendance",
    moduleCode: "ATT",
    nameKey: "app.attendance",
    descKey: "appDesc.attendance",
    icon: "clock",
    rootPath: "/attendance",
    defaultRoute: "/attendance/today",
    category: "operation",
    aliases: ["cham cong", "attendance", "checkin", "checkout"],
    requiredAnyPermissions: [
      "ATT.ATTENDANCE.VIEW_OWN",
      "ATT.ATTENDANCE.VIEW_TEAM",
      "ATT.ATTENDANCE.VIEW_COMPANY",
    ],
    status: "active",
    order: 30,
  },
  {
    appKey: "leave",
    moduleCode: "LEAVE",
    nameKey: "app.leave",
    descKey: "appDesc.leave",
    icon: "calendar-days",
    rootPath: "/leave",
    defaultRoute: "/leave/me/requests",
    category: "operation",
    aliases: ["nghi phep", "leave", "absence"],
    requiredAnyPermissions: [
      "LEAVE.REQUEST.VIEW_OWN",
      "LEAVE.REQUEST.VIEW",
      "LEAVE.REQUEST.APPROVE",
    ],
    status: "active",
    order: 40,
  },
  {
    appKey: "tasks",
    moduleCode: "TASK",
    nameKey: "app.tasks",
    descKey: "appDesc.tasks",
    icon: "kanban-square",
    rootPath: "/tasks",
    defaultRoute: "/tasks/my-tasks",
    category: "collaboration",
    aliases: ["cong viec", "task", "project", "kanban"],
    requiredAnyPermissions: ["TASK.TASK.VIEW", "TASK.PROJECT.VIEW"],
    status: "active",
    order: 50,
  },
  {
    appKey: "notifications",
    moduleCode: "NOTI",
    nameKey: "app.notifications",
    descKey: "appDesc.notifications",
    icon: "bell",
    rootPath: "/notifications",
    defaultRoute: "/notifications",
    category: "core",
    aliases: ["thong bao", "notification", "noti"],
    requiredAnyPermissions: ["NOTI.NOTIFICATION.VIEW_OWN"],
    status: "active",
    order: 60,
  },
  {
    appKey: "system",
    moduleCode: "FOUNDATION",
    nameKey: "app.system",
    descKey: "appDesc.system",
    icon: "settings",
    rootPath: "/system",
    defaultRoute: "/system/settings",
    category: "system",
    aliases: ["he thong", "system", "settings", "admin"],
    requiredAnyPermissions: [
      "AUTH.USER.VIEW",
      "AUTH.ROLE.VIEW",
      "FOUNDATION.SETTING.VIEW",
      "FOUNDATION.AUDIT_LOG.VIEW",
    ],
    status: "active",
    order: 70,
  },
] as const;

// ---------------------------------------------------------------------------
// App visibility filter (FRONTEND-03 §16.4, UI-02 §10.3)
// ---------------------------------------------------------------------------

/**
 * Lọc danh sách app hiển thị trong App Switcher / Home Portal.
 *
 * Logic:
 * - App `hidden` → ẩn tuyệt đối.
 * - App `active` → chỉ hiện nếu user có ≥1 quyền yêu cầu.
 * - App `coming_soon` | `locked` | `maintenance` → hiện nhưng disabled (không cần quyền).
 *
 * Module status từ server ghi đè `app.status` nếu tìm thấy.
 */
export function getVisibleApps(
  apps: readonly AppRegistryItem[],
  session: SessionContext,
  permission: PermissionChecker,
): AppRegistryItem[] {
  return apps
    .filter((app) => {
      const mod = session.modules.find((m) => m.moduleCode === app.moduleCode);
      const effectiveStatus: ModuleStatus = mod?.status ?? app.status;

      if (effectiveStatus === "hidden") return false;
      if (app.status === "hidden") return false;

      // coming_soon / locked / maintenance → hiện dù không có quyền
      if (effectiveStatus !== "active") return true;

      // active → kiểm tra quyền
      return permission.checkRequirement(app).allowed;
    })
    .sort((a, b) => a.order - b.order);
}

// ---------------------------------------------------------------------------
// Sidebar registry (FRONTEND-03 §17)
// ---------------------------------------------------------------------------

export interface SidebarItemMeta extends PermissionRequirement {
  sidebarKey: string;
  moduleCode: ModuleCode;
  /** Label text (tiếng Việt — sidebar không dùng i18n key để render nhanh). */
  label: string;
  path?: string;
  icon?: string;
  group?: string;
  order: number;
  /** Key để lấy badge count (từ React Query). */
  badgeKey?: string;
  children?: SidebarItemMeta[];
  featureFlag?: string;
  isDivider?: boolean;
}

/**
 * Lọc sidebar items theo quyền của user (đệ quy cho 2 cấp).
 *
 * Logic:
 * - Item tự bản thân không pass permission + không có children pass → ẩn.
 * - Item cha pass permission hoặc có ≥1 child pass → giữ lại (kèm children đã lọc).
 */
export function filterSidebarItems(
  items: readonly SidebarItemMeta[],
  permission: PermissionChecker,
  session: SessionContext,
): SidebarItemMeta[] {
  return items
    .flatMap((item): SidebarItemMeta[] => {
      // Kiểm tra module nếu có
      if (item.moduleCode) {
        const mod = session.modules.find((m) => m.moduleCode === item.moduleCode);
        if (mod && mod.status !== "active") return [];
      }

      // Feature flag
      if (item.featureFlag) {
        const mod = session.modules.find((m) => m.moduleCode === item.moduleCode);
        if (mod?.featureFlags?.[item.featureFlag] === false) return [];
      }

      const children = item.children
        ? filterSidebarItems(item.children, permission, session)
        : undefined;

      const selfAllowed = permission.checkRequirement(item).allowed;
      const hasVisibleChildren = Boolean(children?.length);

      if (!selfAllowed && !hasVisibleChildren) return [];

      return [{ ...item, children }];
    })
    .sort((a, b) => a.order - b.order);
}

// ---------------------------------------------------------------------------
// Route registry (FRONTEND-03 §12.3, UI-02 §9)
// ---------------------------------------------------------------------------

/** Registry route MVP — dùng để guard + breadcrumb + sidebar active-state. */
export const ROUTE_REGISTRY: readonly RouteMeta[] = [
  // Public
  {
    routeKey: "auth.login",
    path: "/login",
    layout: "AUTH",
    titleKey: "routeTitle.login",
    isPublic: true,
  },
  {
    routeKey: "auth.forgot",
    path: "/forgot-password",
    layout: "AUTH",
    titleKey: "routeTitle.forgot",
    isPublic: true,
  },
  {
    routeKey: "auth.reset",
    path: "/reset-password",
    layout: "AUTH",
    titleKey: "routeTitle.reset",
    isPublic: true,
  },

  // Home
  { routeKey: "home", path: "/home", layout: "HOME_PORTAL", titleKey: "routeTitle.home" },

  // Dashboard
  {
    routeKey: "dashboard",
    path: "/dashboard",
    layout: "MODULE_WORKSPACE",
    moduleCode: "DASH",
    screenCode: "DASH-SCREEN-OVERVIEW",
    titleKey: "routeTitle.dashboard",
    requiredAnyPermissions: ["DASH.DASHBOARD.VIEW"],
    showInSidebar: true,
    order: 10,
  },

  // HR
  {
    routeKey: "hr.overview",
    path: "/hr",
    layout: "MODULE_WORKSPACE",
    moduleCode: "HR",
    screenCode: "HR-SCREEN-OVERVIEW",
    titleKey: "routeTitle.hr",
    requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
    showInSidebar: true,
    order: 20,
  },
  {
    routeKey: "hr.employees",
    path: "/hr/employees",
    layout: "MODULE_WORKSPACE",
    moduleCode: "HR",
    screenCode: "HR-SCREEN-EMPLOYEE-LIST",
    titleKey: "routeTitle.hrEmployees",
    requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
    showInSidebar: true,
    order: 21,
  },
  {
    routeKey: "hr.me",
    path: "/hr/me",
    layout: "MODULE_WORKSPACE",
    moduleCode: "HR",
    screenCode: "HR-SCREEN-ME",
    titleKey: "routeTitle.hrMe",
    requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
    showInSidebar: true,
    order: 22,
  },

  // Attendance
  {
    routeKey: "att.today",
    path: "/attendance/today",
    layout: "MODULE_WORKSPACE",
    moduleCode: "ATT",
    screenCode: "ATT-SCREEN-TODAY",
    titleKey: "routeTitle.attToday",
    requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_OWN"],
    showInSidebar: true,
    order: 30,
  },
  {
    routeKey: "att.my-records",
    path: "/attendance/my-records",
    layout: "MODULE_WORKSPACE",
    moduleCode: "ATT",
    screenCode: "ATT-SCREEN-MY-RECORDS",
    titleKey: "routeTitle.attMyRecords",
    requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_OWN"],
    showInSidebar: true,
    order: 31,
  },
  // Scoped records (pair-as-gate). VIEW_TEAM/VIEW_COMPANY là cặp is_sensitive RIÊNG → gate = requiredAny
  // cặp ĐÚNG (KHÔNG requiredScopes cổng-cứng: scope /auth/me lọc sensitive nên có thể rỗng ⇒ 403 sai).
  {
    routeKey: "att.team-records",
    path: "/attendance/team-records",
    layout: "MODULE_WORKSPACE",
    moduleCode: "ATT",
    screenCode: "ATT-SCREEN-TEAM-RECORDS",
    titleKey: "routeTitle.attTeamRecords",
    requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_TEAM"],
    showInSidebar: true,
    order: 32,
  },
  {
    routeKey: "att.records",
    path: "/attendance/records",
    layout: "MODULE_WORKSPACE",
    moduleCode: "ATT",
    screenCode: "ATT-SCREEN-RECORDS",
    titleKey: "routeTitle.attRecords",
    requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_COMPANY"],
    showInSidebar: true,
    order: 33,
  },
  // S3-FE-ATT-5 — ca làm việc / gán ca / rule chấm công (Company, admin, read-only minimum).
  // Gate = CẶP ENGINE THỰC trực tiếp (view:shift / view:shift-assignment / view:attendance-rule, nguồn
  // attendance-permissions.const.ts) — KHÔNG qua PERMISSION_CODE_TO_PAIR (tránh drift đã gặp ở
  // S1-FND-MODULE / S3-FE-wave2), cùng kỹ thuật system.login-logs (AUDIT_LOG_VIEW_PERMISSION).
  {
    routeKey: "att.shifts",
    path: "/attendance/shifts",
    layout: "MODULE_WORKSPACE",
    moduleCode: "ATT",
    screenCode: "ATT-SCREEN-SHIFTS",
    titleKey: "routeTitle.attShifts",
    requiredAnyPermissions: ["view:shift"],
    showInSidebar: true,
    order: 34,
  },
  {
    routeKey: "att.shift-assignments",
    path: "/attendance/shift-assignments",
    layout: "MODULE_WORKSPACE",
    moduleCode: "ATT",
    screenCode: "ATT-SCREEN-SHIFT-ASSIGNMENTS",
    titleKey: "routeTitle.attShiftAssignments",
    requiredAnyPermissions: ["view:shift-assignment"],
    showInSidebar: true,
    order: 35,
  },
  {
    routeKey: "att.rules",
    path: "/attendance/rules",
    layout: "MODULE_WORKSPACE",
    moduleCode: "ATT",
    screenCode: "ATT-SCREEN-RULES",
    titleKey: "routeTitle.attRules",
    requiredAnyPermissions: ["view:attendance-rule"],
    showInSidebar: true,
    order: 36,
  },

  // Leave
  {
    routeKey: "leave.overview",
    path: "/leave",
    layout: "MODULE_WORKSPACE",
    moduleCode: "LEAVE",
    screenCode: "LEAVE-SCREEN-OVERVIEW",
    titleKey: "routeTitle.leave",
    requiredAnyPermissions: ["LEAVE.REQUEST.VIEW_OWN", "LEAVE.REQUEST.VIEW"],
    showInSidebar: true,
    order: 40,
  },
  {
    routeKey: "leave.my-requests",
    path: "/leave/me/requests",
    layout: "MODULE_WORKSPACE",
    moduleCode: "LEAVE",
    screenCode: "LEAVE-SCREEN-MY-REQUESTS",
    titleKey: "routeTitle.leaveMyRequests",
    requiredAnyPermissions: ["LEAVE.REQUEST.VIEW_OWN"],
    showInSidebar: true,
    order: 41,
  },
  // S3-FE-LEAVE-2 PIN CỔNG: gate = CHỈ view:leave (LEAVE.REQUEST.VIEW) — khớp BE GET /leave/requests
  // (VIEW_LEAVE, SENSITIVE, mig 0455). KHÔNG gate LEAVE.REQUEST.APPROVE ở cổng route: người chỉ có approve
  // mà thiếu view sẽ 403 ở list-load ⇒ route phải đòi ĐÚNG cặp đọc chéo. Nút approve/reject gate riêng trong page.
  {
    routeKey: "leave.approvals",
    path: "/leave/approvals",
    layout: "MODULE_WORKSPACE",
    moduleCode: "LEAVE",
    screenCode: "LEAVE-SCREEN-APPROVALS",
    titleKey: "routeTitle.leaveApprovals",
    requiredAnyPermissions: ["LEAVE.REQUEST.VIEW"],
    showInSidebar: true,
    order: 42,
  },
  // S3-FE-LEAVE-3 — LEAVE-SCREEN-006 (tất cả đơn nghỉ, HR/Admin). Cổng CÙNG cặp view:leave với
  // leave.approvals (BE GET /leave/requests dùng chung endpoint) — màn hình này chỉ ĐỌC (không
  // approve/reject), nên KHÔNG cần thêm requiredAny khác.
  {
    routeKey: "leave.all-requests",
    path: "/leave/requests",
    layout: "MODULE_WORKSPACE",
    moduleCode: "LEAVE",
    screenCode: "LEAVE-SCREEN-006",
    titleKey: "routeTitle.leaveAllRequests",
    requiredAnyPermissions: ["LEAVE.REQUEST.VIEW"],
    showInSidebar: true,
    order: 43,
  },

  // Tasks
  {
    routeKey: "task.overview",
    path: "/tasks",
    layout: "MODULE_WORKSPACE",
    moduleCode: "TASK",
    screenCode: "TASK-SCREEN-OVERVIEW",
    titleKey: "routeTitle.tasks",
    requiredAnyPermissions: ["TASK.TASK.VIEW"],
    showInSidebar: true,
    order: 50,
  },
  {
    routeKey: "task.my-tasks",
    path: "/tasks/my-tasks",
    layout: "MODULE_WORKSPACE",
    moduleCode: "TASK",
    screenCode: "TASK-SCREEN-MY-TASKS",
    titleKey: "routeTitle.taskMyTasks",
    requiredAnyPermissions: ["TASK.TASK.VIEW"],
    showInSidebar: true,
    order: 51,
  },

  // Notifications
  {
    routeKey: "noti.list",
    path: "/notifications",
    layout: "MODULE_WORKSPACE",
    moduleCode: "NOTI",
    screenCode: "NOTI-SCREEN-LIST",
    titleKey: "routeTitle.notifications",
    requiredAnyPermissions: ["NOTI.NOTIFICATION.VIEW_OWN"],
    showInSidebar: true,
    order: 60,
  },

  // System
  {
    routeKey: "system.overview",
    path: "/system",
    layout: "MODULE_WORKSPACE",
    moduleCode: "FOUNDATION",
    screenCode: "SYSTEM-SCREEN-OVERVIEW",
    titleKey: "routeTitle.system",
    requiredAnyPermissions: ["FOUNDATION.SETTING.VIEW", "AUTH.USER.VIEW"],
    showInSidebar: true,
    order: 70,
  },
  {
    routeKey: "system.users",
    path: "/system/users",
    layout: "MODULE_WORKSPACE",
    moduleCode: "FOUNDATION",
    screenCode: "SYSTEM-SCREEN-USERS",
    titleKey: "routeTitle.systemUsers",
    requiredAnyPermissions: ["AUTH.USER.VIEW"],
    showInSidebar: true,
    order: 71,
  },
  {
    routeKey: "system.roles",
    path: "/system/roles",
    layout: "MODULE_WORKSPACE",
    moduleCode: "FOUNDATION",
    screenCode: "SYSTEM-SCREEN-ROLES",
    titleKey: "routeTitle.systemRoles",
    requiredAnyPermissions: ["AUTH.ROLE.VIEW"],
    showInSidebar: true,
    order: 72,
  },
  {
    routeKey: "system.audit-logs",
    path: "/system/audit-logs",
    layout: "MODULE_WORKSPACE",
    moduleCode: "FOUNDATION",
    screenCode: "SYSTEM-SCREEN-AUDIT-LOGS",
    titleKey: "routeTitle.systemAuditLogs",
    requiredAnyPermissions: ["FOUNDATION.AUDIT_LOG.VIEW"],
    showInSidebar: true,
    order: 73,
  },
  // S2-FE-FND-2 — cặp seed THẬT mig 0435 (view:foundation-file, is_sensitive=false, bulk-grant company-admin).
  {
    routeKey: "system.files",
    path: "/system/files",
    layout: "MODULE_WORKSPACE",
    moduleCode: "FOUNDATION",
    screenCode: "SYSTEM-SCREEN-FILES",
    titleKey: "routeTitle.systemFiles",
    requiredAnyPermissions: ["FOUNDATION.FILE.VIEW"],
    showInSidebar: true,
    order: 74,
  },

  // Account
  {
    routeKey: "account.profile",
    path: "/account/profile",
    layout: "ACCOUNT",
    titleKey: "routeTitle.accountProfile",
  },

  // Error pages (public — router renders without guard)
  {
    routeKey: "error.403",
    path: "/403",
    layout: "ERROR",
    titleKey: "routeTitle.forbidden",
    isPublic: true,
  },
  {
    routeKey: "error.404",
    path: "/404",
    layout: "ERROR",
    titleKey: "routeTitle.notFound",
    isPublic: true,
  },
] as const;

/** Tra cứu RouteMeta theo routeKey (O(1)). */
export function getRouteMeta(routeKey: string): RouteMeta | undefined {
  return ROUTE_REGISTRY.find((r) => r.routeKey === routeKey);
}
