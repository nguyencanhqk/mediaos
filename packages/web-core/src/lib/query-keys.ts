// query-keys.ts — Query key factories for TanStack Query (FRONTEND-04 §17).
//
// All keys are plain const arrays — NO import from @tanstack/react-query.
// Wiring QueryClient.defaultOptions in apps main.tsx = follow-up S1-FE-QUERY-WIRE-1.
//
// Convention: [root, resource, variant, ...params]
// - root = module slug (stable string)
// - resource = entity name
// - variant = 'list' | 'detail' | specific action
// - params = filter/pagination object (plain, JSON-serialisable)

// ── Root keys (for broad invalidation) ───────────────────────────────────────

export const rootKeys = {
  auth: ["auth"] as const,
  dashboard: ["dashboard"] as const,
  hr: ["hr"] as const,
  attendance: ["attendance"] as const,
  leave: ["leave"] as const,
  tasks: ["tasks"] as const,
  notifications: ["notifications"] as const,
  foundation: ["foundation"] as const,
  // S5-ME-FE-1 — Personal Hub (SPEC-09).
  me: ["me"] as const,
} as const;

// ── Auth keys ─────────────────────────────────────────────────────────────────

export const authKeys = {
  all: rootKeys.auth,
  me: () => [...rootKeys.auth, "me"] as const,
  profile: () => [...rootKeys.auth, "profile"] as const,
  permissions: () => [...rootKeys.auth, "permissions"] as const,
  // S2-FE-AUTH-4 (lane FE batch C) — role & permission admin catalogs (GET /auth/roles·/auth/permissions).
  roles: {
    all: [...rootKeys.auth, "roles"] as const,
    list: () => [...rootKeys.auth, "roles", "list"] as const,
    // S2-AUTH-ROLEMEM-1 — thành viên của 1 role (tab Thành viên, GET /auth/roles/:id/members).
    members: (roleId: string) => [...rootKeys.auth, "roles", roleId, "members"] as const,
    // S2-AUTH-PERMUX-1 — grants đã gán của 1 role (GET /auth/roles/:id/permissions).
    grants: (roleId: string) => [...rootKeys.auth, "roles", roleId, "grants"] as const,
  },
  permissionCatalog: {
    all: [...rootKeys.auth, "permission-catalog"] as const,
    list: () => [...rootKeys.auth, "permission-catalog", "list"] as const,
  },
  // S2-FE-AUTH-5 (lane FE batch C) — session self-service (Own scope, GET /auth/sessions).
  sessions: {
    all: [...rootKeys.auth, "sessions"] as const,
    list: () => [...rootKeys.auth, "sessions", "list"] as const,
  },
};

// ── Auth admin keys (S2-FE-AUTH-3) — /system/users + /system/roles(assign) ────
//
// Tách khỏi authKeys (self-service /auth/me) — namespace riêng "auth-admin" tránh đụng invalidation
// của phiên hiện tại khi admin thao tác trên user KHÁC.

export const authUsersKeys = {
  all: [...rootKeys.auth, "admin", "users"] as const,
  list: (params?: Record<string, unknown>) =>
    [...rootKeys.auth, "admin", "users", "list", params] as const,
  detail: (id: string) => [...rootKeys.auth, "admin", "users", "detail", id] as const,
  roles: () => [...rootKeys.auth, "admin", "roles"] as const,
};

// ── Dashboard keys ────────────────────────────────────────────────────────────

export const dashboardKeys = {
  all: rootKeys.dashboard,
  overview: () => [...rootKeys.dashboard, "overview"] as const,
  stats: (params?: Record<string, unknown>) => [...rootKeys.dashboard, "stats", params] as const,
  // S4-FE-DASH-1 — APPEND: GET /dashboard/me (shell) + widget catalog/data (lazy-load per WidgetCard).
  me: () => [...rootKeys.dashboard, "me"] as const,
  // S4-FE-DASH-2 — APPEND: GET /dashboard/types (DashboardTypeSwitcher) + GET /dashboard/{type} (switch).
  types: () => [...rootKeys.dashboard, "types"] as const,
  byType: (type: string) => [...rootKeys.dashboard, "byType", type] as const,
  widgets: {
    all: [...rootKeys.dashboard, "widgets"] as const,
    catalog: (params?: Record<string, unknown>) =>
      [...rootKeys.dashboard, "widgets", "catalog", params] as const,
    data: (widgetCode: string, params?: Record<string, unknown>) =>
      [...rootKeys.dashboard, "widgets", "data", widgetCode, params] as const,
  },
  // S4-FE-DASH-3 — widget CONFIG admin (GET/PATCH /dashboard/configs, DashboardConfigPage).
  configs: {
    all: [...rootKeys.dashboard, "configs"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.dashboard, "configs", "list", params] as const,
  },
};

