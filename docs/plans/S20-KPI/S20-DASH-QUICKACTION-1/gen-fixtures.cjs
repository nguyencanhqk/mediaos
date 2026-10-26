// S20-DASH-QUICKACTION-1 — dựng fixture đúng shape contracts (dist/cjs của cây đang đo) rồi parse; in JSON ra stdout.
// Hai bộ quick action: `qaNew` lấy đích từ DASH_QUICK_ACTION_TARGET_URLS (hằng BE dùng trên nhánh) · `qaLegacy`
// là payload của API TRƯỚC nhánh (đích cũ: /tasks/new · /tasks/my · /tasks?filter=due-soon · /projects ·
// /leave/approvals?status=Pending). Nhãn + cổng của từng action chép từ
// apps/api/src/dashboard/dashboard-widget-quick-actions.const.ts (bản trên nhánh và bản trên master).
// Chạy: node gen-fixtures.cjs > fixtures.json
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const C = require(ROOT + "/packages/contracts/dist/cjs/index.js");
const T = C.DASH_QUICK_ACTION_TARGET_URLS;
const CO = "11111111-1111-4111-8111-111111111111";
const DEPT = "22222222-2222-4222-8222-222222222222";
const ME_EMP = "33333333-3333-4333-8333-333333333333";
const ME = "44444444-4444-4444-8444-444444444444";
const PROJ = "55555555-5555-4555-8555-555555555555";
const REC = "dddddddd-0000-4000-8000-000000000001";
const SHIFT = "eeeeeeee-0000-4000-8000-000000000001";
const LEAVE = "ffffffff-0000-4000-8000-000000000001";
const t0 = "2026-10-20T03:00:00.000Z";
// «Bây giờ» giả lập = 10:00 22/10/2026 giờ VN (run.js đặt page.clock cùng mốc).
const NOW = "2026-10-22T03:00:00.000Z";
const TODAY = "2026-10-22";
const NAME = "Trần Tôi";

const task = (n, o) =>
  C.myTaskItemSchema.parse({
    id: `aaaaaaaa-0000-4000-8000-00000000000${n}`,
    companyId: CO,
    title: "",
    description: null,
    taskType: "task",
    status: "Todo",
    priority: "Medium",
    projectId: null,
    projectName: null,
    mainAssigneeEmployeeId: ME_EMP,
    assigneeName: NAME,
    assigneeAvatarUrl: null,
    coverUrl: null,
    creatorUserId: ME,
    creatorName: NAME,
    reporterEmployeeId: ME_EMP,
    reporterName: NAME,
    departmentId: DEPT,
    dueAt: null,
    startAt: null,
    completedAt: null,
    isOverdue: false,
    createdBy: ME,
    createdAt: t0,
    updatedAt: t0,
    source: "assigned",
    ...o,
  });
// 3 việc quá hạn (isOverdue của server) · 1 hạn hôm nay 17:00 · 1 sắp đến hạn · 1 không hạn.
const tasks = [
  task(1, { title: "Nộp báo cáo tuần", dueAt: "2026-10-20T10:00:00.000Z", isOverdue: true }),
  task(2, { title: "Gửi hợp đồng khách C", dueAt: "2026-10-21T02:00:00.000Z", isOverdue: true }),
  task(3, { title: "Duyệt ngân sách quý", dueAt: "2026-10-22T01:00:00.000Z", isOverdue: true }),
  task(4, { title: "Chuẩn bị họp giao ban", dueAt: "2026-10-22T10:00:00.000Z" }),
  task(5, { title: "Cập nhật kế hoạch tháng", dueAt: "2026-10-24T10:00:00.000Z" }),
  task(6, { title: "Đọc tài liệu quy trình" }),
];

