/**
 * S20-TASK-MYTASKSLOAD-1 — «Việc của tôi» tải nhẹ + lọc /tasks theo mục tiêu.
 * Plan: `docs/plans/S20-TASK-MYTASKSLOAD-1.md` §4 (M1–M6 · G1–G6).
 *
 * Diễn viên (vai trò tự gieo):
 *  · U — đọc việc (công ty) + xem mục tiêu ở phạm vi PHÒNG (chỉ thấy G-in); là người được giao mọi việc của tệp;
 *  · N — đọc việc, KHÔNG có cặp xem mục tiêu;
 *  · F — đọc việc + xem mục tiêu ở phạm vi công ty;
 *  · P — đọc việc ở phạm vi PHÒNG + xem mục tiêu công ty (đo «bộ lọc không nới quyền đọc việc»);
 *  · Z — KHÔNG có cặp đọc việc (cổng quyền chạy trước);
 *  · B — công ty khác.
 * Cổng `hasDb && LANE_DB`. Không `Promise.all` quanh supertest.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

type Pair = [action: string, resourceType: string];
type Scope = "Company" | "Department";
type Row = Record<string, unknown>;

async function grant(
  direct: Pool,
  companyId: string,
  userId: string,
  pairs: Pair[],
  scope: Scope,
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `mtl-${scope}-${userId.slice(0, 8)}`);
  for (const [action, resourceType] of pairs) {
    const cat = await direct.query<{ is_sensitive: boolean }>(
      "SELECT is_sensitive FROM permissions WHERE action = $1 AND resource_type = $2",
      [action, resourceType],
    );
    const permId = await seedPermissionCatalog(
      direct,
      action,
      resourceType,
      cat.rows[0]?.is_sensitive === true,
    );
    await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = loginPasswordFixture("mtl");
const NOW = Date.now();
const PERIOD_START = new Date(NOW - 30 * 864e5).toISOString().slice(0, 10);
const PERIOD_END = new Date(NOW + 60 * 864e5).toISOString().slice(0, 10);
const OPEN_COUNT = 15;
const DONE_COUNT = 500;
const CLOSED_CAP = 100;
const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000001";

describe.skipIf(!runDb)("S20-TASK-MYTASKSLOAD-1 — /tasks/my tải nhẹ + goalId", () => {
  const direct: Pool = directPool();
  let nest: INestApplication;
  let A: SeededTenant;
  let B: SeededTenant;
  const token: Record<string, string> = {};
  const emp: Record<string, string> = {};
  const goal: Record<string, string> = {};
  const t: Record<string, string> = {};

  const get = (who: string, url: string) =>
    request(nest.getHttpServer()).get(url).set("Authorization", `Bearer ${token[who]}`);

  async function getOk(who: string, url: string): Promise<Row[]> {
    const res = await get(who, url);
    expect(res.status, `${who} GET ${url}: ${JSON.stringify(res.body)}`).toBe(200);
    expect(Array.isArray(res.body.data), JSON.stringify(res.body)).toBe(true);
    return res.body.data as Row[];
  }

  const ids = (rows: Row[]) => rows.map((r) => r.id as string);

  beforeAll(async () => {
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "mtlA");
    B = await seedCompany(direct, "mtlB");
    await direct.query(
      `INSERT INTO sequence_counters
         (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
          reset_policy, increment_by, current_value, status)
       VALUES ($1,'GOAL','goal','Company','GOAL-',4,'Never',1,0,'Active'),
              ($1,'TASK','task','Company','TSK-',4,'Never',1,0,'Active')
       ON CONFLICT DO NOTHING`,
      [A.companyId],
    );
    const mkOu = async (companyId: string, name: string) =>
      (
        await direct.query(
          "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
          [companyId, name],
        )
      ).rows[0].id as string;
    const ouIn = await mkOu(A.companyId, "Phòng trong");
    const ouOut = await mkOu(A.companyId, "Phòng ngoài");
    const ouB = await mkOu(B.companyId, "Phòng B");
    const mkEmp = async (companyId: string, orgUnitId: string, userId: string | null) =>
      (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
           VALUES ($1,$2,$3,'active') RETURNING id`,
          [companyId, userId, orgUnitId],
        )
      ).rows[0].id as string;
    const uid: Record<string, string> = {};
    const actor = async (k: string, tenant: SeededTenant, ou: string) => {
      uid[k] = await seedUser(direct, tenant.companyId, `${k}@${tenant.slug}.test`, hash);
      emp[k] = await mkEmp(tenant.companyId, ou, uid[k]);
    };
    await actor("u", A, ouIn);
    await actor("n", A, ouIn);
    await actor("f", A, ouIn);
    await actor("p", A, ouIn);
    await actor("z", A, ouIn);
    await actor("b", B, ouB);
    const ownerOut = await mkEmp(A.companyId, ouOut, null);

    await grant(direct, A.companyId, uid.u, [["read", "task"]], "Company");
    await grant(direct, A.companyId, uid.u, [["view", "goal"]], "Department");
    await grant(direct, A.companyId, uid.n, [["read", "task"]], "Company");
    await grant(
      direct,
      A.companyId,
      uid.f,
      [
        ["read", "task"],
        ["view", "goal"],
      ],
      "Company",
    );
    await grant(direct, A.companyId, uid.p, [["read", "task"]], "Department");
    await grant(direct, A.companyId, uid.p, [["view", "goal"]], "Company");
    await grant(direct, A.companyId, uid.z, [["view", "goal"]], "Company");
    await grant(
      direct,
      B.companyId,
      uid.b,
      [
        ["read", "task"],
        ["view", "goal"],
      ],
      "Company",
    );

    const mkGoal = async (
      companyId: string,
      code: string,
      ou: string,
      owner: string,
      softDeleted = false,
    ) =>
      (
        await direct.query(
          `INSERT INTO goals (company_id, goal_code, name, level, department_id, owner_employee_id,
                              period_type, period_start, period_end, progress_mode, status, deleted_at)
           VALUES ($1,$2,$3,'department',$4,$5,'quarter',$6,$7,'tasks','Active',$8) RETURNING id`,
          [
            companyId,
            code,
            `Tên ${code}`,
            ou,
            owner,
            PERIOD_START,
            PERIOD_END,
            softDeleted ? new Date() : null,
          ],
        )
      ).rows[0].id as string;
    goal.in = await mkGoal(A.companyId, "MTL-IN", ouIn, emp.f);
    goal.out = await mkGoal(A.companyId, "MTL-OUT", ouOut, ownerOut);
    goal.del = await mkGoal(A.companyId, "MTL-DEL", ouIn, emp.f, true);
    goal.b = await mkGoal(B.companyId, "MTL-B", ouB, emp.b);

    const mkTask = async (
      companyId: string,
      title: string,
      status: string,
      assignee: string | null,
      goalId: string | null,
    ) =>
      (
        await direct.query(
          `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id, goal_id,
                              completed_at)
           VALUES ($1,'office',$2,$3,$4,$5, CASE WHEN $3 = 'Done' THEN now() ELSE NULL END) RETURNING id`,
          [companyId, title, status, assignee, goalId],
        )
      ).rows[0].id as string;
    // 15 việc MỞ của U: 3 có mục tiêu (in/out/del), 12 không.
    t.openIn = await mkTask(A.companyId, "mtl-open-in", "Todo", emp.u, goal.in);
    t.openOut = await mkTask(A.companyId, "mtl-open-out", "In Progress", emp.u, goal.out);
    t.openDel = await mkTask(A.companyId, "mtl-open-del", "Todo", emp.u, goal.del);
    for (let i = 0; i < OPEN_COUNT - 3; i++) {
      await mkTask(A.companyId, `mtl-open-${i}`, "Todo", emp.u, null);
    }
    // Việc ĐÓNG có mục tiêu — mới nhất để chắc nằm trong 100 đầu.
    t.doneIn = await mkTask(A.companyId, "mtl-done-in", "Done", emp.u, goal.in);
    t.doneOut = await mkTask(A.companyId, "mtl-done-out", "Done", emp.u, goal.out);
    // Việc Done xoá mềm: KHÔNG được có mặt / không được đếm.
    t.doneDeleted = await mkTask(A.companyId, "mtl-done-deleted", "Done", emp.u, null);
    await direct.query("UPDATE tasks SET deleted_at = now() WHERE id = $1", [t.doneDeleted]);
    // Việc ngoài phạm vi đọc phòng của P (giao cho người phòng ngoài) + việc trong phạm vi, cùng gắn goal.in.
    t.outsideScope = await mkTask(A.companyId, "mtl-outside-scope", "Todo", ownerOut, goal.in);
    t.inScope = await mkTask(A.companyId, "mtl-in-scope", "Todo", emp.p, goal.in);
    // Công ty B: việc mở + đã xong của người b, gắn goal.b.
    t.bOpen = await mkTask(B.companyId, "mtl-b-open", "Todo", emp.b, goal.b);
    t.bDone = await mkTask(B.companyId, "mtl-b-done", "Done", emp.b, goal.b);
    // 500 việc Done cũ hơn — MỘT câu lệnh.
    await direct.query(
      `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id, completed_at)
       SELECT $1,'office','mtl-done-bulk-'||g,'Done',$2, now() - ((g + 10) || ' minutes')::interval
         FROM generate_series(1, $3::int) g`,
      [A.companyId, emp.u, DONE_COUNT],
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = applyMainPipeline(moduleRef.createNestApplication());
    await nest.init();
    for (const [k, tenant] of [
      ["u", A],
      ["n", A],
      ["f", A],
      ["p", A],
      ["z", A],
      ["b", B],
    ] as const) {
      const res = await request(nest.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: tenant.slug, email: `${k}@${tenant.slug}.test`, password: LOGIN_PW });
      expect(res.status, `login ${k}: ${JSON.stringify(res.body)}`).toBe(200);
      token[k] = res.body.data.accessToken as string;
    }
  }, 120_000);

  afterAll(async () => {
    await nest?.close();
    if (A && B) {
      const ids = [A.companyId, B.companyId];
      await direct.query("UPDATE tasks SET goal_id = NULL WHERE company_id = ANY($1::uuid[])", [
        ids,
      ]);
      await direct.query("DELETE FROM goals WHERE company_id = ANY($1::uuid[])", [ids]);
      await cleanupTenants(direct, ids);
    }
    await direct.end();
  });

  it("M1 mặc định: chỉ việc MỞ (không Done) — kể cả khi có 500 Done", async () => {
    const rows = await getOk("u", "/tasks/my");
    expect(rows).toHaveLength(OPEN_COUNT);
    expect(rows.every((r) => r.status !== "Done" && r.status !== "Cancelled")).toBe(true);
  });

  it("M1b includeClosed=true: mở + đúng trần việc đóng, báo bị cắt, total đủ, không đếm việc xoá mềm", async () => {
    const res = await get("u", "/tasks/my?includeClosed=true");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Row[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(OPEN_COUNT + CLOSED_CAP);
    expect(ids(rows)).not.toContain(t.doneDeleted);
    expect(res.body.pagination.has_next).toBe(true);
    expect(res.body.pagination.total).toBe(OPEN_COUNT + 2 + DONE_COUNT);
    expect(ids(rows)).toContain(t.doneIn);
  });

  it("M2 includeClosed rác ⇒ 400 (không 500); false ⇒ 200", async () => {
    for (const bad of ["abc", ""]) {
      const res = await get("u", `/tasks/my?includeClosed=${bad}`);
      expect(res.status, `includeClosed=${bad}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    expect(await getOk("u", "/tasks/my?includeClosed=false")).toHaveLength(OPEN_COUNT);
  });

  it("M3 dưới trần ⇒ không báo cắt oan", async () => {
    const res = await get("p", "/tasks/my?includeClosed=true");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pagination.has_next).toBe(false);
    expect((res.body.data as Row[]).length).toBe(res.body.pagination.total);
  });

  it("M5 tenant: người công ty B chỉ thấy việc của B", async () => {
    const rows = await getOk("b", "/tasks/my?includeClosed=true");
    expect(ids(rows).sort()).toEqual([t.bOpen, t.bDone].sort());
    const mine = await getOk("u", "/tasks/my?includeClosed=true");
    expect(ids(mine)).not.toContain(t.bOpen);
  });

  it("M6 che goalName: DENY ở cả dòng mở lẫn dòng đóng, ALLOW cạnh", async () => {
    const rows = await getOk("u", "/tasks/my?includeClosed=true");
    const by = (id: string) => rows.find((r) => r.id === id) as Row;
    for (const id of [t.openOut, t.doneOut]) {
      expect(by(id), id).toBeDefined();
      expect(by(id).goalName, id).toBeNull();
      expect(by(id).goalCode, id).toBeNull();
      expect(by(id).goalId, id).toBeNull();
    }
    for (const id of [t.openIn, t.doneIn]) {
      expect(by(id), id).toBeDefined();
      expect(by(id).goalName, id).toBe("Tên MTL-IN");
      expect(by(id).goalCode, id).toBe("MTL-IN");
      expect(by(id).goalId, id).toBe(goal.in);
    }
  });

  it("G1 goalId không phải uuid ⇒ 400; uuid hợp lệ ⇒ 200", async () => {
    const bad = await get("f", "/tasks?goalId=abc");
    expect(bad.status, JSON.stringify(bad.body)).toBe(400);
    expect((await get("f", `/tasks?goalId=${goal.in}`)).status).toBe(200);
  });

  it("G2 lọc đúng mục tiêu: việc gắn G có, việc khác/không gắn thì không", async () => {
    const rows = await getOk("f", `/tasks?goalId=${goal.in}&limit=100`);
    expect(ids(rows)).toEqual(
      expect.arrayContaining([t.openIn, t.doneIn, t.outsideScope, t.inScope]),
    );
    expect(ids(rows)).not.toContain(t.openOut);
    expect(rows.every((r) => r.goalId === goal.in)).toBe(true);
  });

  it("G3 công ty khác / không tồn tại / xoá mềm ⇒ [] (200)", async () => {
    for (const g of [goal.b, UNKNOWN_UUID, goal.del]) {
      expect(await getOk("f", `/tasks?goalId=${g}`), g).toEqual([]);
    }
  });

  it("G4 đọc được việc nhưng không xem được mục tiêu ⇒ []; có quyền ⇒ danh sách", async () => {
    expect(await getOk("n", `/tasks?goalId=${goal.in}`)).toEqual([]);
    expect(await getOk("u", `/tasks?goalId=${goal.out}`)).toEqual([]);
    expect((await getOk("u", `/tasks?goalId=${goal.in}&limit=100`)).length).toBeGreaterThan(0);
  });

  it("G5 bộ lọc không nới quyền đọc việc", async () => {
    const unfiltered = await getOk("p", "/tasks?limit=100");
    expect(
      ids(unfiltered),
      "điều kiện tiên quyết: P không đọc được việc ngoài phòng",
    ).not.toContain(t.outsideScope);
    const rows = await getOk("p", `/tasks?goalId=${goal.in}&limit=100`);
    expect(ids(rows)).not.toContain(t.outsideScope);
    expect(ids(rows)).toContain(t.inScope);
  });

  it("G6 không có read:task + goalId ⇒ 403 như cũ", async () => {
    const res = await get("z", `/tasks?goalId=${goal.in}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });
});
