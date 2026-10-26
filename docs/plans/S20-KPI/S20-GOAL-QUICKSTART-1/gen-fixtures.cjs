// S20-GOAL-QUICKSTART-1 — dựng fixture đúng shape contracts (dist/cjs) rồi parse; in JSON ra stdout.
// Chạy: node gen-fixtures.cjs > fixtures.json
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const C = require(ROOT + "/packages/contracts/dist/cjs/index.js");

const CO = "11111111-1111-4111-8111-111111111111";
const DEPT = "22222222-2222-4222-8222-222222222222";
const ME_EMP = "33333333-3333-4333-8333-333333333333";
const ME_USER = "44444444-4444-4444-8444-444444444444";
const ACTIVE = "55555555-5555-4555-8555-555555555555";
const DRAFT = "88888888-8888-4888-8888-888888888888";
const now = "2026-10-20T03:00:00.000Z";

function fillNulls(schema, overrides) {
  const out = {};
  for (const [k, v] of Object.entries(schema.shape)) {
    if (v.isNullable && v.isNullable()) out[k] = null;
  }
  return { ...out, ...overrides };
}

const goal = (o) =>
  C.goalCoreResponseSchema.parse({
    id: ACTIVE,
    companyId: CO,
    goalCode: "G-0001",
    name: "Hoàn thành 3 khoá đào tạo nội bộ",
    description: null,
    level: "employee",
    departmentId: null,
    projectId: null,
    employeeId: ME_EMP,
    parentGoalId: null,
    ownerEmployeeId: ME_EMP,
    periodType: "quarter",
    periodStart: "2026-10-01",
    periodEnd: "2026-12-31",
    measureType: "percent",
    targetValue: 100,
    currentValue: 0,
    unit: null,
    progressMode: "manual",
    progressPercent: 0,
    weight: 1,
    status: "Active",
    finalizedAt: null,
    createdAt: now,
    updatedAt: now,
    ...o,
  });

const activeGoal = goal({});
const draftGoal = goal({
  id: DRAFT,
  goalCode: "G-0002",
  name: "Giảm 20% thời gian xử lý phiếu",
  status: "Draft",
  progressPercent: null,
  currentValue: null,
});
// Kiểm shape chi tiết một lần (mock dựng chi tiết = core + parent:null + childCount).
C.goalDetailResponseSchema.parse({ ...draftGoal, parent: null, childCount: 0 });

const employees = C.hrEmployeeListResponseSchema.parse({
  items: [
    fillNulls(C.hrEmployeeListItemSchema, {
      id: ME_EMP,
      userId: ME_USER,
      employeeCode: "NV01",
      fullName: "Lê Nhân Viên",
      email: null,
      orgUnitId: DEPT,
      orgUnitName: "Kinh doanh",
      status: "active",
    }),
  ],
  meta: fillNulls(C.hrPageMetaSchema, {
    page: 1,
    pageSize: 100,
    total: 1,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  }),
});
const departments = C.hrDepartmentLookupSchema
  .array()
  .parse([{ id: DEPT, name: "Kinh doanh", code: "KD", parentId: null }]);

// Nhân viên thường: mọi cặp GOAL ở phạm vi Own.
const NV_CAPS = ["access:goal", "view:goal", "create:goal", "update:goal", "checkin:goal"];
const me = (caps) =>
  C.meResponseSchema.parse({
    id: ME_USER,
    companyId: CO,
    email: "nv@example.test",
    fullName: "Lê Nhân Viên",
    status: "active",
    capabilities: Object.fromEntries(caps.map((k) => [k, true])),
    mustSetupTwoFactor: false,
    mustChangePassword: false,
    company: { id: CO, name: "Công ty Thử", status: "active" },
    employee: {
      id: ME_EMP,
      employeeCode: "NV01",
      fullName: "Lê Nhân Viên",
      departmentId: DEPT,
      directManagerId: null,
      employmentStatus: "active",
    },
    roles: [{ id: "77777777-7777-4777-8777-777777777777", name: "employee" }],
    scopes: Object.fromEntries(caps.map((k) => [k, ["Own"]])),
    modules: [{ code: "GOAL", name: "Mục tiêu" }],
  });

process.stdout.write(
  JSON.stringify({
    ids: { CO, DEPT, ME_EMP, ME_USER, ACTIVE, DRAFT },
    activeGoal,
    draftGoal,
    employees,
    departments,
    meOwn: me(NV_CAPS),
    meNoCreate: me(NV_CAPS.filter((k) => k !== "create:goal")),
    refresh: C.authRefreshResponseSchema.parse({ accessToken: "fake", expiresIn: 900 }),
  }),
);