const PAIRS = [
  "read:dashboard",
  "access:me",
  "read:task",
  "create:task",
  "update-status:task",
  "update-deadline:task",
  "read:project",
  "read:notification",
  "view:leave",
  "view-own:leave",
  "approve:leave",
  "read:employee",
  "view-own:attendance",
  "check-in:attendance",
  "check-out:attendance",
];
const MODULES = [
  ["DASH", "Dashboard"],
  ["ME", "Cá nhân"],
  ["TASK", "Công việc"],
  ["NOTI", "Thông báo"],
  ["LEAVE", "Nghỉ phép"],
  ["HR", "Nhân sự"],
  ["ATT", "Chấm công"],
];
const me = C.meResponseSchema.parse({
  id: ME,
  companyId: CO,
  email: "toi@example.test",
  fullName: NAME,
  status: "active",
  capabilities: Object.fromEntries(PAIRS.map((k) => [k, true])),
  mustSetupTwoFactor: false,
  mustChangePassword: false,
  company: { id: CO, name: "Công ty Thử", status: "active" },
  employee: {
    id: ME_EMP,
    employeeCode: "NV01",
    fullName: NAME,
    departmentId: DEPT,
    directManagerId: null,
    employmentStatus: "active",
  },
  roles: [{ id: "77777777-7777-4777-8777-777777777777", name: "manager" }],
  scopes: Object.fromEntries(PAIRS.map((k) => [k, ["Company"]])),
  modules: MODULES.map(([code, name]) => ({ code, name })),
});

// ─── quick action ────────────────────────────────────────────────────────────
const qa = (code, label, mod, method, url, api) =>
  C.quickActionSchema.parse({
    action_code: code,
    label,
    target_module: mod,
    method,
    target_url: url,
    api_endpoint: api,
    enabled: true,
    disabled_reason: null,
  });
const ATT_QA = [
  qa("CHECK_IN", "Check-in", "ATT", "API_CALL", null, "/api/v1/attendance/check-in"),
  qa("CHECK_OUT", "Check-out", "ATT", "API_CALL", null, "/api/v1/attendance/check-out"),
];
const qaNew = {
  ATTENDANCE_TODAY: ATT_QA,
  MY_TASKS: [
    qa("CREATE_TASK", "Tạo task", "TASK", "NAVIGATE", T.CREATE_TASK, null),
    qa("OPEN_MY_TASKS", "Xem tất cả task", "TASK", "NAVIGATE", T.OPEN_MY_TASKS, null),
  ],
  TASK_ALERTS: [
    qa("OPEN_TASK_ALERTS", "Xem task quá hạn", "TASK", "NAVIGATE", T.OPEN_TASK_ALERTS, null),
    qa(
      "OPEN_TASKS_DUE_SOON",
      "Xem việc sắp đến hạn",
      "TASK",
      "NAVIGATE",
      T.OPEN_TASKS_DUE_SOON,
      null,
    ),
  ],
  NOTIFICATIONS: [
    qa(
      "OPEN_NOTIFICATIONS",
      "Xem tất cả thông báo",
      "NOTI",
      "NAVIGATE",
      T.OPEN_NOTIFICATIONS,
      null,
    ),
  ],
  PENDING_LEAVE: [
    qa(
      "OPEN_PENDING_LEAVE_APPROVAL",
      "Duyệt đơn",
      "LEAVE",
      "NAVIGATE",
      T.OPEN_PENDING_LEAVE_APPROVAL,
      null,
    ),
  ],
  HR_OVERVIEW: [
    qa("OPEN_HR_DIRECTORY", "Danh bạ nhân sự", "HR", "NAVIGATE", T.OPEN_HR_DIRECTORY, null),
  ],
};
// Payload của API trên master (trước nhánh) — literal cũ.
const qaLegacy = {
  ATTENDANCE_TODAY: ATT_QA,
  MY_TASKS: [
    qa("CREATE_TASK", "Tạo task", "TASK", "NAVIGATE", "/tasks/new", null),
    qa("OPEN_MY_TASKS", "Xem tất cả task", "TASK", "NAVIGATE", "/tasks/my", null),
  ],
  TASK_ALERTS: [
    qa(
      "OPEN_TASK_ALERTS",
      "Xem task cần chú ý",
      "TASK",
      "NAVIGATE",
      "/tasks?filter=due-soon",
      null,
    ),
  ],
  NOTIFICATIONS: [
    qa("OPEN_NOTIFICATIONS", "Xem tất cả thông báo", "NOTI", "NAVIGATE", "/notifications", null),
  ],
  PENDING_LEAVE: [
    qa(
      "OPEN_PENDING_LEAVE_APPROVAL",
      "Duyệt đơn",
      "LEAVE",
      "NAVIGATE",
      "/leave/approvals?status=Pending",
      null,
    ),
  ],
  HR_OVERVIEW: [
    qa("OPEN_HR_DIRECTORY", "Danh bạ nhân sự", "HR", "NAVIGATE", "/hr/employees", null),
  ],
};

