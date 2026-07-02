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
};