// ── HR keys ───────────────────────────────────────────────────────────────────

export const hrKeys = {
  all: rootKeys.hr,
  employees: {
    all: [...rootKeys.hr, "employees"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "employees", "list", params] as const,
    detail: (id: string) => [...rootKeys.hr, "employees", "detail", id] as const,
    // HR-PROFILE-UI-1 — overview strip aggregates (GET /hr/employees/summary).
    summary: () => [...rootKeys.hr, "employees", "summary"] as const,
    me: () => [...rootKeys.hr, "employees", "me"] as const,
    // S2-FE-HR-9 — Employee Files tab (danh sách file đính kèm hồ sơ, GET /hr/employees/:id/files).
    files: (employeeId: string) => [...rootKeys.hr, "employees", "files", employeeId] as const,
  },
  departments: {
    all: [...rootKeys.hr, "departments"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "departments", "list", params] as const,
    detail: (id: string) => [...rootKeys.hr, "departments", "detail", id] as const,
  },
  positions: {
    all: [...rootKeys.hr, "positions"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "positions", "list", params] as const,
    // S2-FE-HR-5 (lane HR5-WC) — APPEND detail (GET/PATCH /org/positions/:id).
    detail: (id: string) => [...rootKeys.hr, "positions", "detail", id] as const,
  },
  jobLevels: {
    all: [...rootKeys.hr, "job-levels"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "job-levels", "list", params] as const,
    // S2-FE-HR-5 (lane HR5-WC) — APPEND detail (GET/PATCH /hr/master-data/job-levels/:id).
    detail: (id: string) => [...rootKeys.hr, "job-levels", "detail", id] as const,
  },
  contractTypes: {
    all: [...rootKeys.hr, "contract-types"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "contract-types", "list", params] as const,
    // S2-FE-HR-5 (lane HR5-WC) — APPEND detail (GET/PATCH /hr/master-data/contract-types/:id).
    detail: (id: string) => [...rootKeys.hr, "contract-types", "detail", id] as const,
  },
  // S2-FE-HR-7 — APPEND. Employee contracts (hợp đồng lao động): danh sách toàn công ty + theo nhân viên.
  contracts: {
    all: [...rootKeys.hr, "contracts"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "contracts", "list", params] as const,
    byEmployee: (employeeId: string, params?: Record<string, unknown>) =>
      [...rootKeys.hr, "contracts", "by-employee", employeeId, params] as const,
    detail: (id: string) => [...rootKeys.hr, "contracts", "detail", id] as const,
  },
  // S2-FE-HR-6 — Org chart (danh mục nhỏ, không phân trang server) + HR audit-logs (phân trang offset/limit).
  orgChart: {
    all: [...rootKeys.hr, "org-chart"] as const,
    tree: () => [...rootKeys.hr, "org-chart", "tree"] as const,
  },
  auditLogs: {
    all: [...rootKeys.hr, "audit-logs"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "audit-logs", "list", params] as const,
  },
  // S2-FE-HR-8 — Employee-code CONFIG admin (danh mục 1 record/company, KHÔNG phân trang). preview()
  // TÁCH khỏi config() (2 endpoint khác nhau: GET config vs POST preview) — invalidate riêng.
  employeeCodeConfig: {
    all: [...rootKeys.hr, "employee-code-config"] as const,
    config: () => [...rootKeys.hr, "employee-code-config", "config"] as const,
    preview: () => [...rootKeys.hr, "employee-code-config", "preview"] as const,
  },
  // S2-FE-HR-4 — Profile change request (self-service + HR duyệt). "mine" tách khỏi "list" (Company scope,
  // HR/Admin) vì cùng resource nhưng scope khác nhau — invalidate riêng tránh làm mới nhầm cache của người khác.
  profileChangeRequests: {
    all: [...rootKeys.hr, "profile-change-requests"] as const,
    mine: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "profile-change-requests", "mine", params] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "profile-change-requests", "list", params] as const,
    detail: (id: string) => [...rootKeys.hr, "profile-change-requests", "detail", id] as const,
  },
};

// S2-FE-HR-7 — mutation → invalidation cho hợp đồng nhân viên. Prefix (bỏ slot params) khớp mọi biến
// thể param'd. Sau create/update/delete/link-file: làm mới cả danh sách công ty lẫn danh sách theo NV.
const hrContractsListPrefix = [...rootKeys.hr, "contracts", "list"] as const;
const hrContractsByEmployeePrefix = [...rootKeys.hr, "contracts", "by-employee"] as const;

