/**
 * S20-TASK-ALLOWEDACTIONS-1 — `allowedActions` của GET /tasks/:id khớp cổng THẬT của từng route chuyên
 * trách (plan docs/plans/S20-TASK-ALLOWEDACTIONS-1.md §4). App THẬT qua `applyMainPipeline`, engine quyền
 * THẬT, Postgres THẬT (lane cô lập). Cổng `hasDb && LANE_DB`. Không `Promise.all` quanh supertest.
 *
 * Người gọi (mỗi người một role riêng qua `grant()`):
 *  X  read@Own + update/update-status/update-state@Own, là người phụ trách T · X3 như X, phụ trách T3
 *  Y  read@Company + cùng cặp @Own, KHÔNG phụ trách/không thành viên, ĐANG theo dõi T
 *  Y2 cặp seed employee @Own, thành viên dự án `Member`, ĐANG theo dõi T
 *  Z  cặp như Y2, thành viên `Manager`, không phụ trách · M 8 cặp @Company · B công ty khác, 8 cặp @Company
 * Oracle: `allowedActions[k]` ⇔ route chuyên trách trả 2xx trên một việc mới mỗi lượt.
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
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { grant, seedEmployee, type Pair } from "../helpers/task-file-seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = loginPasswordFixture("s20aa");

type Caller = "X" | "X3" | "Y" | "Y2" | "Z" | "M" | "B";
type Key = "changeStatus" | "changeState" | "changeDeadline" | "changePriority" | "assign" | "edit";

const OWN_PAIRS: Pair[] = [
  ["read", "task"],
  ["update", "task"],
  ["update-status", "task"],
  ["update-state", "task"],
];
const ALL_PAIRS: Pair[] = [
  ...OWN_PAIRS,
  ["update-deadline", "task"],
  ["update-priority", "task"],
  ["assign", "task"],
  ["delete", "task"],
];
const WRITE_KEYS: Key[] = [
  "changeStatus",
  "changeState",
  "changeDeadline",
  "changePriority",
  "assign",
  "edit",
];

describe.skipIf(!runDb)("S20-TASK-ALLOWEDACTIONS-1 — allowedActions khớp cổng thật", () => {
  const direct: Pool = directPool();
  let nest: INestApplication;
  let A: SeededTenant;
  let Bt: SeededTenant;
  const token: Partial<Record<Caller, string>> = {};
  const uid: Record<string, string> = {};
  const emp: Record<string, string> = {};
  let project: string;
  let colA: string;
  let colB: string;
  let T: string;

  const http = () => request(nest.getHttpServer());
  const authed = (m: "get" | "post" | "patch" | "delete", who: Caller, path: string) =>
    http()[m](path).set("Authorization", `Bearer ${token[who]}`);
  const detail = async (who: Caller, id: string) => authed("get", who, `/tasks/${id}`);
  const actions = async (who: Caller, id: string) => {
    const r = await detail(who, id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return (r.body.data ?? r.body).allowedActions as Record<string, unknown> | undefined;
  };

  async function mkTask(o: {
    assignee?: string;
    status?: string;
    type?: string;
    withProject?: boolean;
    parent?: string;
    companyId?: string;
    watchers?: string[];
  }): Promise<string> {
    const companyId = o.companyId ?? A.companyId;
    const pj = o.withProject === false ? null : project;
    const r = await direct.query(
      `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id,
                          assignee_user_id, project_id, state_id, parent_task_id)
       VALUES ($1, $2, 'aa-task', $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        companyId,
        o.type ?? "office",
        o.status ?? "Todo",
        o.assignee ? emp[o.assignee] : null,
        o.assignee ? uid[o.assignee] : null,
        pj,
        pj ? colA : null,
        o.parent ?? null,
      ],
    );
    const id = r.rows[0].id as string;
    for (const w of o.watchers ?? []) {
      await direct.query(
        `INSERT INTO task_watchers (company_id, task_id, employee_id, watcher_type, status, added_by,
                                    created_by, updated_by)
         VALUES ($1, $2, $3, 'Manual', 'Active', $4, $4, $4)`,
        [companyId, id, emp[w], uid.M],
      );
    }
    return id;
  }

  /** Route chuyên trách của khoá `k` (body hợp lệ, đổi thật). */
  const oracle = (who: Caller, k: Key | "delete", id: string) => {
    switch (k) {
      case "changeStatus":
        return authed("post", who, `/tasks/${id}/change-status`).send({ status: "In Progress" });
      case "changeState":
        return authed("post", who, `/tasks/${id}/move-state`).send({ stateId: colB });
      case "changeDeadline":
        return authed("post", who, `/tasks/${id}/change-deadline`).send({
          dueAt: "2026-12-05T09:30:00.000Z",
        });
      case "changePriority":
        return authed("post", who, `/tasks/${id}/change-priority`).send({ priority: "Urgent" });
      case "assign":
        return authed("post", who, `/tasks/${id}/assign`).send({ assigneeEmployeeId: emp.Q });
      case "edit":
        return authed("patch", who, `/tasks/${id}`).send({ title: "aa-edited" });
      case "delete":
        return authed("delete", who, `/tasks/${id}`);
    }
  };
  const is2xx = (s: number) => s >= 200 && s < 300;

  beforeAll(async () => {
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "aaA");
    Bt = await seedCompany(direct, "aaB");
    for (const k of ["X", "X3", "Y", "Y2", "Z", "M", "Q"]) {
      uid[k] = await seedUser(direct, A.companyId, `${k.toLowerCase()}@${A.slug}.test`, hash);
    }
    uid.B = await seedUser(direct, Bt.companyId, `b@${Bt.slug}.test`, hash);

    await grant(direct, A.companyId, uid.X, OWN_PAIRS, "Own");
    await grant(direct, A.companyId, uid.X3, OWN_PAIRS, "Own");
    await grant(direct, A.companyId, uid.Y, [["read", "task"]], "Company");
    await grant(direct, A.companyId, uid.Y, OWN_PAIRS.slice(1), "Own");
    await grant(direct, A.companyId, uid.Y2, OWN_PAIRS, "Own");
    await grant(direct, A.companyId, uid.Z, OWN_PAIRS, "Own");
    await grant(direct, A.companyId, uid.M, ALL_PAIRS, "Company");
    await grant(direct, Bt.companyId, uid.B, ALL_PAIRS, "Company");
    for (const k of ["X", "X3", "Y", "Y2", "Z", "M", "Q"]) {
      emp[k] = await seedEmployee(direct, A.companyId, uid[k]);
    }

    const p = await direct.query(
      `INSERT INTO projects (company_id, name, project_status) VALUES ($1, 'aa-proj', 'Active') RETURNING id`,
      [A.companyId],
    );
    project = p.rows[0].id as string;
    for (const k of ["Y2", "Z"]) {
      await direct.query(
        `INSERT INTO project_members (company_id, project_id, user_id, employee_id, project_role, member_status)
         VALUES ($1, $2, $3, $4, $5, 'Active')`,
        [A.companyId, project, uid[k], emp[k], k === "Z" ? "Manager" : "Member"],
      );
    }
    const st = async (name: string, order: number) =>
      (
        await direct.query(
          `INSERT INTO project_states (company_id, project_id, name, state_group, sort_order)
           VALUES ($1, $2, $3, 'unstarted', $4) RETURNING id`,
          [A.companyId, project, name, order],
        )
      ).rows[0].id as string;
    colA = await st("aa-col-1", 90);
    colB = await st("aa-col-2", 91);
    T = await mkTask({ assignee: "X", watchers: ["Y", "Y2"] });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = applyMainPipeline(moduleRef.createNestApplication());
    await nest.init();
    await nest.listen(0);

    const logins: Array<[Caller, SeededTenant]> = [
      ["X", A],
      ["X3", A],
      ["Y", A],
      ["Y2", A],
      ["Z", A],
      ["M", A],
      ["B", Bt],
    ];
    for (const [k, tenant] of logins) {
      const res = await http()
        .post("/auth/login")
        .send({
          companySlug: tenant.slug,
          email: `${k.toLowerCase()}@${tenant.slug}.test`,
          password: LOGIN_PW,
        });
      expect(res.status, `login ${k}: ${JSON.stringify(res.body)}`).toBe(200);
      token[k] = res.body.data.accessToken as string;
    }
  });

  afterAll(async () => {
    if (nest) await nest.close();
    if (A && Bt) {
      const ids = [A.companyId, Bt.companyId];
      for (const tbl of [
        "task_activity_logs",
        "task_watchers",
        "task_assignees",
        "tasks",
        "project_states",
        "project_members",
        "projects",
      ]) {
        await direct
          .query(`DELETE FROM ${tbl} WHERE company_id = ANY($1::uuid[])`, [ids])
          .catch(() => undefined);
      }
      await cleanupTenants(direct, ids);
    }
    await direct.end();
  });

  // ── ALLOW đứng cạnh ────────────────────────────────────────────────────────────────────────────
  it("A1 · người phụ trách X: changeStatus/changeState/edit true; assign/hạn/ưu tiên/delete false", async () => {
    const a = await actions("X", T);
    expect(a).toMatchObject({
      changeStatus: true,
      changeState: true,
      edit: true,
      assign: false,
      changeDeadline: false,
      changePriority: false,
      delete: false,
    });
    expect(a?.lockReason ?? null).toBeNull();
  });

  it("A1b · Manager dự án Z (nhánh thành viên, mode write): status/state/edit true", async () => {
    const a = await actions("Z", T);
    expect(a).toMatchObject({ changeStatus: true, changeState: true, edit: true });
    expect(a).toMatchObject({
      assign: false,
      changeDeadline: false,
      changePriority: false,
      delete: false,
    });
  });

  it("A2 · M Company: 7 khoá true", async () => {
    const a = await actions("M", T);
    for (const k of [...WRITE_KEYS, "delete"]) expect(a?.[k], k).toBe(true);
  });

  // ── DENY ───────────────────────────────────────────────────────────────────────────────────────
  it("R1 · Y chỉ theo dõi (read@Company): khoá ghi false + lockReason watcher; change-status ⇒ 404, hàng không đổi", async () => {
    const t = await mkTask({ assignee: "X", watchers: ["Y"] });
    const a = await actions("Y", t);
    for (const k of [...WRITE_KEYS, "delete"]) expect(a?.[k], k).toBe(false);
    expect(a?.lockReason).toBe("watcher");
    const res = await oracle("Y", "changeStatus", t);
    expect(res.status).toBe(404);
    const row = await direct.query(`SELECT task_status FROM tasks WHERE id = $1`, [t]);
    expect(row.rows[0].task_status).toBe("Todo");
  });

  it("R1b · Y2 người theo dõi thật (thành viên Member): mọi khoá ghi false + watcher; change-status ⇒ 404", async () => {
    const t = await mkTask({ assignee: "X", watchers: ["Y2"] });
    const a = await actions("Y2", t);
    for (const k of [...WRITE_KEYS, "delete"]) expect(a?.[k], k).toBe(false);
    expect(a?.lockReason).toBe("watcher");
    expect((await oracle("Y2", "changeStatus", t)).status).toBe(404);
    const row = await direct.query(`SELECT task_status FROM tasks WHERE id = $1`, [t]);
    expect(row.rows[0].task_status).toBe("Todo");
  });

  it("R2 · công ty B: 404, thân trùng 404 của UUID ngẫu nhiên, không lộ allowedActions", async () => {
    const res = await detail("B", T);
    const ghost = await detail("B", "00000000-0000-4000-8000-000000000abc");
    expect(res.status).toBe(404);
    expect(ghost.status).toBe(404);
    const strip = (b: unknown) =>
      JSON.stringify(b)
        .replace(/,"meta":{.*}}$/, "}")
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>");
    expect(strip(res.body)).toBe(strip(ghost.body));
    expect(JSON.stringify(res.body)).not.toContain("allowedActions");
  });

  it("R3 · quyền vừa bị thu hồi: server vẫn 403, GET lại ⇒ changeStatus false", async () => {
    const t3 = await mkTask({ assignee: "X3" });
    expect((await actions("X3", t3))?.changeStatus).toBe(true);
    await direct.query(
      `DELETE FROM role_permissions rp USING permissions p, user_roles ur
        WHERE rp.permission_id = p.id AND p.action = 'update-status' AND p.resource_type = 'task'
          AND ur.role_id = rp.role_id AND ur.user_id = $1`,
      [uid.X3],
    );
    // Xoá qua directPool không đi qua outbox ⇒ PHẢI vô hiệu cache grant, không thì guard đọc grant cũ.
    await nest
      .get<{ invalidateUser(c: string, u: string): Promise<void> }>("CACHED_PERMISSION_REPO")
      .invalidateUser(A.companyId, uid.X3);
    const res = await oracle("X3", "changeStatus", t3);
    expect(res.status).toBe(403);
    expect((await actions("X3", t3))?.changeStatus).toBe(false);
  });

  it("R4 · việc Cancelled (M): hạn/ưu tiên/assign false; status/state/edit/delete true; change-priority ⇒ 422", async () => {
    const t = await mkTask({ assignee: "X", status: "Cancelled" });
    const a = await actions("M", t);
    expect([a?.assign, a?.changeDeadline, a?.changePriority]).toEqual([false, false, false]);
    expect([a?.changeStatus, a?.changeState, a?.edit, a?.delete]).toEqual([true, true, true, true]);
    expect((await oracle("M", "changePriority", t)).status).toBe(422);
  });

  it("R5 · việc workflow (M): mọi khoá false; oracle ⇒ 400", async () => {
    const t = await mkTask({ assignee: "X", type: "production" });
    const a = await actions("M", t);
    for (const k of [...WRITE_KEYS, "delete"]) expect(a?.[k], k).toBe(false);
    expect((await oracle("M", "changeStatus", t)).status).toBe(400);
  });

  it("R6 · việc con và việc không dự án (M): changeState false, move-state ⇒ 400; khoá khác theo cặp", async () => {
    const child = await mkTask({ assignee: "X", parent: T });
    const noProject = await mkTask({ assignee: "X", withProject: false });
    for (const t of [child, noProject]) {
      const a = await actions("M", t);
      expect(a?.changeState).toBe(false);
      expect(a?.changeStatus).toBe(true);
      expect((await oracle("M", "changeState", t)).status).toBe(400);
    }
  });

  // ── Oracle: allowedActions[k] ⇔ route 2xx ───────────────────────────────────────────────────────
  for (const who of ["X", "Y", "Y2", "Z", "M"] as const) {
    it(`O · ${who}: allowedActions[k] ⇔ route chuyên trách 2xx (việc mới mỗi lượt)`, async () => {
      for (const k of WRITE_KEYS) {
        const t = await mkTask({ assignee: "X", watchers: ["Y", "Y2"] });
        const a = await actions(who, t);
        const res = await oracle(who, k, t);
        expect(a?.[k] === true, `${who}.${k} allowed=${String(a?.[k])} status=${res.status}`).toBe(
          is2xx(res.status),
        );
      }
    });
  }

  it("O-del · M xoá việc ⇒ delete:true ⇔ 2xx · X trên việc của mình ⇒ delete:false ⇔ 403", async () => {
    const t = await mkTask({ assignee: "X" });
    expect((await actions("M", t))?.delete).toBe(true);
    expect(is2xx((await oracle("M", "delete", t)).status)).toBe(true);
    const t2 = await mkTask({ assignee: "X" });
    expect((await actions("X", t2))?.delete).toBe(false);
    expect((await oracle("X", "delete", t2)).status).toBe(403);
  });

  it("L · danh sách /tasks và /tasks/my KHÔNG có allowedActions", async () => {
    for (const path of ["/tasks", "/tasks/my"]) {
      const r = await authed("get", "M", path);
      expect(r.status, path).toBe(200);
      expect(JSON.stringify(r.body)).not.toContain("allowedActions");
    }
  });
});
