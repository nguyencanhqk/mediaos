/**
 * S4-DASH-SEED-1 — registry TĨNH cho catalog widget DASH + quyền DASH + default config.
 *
 * MỐC CHỐNG DRIFT: migration 0484, DashboardConfigSeeder và int-spec đều đọc TỪ ĐÂY. Đổi một chỗ mà quên
 * chỗ khác thì int-spec đỏ ngay, thay vì lệch âm thầm tới runtime (pair-drift đã cắn 3 lần: S1-FND-MODULE,
 * S3-FE, S4-TASK-RECON).
 *
 * Nguồn chuẩn (docs/plans/S4-DASH-SEED-1.md §1):
 *  - grant per-role            → docs/API Design/API-10 PERMISSION MATRIX.md:283-312
 *  - required_permission_code  → docs/DB/DB-07 §8.5 (dòng 1109-1123)
 *  - default dashboard         → docs/DB/DB-07 §14.3 (dòng 2147+)
 *  - tập widget in-sprint      → docs/IMPLEMENTATION/IMPLEMENTATION-07 §11.3 (dòng 739-745)
 *  - mô hình gate widget       → docs/permission-matrix-spec.md §7 (dòng 144)
 */

/** Union khớp CHECK chk_dashboard_widgets_module_code (mig 0482:71-72). */
export type DashModuleCode = "AUTH" | "HR" | "ATT" | "LEAVE" | "TASK" | "DASH" | "NOTI" | "SYSTEM";
/** Union khớp CHECK chk_dashboard_widgets_widget_type (mig 0482:73-74). */
export type DashWidgetType = "Summary" | "List" | "Chart" | "Calendar" | "Action" | "Alert";
/** Union khớp CHECK chk_dashboard_widgets_default_data_scope (mig 0482:75-76). */
export type DashDataScope = "Own" | "Team" | "Department" | "Project" | "Company" | "System";
/** Union khớp CHECK chk_dashboard_widget_configs_dashboard_type (mig 0482:135-136). */
export type DashboardType = "Employee" | "Manager" | "HR" | "Admin" | "System" | "Project";
/** 4 role canonical (roles.company_id IS NULL). super-admin KHÔNG có row ⇒ KHÔNG enumerate (mirror 0481:35). */
export type DashCanonicalRole = "employee" | "manager" | "hr" | "company-admin";

/** Cặp engine mà PermissionService hiểu — bảng permissions chỉ có (action, resource_type). */
export interface EnginePair {
  readonly action: string;
  readonly resourceType: string;
}

export interface DashWidgetEntry {
  readonly widgetCode: string;
  readonly moduleCode: DashModuleCode;
  readonly name: string;
  /** Chuỗi SPEC verbatim (DB-07 §8.5) — DỮ LIỆU catalog, KHÔNG phải engine key. Gate thật: DASH_WIDGET_GATE_PAIR. */
  readonly requiredPermissionCode: string;
  readonly defaultDataScope: DashDataScope;
  readonly widgetType: DashWidgetType;
  readonly dataSourceKey: string;
  readonly componentKey: string;
}

/**
 * 7 widget in-sprint (IMPLEMENTATION-07 §11.3). OWNER CHỐT 2026-07-10 "Trim MVP": KHÔNG seed phần còn lại
 * của DB-07 §14.3 (LEAVE_BALANCE, TEAM_TASKS_TODAY, LEAVE_CALENDAR, ATTENDANCE_ALERTS, NEW_EMPLOYEES,
 * CONTRACT_EXPIRING, USER_SUMMARY, EMPLOYEE_SUMMARY, MODULE_STATUS, CONFIG_WARNINGS, SYSTEM_LOGS) —
 * chúng chưa có data source. DRIFT đã ghi vào DB-07 §14.3.
 *
 * `defaultDataScope` lấy CẬN DƯỚI khi DB-07 §8.5 ghi dải (vd 'Own/Team' → Own): cột là đơn-giá-trị và BE
 * nới theo quyền user lúc runtime. `widgetType` là chỗ DUY NHẤT không có doc chống lưng (chọn theo bản chất
 * hiển thị) — reviewer lưu ý.
 */