export const hrContractsInvalidation = {
  mutate: (employeeId?: string): readonly (readonly unknown[])[] => {
    const keys: (readonly unknown[])[] = [hrContractsListPrefix];
    keys.push(
      employeeId ? [...hrContractsByEmployeePrefix, employeeId] : hrContractsByEmployeePrefix,
    );
    return keys;
  },
  // S2-FE-HR-6 — Org chart (danh mục nhỏ, không phân trang server) + HR audit-logs (phân trang offset/limit).
  orgChart: {
    all: [...rootKeys.hr, "org-chart"] as const,
    tree: () => [...rootKeys.hr, "org-chart", "tree"] as const,
  },
  auditLogs: {
    all: [...rootKeys.hr, "audit-logs"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "audit-logs", "list", params] as const,
  },
  // S2-FE-HR-8 — Employee-code CONFIG admin (danh mục 1 record/company, KHÔNG phân trang). preview()
  // TÁCH khỏi config() (2 endpoint khác nhau: GET config vs POST preview) — invalidate riêng.
  employeeCodeConfig: {
    all: [...rootKeys.hr, "employee-code-config"] as const,
    config: () => [...rootKeys.hr, "employee-code-config", "config"] as const,
    preview: () => [...rootKeys.hr, "employee-code-config", "preview"] as const,
  },
  // S2-FE-HR-4 — Profile change request (self-service + HR duyệt). "mine" tách khỏi "list" (Company scope,
  // HR/Admin) vì cùng resource nhưng scope khác nhau — invalidate riêng tránh làm mới nhầm cache của người khác.
  profileChangeRequests: {
    all: [...rootKeys.hr, "profile-change-requests"] as const,
    mine: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "profile-change-requests", "mine", params] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "profile-change-requests", "list", params] as const,
    detail: (id: string) => [...rootKeys.hr, "profile-change-requests", "detail", id] as const,
  },
};

// S2-FE-HR-5 (lane HR5-WC) — mutation → invalidation cho HR master-data. Sau create/update/delete:
// làm mới danh sách (prefix list) của đúng resource. Prefix (bỏ slot params) khớp mọi biến thể param'd.
const hrDepartmentsListPrefix = [...rootKeys.hr, "departments", "list"] as const;
const hrPositionsListPrefix = [...rootKeys.hr, "positions", "list"] as const;
const hrJobLevelsListPrefix = [...rootKeys.hr, "job-levels", "list"] as const;
const hrContractTypesListPrefix = [...rootKeys.hr, "contract-types", "list"] as const;

export const hrMasterDataInvalidation = {
  departments: () => [hrDepartmentsListPrefix] as const,
  positions: () => [hrPositionsListPrefix] as const,
  jobLevels: () => [hrJobLevelsListPrefix] as const,
  contractTypes: () => [hrContractTypesListPrefix] as const,
};

// ── Attendance keys ───────────────────────────────────────────────────────────

export const attendanceKeys = {
  all: rootKeys.attendance,
  list: (params?: Record<string, unknown>) => [...rootKeys.attendance, "list", params] as const,
  detail: (id: string) => [...rootKeys.attendance, "detail", id] as const,
  myToday: () => [...rootKeys.attendance, "my", "today"] as const,
  mySummary: (params?: Record<string, unknown>) =>
    [...rootKeys.attendance, "my", "summary", params] as const,
  // S3-FE-REGISTRY-1 — APPEND (không rename key cũ). Scoped records: my / team / company(records).
  myRecords: (params?: Record<string, unknown>) =>
    [...rootKeys.attendance, "my", "records", params] as const,
  teamRecords: (params?: Record<string, unknown>) =>
    [...rootKeys.attendance, "team", "records", params] as const,
  records: {
    all: [...rootKeys.attendance, "records"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "records", "list", params] as const,
    detail: (id: string) => [...rootKeys.attendance, "records", "detail", id] as const,
  },
  // S3-FE-ATT-5 — APPEND. Danh mục nhỏ (không phân trang server): list() không nhận params.
  shifts: {
    all: [...rootKeys.attendance, "shifts"] as const,
    list: () => [...rootKeys.attendance, "shifts", "list"] as const,
  },
  shiftAssignments: {
    all: [...rootKeys.attendance, "shift-assignments"] as const,
    list: () => [...rootKeys.attendance, "shift-assignments", "list"] as const,
  },
  rules: {
    all: [...rootKeys.attendance, "rules"] as const,
    list: () => [...rootKeys.attendance, "rules", "list"] as const,
  },
  // S3-FE-ATT-4 — APPEND. Remote/onsite-work requests (my/team/company + detail).
  remoteWorkRequests: {
    all: [...rootKeys.attendance, "remote-work-requests"] as const,
    my: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "remote-work-requests", "my", params] as const,
    team: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "remote-work-requests", "team", params] as const,
    company: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "remote-work-requests", "company", params] as const,
    detail: (id: string) => [...rootKeys.attendance, "remote-work-requests", "detail", id] as const,
  },
  // S3-FE-ATT-6 — APPEND. Báo cáo tổng hợp công (team/company) + audit log viewer ATT.
  reports: {
    all: [...rootKeys.attendance, "reports"] as const,
    team: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "reports", "team", params] as const,
    company: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "reports", "company", params] as const,
  },
  auditLogs: {
    all: [...rootKeys.attendance, "audit-logs"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "audit-logs", "list", params] as const,
  },
  // S3-FE-ATT-3 — APPEND. Đơn điều chỉnh công: my/team/company (phân trang server) + detail.
  adjustments: {
    all: [...rootKeys.attendance, "adjustments"] as const,
    my: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "adjustments", "my", params] as const,
    team: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "adjustments", "team", params] as const,
    company: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "adjustments", "company", params] as const,
    detail: (id: string) => [...rootKeys.attendance, "adjustments", "detail", id] as const,
  },
};

