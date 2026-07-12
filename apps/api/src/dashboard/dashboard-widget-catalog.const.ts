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
  // ─── S4-DASH-CATALOG-2 (APPEND-only) — 9 widget đợt 2 ─────────────────────────────────────────────
  // Transcribe VERBATIM từ bảng LOCK (docs/plans/S4-DASH-CATALOG-2.md §LOCK) — cùng nguồn với migration 0493.
  // MIRROR khối (1) của 0493 (INSERT dashboard_widgets 9 row GLOBAL). Owner Trim-MVP đợt 2 (2026-07-11):
  // DEFER TEAM_TASKS_TODAY (không resolver viewer→teamId sạch) + CONFIG_WARNINGS (chưa read-service) — cả hai
  // VẮNG catalog, còn trong DASH_WIDGETS_NOT_SEEDED. Tổng catalog = 7 (0484) + 9 = 16.
  {
    widgetCode: "USER_SUMMARY",
    moduleCode: "AUTH",
    name: "Tổng số user",
    requiredPermissionCode: "DASH.WIDGET.VIEW_USER_SUMMARY",
    defaultDataScope: "Company",
    widgetType: "Summary",
    dataSourceKey: "user-summary",
    componentKey: "UserSummaryWidget",
  },
  {
    widgetCode: "EMPLOYEE_SUMMARY",
    moduleCode: "HR",
    name: "Tổng số nhân viên",
    requiredPermissionCode: "DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY",
    defaultDataScope: "Company",
    widgetType: "Summary",
    dataSourceKey: "employee-summary",
    componentKey: "EmployeeSummaryWidget",
  },
  {
    widgetCode: "MODULE_STATUS",
    moduleCode: "SYSTEM",
    name: "Module đang dùng",
    requiredPermissionCode: "DASH.WIDGET.VIEW_MODULE_STATUS",
    defaultDataScope: "Company",
    widgetType: "List",
    dataSourceKey: "module-status",
    componentKey: "ModuleStatusWidget",
  },
  {
    widgetCode: "SYSTEM_LOGS",
    moduleCode: "SYSTEM",
    name: "Log quan trọng gần đây",
    requiredPermissionCode: "DASH.WIDGET.VIEW_SYSTEM_LOGS",
    defaultDataScope: "Company",
    widgetType: "Summary",
    dataSourceKey: "system-logs",
    componentKey: "SystemLogsWidget",
  },
  {
    widgetCode: "LEAVE_BALANCE",
    moduleCode: "LEAVE",
    name: "Số ngày phép còn lại",
    requiredPermissionCode: "DASH.WIDGET.VIEW_LEAVE_BALANCE",
    defaultDataScope: "Own",
    widgetType: "Summary",
    dataSourceKey: "leave-balance",
    componentKey: "LeaveBalanceWidget",
  },
  {
    widgetCode: "NEW_EMPLOYEES",
    moduleCode: "HR",
    name: "Nhân sự mới",
    requiredPermissionCode: "DASH.WIDGET.VIEW_NEW_EMPLOYEES",
    defaultDataScope: "Company",
    widgetType: "List",
    dataSourceKey: "new-employees",
    componentKey: "NewEmployeesWidget",
  },
  {
    widgetCode: "CONTRACT_EXPIRING",
    moduleCode: "HR",
    name: "Hợp đồng sắp hết hạn",
    requiredPermissionCode: "DASH.WIDGET.VIEW_CONTRACT_EXPIRING",
    defaultDataScope: "Company",
    widgetType: "Alert",
    dataSourceKey: "contract-expiring",
    componentKey: "ContractExpiringWidget",
  },
  {
    widgetCode: "LEAVE_CALENDAR",
    moduleCode: "LEAVE",
    name: "Lịch nghỉ team",
    requiredPermissionCode: "DASH.WIDGET.VIEW_LEAVE_CALENDAR",
    defaultDataScope: "Team",
    widgetType: "Calendar",
    dataSourceKey: "leave-calendar",
    componentKey: "LeaveCalendarWidget",
  },
  {
    widgetCode: "ATTENDANCE_ALERTS",
    moduleCode: "ATT",
    name: "Bất thường chấm công",
    requiredPermissionCode: "DASH.WIDGET.VIEW_ATTENDANCE_ALERTS",
    defaultDataScope: "Team",
    widgetType: "Alert",
    dataSourceKey: "attendance-alerts",
    componentKey: "AttendanceAlertsWidget",
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
  // ─── S4-DASH-CATALOG-2 (APPEND-only) — cặp gate 9 widget đợt 2 (ĐÃ VERIFY grep migration runtime) ───
  // Mọi cặp ĐÃ TỒN TẠI + ĐÃ GRANT trước WO này; migration 0493 KHÔNG đụng permissions/role_permissions.
  // ('view','user') — 0444:39; grant hr 0444:88 · CA 0444:89 (Company). listUsers KHÔNG tự gate ⇒ handler gate.
  USER_SUMMARY: { action: "view", resourceType: "user" },
  // ('read','employee') — 0019:19. getEmployeesSummary tự resolveAndAssert; handler vẫn gate lại cho nhất quán.
  EMPLOYEE_SUMMARY: { action: "read", resourceType: "employee" },
  // ('view','foundation-module') — 0435:338 (is_sensitive=false). getAllModules KHÔNG tự gate ⇒ handler gate.
  MODULE_STATUS: { action: "view", resourceType: "foundation-module" },
  // ('view','audit-log') — 0340:31 SENSITIVE; grant CA TƯỜNG MINH 0340:38-40 (CA-only). listCompany KHÔNG tự
  // gate ⇒ handler PHẢI tự gate (crown, chống leo thang). engine tự ép effectivelySensitive ⇒ wildcard KHÔNG lọt.
  SYSTEM_LOGS: { action: "view", resourceType: "audit-log" },
  // ('view-own','leave-balance') — 0455:59; grant 4 role 0455:136-139 (Own). listMyBalances self-locked user_id.
  LEAVE_BALANCE: { action: "view-own", resourceType: "leave-balance" },
  // ('read','employee') — 0019:19 (widget "nhân sự mới" cũng dùng cặp read:employee, map non-PII).
  NEW_EMPLOYEES: { action: "read", resourceType: "employee" },
  // ('view','contract') — 0462:157; grant hr/CA 0462:169-170 (Company), employee Own/manager Team ở 0462/0465.
  CONTRACT_EXPIRING: { action: "view", resourceType: "contract" },
  // ('view-team','leave-calendar') — 0455:65. listCalendar(scope=team) tự resolveAndAssert(view-team); handler
  // gate lại cho nhất quán ⇒ user chỉ có view-own → 403 (fail-closed, không rơi về Own âm thầm).
  LEAVE_CALENDAR: { action: "view-team", resourceType: "leave-calendar" },
  // ('view-team','attendance') — 0454:36 SENSITIVE. listTeamRecords tự resolveAndAssert(view-team,isSensitive);
  // handler gate lại cho nhất quán.
  ATTENDANCE_ALERTS: { action: "view-team", resourceType: "attendance" },
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
 *
 * S4-DASH-CATALOG-2 (APPEND-only): seed nốt DB-07 §14.3 cho 9 widget đợt 2. TEAM_TASKS_TODAY + CONFIG_WARNINGS
 * DEFER ⇒ KHÔNG default-config (không có row). ATTENDANCE_ALERTS xuất hiện ở CẢ Manager lẫn HR (khác
 * dashboard_type ⇒ khoá nghiệp vụ (company,widget,type,scope) không đụng). Dashboard Admin sau seed = 5 widget
 * (USER_SUMMARY@10 · EMPLOYEE_SUMMARY@20 · MODULE_STATUS@30 · SYSTEM_LOGS@50 + NOTIFICATIONS@50 đã có).
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
  // ─── S4-DASH-CATALOG-2 (APPEND) — DB-07 §14.3 cho 9 widget đợt 2 (KHÔNG TEAM_TASKS_TODAY/CONFIG_WARNINGS) ───
  { dashboardType: "Employee", widgetCode: "LEAVE_BALANCE", sortOrder: 40 },
  { dashboardType: "Manager", widgetCode: "LEAVE_CALENDAR", sortOrder: 40 },
  { dashboardType: "Manager", widgetCode: "ATTENDANCE_ALERTS", sortOrder: 50 },
  { dashboardType: "HR", widgetCode: "NEW_EMPLOYEES", sortOrder: 20 },
  { dashboardType: "HR", widgetCode: "CONTRACT_EXPIRING", sortOrder: 30 },
  { dashboardType: "HR", widgetCode: "ATTENDANCE_ALERTS", sortOrder: 50 },
  { dashboardType: "Admin", widgetCode: "USER_SUMMARY", sortOrder: 10 },
  { dashboardType: "Admin", widgetCode: "EMPLOYEE_SUMMARY", sortOrder: 20 },
  { dashboardType: "Admin", widgetCode: "MODULE_STATUS", sortOrder: 30 },
  { dashboardType: "Admin", widgetCode: "SYSTEM_LOGS", sortOrder: 50 },
] as const;

