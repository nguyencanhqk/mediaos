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
  },
};

// ── Attendance keys ───────────────────────────────────────────────────────────

export const attendanceKeys = {
  all: rootKeys.attendance,
  list: (params?: Record<string, unknown>) => [...rootKeys.attendance, "list", params] as const,
  detail: (id: string) => [...rootKeys.attendance, "detail", id] as const,
  myToday: () => [...rootKeys.attendance, "my", "today"] as const,
  mySummary: (params?: Record<string, unknown>) =>
    [...rootKeys.attendance, "my", "summary", params] as const,
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
