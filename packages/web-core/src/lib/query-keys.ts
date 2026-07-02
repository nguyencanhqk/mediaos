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
};

// ── HR keys ───────────────────────────────────────────────────────────────────

export const hrKeys = {
  all: rootKeys.hr,
  employees: {
    all: [...rootKeys.hr, "employees"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.hr, "employees", "list", params] as const,
    detail: (id: string) => [...rootKeys.hr, "employees", "detail", id] as const,
    me: () => [...rootKeys.hr, "employees", "me"] as const,
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
};

// ── Task keys ─────────────────────────────────────────────────────────────────

export const taskKeys = {
  all: rootKeys.tasks,
  list: (params?: Record<string, unknown>) => [...rootKeys.tasks, "list", params] as const,
  detail: (id: string) => [...rootKeys.tasks, "detail", id] as const,
  projects: {
    all: [...rootKeys.tasks, "projects"] as const,
    list: (params?: Record<string, unknown>) =>
      [...rootKeys.tasks, "projects", "list", params] as const,
    detail: (id: string) => [...rootKeys.tasks, "projects", "detail", id] as const,
  },
  comments: (taskId: string) => [...rootKeys.tasks, "comments", taskId] as const,
};

// ── Notification keys ─────────────────────────────────────────────────────────

export const notificationKeys = {
  all: rootKeys.notifications,
  list: (params?: Record<string, unknown>) => [...rootKeys.notifications, "list", params] as const,
  detail: (id: string) => [...rootKeys.notifications, "detail", id] as const,
  unreadCount: () => [...rootKeys.notifications, "unread-count"] as const,
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
};

// S3-FE-LEAVE-2: approver KHÔNG giữ balance key của requester (balance thuộc user gửi đơn, không nằm
// trong cache của người duyệt) → BỎ leaveKeys.balances.all. Chỉ làm mới danh sách quản lý (mọi biến thể
// param'd qua list-prefix) + chi tiết đúng đơn vừa duyệt/từ chối.
export const leaveInvalidation = {
  approve: (requestId: string) =>
    [leaveRequestsListPrefix, leaveKeys.requests.detail(requestId)] as const,
  reject: (requestId: string) =>
    [leaveRequestsListPrefix, leaveKeys.requests.detail(requestId)] as const,
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
};
