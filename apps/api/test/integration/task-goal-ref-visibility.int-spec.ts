/**
 * S20-SEC-GOALNAMEDTO-1 — tham chiếu mục tiêu trong dữ liệu việc: CÙNG DỮ LIỆU, CÙNG QUYẾT ĐỊNH QUYỀN.
 * Plan: `docs/plans/S20-SEC-GOALNAMEDTO-1.md` §1 (I-1…I-6) + §4 (ca R1–R8 · A0–A6 · X1).
 *
 * Bất biến được đo:
 *  · I-1: `goalId`/`goalCode`/`goalName` có mặt trong một bản ghi việc ⇔ người xem đọc được CHÍNH mục tiêu đó
 *    qua đường đọc mục tiêu chuẩn (`GET /goals/:id`). Mọi đường trả dữ liệu việc (danh sách · chi tiết · việc
 *    của tôi · bảng kanban · phản hồi ghi · việc-của-mục-tiêu) cho cùng một kết quả.
 *  · I-3: `hasGoal` = việc đang gắn một mục tiêu còn sống — cờ trung tính, không mang id/tên/mã.
 *  · I-6: nhật ký hoạt động của việc/dự án theo cùng quyết định (che lúc đọc, sổ không đổi).
 *  · I-4 (hồi quy): bản ghi việc của công ty khác vẫn 404.
 *
 * Diễn viên (vai trò tự gieo; quyền đọc mục tiêu là biến DUY NHẤT giữa N và D cho đường được thử):
 *  · N — đủ cặp TASK cho các đường được thử, KHÔNG có cặp đọc mục tiêu;
 *  · D — như N + đọc mục tiêu ở phạm vi phòng (phòng của G-in) + xem nhật ký dự án;
 *  · M — đọc việc + đọc mục tiêu ở phạm vi phòng, là thành viên Active của dự án P;
 *  · F — đọc việc + đọc/tạo/sửa/xoá mục tiêu ở phạm vi công ty + tạo việc;
 *  · B — người dùng của công ty khác.
 * Ca A0 neo định nghĩa diễn viên bằng chính đường đọc mục tiêu chuẩn (200/403), để mọi ca sau so cùng quyết định.
 *
 * Kỷ luật assert: status trước body · tìm hàng THEO ID + `toBeDefined()` · goalName → goalCode → goalId → hasGoal.
 * Danh sách lọc theo `projectId` của riêng tệp này (không rơi khỏi trang). Cổng `hasDb && LANE_DB`.
 * Không `Promise.all` quanh supertest (census S18-QA-SUPERTESTLISTEN-1).
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

/** Vai trò mới mang `pairs` ở `scope`; cờ nhạy cảm lấy ĐÚNG giá trị catalog (cặp chưa có ⇒ false). */
async function grant(
  direct: Pool,
  companyId: string,
  userId: string,
  pairs: Pair[],
  scope: Scope,
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `gndto-${scope}-${userId.slice(0, 8)}`);
  for (const [action, resourceType] of pairs) {
    const cat = await direct.query<{ is_sensitive: boolean }>(
      "SELECT is_sensitive FROM permissions WHERE action = $1 AND resource_type = $2",
      [action, resourceType],
    );
    const sensitive = cat.rows[0]?.is_sensitive === true;
    const permId = await seedPermissionCatalog(direct, action, resourceType, sensitive);
    await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = loginPasswordFixture("gndto");
const DECOMPOSED = "TASK_GOAL_DECOMPOSED";

function dayShift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const PERIOD_START = dayShift(-30);
const PERIOD_END = dayShift(60);

type Row = Record<string, unknown>;
interface GoalRef {
  id: string;
  code: string;
  name: string;
}

const TASK_PAIRS: Pair[] = [
  ["read", "task"],
  ["view-kanban", "task"],
  ["update", "task"],
  ["update-priority", "task"],
];

function byId(rows: unknown, id: string): Row | undefined {
  expect(Array.isArray(rows), JSON.stringify(rows)).toBe(true);
  return (rows as Row[]).find((r) => r.id === id);
}

/** Người xem KHÔNG đọc được mục tiêu đang gắn ⇒ không tên/mã/id, chỉ cờ «có mục tiêu». */
function expectGoalHidden(row: Row | undefined, label: string): void {
  expect(row, label).toBeDefined();
  const r = row as Row;
  expect(r.goalName, label).toBeNull();
  expect(r.goalCode, label).toBeNull();
  expect(r.goalId, label).toBeNull();
  expect(r.hasGoal, label).toBe(true);
}

/** Người xem đọc được mục tiêu đang gắn ⇒ đủ ba trường của đúng mục tiêu đó. */
function expectGoalShown(row: Row | undefined, goal: GoalRef, label: string): void {
  expect(row, label).toBeDefined();
  const r = row as Row;
  expect(r.goalName, label).toBe(goal.name);
  expect(r.goalCode, label).toBe(goal.code);
  expect(r.goalId, label).toBe(goal.id);
}

/** Việc không gắn mục tiêu còn sống ⇒ ba trường null, cờ false. */
function expectNoGoal(row: Row | undefined, label: string): void {
  expect(row, label).toBeDefined();
  const r = row as Row;
  expect(r.goalName, label).toBeNull();
  expect(r.goalCode, label).toBeNull();
  expect(r.goalId, label).toBeNull();
  expect(r.hasGoal, label).toBe(false);
}

describe.skipIf(!runDb)("S20-SEC-GOALNAMEDTO-1 — tham chiếu mục tiêu trong dữ liệu việc", () => {
  const direct: Pool = directPool();
  let nest: INestApplication;
  let A: SeededTenant;
  let B: SeededTenant;
  const token: Record<string, string> = {};
  const emp: Record<string, string> = {};
  let projectP = "";
  let gIn: GoalRef;
  let gOut: GoalRef;
  let gProj: GoalRef;
  let gDel: GoalRef;
  const t: Record<string, string> = {};

  const call = (m: "get" | "post" | "patch" | "delete", who: string, url: string) =>
    request(nest.getHttpServer())[m](url).set("Authorization", `Bearer ${token[who]}`);

  async function getOk(who: string, url: string): Promise<unknown> {
    const res = await call("get", who, url);
    expect(res.status, `${who} GET ${url}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data;
  }

  const listP = (who: string) => getOk(who, `/tasks?projectId=${projectP}&limit=100`);

  function kanbanCards(board: unknown): Row[] {
    const columns = (board as { columns: Array<{ tasks: Row[] }> }).columns;
    expect(Array.isArray(columns), JSON.stringify(board)).toBe(true);
    return columns.flatMap((c) => c.tasks);
  }

  async function decomposedLog(who: string, url: string): Promise<Row | undefined> {
    const rows = (await getOk(who, url)) as Row[];
    expect(Array.isArray(rows), JSON.stringify(rows)).toBe(true);
    return rows.find((r) => r.action === DECOMPOSED && r.taskId === t.decomposed);
  }

  beforeAll(async () => {
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "gndtoA");
    B = await seedCompany(direct, "gndtoB");
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
    await actor("n", A, ouIn);
    await actor("d", A, ouIn);
    await actor("m", A, ouIn);
    await actor("f", A, ouIn);
    await actor("b", B, ouB);
    const ownerOut = await mkEmp(A.companyId, ouOut, null);

    await grant(direct, A.companyId, uid.n, TASK_PAIRS, "Company");
    await grant(direct, A.companyId, uid.d, [...TASK_PAIRS, ["view", "task-audit-log"]], "Company");
    await grant(direct, A.companyId, uid.d, [["view", "goal"]], "Department");
    await grant(direct, A.companyId, uid.m, [["read", "task"]], "Company");
    await grant(direct, A.companyId, uid.m, [["view", "goal"]], "Department");
    await grant(
      direct,
      A.companyId,
      uid.f,
      [
        ["read", "task"],
        ["create", "task"],
        ["view", "goal"],
        ["create", "goal"],
        ["update", "goal"],
        ["delete", "goal"],
      ],
      "Company",
    );
    await grant(direct, B.companyId, uid.b, [["read", "task"]], "Company");

    projectP = (
      await direct.query(
        `INSERT INTO projects (company_id, name, status, project_status)
         VALUES ($1,'gndto-proj','active','Active') RETURNING id`,
        [A.companyId],
      )
    ).rows[0].id as string;
    await direct.query(
      `INSERT INTO project_members (company_id, project_id, user_id, employee_id, project_role, member_status)
       VALUES ($1,$2,$3,$4,'Member','Active')`,
      [A.companyId, projectP, uid.m, emp.m],
    );

    const mkGoal = async (
      code: string,
      name: string,
      anchor: { departmentId: string } | { projectId: string },
      ownerEmp: string,
    ): Promise<GoalRef> => {
      const level = "departmentId" in anchor ? "department" : "project";
      const r = await direct.query(
        `INSERT INTO goals (company_id, goal_code, name, level, department_id, project_id,
                            owner_employee_id, period_type, period_start, period_end, progress_mode, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'quarter',$8,$9,'tasks','Active') RETURNING id`,
        [
          A.companyId,
          code,
          name,
          level,
          "departmentId" in anchor ? anchor.departmentId : null,
          "projectId" in anchor ? anchor.projectId : null,
          ownerEmp,
          PERIOD_START,
          PERIOD_END,
        ],
      );
      return { id: r.rows[0].id as string, code, name };
    };
    gIn = await mkGoal("GNDTO-IN", "Mục tiêu phòng trong", { departmentId: ouIn }, emp.f);
    gOut = await mkGoal("GNDTO-OUT", "Mục tiêu phòng ngoài", { departmentId: ouOut }, ownerOut);
    gProj = await mkGoal("GNDTO-PRJ", "Mục tiêu dự án P", { projectId: projectP }, ownerOut);
    gDel = await mkGoal("GNDTO-DEL", "Mục tiêu sẽ xoá", { departmentId: ouIn }, emp.f);

    const mkTask = async (title: string, goalId: string | null, assigneeEmp: string | null) =>
      (
        await direct.query(
          `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id,
                              project_id, goal_id)
           VALUES ($1,'office',$2,'Todo',$3,$4,$5) RETURNING id`,
          [A.companyId, title, assigneeEmp, projectP, goalId],
        )
      ).rows[0].id as string;
    t.in = await mkTask("gndto-t-in", gIn.id, null);
    t.out = await mkTask("gndto-t-out", gOut.id, emp.d);
    t.proj = await mkTask("gndto-t-proj", gProj.id, null);
    t.none = await mkTask("gndto-t-none", null, null);
    t.del = await mkTask("gndto-t-del", gDel.id, null);
    t.b = (
      await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_status) VALUES ($1,'office','gndto-b','Todo')
         RETURNING id`,
        [B.companyId],
      )
    ).rows[0].id as string;

    const templateId = (
      await direct.query(
        "INSERT INTO task_templates (company_id, name) VALUES ($1,'gndto-template') RETURNING id",
        [A.companyId],
      )
    ).rows[0].id as string;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = applyMainPipeline(moduleRef.createNestApplication());
    await nest.init();

    for (const [k, tenant] of [
      ["n", A],
      ["d", A],
      ["m", A],
      ["f", A],
      ["b", B],
    ] as const) {
      const res = await request(nest.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: tenant.slug, email: `${k}@${tenant.slug}.test`, password: LOGIN_PW });
      expect(res.status, `login ${k}: ${JSON.stringify(res.body)}`).toBe(200);
      token[k] = res.body.data.accessToken as string;
    }

    // Việc sinh từ phân rã mục tiêu dự án — dòng nhật ký mang tham chiếu mục tiêu (đường ghi thật).
    const dec = await call("post", "f", `/goals/${gProj.id}/decompose`).send({
      templateId,
      items: [{ title: "gndto-t-decomposed" }],
    });
    expect([200, 201], JSON.stringify(dec.body)).toContain(dec.status);
    t.decomposed = dec.body.data.tasks[0].id as string;
    for (const k of ["d", "m"]) {
      await direct.query(
        `INSERT INTO task_watchers (company_id, task_id, employee_id, watcher_type, status, added_by)
         VALUES ($1,$2,$3,'Manual','Active',$4)`,
        [A.companyId, t.decomposed, emp[k], uid.f],
      );
    }
  }, 180_000);

  afterAll(async () => {
    if (nest) await nest.close();
    if (A && B) {
      const ids = [A.companyId, B.companyId];
      await direct.query("UPDATE tasks SET goal_id = NULL WHERE company_id = ANY($1::uuid[])", [
        ids,
      ]);
      await direct.query("DELETE FROM goal_updates WHERE company_id = ANY($1::uuid[])", [ids]);
      await direct.query("DELETE FROM goals WHERE company_id = ANY($1::uuid[])", [ids]);
      await direct.query("DELETE FROM task_templates WHERE company_id = ANY($1::uuid[])", [ids]);
      await cleanupTenants(direct, ids);
    }
    await direct.end();
  });

  it("A0 định nghĩa diễn viên theo đường đọc mục tiêu chuẩn (GET /goals/:id)", async () => {
    const status = async (who: string, g: GoalRef) =>
      (await call("get", who, `/goals/${g.id}`)).status;
    expect(await status("d", gIn)).toBe(200);
    expect(await status("d", gOut)).toBe(403);
    expect(await status("d", gProj)).toBe(403);
    expect(await status("m", gProj)).toBe(200);
    expect(await status("f", gOut)).toBe(200);
    expect(await status("n", gIn)).toBe(403);
  });

  it("R1 danh sách việc: không có quyền đọc mục tiêu ⇒ chỉ cờ có mục tiêu", async () => {
    expectGoalHidden(byId(await listP("n"), t.in), "N list t.in");
  });

  it("R2 danh sách việc: mục tiêu ngoài phạm vi đọc mục tiêu ⇒ chỉ cờ có mục tiêu", async () => {
    expectGoalHidden(byId(await listP("d"), t.out), "D list t.out");
  });

  it("R3 chi tiết việc: cùng quyết định như danh sách", async () => {
    expectGoalHidden((await getOk("d", `/tasks/${t.out}`)) as Row, "D detail t.out");
  });

  it("R4 việc của tôi: cùng quyết định như danh sách", async () => {
    expectGoalHidden(byId(await getOk("d", "/tasks/my"), t.out), "D my t.out");
  });

  it("R5 bảng kanban dự án: cùng quyết định như danh sách", async () => {
    const cards = kanbanCards(await getOk("d", `/projects/${projectP}/kanban`));
    expectGoalHidden(byId(cards, t.out), "D kanban t.out");
  });

  it("R6 phản hồi ghi PATCH: cùng quyết định như danh sách", async () => {
    const patched = await call("patch", "d", `/tasks/${t.out}`).send({ description: "gndto" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expectGoalHidden(patched.body.data as Row, "D PATCH t.out");
  });

  it("R6b phản hồi hành động (đổi ưu tiên): cùng quyết định như danh sách", async () => {
    const prio = await call("post", "d", `/tasks/${t.out}/change-priority`).send({
      priority: "High",
    });
    expect([200, 201], JSON.stringify(prio.body)).toContain(prio.status);
    expectGoalHidden(prio.body.data.task as Row, "D change-priority t.out");
  });

  it("A1 đứng cạnh: mục tiêu trong phạm vi đọc ⇒ đủ ba trường ở mọi đường", async () => {
    expectGoalShown(byId(await listP("d"), t.in), gIn, "D list t.in");
    expectGoalShown((await getOk("d", `/tasks/${t.in}`)) as Row, gIn, "D detail t.in");
    const cards = kanbanCards(await getOk("d", `/projects/${projectP}/kanban`));
    expectGoalShown(byId(cards, t.in), gIn, "D kanban t.in");
    const patched = await call("patch", "d", `/tasks/${t.in}`).send({ description: "gndto" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expectGoalShown(patched.body.data as Row, gIn, "D PATCH t.in");
    const prio = await call("post", "d", `/tasks/${t.in}/change-priority`).send({
      priority: "Low",
    });
    expect([200, 201], JSON.stringify(prio.body)).toContain(prio.status);
    expectGoalShown(prio.body.data.task as Row, gIn, "D change-priority t.in");
  });

  it("A2 đứng cạnh: thành viên dự án đọc được mục tiêu dự án ⇒ đủ ba trường", async () => {
    expectGoalShown((await getOk("m", `/tasks/${t.proj}`)) as Row, gProj, "M detail t.proj");
  });

  it("A2' cùng việc, người xem không là thành viên dự án ⇒ chỉ cờ có mục tiêu", async () => {
    expectGoalHidden((await getOk("d", `/tasks/${t.proj}`)) as Row, "D detail t.proj");
  });

  it("A3 đứng cạnh: phạm vi đọc mục tiêu toàn công ty ⇒ đủ ba trường", async () => {
    const rows = await listP("f");
    expectGoalShown(byId(rows, t.in), gIn, "F list t.in");
    expectGoalShown(byId(rows, t.out), gOut, "F list t.out");
    expectGoalShown(byId(rows, t.proj), gProj, "F list t.proj");
  });

  it("A4 đứng cạnh: việc-của-mục-tiêu (mục tiêu đọc được) ⇒ đủ ba trường", async () => {
    expectGoalShown(byId(await getOk("d", `/goals/${gIn.id}/tasks`), t.in), gIn, "D goal-tasks");
  });

  it("A5 việc không gắn mục tiêu ⇒ ba trường null, cờ false với mọi diễn viên", async () => {
    for (const who of ["n", "d", "m", "f"]) {
      expectNoGoal((await getOk(who, `/tasks/${t.none}`)) as Row, `${who} detail t.none`);
    }
  });

  it("A5b cờ có mục tiêu đi cùng ba trường khi người xem đọc được mục tiêu", async () => {
    const row = (await getOk("d", `/tasks/${t.in}`)) as Row;
    expectGoalShown(row, gIn, "D detail t.in");
    expect(row.hasGoal).toBe(true);
  });

  /** Dòng phân rã theo cùng quyết định đọc mục tiêu: không tên trong message, không id/mã trong newValues. */
  async function expectDecomposedLogHidden(url: string): Promise<void> {
    const log = await decomposedLog("d", url);
    expect(log, url).toBeDefined();
    const r = log as Row;
    expect(String(r.message), url).not.toContain(gProj.name);
    expect(r.newValues, url).not.toHaveProperty("goalId");
    expect(r.newValues, url).not.toHaveProperty("goalCode");
  }

  it("R8 nhật ký việc: dòng phân rã theo cùng quyết định đọc mục tiêu", async () => {
    await expectDecomposedLogHidden(`/tasks/${t.decomposed}/activity`);
  });

  it("R8b nhật ký dự án: dòng phân rã theo cùng quyết định đọc mục tiêu", async () => {
    await expectDecomposedLogHidden(`/projects/${projectP}/activity`);
  });

  it("A6 đứng cạnh: người xem đọc được mục tiêu ⇒ dòng phân rã nguyên văn", async () => {
    const log = await decomposedLog("m", `/tasks/${t.decomposed}/activity`);
    expect(log).toBeDefined();
    const r = log as Row;
    expect(String(r.message)).toContain(gProj.name);
    expect(r.newValues).toHaveProperty("goalId", gProj.id);
    expect(r.newValues).toHaveProperty("goalCode", gProj.code);
  });

  it("X1 hồi quy tenant: việc của công ty khác ⇒ 404", async () => {
    const res = await call("get", "b", `/tasks/${t.in}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  // ⚠️ R7 → R7b phụ thuộc thứ tự: R7 xoá mềm G-del qua API, R7b đo trên cùng dữ liệu. Chạy cả tệp.
  it("R7 mục tiêu đã xoá mềm ⇒ việc không còn tham chiếu mục tiêu (phạm vi đọc toàn công ty)", async () => {
    const before = (await getOk("d", `/tasks/${t.del}`)) as Row;
    expectGoalShown(before, gDel, "D detail t.del trước khi xoá");
    const del = await call("delete", "f", `/goals/${gDel.id}`);
    expect(del.status, JSON.stringify(del.body)).toBe(204);
    expectNoGoal((await getOk("f", `/tasks/${t.del}`)) as Row, "F detail t.del");
    expectNoGoal(byId(await listP("f"), t.del), "F list t.del");
  });

  it("R7b mục tiêu đã xoá mềm ⇒ việc không còn tham chiếu mục tiêu (phạm vi đọc theo phòng)", async () => {
    const gone = await call("get", "f", `/goals/${gDel.id}`);
    expect(gone.status, "G-del đã xoá mềm ở R7").toBe(404);
    expectNoGoal((await getOk("d", `/tasks/${t.del}`)) as Row, "D detail t.del");
    expectNoGoal(byId(await listP("d"), t.del), "D list t.del");
  });
});
