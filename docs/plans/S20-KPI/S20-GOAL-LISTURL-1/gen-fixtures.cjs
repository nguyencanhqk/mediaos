// Dựng fixture đúng shape contracts (dist/cjs) rồi parse — in JSON ra stdout.
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const C = require(ROOT + "/packages/contracts/dist/cjs/index.js");
const z = C.z || require(ROOT + "/node_modules/.pnpm/node_modules/zod");
function fillNulls(schema, overrides) {
  const shape = schema.shape;
  const out = {};
  for (const [k, v] of Object.entries(shape)) {
    if (v.isNullable && v.isNullable()) out[k] = null;
    else if (v.isOptional && v.isOptional()) continue;
  }
  return { ...out, ...overrides };
}
const CO = "11111111-1111-4111-8111-111111111111";
const DEPT = "22222222-2222-4222-8222-222222222222";
const ME_EMP = "33333333-3333-4333-8333-333333333333";
const ME_USER = "44444444-4444-4444-8444-444444444444";
const PARENT = "55555555-5555-4555-8555-555555555555";
const names = ["An", "Bình", "Chi", "Dũng", "Hà", "Khánh"];
const emps = names.map((n, i) => `66666666-6666-4666-8666-66666666666${i}`);
const now = "2026-10-20T03:00:00.000Z";
const goal = (o) =>
  C.goalCoreResponseSchema.parse({
    id: PARENT,
    companyId: CO,
    goalCode: "G-0001",
    name: "Doanh số phòng Kinh doanh Q4",
    description: null,
    level: "department",
    departmentId: DEPT,
    projectId: null,
    employeeId: null,
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
const parentDetail = C.goalDetailResponseSchema.parse({ ...goal({}), parent: null, childCount: 0 });
const employees = C.hrEmployeeListResponseSchema.parse({
  items: emps.map((id, i) =>
    fillNulls(C.hrEmployeeListItemSchema, {
      id,
      userId: null,
      employeeCode: `NV00${i + 1}`,
      fullName: `Nguyễn ${names[i]}`,
      email: null,
      orgUnitId: DEPT,
      orgUnitName: "Kinh doanh",
      status: "active",
    }),
  ),
  meta: fillNulls(C.hrPageMetaSchema, {
    page: 1,
    pageSize: 100,
    total: 6,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  }),
});
const departments = require(ROOT + "/packages/contracts/dist/cjs/index.js")
  .hrDepartmentLookupSchema.array()
  .parse([{ id: DEPT, name: "Kinh doanh", code: "KD", parentId: null }]);
const allCaps = ["access:goal", "view:goal", "create:goal", "update:goal", "read:employee"];
const me = (caps, scopes) =>
  C.meResponseSchema.parse({
    id: ME_USER,
    companyId: CO,
    email: "ql@example.test",
    fullName: "Trần Quản Lý",
    status: "active",
    capabilities: Object.fromEntries(caps.map((k) => [k, true])),
    mustSetupTwoFactor: false,
    mustChangePassword: false,
    company: { id: CO, name: "Công ty Thử", status: "active" },
    employee: {
      id: ME_EMP,
      employeeCode: "QL01",
      fullName: "Trần Quản Lý",
      departmentId: DEPT,
      directManagerId: null,
      employmentStatus: "active",
    },
    roles: [{ id: "77777777-7777-4777-8777-777777777777", name: "manager" }],
    scopes,
    modules: [{ code: "GOAL", name: "Mục tiêu" }],
  });
const deptScopes = Object.fromEntries(allCaps.map((k) => [k, ["Department"]]));
const ownScopes = Object.fromEntries(allCaps.map((k) => [k, ["Own"]]));
const out = {
  ids: { CO, DEPT, ME_EMP, ME_USER, PARENT, emps },
  parentDetail,
  parentCore: goal({}),
  employees,
  departments,
  meManager: me(allCaps, deptScopes),
  meNoCreate: me(
    allCaps.filter((k) => k !== "create:goal"),
    Object.fromEntries(allCaps.filter((k) => k !== "create:goal").map((k) => [k, ["Department"]])),
  ),
  meOwn: me(allCaps, ownScopes),
  refresh: C.authRefreshResponseSchema.parse({ accessToken: "fake", expiresIn: 900 }),
};
process.stdout.write(JSON.stringify(out));