// S3-FE-ATT-4 — mutation → invalidation cho remote-work-requests. Prefix (bỏ slot params) khớp mọi
// biến thể param'd. Sau submit/approve/reject/cancel: làm mới cả 3 scope list + chi tiết đúng đơn.
const attRemoteWorkRequestsMyPrefix = [
  ...rootKeys.attendance,
  "remote-work-requests",
  "my",
] as const;
const attRemoteWorkRequestsTeamPrefix = [
  ...rootKeys.attendance,
  "remote-work-requests",
  "team",
] as const;
const attRemoteWorkRequestsCompanyPrefix = [
  ...rootKeys.attendance,
  "remote-work-requests",
  "company",
] as const;

export const remoteWorkRequestInvalidation = {
  mutate: (id: string) =>
    [
      attRemoteWorkRequestsMyPrefix,
      attRemoteWorkRequestsTeamPrefix,
      attRemoteWorkRequestsCompanyPrefix,
      attendanceKeys.remoteWorkRequests.detail(id),
    ] as const,
  // S3-FE-ATT-3 — APPEND. Đơn điều chỉnh công: my/team/company (phân trang server) + detail.
  adjustments: {
    all: [...rootKeys.attendance, "adjustments"] as const,
    my: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "adjustments", "my", params] as const,
    team: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "adjustments", "team", params] as const,
    company: (params?: Record<string, unknown>) =>
      [...rootKeys.attendance, "adjustments", "company", params] as const,
    detail: (id: string) => [...rootKeys.attendance, "adjustments", "detail", id] as const,
  },
};

// ── Leave keys ────────────────────────────────────────────────────────────────

export const leaveKeys = {
  all: rootKeys.leave,
  types: {
    all: [...rootKeys.leave, "types"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.leave, "types", "list", params] as const,
    // S3-FE-LEAVE-5 — danh sách mặt admin (LEAVE-SCREEN-010). TÁCH khỏi `list` (cùng endpoint GET
    // /leave/types nhưng validate/adapt khác — leaveApi.listTypesAdmin) để invalidate không lẫn cache.
    adminList: () => [...rootKeys.leave, "types", "admin-list"] as const,
  },
  requests: {
    all: [...rootKeys.leave, "requests"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.leave, "requests", "list", params] as const,
    detail: (id: string) => [...rootKeys.leave, "requests", "detail", id] as const,
    my: (params?: Record<string, unknown>) =>
      [...rootKeys.leave, "requests", "my", params] as const,
  },
  balances: {
    all: [...rootKeys.leave, "balances"] as const,
    my: () => [...rootKeys.leave, "balances", "my"] as const,
    employee: (id: string) => [...rootKeys.leave, "balances", "employee", id] as const,
  },
  // S3-FE-LEAVE-4 — lịch nghỉ (own/team/company). params gồm scope+from+to (mirror BE query).
  calendar: {
    all: [...rootKeys.leave, "calendar"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.leave, "calendar", "list", params] as const,
  },
  // S3-FE-LEAVE-5 — Chính sách nghỉ phép (LEAVE-SCREEN-011, admin).
  policies: {
    all: [...rootKeys.leave, "policies"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.leave, "policies", "list", params] as const,
  },
  // S3-FE-LEAVE-5 — Số dư phép (HR, LEAVE-SCREEN-012/013). TÁCH khỏi `balances` (self-service) vì khác
  // endpoint (/leave/admin/balances) + khác shape (LeaveBalanceAdminView).
  balancesAdmin: {
    all: [...rootKeys.leave, "balances-admin"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.leave, "balances-admin", "list", params] as const,
    transactions: (balanceId: string) =>
      [...rootKeys.leave, "balances-admin", "transactions", balanceId] as const,
  },
  // S3-FE-LEAVE-6 — Báo cáo tổng hợp nghỉ (LEAVE-SCREEN-013) + audit log LEAVE (LEAVE-SCREEN-014A).
  // Mirror attendanceKeys.reports/auditLogs. params = filter kỳ / offset+limit (plain, JSON-serialisable).
  reports: {
    all: [...rootKeys.leave, "reports"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.leave, "reports", "list", params] as const,
  },
  auditLogs: {
    all: [...rootKeys.leave, "audit-logs"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.leave, "audit-logs", "list", params] as const,
  },
};

