/**
 * S20-TASK-WORKLOAD-1 — GET /tasks/workload («Đội của tôi»). Plan: `docs/plans/S20-TASK-WORKLOAD-1.md` §4
 * (R1–R9 · P1 · P2). App THẬT qua `applyMainPipeline`, engine quyền THẬT, Postgres THẬT (lane cô lập).
 *
 * ⚠️ Bẫy xanh rỗng: ca phủ định («X không xuất hiện») chỉ có nghĩa khi X TỒN TẠI và đọc được ở phạm vi rộng —
 *    R8 (Company thấy X và Y) là neo dương; `beforeAll` assert tiền điều kiện bằng direct pool.
 * Mọi lời gọi HTTP chạy TUẦN TỰ (không `Promise.all` quanh supertest — census S18-QA-SUPERTESTLISTEN-1).
 * Cổng `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { taskWorkloadResponseSchema, taskWorkloadRowSchema } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { addDaysToLocalDate, localDateOf, wallTimeToInstant } from "../../src/common/tz.util";
import { dueSoonWindowEnd } from "../../src/tasks/task-workload.predicates";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { grant, seedEmployee } from "../helpers/task-file-seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = loginPasswordFixture("s20wl");
const TZ = "Asia/Ho_Chi_Minh";
const DAY_MS = 86_400_000;

type Caller = "NOPERM" | "M" | "E" | "H" | "D" | "B";
type Row = {
  employeeId: string;
  displayName: string | null;
  activeCount: number;
  overdueCount: number;
  dueSoon7dCount: number;
  inReviewCount: number;
  maxOverdueDays: number | null;
};

describe.skipIf(!runDb)("S20-TASK-WORKLOAD-1 — GET /tasks/workload", () => {
  const direct: Pool = directPool();
  let nest: INestApplication;
  let A: SeededTenant;
  let B: SeededTenant;
  const token: Partial<Record<Caller, string>> = {};
  const uid: Record<string, string> = {};
  const emp: Record<string, string> = {};
  let projectP = "";
  let projectB = "";
  const nowMs = Date.now();
  const at = (deltaDays: number) => new Date(nowMs + deltaDays * DAY_MS).toISOString();

  const http = () => request(nest.getHttpServer());
  const getAs = (who: Caller, path: string) =>
    http().get(path).set("Authorization", `Bearer ${token[who]}`);

  async function workload(who: Caller, qs = "") {
    const res = await getAs(who, `/tasks/workload${qs}`);
    expect(res.status, `workload ${who}${qs}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data as {
      items: Row[];
      unassigned: Record<string, unknown> | null;
      truncated: boolean;
    };
  }

  async function addTask(
    companyId: string,
    assignee: string | null,
    o: { status?: string; dueAt?: string | null; project?: string | null; deleted?: boolean } = {},
  ) {
    await direct.query(
      `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id, project_id, due_at, deleted_at)
       VALUES ($1, 'office', 'wl-task', $2, $3, $4, $5, $6)`,
      [
        companyId,
        o.status ?? "Todo",
        assignee,
        o.project ?? null,
        o.dueAt ?? null,
        o.deleted ? new Date().toISOString() : null,
      ],
    );
  }

  async function person(
    key: string,
    company: SeededTenant,
    name: string,
    opts: { manager?: string; orgUnit?: string } = {},
  ) {
    uid[key] = await seedUser(
      direct,
      company.companyId,
      `${key.toLowerCase()}@${company.slug}.test`,
      await hashed(),
    );
    await direct.query(`UPDATE users SET full_name = $1 WHERE id = $2`, [name, uid[key]]);
    emp[key] = await seedEmployee(direct, company.companyId, uid[key] as string);
    if (opts.manager) {
      await direct.query(`UPDATE employee_profiles SET direct_manager_id = $1 WHERE id = $2`, [
        opts.manager,
        emp[key],
      ]);
    }
    if (opts.orgUnit) {
      await direct.query(`UPDATE employee_profiles SET org_unit_id = $1 WHERE id = $2`, [
        opts.orgUnit,
        emp[key],
      ]);
    }
  }
  let cachedHash: string | undefined;
  async function hashed() {
    cachedHash ??= await new PasswordService().hash(LOGIN_PW);
    return cachedHash;
  }

  const addMember = (userKey: string) =>
    direct.query(
      `INSERT INTO project_members (company_id, project_id, user_id, employee_id, project_role, member_status)
       VALUES ($1, $2, $3, $4, 'Member', 'Active')`,
      [A.companyId, projectP, uid[userKey], emp[userKey]],
    );

  beforeAll(async () => {
    A = await seedCompany(direct, "wlA");
    B = await seedCompany(direct, "wlB");

    const ou = await direct.query(
      `INSERT INTO org_units (company_id, name, type) VALUES ($1,'wl-ou1','department') RETURNING id`,
      [A.companyId],
    );
    const ou1 = ou.rows[0].id as string;

    // Người gọi
    await person("NOPERM", A, "Không Quyền");
    await person("M", A, "Quản Lý");
    await person("H", A, "Nhân Sự");
    await person("E", A, "Nhân Viên Own");
    await person("D", A, "Trưởng Đơn Vị", { orgUnit: ou1 });
    await grant(direct, A.companyId, uid.M as string, [["read", "task"]], "Team");
    await grant(direct, A.companyId, uid.E as string, [["read", "task"]], "Own");
    await grant(direct, A.companyId, uid.H as string, [["read", "task"]], "Company");
    await grant(direct, A.companyId, uid.D as string, [["read", "task"]], "Department");

    // Đội của M: N1..N9 (direct_manager_id = user M)
    for (let i = 1; i <= 9; i++) {
      await person(`N${i}`, A, `Nhân Viên ${i}`, { manager: uid.M });
    }
    // Ngoài đội M / ngoài OU1 / trong OU1
    await person("X", A, "Người Ngoài Đội");
    await person("Y", A, "Người Ngoài Đơn Vị");
    await person("Z", A, "Người Trong Đơn Vị", { orgUnit: ou1 });
    await person("OWN", B, "Nhân Viên B");
    await person("BV", B, "Xem Công Ty B");
    await grant(direct, B.companyId, uid.BV as string, [["read", "task"]], "Company");

    const p = await direct.query(
      `INSERT INTO projects (company_id, name, project_status) VALUES ($1,'wl-proj','Active') RETURNING id`,
      [A.companyId],
    );
    projectP = p.rows[0].id as string;
    const pb = await direct.query(
      `INSERT INTO projects (company_id, name, project_status) VALUES ($1,'wl-proj-b','Active') RETURNING id`,
      [B.companyId],
    );
    projectB = pb.rows[0].id as string;
    for (const k of ["M", "E", "D"]) await addMember(k);

    // N1: quá hạn 3 ngày + chờ duyệt (hạn +2 ngày) + 1 Done  · N2..N8: 1 việc mở · N9: chỉ Done/Cancelled/xoá mềm
    await addTask(A.companyId, emp.N1 as string, { dueAt: at(-3), project: projectP });
    await addTask(A.companyId, emp.N1 as string, { status: "In Review", dueAt: at(2) });
    await addTask(A.companyId, emp.N1 as string, { status: "Done", dueAt: at(-9) });
    for (let i = 2; i <= 8; i++) {
      await addTask(A.companyId, emp[`N${i}`] as string, { project: i % 2 ? projectP : null });
    }
    await addTask(A.companyId, emp.N9 as string, { status: "Done" });
    await addTask(A.companyId, emp.N9 as string, { status: "Cancelled" });
    await addTask(A.companyId, emp.N9 as string, { deleted: true });
    // Dự án chung P
    await addTask(A.companyId, emp.X as string, { project: projectP, dueAt: at(-1) });
    await addTask(A.companyId, emp.Y as string, { project: projectP });
    await addTask(A.companyId, emp.Z as string, { project: projectP, dueAt: at(-1) });
    await addTask(A.companyId, emp.Z as string, { project: projectP, status: "In Review" });
    await addTask(A.companyId, emp.E as string, { project: projectP, dueAt: at(3) });
    await addTask(A.companyId, null, { project: projectP });
    // Công ty B
    await addTask(B.companyId, emp.OWN as string, { project: projectB, dueAt: at(-2) });

    // Tiền điều kiện (direct pool)
    const pre = await direct.query(
      `SELECT count(*)::int AS n FROM tasks WHERE company_id = $1 AND deleted_at IS NULL`,
      [A.companyId],
    );
    expect(pre.rows[0].n, "tiền điều kiện: có việc tenant A").toBeGreaterThan(10);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = applyMainPipeline(moduleRef.createNestApplication());
    await nest.init();
    await nest.listen(0);

    const who: Array<[Caller, string, SeededTenant]> = [
      ["NOPERM", "NOPERM", A],
      ["M", "M", A],
      ["E", "E", A],
      ["H", "H", A],
      ["D", "D", A],
      ["B", "BV", B],
    ];
    for (const [k, key, tenant] of who) {
      const res = await http()
        .post("/auth/login")
        .send({
          companySlug: tenant.slug,
          email: `${key.toLowerCase()}@${tenant.slug}.test`,
          password: LOGIN_PW,
        });
      expect(res.status, `login ${k}: ${JSON.stringify(res.body)}`).toBe(200);
      token[k] = res.body.data.accessToken as string;
    }
  }, 120_000);

  afterAll(async () => {
    if (nest) await nest.close();
    if (A && B) await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  const ids = (rows: Row[]) => rows.map((r) => r.employeeId);

  it("R1 · không có read:task ⇒ 403; có quyền ⇒ 200", async () => {
    const deny = await getAs("NOPERM", "/tasks/workload");
    expect(deny.status).toBe(403);
    const allow = await getAs("M", "/tasks/workload");
    expect(allow.status).toBe(200);
  });

  it("R7 · /tasks/workload không bị :taskId nuốt; mỗi dòng đúng 7 khoá, schema strict", async () => {
    const res = await getAs("M", "/tasks/workload");
    expect(res.status).not.toBe(400);
    const body = res.body.data;
    expect(() => taskWorkloadResponseSchema.parse(body)).not.toThrow();
    expect(body.items.length).toBeGreaterThan(0);
    for (const row of body.items) {
      expect(() => taskWorkloadRowSchema.strict().parse(row)).not.toThrow();
      expect(Object.keys(row)).toHaveLength(7);
    }
  });

  it("R2 · Own: không có X, không «Chưa giao»; ALLOW: đúng 1 dòng là chính mình", async () => {
    const w = await workload("E");
    expect(ids(w.items)).not.toContain(emp.X);
    expect(w.unassigned).toBeNull();
    expect(ids(w.items)).toEqual([emp.E]);
    expect(w.items[0]?.activeCount).toBe(1);
  });

  it("R3 · Team: X không xuất hiện dù chung dự án; ALLOW: đúng 8 dòng N1..N8 + Chưa giao", async () => {
    const w = await workload("M");
    expect(ids(w.items)).not.toContain(emp.X);
    expect(JSON.stringify(w)).not.toContain("Người Ngoài Đội");
    expect([...ids(w.items)].sort()).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((i) => emp[`N${i}`] as string).sort(),
    );
    expect(w.unassigned).not.toBeNull();
    // Chiều thuận: giao 1 việc mở cho M ⇒ M thành dòng thứ 9 (rồi hoàn tác)
    await addTask(A.companyId, emp.M as string);
    const w2 = await workload("M");
    expect(ids(w2.items)).toContain(emp.M);
    expect(w2.items).toHaveLength(9);
    await direct.query(
      `UPDATE tasks SET deleted_at = now() WHERE company_id = $1 AND main_assignee_employee_id = $2`,
      [A.companyId, emp.M],
    );
  });

  it("R4 · N9 (chỉ Done/Cancelled/xoá mềm) không xuất hiện; mở lại 1 việc ⇒ xuất hiện", async () => {
    const before = await workload("M");
    expect(ids(before.items)).not.toContain(emp.N9);
    await addTask(A.companyId, emp.N9 as string);
    const after = await workload("M");
    expect(ids(after.items)).toContain(emp.N9);
    await direct.query(
      `UPDATE tasks SET deleted_at = now() WHERE company_id = $1 AND main_assignee_employee_id = $2 AND task_status = 'Todo'`,
      [A.companyId, emp.N9],
    );
  });

  it("R5 · cross-tenant: A không thấy dòng của B, kể cả ?projectId=<dự án B>; B thấy dòng của B", async () => {
    const wh = await workload("H");
    expect(ids(wh.items)).not.toContain(emp.OWN);
    const wp = await workload("H", `?projectId=${projectB}`);
    expect(wp.items).toEqual([]);
    expect(wp.unassigned).toBeNull();
    const wm = await workload("M", `?projectId=${projectB}`);
    expect(wm.items).toEqual([]);
    const wb = await workload("B");
    expect(ids(wb.items)).toEqual([emp.OWN]);
  });

  it("R6 · ?projectId=abc ⇒ 400; ?projectId=P chỉ đếm việc trong P", async () => {
    const bad = await getAs("M", "/tasks/workload?projectId=abc");
    expect(bad.status).toBe(400);
    const w = await workload("M", `?projectId=${projectP}`);
    const n1 = w.items.find((r) => r.employeeId === emp.N1);
    expect(n1?.activeCount).toBe(1); // chỉ việc quá hạn của N1 nằm trong P
    expect(n1?.inReviewCount).toBe(0);
  });

  it("R8 · Company thấy cả X và Y (neo dương)", async () => {
    const w = await workload("H");
    expect(ids(w.items)).toEqual(expect.arrayContaining([emp.X, emp.Y, emp.Z, emp.N1]));
    expect(w.unassigned).not.toBeNull();
  });

  it("R9 · Department: Y (ngoài OU1, chung dự án) không xuất hiện, tên Y không có; Z xuất hiện", async () => {
    const w = await workload("D");
    expect(ids(w.items)).not.toContain(emp.Y);
    expect(JSON.stringify(w)).not.toContain("Người Ngoài Đơn Vị");
    expect(ids(w.items)).toContain(emp.Z);
    expect(w.unassigned).not.toBeNull();
  });

  /** P1 — mỗi số = kết quả GET /tasks cùng bộ lọc. */
  async function listFor(who: Caller, employeeId: string, extra = "") {
    const res = await getAs(who, `/tasks?assigneeEmployeeId=${employeeId}&limit=200${extra}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as Array<{
      status: string | null;
      isOverdue: boolean;
      dueAt: string | null;
    }>;
  }

  async function expectMatchesList(who: Caller, qs: string, listExtra: string) {
    const w = await workload(who, qs);
    expect(w.items.length).toBeGreaterThan(0);
    const windowEnd = dueSoonWindowEnd(new Date(), TZ);
    for (const row of w.items) {
      const all = (await listFor(who, row.employeeId, listExtra)).filter(
        (t) => t.status !== "Done" && t.status !== "Cancelled",
      );
      const overdue = await listFor(who, row.employeeId, `${listExtra}&overdue=true`);
      const review = await listFor(who, row.employeeId, `${listExtra}&status=In%20Review`);
      const soon = all.filter(
        (t) =>
          !t.isOverdue && t.dueAt !== null && new Date(t.dueAt).getTime() < windowEnd.getTime(),
      );
      expect(row.activeCount, `active ${row.employeeId}`).toBe(all.length);
      expect(row.overdueCount, `overdue ${row.employeeId}`).toBe(overdue.length);
      expect(row.inReviewCount, `review ${row.employeeId}`).toBe(review.length);
      expect(row.dueSoon7dCount, `soon ${row.employeeId}`).toBe(soon.length);
    }
  }

  it("P1 · khớp số với GET /tasks — M và D, có/không projectId", async () => {
    await expectMatchesList("M", "", "");
    await expectMatchesList("M", `?projectId=${projectP}`, `&projectId=${projectP}`);
    await expectMatchesList("D", "", "");
    await expectMatchesList("D", `?projectId=${projectP}`, `&projectId=${projectP}`);
  });

  it("P2 · biên sắp hạn theo giờ công ty + maxOverdueDays = 3", async () => {
    const today = localDateOf(new Date(), TZ);
    const in7 = wallTimeToInstant(addDaysToLocalDate(today, 7), "23:59:00", TZ).toISOString();
    const at8 = wallTimeToInstant(addDaysToLocalDate(today, 8), "00:00:00", TZ).toISOString();
    await addTask(A.companyId, emp.N5 as string, { dueAt: in7 });
    await addTask(A.companyId, emp.N6 as string, { dueAt: at8 });
    const w = await workload("M");
    const n5 = w.items.find((r) => r.employeeId === emp.N5);
    const n6 = w.items.find((r) => r.employeeId === emp.N6);
    expect(n5?.dueSoon7dCount, "hạn hôm-nay+7 23:59 tính").toBe(1);
    expect(n6?.dueSoon7dCount, "hạn hôm-nay+8 00:00 KHÔNG tính").toBe(0);
    const n1 = w.items.find((r) => r.employeeId === emp.N1);
    expect(n1?.maxOverdueDays).toBe(3);
    expect(n1?.overdueCount).toBe(1);
    expect(w.items[0]?.employeeId, "sắp theo quá hạn giảm dần").toBe(emp.N1);
  });
});
