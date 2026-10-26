// S20-TASK-QUICKADD-1 — dựng fixture đúng shape contracts (dist/cjs của cây đang đo) rồi parse; in JSON ra stdout.
// Chạy: node gen-fixtures.cjs > fixtures.json
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const C = require(ROOT + "/packages/contracts/dist/cjs/index.js");
const CO = "11111111-1111-4111-8111-111111111111";
const DEPT = "22222222-2222-4222-8222-222222222222";
const ME_EMP = "33333333-3333-4333-8333-333333333333";
const ME = "44444444-4444-4444-8444-444444444444";
const PROJ = "55555555-5555-4555-8555-555555555555";
const ST_TODO = "66666666-0000-4000-8000-000000000001";
const ST_DOING = "66666666-0000-4000-8000-000000000002";
const ST_DONE = "66666666-0000-4000-8000-000000000003";
// Ba người được giao (thành viên dự án) + một người ngoài dự án (chỉ có trong danh sách nhân viên).
const EMP = {
  A: { id: "88888888-0000-4000-8000-00000000000a", name: "Lê Văn An", code: "NV10" },
  B: { id: "88888888-0000-4000-8000-00000000000b", name: "Phạm Thị Bình", code: "NV11" },
  C: { id: "88888888-0000-4000-8000-00000000000c", name: "Hoàng Minh Châu", code: "NV12" },
  X: { id: "88888888-0000-4000-8000-00000000000f", name: "Đỗ Ngoài Phạm Vi", code: "NV99" },
};
const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
const T2 = "aaaaaaaa-0000-4000-8000-000000000002";
const B1 = "bbbbbbbb-0000-4000-8000-000000000001";
const t0 = "2026-10-20T03:00:00.000Z";
const NAME = "Trần Tôi";

const base = (id, o) => ({
  id,
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
  ...o,
});
const myTask = (id, o) => C.myTaskItemSchema.parse(base(id, { source: "assigned", ...o }));
const card = (id, o) =>
  C.taskKanbanCardSchema.parse(base(id, { projectId: PROJ, projectName: "Dự án Ra mắt Q4", ...o }));

// Cặp của NV ở «Việc của tôi» (KHÔNG có read:employee — người phụ trách lấy từ /auth/me).
const NV_PAIRS = ["read:task", "create:task", "update-status:task", "update-deadline:task"];
// Cặp của QL trên board.
const QL_PAIRS = [
  ...NV_PAIRS,
  "update:task",
  "assign:task",
  "update-state:task",
  "view-kanban:task",
  "read:project",
  "read:employee",
];
const me = (caps, employee = true) =>
  C.meResponseSchema.parse({
    id: ME,
    companyId: CO,
    email: "toi@example.test",
    fullName: NAME,
    status: "active",
    capabilities: Object.fromEntries(caps.map((k) => [k, true])),
    mustSetupTwoFactor: false,
    mustChangePassword: false,
    company: { id: CO, name: "Công ty Thử", status: "active" },
    employee: employee
      ? {
          id: ME_EMP,
          employeeCode: "NV01",
          fullName: NAME,
          departmentId: DEPT,
          directManagerId: null,
          employmentStatus: "active",
        }
      : null,
    roles: [{ id: "77777777-7777-4777-8777-777777777777", name: "employee" }],
    scopes: Object.fromEntries(caps.map((k) => [k, ["Own"]])),
    modules: [
      { code: "TASK", name: "Công việc" },
      { code: "NOTI", name: "Thông báo" },
    ],
  });

const member = (e, i, role = "Member") =>
  C.memberResponseSchema.parse({
    id: `99999999-0000-4000-8000-00000000000${i}`,
    projectId: PROJ,
    employeeId: e.id,
    employeeName: e.name,
    employeeCode: e.code,
    departmentName: "Phòng Kinh doanh",
    projectRole: role,
    status: "Active",
    joinedAt: t0,
    removedAt: null,
  });
const employeeItem = (e) => ({
  id: e.id,
  userId: null,
  employeeCode: e.code,
  fullName: e.name,
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
const meEmp = { id: ME_EMP, name: NAME, code: "NV01" };

const stateCol = (stateId, name, color, stateGroup, sortOrder, tasks) => ({
  columnMode: "state",
  stateId,
  name,
  color,
  stateGroup,
  sortOrder,
  taskCount: tasks.length,
  tasks,
});

const out = {
  ids: { CO, DEPT, ME_EMP, ME, PROJ, ST_TODO, ST_DOING, ST_DONE, EMP, T1, T2, B1 },
  tasks: [
    myTask(T1, { title: "Soạn báo giá khách hàng A", status: "In Progress", priority: "High" }),
    myTask(T2, { title: "Rà soát hợp đồng mẫu", dueAt: "2026-10-30T10:00:00.000Z" }),
  ],
  project: C.taskProjectResponseSchema.parse({
    id: PROJ,
    companyId: CO,
    code: "PRJ-Q4",
    name: "Dự án Ra mắt Q4",
    description: null,
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
    closedBy: null,
  }),
  board: C.taskKanbanBoardSchema.parse({
    projectId: PROJ,
    columns: [
      stateCol(ST_TODO, "Cần làm", "#64748b", "unstarted", 1, [
        card(B1, {
          title: "Chốt danh sách khách mời",
          stateId: ST_TODO,
          stateName: "Cần làm",
          stateColor: "#64748b",
          stateGroup: "unstarted",
        }),
      ]),
      stateCol(ST_DOING, "Đang làm", "#3b82f6", "started", 2, []),
      stateCol(ST_DONE, "Hoàn thành", "#22c55e", "completed", 3, []),
    ],
  }),
  members: [member(meEmp, 1, "Manager"), member(EMP.A, 2), member(EMP.B, 3), member(EMP.C, 4)],
  employees: C.hrEmployeeListResponseSchema.parse({
    items: [meEmp, EMP.A, EMP.B, EMP.C, EMP.X].map(employeeItem),
    meta: { page: 1, pageSize: 100, total: 5, totalPages: 1, hasNext: false, hasPrev: false },
  }),
  meNv: me(NV_PAIRS),
  meNvUnlinked: me(NV_PAIRS, false),
  meQl: me(QL_PAIRS),
  meQlNoAssign: me(QL_PAIRS.filter((p) => p !== "assign:task")),
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