// ── Task keys ─────────────────────────────────────────────────────────────────

export const taskKeys = {
  all: rootKeys.tasks,
  list: (params?: Record<string, unknown>) => [...rootKeys.tasks, "list", params] as const,
  detail: (id: string) => [...rootKeys.tasks, "detail", id] as const,
  // S4-FE-TASK-2 — GET /tasks/my (TASK-API-210, MyTasksPage). Không tham số (gộp 3 nguồn server-side).
  my: () => [...rootKeys.tasks, "my"] as const,
  projects: {
    all: [...rootKeys.tasks, "projects"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.tasks, "projects", "list", params] as const,
    detail: (id: string) => [...rootKeys.tasks, "projects", "detail", id] as const,
    // S4-FE-TASK-1 — APPEND: thành viên dự án (ProjectMemberTable), tách khỏi detail vì mutate
    // riêng (add/update-role/remove member KHÔNG đổi payload getProject).
    members: (id: string) => [...rootKeys.tasks, "projects", "members", id] as const,
    // S4-FE-TASK-4 — APPEND: báo cáo tổng hợp dự án (ProjectProgressCard, GET /projects/:id/report,
    // view-report:project SENSITIVE) — tách khỏi detail (khác endpoint/gate/shape).
    report: (id: string) => [...rootKeys.tasks, "projects", "report", id] as const,
  },
  comments: (taskId: string) => [...rootKeys.tasks, "comments", taskId] as const,
  // S4-FE-TASK-3 — Kanban board (theo project) · checklist · activity feed (S4-TASK-BE-4).
  kanban: (projectId: string) => [...rootKeys.tasks, "kanban", projectId] as const,
  checklists: (taskId: string) => [...rootKeys.tasks, "checklists", taskId] as const,
  activity: (taskId: string, params?: Record<string, unknown>) =>
    [...rootKeys.tasks, "activity", taskId, params] as const,
  // S4-FE-TASK-4 — APPEND: file đính kèm công việc (TaskFilePanel, GET /tasks/:taskId/files).
  files: (taskId: string) => [...rootKeys.tasks, "files", taskId] as const,
};

// S4-FE-TASK-1 — invalidation cho mutation Project (create/update/close/delete + member add/update-role/
// remove). `taskProjectListPrefix` là PREFIX 3-phần tử (bỏ slot params) — khớp MỌI biến thể filter/offset
// (partial-match TanStack Query so từng phần tử theo vị trí; key có object params cụ thể sẽ KHÔNG khớp
// filter khác — mirror notificationListPrefix ở dưới).
const taskProjectListPrefix = [...taskKeys.projects.all, "list"] as const;

export const taskProjectInvalidation = {
  list: () => [taskProjectListPrefix] as const,
  detail: (id: string) => [taskProjectListPrefix, taskKeys.projects.detail(id)] as const,
  members: (id: string) => [taskKeys.projects.detail(id), taskKeys.projects.members(id)] as const,
};

// S4-FE-TASK-2 — invalidation cho Task core (list/my/detail) sau mutate (create/update/delete/assign/
// change-status/change-priority/change-deadline/watchers). `taskListPrefix` là PREFIX 3-phần tử (bỏ slot
// params) — mirror taskProjectListPrefix, khớp MỌI biến thể filter/offset.
const taskListPrefix = [...taskKeys.all, "list"] as const;

export const taskCoreInvalidation = {
  list: () => [taskListPrefix] as const,
  my: () => [taskKeys.my()] as const,
  detail: (id: string) => [taskListPrefix, taskKeys.my(), taskKeys.detail(id)] as const,
};

// S4-FE-TASK-3 — invalidation cho collab (comment CRUD/checklist CRUD/Kanban move). `taskActivityPrefix`
// là PREFIX 3-phần tử (bỏ slot params) — mirror taskListPrefix, khớp mọi biến thể limit/offset.
const taskActivityPrefix = [...taskKeys.all, "activity"] as const;

export const taskCollabInvalidation = {
  comments: (taskId: string) => [taskKeys.comments(taskId)] as const,
  checklists: (taskId: string) => [taskKeys.checklists(taskId)] as const,
  // Move (Kanban drag/drop) đổi CẢ board + task detail/list (status field dùng chung).
  kanban: (projectId: string, taskId: string) =>
    [taskKeys.kanban(projectId), ...taskCoreInvalidation.detail(taskId)] as const,
  activity: (taskId: string) => [taskActivityPrefix, taskKeys.activity(taskId)] as const,
};