// ─── dữ liệu widget (data container theo widget-data-schemas.ts của FE) ─────────
const wItem = (t) => ({
  id: t.id,
  title: t.title,
  status: t.status,
  priority: t.priority,
  dueAt: t.dueAt,
  isOverdue: t.isOverdue,
  projectName: t.projectName,
});
const attItem = (checkInAt) => ({
  id: REC,
  workDate: TODAY,
  attendanceStatus: checkInAt ? "Present" : null,
  status: checkInAt ? "CheckedIn" : "NotCheckedIn",
  checkInAt,
  checkOutAt: null,
});
const widgetData = {
  MY_TASKS: { items: tasks.slice(0, 5).map(wItem), summary: { total: tasks.length } },
  TASK_ALERTS: {
    items: tasks.slice(0, 4).map(wItem),
    summary: { total: 4, overdue: 3, dueSoon: 1 },
  },
  NOTIFICATIONS: { items: [], summary: { total: 0, unread: 0 } },
  PENDING_LEAVE: {
    items: [
      {
        id: LEAVE,
        leaveTypeName: "Nghỉ phép năm",
        startDate: "2026-10-27",
        endDate: "2026-10-28",
        totalDays: 2,
        status: "Pending",
        submittedAt: t0,
        requester: { fullName: "Lê Văn An", department: "Phòng Kinh doanh" },
      },
    ],
    summary: { total: 1 },
  },
  HR_OVERVIEW: {
    summary: { headcount: 5 },
    byStatus: { active: 5 },
    byOrgUnit: { "Phòng Kinh doanh": 5 },
  },
};
const SLUG = {
  ATTENDANCE_TODAY: "attendance-today",
  MY_TASKS: "my-tasks",
  TASK_ALERTS: "task-alerts",
  NOTIFICATIONS: "notifications",
  PENDING_LEAVE: "pending-leave",
  HR_OVERVIEW: "hr-overview",
};
const ORDER = Object.keys(SLUG);
const view = C.dashboardViewResponseSchema.parse({
  dashboard_type: "Employee",
  widgets: ORDER.map((code, i) => ({
    widget_code: code,
    widget_name: code,
    widget_type: "List",
    source_modules: [code === "ATTENDANCE_TODAY" ? "ATT" : "X"],
    data_scope: "Own",
    layout: { order: i + 1 },
    data: null,
    last_updated_at: null,
  })),
  generated_at: NOW,
});

// ─── ATT ─────────────────────────────────────────────────────────────────────
const shift = {
  id: SHIFT,
  shiftCode: "OFFICE_8H",
  name: "Hành chính 8h",
  startTime: "08:00",
  endTime: "17:00",
  breakMinutes: 60,
  requiredWorkingMinutes: 480,
  graceLateMinutes: 10,
  graceEarlyLeaveMinutes: 10,
  crossDay: false,
  isDefault: true,
  timezone: "Asia/Ho_Chi_Minh",
};
const record = (checkInAt) =>
  C.attendanceRecordV2Schema.parse({
    id: REC,
    workDate: TODAY,
    employeeId: ME_EMP,
    shiftId: SHIFT,
    checkInAt,
    checkOutAt: null,
    checkInMethod: "web",
    checkOutMethod: null,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    workingMinutes: null,
    requiredWorkingMinutes: 480,
    missingMinutes: null,
    breakMinutes: null,
    status: "CheckedIn",
    attendanceStatus: "Present",
    isLate: false,
    isEarlyLeave: false,
    isMissingCheckOut: null,
  });
const today = (checkInAt) =>
  C.attendanceTodayV2Schema.parse({
    workDate: TODAY,
    employee: { id: ME_EMP, status: "active" },
    shift,
    rule: {
      id: null,
      ruleCode: "DEFAULT_OFFICE_RULE",
      requireCheckIn: true,
      requireCheckOut: true,
      blockWhenLeaveApproved: true,
    },
    record: checkInAt ? record(checkInAt) : null,
    allowedActions: { canCheckIn: !checkInAt, canCheckOut: Boolean(checkInAt) },
    disabledReason: null,
    periodLocked: false,
  });