export const DASH_WIDGET_CATALOG: readonly DashWidgetEntry[] = [
  {
    widgetCode: "ATTENDANCE_TODAY",
    moduleCode: "ATT",
    name: "Chấm công hôm nay",
    requiredPermissionCode: "DASH.WIDGET.VIEW_ATTENDANCE_TODAY",
    defaultDataScope: "Own",
    widgetType: "Summary",
    dataSourceKey: "attendance-today",
    componentKey: "AttendanceTodayWidget",
  },
  {
    widgetCode: "MY_TASKS",
    moduleCode: "TASK",
    name: "Task của tôi",
    requiredPermissionCode: "DASH.WIDGET.VIEW_MY_TASKS",
    defaultDataScope: "Own",
    widgetType: "List",
    dataSourceKey: "my-tasks",
    componentKey: "MyTasksWidget",
  },
  {
    widgetCode: "TASK_ALERTS",
    moduleCode: "TASK",
    name: "Task sắp đến hạn/quá hạn",
    requiredPermissionCode: "DASH.WIDGET.VIEW_TASK_ALERTS",
    defaultDataScope: "Own",
    widgetType: "Alert",
    dataSourceKey: "task-alerts",
    componentKey: "TaskAlertsWidget",
  },
  {
    widgetCode: "NOTIFICATIONS",
    moduleCode: "NOTI",
    name: "Thông báo mới",
    requiredPermissionCode: "DASH.WIDGET.VIEW_NOTIFICATIONS",
    defaultDataScope: "Own",
    widgetType: "List",
    dataSourceKey: "notifications",
    componentKey: "NotificationsWidget",
  },
  {
    widgetCode: "PENDING_LEAVE",
    moduleCode: "LEAVE",
    name: "Đơn nghỉ chờ duyệt",
    requiredPermissionCode: "DASH.WIDGET.VIEW_PENDING_LEAVE",
    defaultDataScope: "Team",
    widgetType: "List",
    dataSourceKey: "pending-leave",
    componentKey: "PendingLeaveWidget",
  },
  {
    widgetCode: "PROJECT_PROGRESS",
    moduleCode: "TASK",
    name: "Tiến độ dự án",
    requiredPermissionCode: "DASH.WIDGET.VIEW_PROJECT_PROGRESS",
    defaultDataScope: "Project",
    widgetType: "Chart",
    dataSourceKey: "project-progress",
    componentKey: "ProjectProgressWidget",
  },
  {
    widgetCode: "HR_OVERVIEW",
    moduleCode: "HR",
    name: "Tổng quan nhân sự",
    requiredPermissionCode: "DASH.WIDGET.VIEW_HR_OVERVIEW",
    defaultDataScope: "Company",
    widgetType: "Summary",
    dataSourceKey: "hr-overview",
    componentKey: "HrOverviewWidget",
  },
] as const;

export const DASH_WIDGET_COUNT = DASH_WIDGET_CATALOG.length;

/**
 * OPTION B (owner chốt) — gate widget bằng cặp quyền của MODULE NGUỒN, KHÔNG seed cặp per-widget
 * '*:dashboard-widget'. Căn cứ: permission-matrix-spec §7:144 "DASH chỉ hiển thị; module nguồn ép data scope".
 *
 * ⚠ Test E3 chỉ chứng "cặp TỒN TẠI". Nhiều module có NHIỀU cặp cùng tồn tại, nên chọn nhầm một cặp
 * có-thật-nhưng-sai-ngữ-nghĩa vẫn cho E3 xanh. Mỗi entry vì thế ghi rõ migration + lý do; reviewer FULL gate
 * đối chiếu bằng mắt.
 */
export const DASH_WIDGET_GATE_PAIR: Readonly<Record<string, EnginePair>> = {
  // ATT có CẢ ('read','attendance') [0063_g11_permissions_seed.sql] LẪN ('view-own','attendance')
  // [0454_s3_attseed1_att_perms.sql]. Widget hiển thị công CỦA CHÍNH MÌNH (DB-07 §8.5 Scope=Own) ⇒ view-own.
  ATTENDANCE_TODAY: { action: "view-own", resourceType: "attendance" },
  // ('read','task') — 0005_permissions.sql.
  MY_TASKS: { action: "read", resourceType: "task" },
  TASK_ALERTS: { action: "read", resourceType: "task" },
  // ('read','notification') — 0005_permissions.sql; grant Own-scope ở 0481.
  NOTIFICATIONS: { action: "read", resourceType: "notification" },
  // LEAVE có 3 cặp: read/view/view-own:leave. Widget là "đơn CHỜ DUYỆT của team" (Scope=Team) ⇒ view:leave
  // [0455_s3_leaveseed1_leave_perms.sql], KHÔNG view-own (của mình), KHÔNG read (cặp admin).
  PENDING_LEAVE: { action: "view", resourceType: "leave" },
  // Tiến độ PROJECT, không phải task ⇒ ('read','project') — 0005_permissions.sql:223.
  PROJECT_PROGRESS: { action: "read", resourceType: "project" },
  // ('read','employee') — 0019_g5_permissions_seed.sql.
  HR_OVERVIEW: { action: "read", resourceType: "employee" },
} as const;