// S4-FE-TASK-4 — invalidation cho file đính kèm công việc (upload/xóa TaskFilePanel).
export const taskFileInvalidation = {
  files: (taskId: string) => [taskKeys.files(taskId)] as const,
};

// ── Notification keys ─────────────────────────────────────────────────────────

export const notificationKeys = {
  all: rootKeys.notifications,
  list: (params?: Record<string, unknown>) => [...rootKeys.notifications, "list", params] as const,
  detail: (id: string) => [...rootKeys.notifications, "detail", id] as const,
  unreadCount: () => [...rootKeys.notifications, "unread-count"] as const,
  // S4-FE-NOTI-1 — APPEND. GET /notifications/dropdown (latest N cho chuông header, TÁCH khỏi `list`
  // vì khác endpoint/shape — invalidate riêng, không làm mới nhầm cache trang danh sách đầy đủ).
  dropdown: (params?: Record<string, unknown>) =>
    [...rootKeys.notifications, "dropdown", params] as const,
  // S4-FE-NOTI-2 — APPEND. GET /notifications/events (admin catalog, NotificationAdminController) —
  // TÁCH khỏi `list` (own-scope MyNotificationsController, khác endpoint/shape/permission hẳn).
  events: (params?: Record<string, unknown>) =>
    [...rootKeys.notifications, "admin-events", params] as const,
  // S4-FE-NOTI-3 — APPEND. GET /notifications/delivery-logs (viewer append-only, TÁCH khỏi `list`
  // của My-Notification — khác endpoint/permission/scope, không invalidate chéo).
  deliveryLogs: (params?: Record<string, unknown>) =>
    [...rootKeys.notifications, "delivery-logs", params] as const,
  // S4-FE-NOTI-4 — APPEND. GET /notifications/templates (danh mục + chi tiết, NOTI-API-303) — TÁCH
  // khỏi `events` (khác endpoint/shape, cùng NotificationAdminController nhưng resource riêng).
  templates: (params?: Record<string, unknown>) =>
    [...rootKeys.notifications, "admin-templates", params] as const,
  templateDetail: (id: string) =>
    [...rootKeys.notifications, "admin-templates", "detail", id] as const,
};

// S4-FE-NOTI-1 — mutation → invalidation cho My-Notification (mark-read/mark-all-read/delete). Prefix
// (bỏ slot params) khớp mọi biến thể param'd (list theo filter, dropdown theo limit). markRead/remove làm
// mới CẢ 3 (unread-count đổi, dropdown/list có thể đổi is_read hoặc biến mất khỏi mặc định "include_hidden
// =false"); markAllRead tương tự — KHÔNG cần biết id vì server có thể đổi NHIỀU dòng cùng lúc.
const notificationListPrefix = [...rootKeys.notifications, "list"] as const;
const notificationDropdownPrefix = [...rootKeys.notifications, "dropdown"] as const;

export const notificationInvalidation = {
  markRead: (id: string) =>
    [
      notificationListPrefix,
      notificationDropdownPrefix,
      notificationKeys.unreadCount(),
      notificationKeys.detail(id),
    ] as const,
  markAllRead: () =>
    [notificationListPrefix, notificationDropdownPrefix, notificationKeys.unreadCount()] as const,
  remove: (id: string) =>
    [
      notificationListPrefix,
      notificationDropdownPrefix,
      notificationKeys.unreadCount(),
      notificationKeys.detail(id),
    ] as const,
};

// ── Foundation keys (S2-FE-FND-1 · FND1-WC) ─────────────────────────────────────
//
// /system màn quản trị foundation: hồ sơ công ty (current) + company settings (resolve batch). Key ổn định
// cho invalidate sau PATCH. company_id KHÔNG vào key (server-scoped theo AuthContext).