// ─── S4-DASH-BE-1 (APPEND-only) — resolver route → cặp engine ────────────────────────────────────────
//
// KHÔNG sửa các khối trên (chúng là hợp đồng với mig 0484 đã land). Chỉ THÊM 3 hằng + 2 helper dưới đây để
// DashboardResolverController/Service lấy cặp @RequirePermission TỪ NGUỒN DUY NHẤT, KHÔNG gõ tay string rời
// (bài học pair-drift đã cắn 3 lần — xem doc-block đầu file).

/** 4 dashboard type user-facing mà lane này mở route (API-08 §10.1). System/Project KHÔNG mở.
 *  Value không export (chỉ nguồn sinh type — consumer duyệt theo DASH_TYPE_PRIORITY). */
const DASH_RESOLVER_TYPES = ["Employee", "Manager", "HR", "Admin"] as const;
export type DashResolverType = (typeof DASH_RESOLVER_TYPES)[number];

/**
 * Cặp engine gate cho /dashboard/me và /dashboard/types = ('read','dashboard') — mig 0100, blanket-grant
 * MỌI role (CROSS JOIN roles), is_sensitive=false. KHÔNG nằm trong DASH_PERMISSION_PAIRS (chỉ chứa các cặp
 * view-* seed ở mig 0484). User KHÔNG có role nào ⇒ 0 grant ⇒ 403 (deny-path M1).
 */