export interface DashPermissionPair extends EnginePair {
  /** SPEC code tương ứng (DB-07 §10.2 / API-10) — chỉ để truy vết, KHÔNG lưu vào DB. */
  readonly specCode: string;
  readonly isSensitive: boolean;
}

/**
 * 7 cặp quyền DASH seed mới. GIỮ NGUYÊN ('read','dashboard') của mig 0100 — KHÔNG đụng.
 *
 * KHÔNG seed 'refresh:dashboard-cache' (DASH.CACHE.REFRESH): API-10:313 cấp nó cho SA DUY NHẤT, mà ta không
 * enumerate super-admin ⇒ không có role nào để grant; nó cũng "không có endpoint" và vắng mặt ở DB-07 §10.2.
 *
 * 'view:dashboard-audit-log' hiện CŨNG chưa có endpoint (API-10:312) nhưng CÓ trong DB-07 §10.2 (nguồn seed)
 * và cấp cho CA ⇒ seed, coi là quyền catalog tới khi S4-DASH-BE-3 gắn endpoint.
 */
export const DASH_PERMISSION_PAIRS: readonly DashPermissionPair[] = [
  {
    specCode: "DASH.DASHBOARD.VIEW_EMPLOYEE",
    action: "view-employee",
    resourceType: "dashboard",
    isSensitive: false,
  },
  {
    specCode: "DASH.DASHBOARD.VIEW_MANAGER",
    action: "view-manager",
    resourceType: "dashboard",
    isSensitive: true,
  },
  {
    specCode: "DASH.DASHBOARD.VIEW_HR",
    action: "view-hr",
    resourceType: "dashboard",
    isSensitive: true,
  },
  {
    specCode: "DASH.DASHBOARD.VIEW_ADMIN",
    action: "view-admin",
    resourceType: "dashboard",
    isSensitive: true,
  },
  {
    specCode: "DASH.CONFIG.VIEW",
    action: "view",
    resourceType: "dashboard-config",
    isSensitive: true,
  },
  {
    specCode: "DASH.CONFIG.UPDATE",
    action: "update",
    resourceType: "dashboard-config",
    isSensitive: true,
  },
  {
    specCode: "DASH.AUDIT_LOG.VIEW",
    action: "view",
    resourceType: "dashboard-audit-log",
    isSensitive: true,
  },
] as const;

/** Cặp mà employee/manager/hr PHẢI vắng mặt (test M). */
export const DASH_ADMIN_ONLY_PAIRS: readonly EnginePair[] = [
  { action: "view-admin", resourceType: "dashboard" },
  { action: "view", resourceType: "dashboard-config" },
  { action: "update", resourceType: "dashboard-config" },
  { action: "view", resourceType: "dashboard-audit-log" },
] as const;

export const DASH_CANONICAL_ROLES: readonly DashCanonicalRole[] = [
  "employee",
  "manager",
  "hr",
  "company-admin",
] as const;

export interface DashGrant extends EnginePair {
  readonly role: DashCanonicalRole;
  readonly dataScope: DashDataScope;
}

/**
 * Grant matrix — API-10 PERMISSION MATRIX:283-312. super-admin (SA) KHÔNG enumerate.
 *
 * data_scope: API-10 ghi cột Scope = 'per-widget' cho 4 cặp dashboard-type, 'Company/System' cho config/audit.
 *  - 4 cặp view-*:dashboard → 'Own'. Scope ở đây KHÔNG mang ngữ nghĩa lọc (data scope thật do cặp module nguồn
 *    ép — permission-matrix-spec §7). Chọn 'Own' = least-privilege: nếu DASH-BE lỡ dùng data_scope của cặp này
 *    thì nó CHẶN CHẶT HƠN, không nới ngầm.
 *  - 3 cặp config/audit → 'Company' (API-10:310-312).
 */