export const foundationKeys = {
  all: rootKeys.foundation,
  company: {
    all: [...rootKeys.foundation, "company"] as const,
    current: () => [...rootKeys.foundation, "company", "current"] as const,
  },
  settings: {
    all: [...rootKeys.foundation, "settings"] as const,
    resolve: (params?: Record<string, unknown>) =>
      [...rootKeys.foundation, "settings", "resolve", params] as const,
  },
  // S2-FE-FND-5 (lane FE batch C) — sequence counters + seed run status (GET /foundation/sequences·/seeds).
  sequences: {
    all: [...rootKeys.foundation, "sequences"] as const,
    list: () => [...rootKeys.foundation, "sequences", "list"] as const,
    preview: (id: string) => [...rootKeys.foundation, "sequences", "preview", id] as const,
  },
  seeds: {
    all: [...rootKeys.foundation, "seeds"] as const,
    list: () => [...rootKeys.foundation, "seeds", "list"] as const,
  },
  // S2-FE-FND-4 — Public Holidays. Danh mục nhỏ theo company/năm (KHÔNG phân trang server).
  holidays: {
    all: [...rootKeys.foundation, "holidays"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.foundation, "holidays", "list", params] as const,
  },
  // S2-FE-FND-6 — Retention policies. Danh mục nhỏ theo company (KHÔNG phân trang server).
  retentionPolicies: {
    all: [...rootKeys.foundation, "retention-policies"] as const,
    list: () => [...rootKeys.foundation, "retention-policies", "list"] as const,
  },
  // S2-FE-FND-6 — File access logs (append-only viewer, phân trang server-side).
  fileAccessLogs: {
    all: [...rootKeys.foundation, "file-access-logs"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.foundation, "file-access-logs", "list", params] as const,
  },
  // S2-FE-FND-8 — System settings GLOBAL (KHÔNG company_id trong key — gate system-manage:foundation-setting).
  systemSettings: {
    all: [...rootKeys.foundation, "system-settings"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.foundation, "system-settings", "list", params] as const,
    detail: (key: string) => [...rootKeys.foundation, "system-settings", "detail", key] as const,
  },
  // S5-FND-JOBS-OBS-1 — System Jobs observability (READ-ONLY). summary = GET /system-jobs (không tham
  // số, tập job nhỏ); runs = GET /system-jobs/:jobName/runs (phân trang page-based theo jobName).
  systemJobs: {
    all: [...rootKeys.foundation, "system-jobs"] as const,
    summary: () => [...rootKeys.foundation, "system-jobs", "summary"] as const,
    runs: (jobName: string, params?: Record<string, unknown>) =>
      [...rootKeys.foundation, "system-jobs", "runs", jobName, params] as const,
  },
} as const;

// ── Mutation → query-key invalidation matrix (FRONTEND-04 §17.3) ──────────────
//
// Mỗi entry trả về DANH SÁCH prefix key để `queryClient.invalidateQueries({ queryKey })`. Prefix (BỎ slot
// params) nên khớp mọi biến thể param'd (TanStack matches theo prefix). Nguồn sự thật DUY NHẤT để hook
// mutation không rải string tay — check-in/out làm mới today + bảng công của tôi; duyệt/từ chối nghỉ làm
// mới danh sách đơn quản lý + chi tiết đơn (KHÔNG số dư phép — balance thuộc requester, không nằm trong
// cache của người duyệt).

const attendanceMyRecordsPrefix = [...rootKeys.attendance, "my", "records"] as const;
const leaveRequestsListPrefix = [...rootKeys.leave, "requests", "list"] as const;

export const attendanceInvalidation = {
  checkIn: () => [attendanceKeys.myToday(), attendanceMyRecordsPrefix] as const,
  checkOut: () => [attendanceKeys.myToday(), attendanceMyRecordsPrefix] as const,
  // S3-FE-ATT-3 — create làm mới CẢ prefix "adjustments" (mọi biến thể scope/param: my/team/company).
  // approve/adjust-direct còn ÁP DỤNG vào attendance_records → làm mới thêm prefix "records" (list +
  // detail đúng bản ghi khi biết recordId) để bảng công không hiển thị giá trị cũ trước điều chỉnh.
  createAdjustment: () => [attendanceKeys.adjustments.all] as const,
  approveAdjustment: (id: string) =>
    [
      attendanceKeys.adjustments.all,
      attendanceKeys.adjustments.detail(id),
      attendanceKeys.records.all,
    ] as const,
  rejectAdjustment: (id: string) =>
    [attendanceKeys.adjustments.all, attendanceKeys.adjustments.detail(id)] as const,
  adjustDirect: (recordId: string) =>
    [
      attendanceKeys.adjustments.all,
      attendanceKeys.records.all,
      attendanceKeys.records.detail(recordId),
    ] as const,
};

// S2-FE-HR-4: create/cancel làm mới "mine" (self list) + detail của chính đơn đó — KHÔNG đụng "list"
// (Company-scope, thuộc cache của HR khác). approve/reject (HR) làm mới "list" + detail — "mine" thuộc
// cache của người gửi yêu cầu, HR không giữ trong phiên của mình.
const hrProfileChangeRequestsMinePrefix = [
  ...rootKeys.hr,
  "profile-change-requests",
  "mine",
] as const;
const hrProfileChangeRequestsListPrefix = [
  ...rootKeys.hr,
  "profile-change-requests",
  "list",
] as const;

