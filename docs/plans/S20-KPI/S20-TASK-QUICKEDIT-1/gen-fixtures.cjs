// S20-TASK-QUICKEDIT-1 — dựng fixture đúng shape contracts (dist/cjs của cây đang đo) rồi parse; in JSON ra stdout.
// Chạy: node gen-fixtures.cjs > fixtures.json
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const C = require(ROOT + "/packages/contracts/dist/cjs/index.js");
const CO = "11111111-1111-4111-8111-111111111111";
const DEPT = "22222222-2222-4222-8222-222222222222";
const ME_EMP = "33333333-3333-4333-8333-333333333333";
const ME = "44444444-4444-4444-8444-444444444444";
const T1 = "aaaaaaaa-0000-4000-8000-000000000001"; // Đang làm, chưa có hạn — KPI #7 (a)
const T2 = "aaaaaaaa-0000-4000-8000-000000000002"; // Cần làm, chưa có hạn — chip «Thứ Sáu này» (b)
const T3 = "aaaaaaaa-0000-4000-8000-000000000003"; // Cần làm, hạn 30/10 — việc nền cho nhóm «Sắp tới»
const t0 = "2026-10-20T03:00:00.000Z";
const NAME = "Trần Tôi";

const task = (id, o) =>
  C.myTaskItemSchema.parse({
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
    source: "assigned",
    ...o,
  });

const pairs = ["read:task", "update-status:task", "update-deadline:task"];
const me = (caps) =>
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
    employee: {
      id: ME_EMP,
      employeeCode: "NV01",
      fullName: NAME,
      departmentId: DEPT,
      directManagerId: null,
      employmentStatus: "active",
    },
    roles: [{ id: "77777777-7777-4777-8777-777777777777", name: "employee" }],
    scopes: Object.fromEntries(caps.map((k) => [k, ["Own"]])),
    modules: [
      { code: "TASK", name: "Công việc" },
      { code: "NOTI", name: "Thông báo" },
    ],
  });

const out = {
  ids: { CO, DEPT, ME_EMP, ME, T1, T2, T3 },
  tasks: [
    task(T1, { title: "Soạn báo giá khách hàng A", status: "In Progress", priority: "High" }),
    task(T2, { title: "Chuẩn bị nội dung họp tuần" }),
    task(T3, { title: "Rà soát hợp đồng mẫu", dueAt: "2026-10-30T10:00:00.000Z" }),
  ],
  meFull: me(pairs),
  meNoStatus: me(pairs.filter((p) => p !== "update-status:task")),
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
// Kiểm shape response của route action (change-status / change-deadline) ngay khi sinh fixture.
C.taskActionResponseSchema.parse({ task: out.tasks[0], warnings: [] });
process.stdout.write(JSON.stringify(out));