export const DASH_GRANT_MATRIX: readonly DashGrant[] = [
  // API-10:284 — EMP, MGR, HR, CA, SA
  { role: "employee", action: "view-employee", resourceType: "dashboard", dataScope: "Own" },
  { role: "manager", action: "view-employee", resourceType: "dashboard", dataScope: "Own" },
  { role: "hr", action: "view-employee", resourceType: "dashboard", dataScope: "Own" },
  { role: "company-admin", action: "view-employee", resourceType: "dashboard", dataScope: "Own" },
  // API-10:285 — MGR, HR(✓), CA, SA  ← 'hr' CÓ, v3 bỏ sót
  { role: "manager", action: "view-manager", resourceType: "dashboard", dataScope: "Own" },
  { role: "hr", action: "view-manager", resourceType: "dashboard", dataScope: "Own" },
  { role: "company-admin", action: "view-manager", resourceType: "dashboard", dataScope: "Own" },
  // API-10:286 — HR, CA(✓), SA
  { role: "hr", action: "view-hr", resourceType: "dashboard", dataScope: "Own" },
  { role: "company-admin", action: "view-hr", resourceType: "dashboard", dataScope: "Own" },
  // API-10:287 — CA, SA
  { role: "company-admin", action: "view-admin", resourceType: "dashboard", dataScope: "Own" },
  // API-10:310-312 — CA, SA
  { role: "company-admin", action: "view", resourceType: "dashboard-config", dataScope: "Company" },
  {
    role: "company-admin",
    action: "update",
    resourceType: "dashboard-config",
    dataScope: "Company",
  },
  {
    role: "company-admin",
    action: "view",
    resourceType: "dashboard-audit-log",
    dataScope: "Company",
  },
] as const;

export interface DashDefaultConfigEntry {
  readonly dashboardType: DashboardType;
  readonly widgetCode: string;
  readonly sortOrder: number;
}

/**
 * QUY TẮC (không phải khẩu vị):
 *   DASH_DEFAULT_CONFIG = ( DB-07 §14.3 ∩ 7 widget đã seed ) ∪ { NOTIFICATIONS cho MỌI dashboard type }
 *
 * Vế hai neo vào IMPLEMENTATION-07 §11.3: cột Dashboard của NOTIFICATIONS ghi "All".
 * sortOrder lấy nguyên từ DB-07 §14.3.
 *
 * PROJECT_PROGRESS có trong catalog nhưng KHÔNG có default config — §14.3 không đặt nó vào dashboard nào.
 * Dashboard Admin vì thế chỉ còn NOTIFICATIONS cho tới khi seed nốt catalog (WO S4-DASH-CATALOG-2).
 */
export const DASH_DEFAULT_CONFIG: readonly DashDefaultConfigEntry[] = [
  { dashboardType: "Employee", widgetCode: "ATTENDANCE_TODAY", sortOrder: 10 },
  { dashboardType: "Employee", widgetCode: "MY_TASKS", sortOrder: 20 },
  { dashboardType: "Employee", widgetCode: "TASK_ALERTS", sortOrder: 30 },
  { dashboardType: "Employee", widgetCode: "NOTIFICATIONS", sortOrder: 50 },
  { dashboardType: "Manager", widgetCode: "PENDING_LEAVE", sortOrder: 10 },
  { dashboardType: "Manager", widgetCode: "TASK_ALERTS", sortOrder: 30 },
  { dashboardType: "Manager", widgetCode: "NOTIFICATIONS", sortOrder: 50 },
  { dashboardType: "HR", widgetCode: "HR_OVERVIEW", sortOrder: 10 },
  { dashboardType: "HR", widgetCode: "PENDING_LEAVE", sortOrder: 40 },
  { dashboardType: "HR", widgetCode: "NOTIFICATIONS", sortOrder: 50 },
  { dashboardType: "Admin", widgetCode: "NOTIFICATIONS", sortOrder: 50 },
] as const;

/** Widget CỐ Ý không seed ở sprint này (DB-07 §14.3 + §8.5) — int-spec A2 assert chúng VẮNG MẶT. */
export const DASH_WIDGETS_NOT_SEEDED: readonly string[] = [
  "LEAVE_BALANCE",
  "LEAVE_CALENDAR",
  "TEAM_TASKS_TODAY",
  "ATTENDANCE_ALERTS",
  "NEW_EMPLOYEES",
  "CONTRACT_EXPIRING",
  "USER_SUMMARY",
  "EMPLOYEE_SUMMARY",
  "MODULE_STATUS",
  "CONFIG_WARNINGS",
  "SYSTEM_LOGS",
] as const;