// hrInvalidation — hợp nhất invalidation helper cho toàn module HR (một export DUY NHẤT, tránh
// redeclare): S2-FE-HR-8 (employee-code-config) + S2-FE-HR-4 (profile-change-requests).
export const hrInvalidation = {
  // S2-FE-HR-8: PATCH /hr/employee-code-config làm mới CẢ config() lẫn preview() (mã tiếp theo có thể
  // đổi hình dạng theo prefix/pattern/numberLength mới dù counter không đổi).
  updateEmployeeCodeConfig: () =>
    [hrKeys.employeeCodeConfig.config(), hrKeys.employeeCodeConfig.preview()] as const,
  createChangeRequest: () => [hrProfileChangeRequestsMinePrefix] as const,
  cancelChangeRequest: (id: string) =>
    [hrProfileChangeRequestsMinePrefix, hrKeys.profileChangeRequests.detail(id)] as const,
  approveChangeRequest: (id: string) =>
    [hrProfileChangeRequestsListPrefix, hrKeys.profileChangeRequests.detail(id)] as const,
  rejectChangeRequest: (id: string) =>
    [hrProfileChangeRequestsListPrefix, hrKeys.profileChangeRequests.detail(id)] as const,
  // S2-FE-HR-9 — upload/delete file hồ sơ đều làm mới đúng danh sách file của nhân viên đó.
  uploadEmployeeFile: (employeeId: string) => [hrKeys.employees.files(employeeId)] as const,
  deleteEmployeeFile: (employeeId: string) => [hrKeys.employees.files(employeeId)] as const,
  // S5-HR-IMPORT-FE-1 — sau apply (dryRun=false) tạo hàng loạt hồ sơ mới: làm mới cả danh sách (list,
  // mọi biến thể param'd — prefix employees.all) lẫn dải tổng quan (summary, employees.all cũng bao phủ).
  applyImport: () => [hrKeys.employees.all] as const,
};

// S3-FE-LEAVE-2: approver KHÔNG giữ balance key của requester (balance thuộc user gửi đơn, không nằm
// trong cache của người duyệt) → BỎ leaveKeys.balances.all. Chỉ làm mới danh sách quản lý (mọi biến thể
// param'd qua list-prefix) + chi tiết đúng đơn vừa duyệt/từ chối.
export const leaveInvalidation = {
  approve: (requestId: string) =>
    [leaveRequestsListPrefix, leaveKeys.requests.detail(requestId)] as const,
  reject: (requestId: string) =>
    [leaveRequestsListPrefix, leaveKeys.requests.detail(requestId)] as const,
  // S3-FE-LEAVE-5 — admin CRUD (LEAVE-SCREEN-010/011/012/013). types/policies làm mới đúng list-prefix
  // của mặt admin; adjustBalance làm mới CẢ danh sách số dư (tổng đổi) LẪN ledger giao dịch của đúng
  // balance vừa điều chỉnh (KHÔNG mutate total_days ngoài ledger — bất biến #2).
  types: () => [leaveKeys.types.adminList()] as const,
  policies: () => [leaveKeys.policies.all] as const,
  adjustBalance: (balanceId: string) =>
    [leaveKeys.balancesAdmin.all, leaveKeys.balancesAdmin.transactions(balanceId)] as const,
};

// S2-FE-FND-1 (FND1-WC): PATCH company/current → làm mới current-company; PATCH company-settings/:key →
// làm mới MỌI biến thể resolve(params) qua prefix (bỏ slot params — TanStack match theo prefix).
const foundationSettingsResolvePrefix = [...rootKeys.foundation, "settings", "resolve"] as const;

export const foundationInvalidation = {
  updateCompany: () => [foundationKeys.company.current()] as const,
  updateSetting: () => [foundationSettingsResolvePrefix] as const,
  // S2-FE-FND-5 — PATCH /foundation/sequences/:id → làm mới list counter.
  updateSequence: () => [foundationKeys.sequences.list()] as const,
  // S2-FE-FND-4 — create/update/delete holiday đều làm mới MỌI biến thể list(params) qua prefix.
  createHoliday: () => [foundationKeys.holidays.all] as const,
  updateHoliday: () => [foundationKeys.holidays.all] as const,
  deleteHoliday: () => [foundationKeys.holidays.all] as const,
  // S2-FE-FND-6 — PATCH retention-policy làm mới list (danh mục nhỏ, không phân trang).
  updateRetentionPolicy: () => [foundationKeys.retentionPolicies.all] as const,
  // S2-FE-FND-8 — PATCH /foundation/system-settings/:key làm mới CẢ prefix "system-settings" (list mọi
  // biến thể filter + detail đúng key vừa sửa).
  updateSystemSetting: () => [foundationKeys.systemSettings.all] as const,
};

// ── ME keys (S5-ME-FE-1) — Personal Hub, SPEC-09 ────────────────────────────────

export const meKeys = {
  all: rootKeys.me,
  overview: () => [...rootKeys.me, "overview"] as const,
};