export const DASH_READ_PAIR: DashPermissionPair = {
  specCode: "DASH.DASHBOARD.READ",
  action: "read",
  resourceType: "dashboard",
  isSensitive: false,
};

/**
 * Map 4 dashboard type user-facing → cặp view-*:dashboard TƯƠNG ỨNG (đọc verbatim từ DASH_PERMISSION_PAIRS —
 * KHÔNG tái khai action/resourceType). Dùng cho:
 *   - @RequirePermission trên 4 route tĩnh (§3 plan).
 *   - resolver: thứ tự ưu tiên Admin>HR>Manager>Employee gọi can() theo đúng cặp (kèm isSensitive).
 */
export const DASH_TYPE_PERMISSION_PAIR: Readonly<Record<DashResolverType, DashPermissionPair>> = {
  Employee: dashPairBySpec("DASH.DASHBOARD.VIEW_EMPLOYEE"),
  Manager: dashPairBySpec("DASH.DASHBOARD.VIEW_MANAGER"),
  HR: dashPairBySpec("DASH.DASHBOARD.VIEW_HR"),
  Admin: dashPairBySpec("DASH.DASHBOARD.VIEW_ADMIN"),
} as const;

/** Nhãn tiếng Việt cho /dashboard/types (hiển thị FE). */
export const DASH_TYPE_LABEL: Readonly<Record<DashResolverType, string>> = {
  Employee: "Nhân viên",
  Manager: "Quản lý",
  HR: "Nhân sự",
  Admin: "Quản trị",
} as const;

/**
 * Thứ tự ưu tiên resolve dashboard mặc định (BACKEND-10 §13.2/13.3) — CỐ ĐỊNH, KHÔNG đọc user_roles.name để
 * đoán (BẤT BIẾN: không hard-code role). Admin mạnh nhất → Employee yếu nhất.
 */
export const DASH_TYPE_PRIORITY: readonly DashResolverType[] = [
  "Admin",
  "HR",
  "Manager",
  "Employee",
] as const;

/** Resolve 1 cặp DASH từ DASH_PERMISSION_PAIRS theo specCode — fail-fast nếu thiếu (mirror notificationPair). */
function dashPairBySpec(specCode: string): DashPermissionPair {
  const pair = DASH_PERMISSION_PAIRS.find((p) => p.specCode === specCode);
  if (!pair) {
    throw new Error(`DASH permission pair missing from catalog: specCode=${specCode}`);
  }
  return pair;
}

/**
 * Widget CỐ Ý không seed (DB-07 §14.3 DRIFT) — int-spec A2 assert chúng VẮNG MẶT trong dashboard_widgets.
 *
 * S4-DASH-CATALOG-2 (2026-07-11): THU HẸP từ 11 → 2. 9 widget (USER_SUMMARY/EMPLOYEE_SUMMARY/MODULE_STATUS/
 * SYSTEM_LOGS/LEAVE_BALANCE/NEW_EMPLOYEES/CONTRACT_EXPIRING/LEAVE_CALENDAR/ATTENDANCE_ALERTS) NAY đã seed
 * (migration 0493 + handler). Còn DEFER đúng 2 (owner Trim-MVP đợt 2):
 *   - TEAM_TASKS_TODAY: KHÔNG có resolver viewer→teamId sạch (resolveContext trả managedUserIds+org-units,
 *     KHÔNG teamId; TasksService.listByTeam nhận teamId tường minh + chỉ tenant-guard) ⇒ không gate scope sạch.
 *   - CONFIG_WARNINGS: chưa có read-service warnings cấu hình hệ thống ⇒ seed sẽ luôn degraded.
 */
export const DASH_WIDGETS_NOT_SEEDED: readonly string[] = [
  "TEAM_TASKS_TODAY",
  "CONFIG_WARNINGS",
] as const;