// ─── /me/overview ────────────────────────────────────────────────────────────
const ok = (data) => ({ status: "ok", data });
const overview = (taskSummary) =>
  C.meOverviewSchema.parse({
    identity: {
      account: {
        userId: ME,
        email: "toi@example.test",
        status: "active",
        displayName: NAME,
        roles: [{ id: "77777777-7777-4777-8777-777777777777", name: "manager" }],
        lastLoginAt: t0,
        createdAt: t0,
      },
      linkStatus: "linked",
      employee: {
        employeeId: ME_EMP,
        employeeCode: "NV01",
        fullName: NAME,
        departmentName: "Phòng Kinh doanh",
        positionName: "Trưởng nhóm",
      },
    },
    hr: ok({
      employeeCode: "NV01",
      fullName: NAME,
      departmentName: "Phòng Kinh doanh",
      positionName: "Trưởng nhóm",
      status: "active",
      startDate: "2024-01-02",
    }),
    attendance: ok({
      workDate: TODAY,
      status: "NotCheckedIn",
      checkInAt: null,
      checkOutAt: null,
      shiftName: "Hành chính 8h",
      isLate: null,
      isEarlyLeave: null,
    }),
    leave: ok({ balances: [], pendingRequestCount: 0 }),
    task: ok(C.meTaskSummarySchema.parse(taskSummary)),
    notification: ok({
      unreadCount: 0,
      highPriorityUnreadCount: 0,
      urgentUnreadCount: 0,
      lastNotificationAt: null,
    }),
  });

const project = {
  id: PROJ,
  companyId: CO,
  code: "PRJ-Q4",
  name: "Dự án Ra mắt Q4",
  ownerEmployeeId: ME_EMP,
  ownerName: NAME,
  departmentId: DEPT,
  departmentName: "Phòng Kinh doanh",
  priority: "High",
  status: "Active",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  memberCount: 4,
  myProjectRole: "Manager",
  createdBy: ME,
  createdAt: t0,
  updatedAt: t0,
  closedAt: null,
};
const employee = (id, code, fullName) => ({
  id,
  userId: null,
  employeeCode: code,
  fullName,
  email: null,
  orgUnitId: DEPT,
  orgUnitName: "Phòng Kinh doanh",
  positionId: null,
  positionName: null,
  workType: null,
  employmentType: null,
  status: "active",
  avatarUrl: null,
  startDate: null,
  officialDate: null,
  workLocation: null,
  gender: null,
  dateOfBirth: null,
  phone: null,
  contractType: null,
  baseSalary: null,
  identityNumber: null,
  identityIssueDate: null,
  identityIssuePlace: null,
});

const out = {
  ids: { CO, DEPT, ME_EMP, ME, PROJ, REC },
  now: NOW,
  today: TODAY,
  me,
  tasks,
  view,
  slug: SLUG,
  widgetData,
  attWidget: { pending: attItem(null) },
  qaNew,
  qaLegacy,
  attToday: { before: today(null) },
  attCheckedInAt: NOW,
  attRecord: record(NOW),
  attTodayAfter: today(NOW),
  overviewThree: overview({ assignedCount: 6, dueTodayCount: 1, overdueCount: 3 }),
  overviewZero: overview({ assignedCount: 3, dueTodayCount: 0, overdueCount: 0 }),
  projects: [C.taskProjectListItemSchema.parse(project)],
  leaveEmpty: {
    items: [],
    meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
  },
  employees: C.hrEmployeeListResponseSchema.parse({
    items: [
      employee(ME_EMP, "NV01", NAME),
      employee(LEAVE.replace("ffff", "8888"), "NV10", "Lê Văn An"),
    ],
    meta: { page: 1, pageSize: 20, total: 2, totalPages: 1, hasNext: false, hasPrev: false },
  }),
  dropdown: C.myNotificationDropdownResponseSchema.parse({ unread_count: 0, items: [] }),
  notiUnread: C.myNotificationUnreadCountResponseSchema.parse({
    unread_count: 0,
    high_priority_unread_count: 0,
    urgent_unread_count: 0,
    last_notification_at: null,
  }),
  prefs: C.mePreferencesSchema.parse({
    locale: "vi",
    timezone: "Asia/Ho_Chi_Minh",
    theme: "light",
    dateFormat: null,
    timeFormat: null,
    defaultLanding: null,
    density: null,
    favoriteModules: null,
    meLayoutConfig: null,
    showBirthday: null,
    updatedAt: null,
  }),
  refresh: C.authRefreshResponseSchema.parse({
    accessToken: ["fake", "access", "smoke"].join("-"),
    expiresIn: 900,
  }),
};
process.stdout.write(JSON.stringify(out));
