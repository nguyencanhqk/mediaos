/**
 * S20-SEC-GOALLINKGATE-1 — liên kết việc ↔ mục tiêu: cùng dữ liệu, cùng quyết định quyền (GOAL-API-010).
 * 🔴 Crown-jewel (permission / data-scope — FULL gate). Plan `docs/plans/S20-SEC-GOALLINKGATE-1.md` §4.
 *
 * Bất biến được kiểm:
 *  · I-1 việc đang thuộc mục tiêu A khi gắn sang mục tiêu B ⇒ A nhận ĐÚNG lớp quyết định mà đường tháo
 *        `DELETE /goals/A/tasks/:taskId` đưa ra cho cùng người gọi, cùng dữ liệu (quyền ghi + chưa chốt kỳ).
 *        Ngoại lệ ghi rõ: A đã xoá mềm ⇒ cho, và vẫn ghi audit ở A.
 *  · I-2 mục tiêu đích chỉ nhận việc khi trạng thái ∈ {Draft, Active} (quyết định owner 25/10/2026).
 *  · I-3 từ chối ⇒ 0 hàng `tasks` đổi, 0 hàng audit mới — tất-cả-hoặc-không cho cả lô.
 *  · I-4 chuyển thành công ⇒ audit ở CẢ HAI mục tiêu + tiến độ tính lại ở cả hai.
 *  · I-5 kiểm + ghi trên hàng ĐÃ KHOÁ trong một transaction (ca đua R7/R8/R9).
 *  · I-6 cô lập tenant giữ nguyên.
 *
 * Vai trò TỰ TẠO (tiền tố riêng của spec; cặp + phạm vi là dữ liệu fixture, không phải vai trò chính tắc):
 *  · P-Dept = update:goal@Department + view:goal@Company + update:task@Company + read:task@Company
 *  · P-Own  = update:goal@Own + update:task@Own + view:goal@Department + read:task@Own
 *  · P-Co   = mọi cặp @Company
 * (`access:goal` cấp cho cả ba — cặp cửa module, không tham gia quyết định phạm vi ghi.)
 *
 * Fixture: mỗi probe ghi dữ liệu dùng hàng MỚI (việc + mục tiêu riêng) — không probe nào đọc kết quả ghi
 * của probe khác. Mục tiêu cũ của probe từ chối quyền: KHÔNG cấp dự án, người phụ trách ≠ người gọi, việc
 * không thuộc dự án — assert lại trên hàng DB (`assertNoSideGrant`). Ca đua: holder trên pool RIÊNG,
 * `waitForBlockedBy` (cạnh chặn thật `pg_blocking_pids`) — hết trần ⇒ ĐỎ có nhãn, không bao giờ xanh-rỗng.
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { directPool, directUrl, hasDb } from "../helpers/integration-db";
import { waitForBlockedBy } from "../helpers/lock-wait";
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

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = ["Passw0rd", "goallinkgate", "x"].join("!");
const PREFIX = "goal-linkgate";
/** Trần chờ request vào trạng thái bị CHÍNH holder chặn. */
const WAIT_LOCK_MS = 5_000;
/** Ca đua: giữ khoá + chờ + commit + request — trần riêng rộng hơn `testTimeout`. */
const RACE_TIMEOUT_MS = 30_000;

type Scope = "Own" | "Department" | "Company";
type Pair = readonly [action: string, resource: string, scope: Scope];

const P_DEPT: readonly Pair[] = [
  ["access", "goal", "Company"],
  ["update", "goal", "Department"],
  ["view", "goal", "Company"],
  ["update", "task", "Company"],
  ["read", "task", "Company"],
];
const P_OWN: readonly Pair[] = [
  ["access", "goal", "Company"],
  ["update", "goal", "Own"],
  ["update", "task", "Own"],
  ["view", "goal", "Department"],
  ["read", "task", "Own"],
];
const P_CO: readonly Pair[] = [
  ["access", "goal", "Company"],
  ["update", "goal", "Company"],
  ["view", "goal", "Company"],
  ["update", "task", "Company"],
  ["read", "task", "Company"],
];

function todayShift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const PERIOD = { start: todayShift(-30), end: todayShift(60) };

interface Emp {
  userId: string;
  empId: string;
}
interface Actor extends Emp {
  token: string;
}

interface GoalSeed {
  level?: "department" | "employee";
  departmentId?: string;
  employeeId?: string;
  ownerEmployeeId: string;
  status?: "Draft" | "Active" | "Completed" | "Cancelled";
  progressPercent?: number | null;
  finalized?: boolean;
  deleted?: boolean;
  companyId?: string;
}

interface TaskSeed {
  assignee?: string | null;
  departmentId?: string | null;
  status?: "Todo" | "Done";
  goalId?: string | null;
  companyId?: string;
}

interface AuditRow {
  object_id: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** Mã lỗi GOAL trong thân phản hồi (thông điệp mang mã ở đầu — `goals.errors.ts`). */
function errCode(res: request.Response): string | null {
  return JSON.stringify(res.body).match(/GOAL-ERR-[0-9A-Z]+(?:-[0-9A-Z]+)*/)?.[0] ?? null;
}

/** Lớp quyết định: «cho phép» (mọi 2xx — POST 201, DELETE 200) hoặc «từ chối + HTTP + mã GOAL-ERR». */
function decisionOf(res: request.Response): string {
  return res.status < 300 ? "allow" : `deny ${res.status} ${errCode(res)}`;
}

function expectDenied(res: request.Response, status: number, code: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(errCode(res), JSON.stringify(res.body)).toBe(code);
}

describe.skipIf(!hasLaneDb)("S20-SEC-GOALLINKGATE-1 · liên kết việc–mục tiêu (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let ouX = "";
  let ouY = "";
  let ouB = "";
  let dept: Actor;
  let own: Actor;
  let co: Actor;
  /** Người phụ trách các mục tiêu phòng X / phòng Y — KHÔNG phải người gọi nào. */
  let peerX: Emp;
  let peerY: Emp;
  let empB: Emp;

  const http = () => request(app.getHttpServer());
  const link = (a: Actor, goalId: string, taskIds: string[]) =>
    http()
      .post(`/goals/${goalId}/tasks`)
      .set("Authorization", `Bearer ${a.token}`)
      .send({ taskIds });
  const unlink = (a: Actor, goalId: string, taskId: string) =>
    http().delete(`/goals/${goalId}/tasks/${taskId}`).set("Authorization", `Bearer ${a.token}`);

  async function mkOu(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function mkEmp(companyId: string, email: string, ou: string, hash: string): Promise<Emp> {
    const userId = await seedUser(direct, companyId, email, hash);
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [companyId, userId, ou],
    );
    return { userId, empId: r.rows[0].id as string };
  }

  async function mkActor(label: string, pairs: readonly Pair[], hash: string): Promise<Actor> {
    const email = `${label}@${A.slug}.test`;
    const emp = await mkEmp(A.companyId, email, ouX, hash);
    const roleId = await seedRole(direct, A.companyId, `${PREFIX}-${label}`);
    for (const [action, resource, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, emp.userId, roleId, A.companyId);
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${label}: ${JSON.stringify(res.body)}`).toBe(200);
    return { ...emp, token: res.body.data.accessToken as string };
  }

  async function seedGoal(s: GoalSeed): Promise<string> {
    const level = s.level ?? "department";
    const r = await direct.query(
      `INSERT INTO goals (company_id, goal_code, name, level, department_id, employee_id,
                          owner_employee_id, period_type, period_start, period_end, progress_mode,
                          status, progress_percent, finalized_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'quarter',$8,$9,'tasks',$10,$11,
               CASE WHEN $12::boolean THEN now() END, CASE WHEN $13::boolean THEN now() END)
       RETURNING id`,
      [
        s.companyId ?? A.companyId,
        `GLG-${randomUUID().slice(0, 8)}`,
        `Mục tiêu ${randomUUID().slice(0, 6)}`,
        level,
        level === "department" ? s.departmentId : null,
        level === "employee" ? s.employeeId : null,
        s.ownerEmployeeId,
        PERIOD.start,
        PERIOD.end,
        s.status ?? "Active",
        s.progressPercent ?? null,
        s.finalized ?? false,
        s.deleted ?? false,
      ],
    );
    return r.rows[0].id as string;
  }

  async function seedTask(s: TaskSeed = {}): Promise<string> {
    const r = await direct.query(
      `INSERT INTO tasks (company_id, title, task_type, task_status, main_assignee_employee_id,
                          department_id, goal_id)
       VALUES ($1,$2,'office',$3,$4,$5,$6) RETURNING id`,
      [
        s.companyId ?? A.companyId,
        `Việc ${randomUUID().slice(0, 6)}`,
        s.status ?? "Todo",
        s.assignee ?? null,
        s.departmentId ?? null,
        s.goalId ?? null,
      ],
    );
    return r.rows[0].id as string;
  }

  async function goalIdOf(taskId: string): Promise<string | null> {
    const r = await direct.query("SELECT goal_id FROM tasks WHERE id = $1", [taskId]);
    return (r.rows[0]?.goal_id as string | null) ?? null;
  }

  async function progressOf(goalId: string): Promise<number | null> {
    const r = await direct.query("SELECT progress_percent FROM goals WHERE id = $1", [goalId]);
    const v = r.rows[0]?.progress_percent as string | null;
    return v === null || v === undefined ? null : Number(v);
  }

  /** Hàng audit liên kết việc–mục tiêu trên các mục tiêu cho trước (append-only, đọc bằng direct). */
  async function auditOf(goalIds: string[]): Promise<AuditRow[]> {
    const r = await direct.query(
      `SELECT object_id, action, before, after FROM audit_logs
        WHERE object_type = 'goal' AND object_id = ANY($1::uuid[])
          AND action IN ('GoalTaskLinked','GoalTaskUnlinked')
        ORDER BY created_at, id`,
      [goalIds],
    );
    return r.rows as AuditRow[];
  }

  /**
   * Tiền điều kiện của probe từ chối quyền (plan §4 «Ràng buộc fixture»): mục tiêu cũ KHÔNG cấp dự án
   * (không nhánh vai trò dự án), người phụ trách ≠ người gọi (không nhánh người phụ trách), chưa xoá,
   * chưa chốt; việc không thuộc dự án nào. Thiếu một điều ⇒ probe không đo được cổng đang xét.
   */
  async function assertNoSideGrant(goalId: string, actor: Actor, taskId: string): Promise<void> {
    const g = await direct.query(
      "SELECT level, owner_employee_id, deleted_at, finalized_at FROM goals WHERE id = $1",
      [goalId],
    );
    expect(g.rows[0].level).not.toBe("project");
    expect(g.rows[0].owner_employee_id).not.toBe(actor.empId);
    expect(g.rows[0].deleted_at).toBeNull();
    expect(g.rows[0].finalized_at).toBeNull();
    const t = await direct.query("SELECT project_id FROM tasks WHERE id = $1", [taskId]);
    expect(t.rows[0].project_id).toBeNull();
  }

  /**
   * Ca đua (plan §4): holder trên pool RIÊNG mở tx + đổi ĐÚNG 1 hàng (giữ khoá, chưa commit) → phóng
   * request → chờ request bị CHÍNH holder chặn → COMMIT → trả phản hồi. `finally`: ROLLBACK nếu chưa
   * commit (request đang chờ chính khoá này), chờ request xong, rồi `end()` pool.
   */
  async function raceAgainst(
    holderSql: string,
    params: readonly unknown[],
    fire: () => request.Test,
  ): Promise<request.Response> {
    const pool = new Pool({ connectionString: directUrl, max: 2 });
    let settled: Promise<unknown> | undefined;
    try {
      const client = await pool.connect();
      let open = false;
      try {
        await client.query("BEGIN");
        open = true;
        await client.query("SET LOCAL lock_timeout = '5s'");
        const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
        const held = await client.query(holderSql, [...params]);
        expect(held.rowCount, "holder phải đổi ĐÚNG 1 hàng").toBe(1);
        const reqP = fire().then((r) => r);
        settled = Promise.allSettled([reqP]);
        expect(
          await waitForBlockedBy(pool, pid, 1, { timeoutMs: WAIT_LOCK_MS }),
          "request phải bị CHÍNH holder chặn (pg_blocking_pids) — không chồng lấp ⇒ ĐỎ",
        ).toBe(true);
        await client.query("COMMIT");
        open = false;
        return await reqP;
      } finally {
        if (open) {
          await client.query("ROLLBACK").then(
            () => client.release(),
            (err: Error) => client.release(err),
          );
        } else {
          client.release();
        }
      }
    } finally {
      if (settled) await settled;
      await pool.end();
    }
  }

  /** Mục tiêu phòng X (người phụ trách peerX) — trong phạm vi ghi của P-Dept và P-Co. */
  const goalInX = (extra: Partial<GoalSeed> = {}) =>
    seedGoal({ departmentId: ouX, ownerEmployeeId: peerX.empId, ...extra });
  /** Mục tiêu phòng Y (người phụ trách peerY) — ngoài phạm vi ghi của P-Dept và P-Own. */
  const goalInY = (extra: Partial<GoalSeed> = {}) =>
    seedGoal({ departmentId: ouY, ownerEmployeeId: peerY.empId, ...extra });
  /** Mục tiêu cá nhân của chính người gọi P-Own. */
  const ownGoal = () =>
    seedGoal({ level: "employee", employeeId: own.empId, ownerEmployeeId: own.empId });

  /**
   * Fixture tiến độ (plan §4, ca A1/A3): hai mục tiêu `progress_mode='tasks'`; mục tiêu cũ giữ một việc
   * Done (sẽ chuyển) + một việc chưa Done ⇒ cũ 50, mới null (gắn qua API của P-Co để engine tự tính).
   */
  async function progressFixture(): Promise<{ oldGoal: string; target: string; tMove: string }> {
    const oldGoal = await goalInX();
    const target = await goalInX();
    const tMove = await seedTask({ departmentId: ouX, status: "Done" });
    const tStay = await seedTask({ departmentId: ouX });
    const seeded = await link(co, oldGoal, [tMove, tStay]);
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(201);
    expect(await progressOf(oldGoal)).toBe(50);
    expect(await progressOf(target)).toBeNull();
    return { oldGoal, target, tMove };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    await app.listen(0);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, PREFIX);
    B = await seedCompany(direct, `${PREFIX}-b`);
    companyIds.push(A.companyId, B.companyId);

    ouX = await mkOu(A.companyId, "Phòng X");
    ouY = await mkOu(A.companyId, "Phòng Y");
    ouB = await mkOu(B.companyId, "Phòng của công ty B");
    peerX = await mkEmp(A.companyId, `peer-x@${A.slug}.test`, ouX, hash);
    peerY = await mkEmp(A.companyId, `peer-y@${A.slug}.test`, ouY, hash);
    empB = await mkEmp(B.companyId, `emp@${B.slug}.test`, ouB, hash);

    dept = await mkActor("p-dept", P_DEPT, hash);
    own = await mkActor("p-own", P_OWN, hash);
    co = await mkActor("p-co", P_CO, hash);
  }, 180_000);

  afterAll(async () => {
    if (companyIds.length > 0) {
      await direct.query("UPDATE tasks SET goal_id = NULL WHERE company_id = ANY($1::uuid[])", [
        companyIds,
      ]);
      await direct.query("DELETE FROM goal_updates WHERE company_id = ANY($1::uuid[])", [
        companyIds,
      ]);
      await direct.query("DELETE FROM goals WHERE company_id = ANY($1::uuid[])", [companyIds]);
      await cleanupTenants(direct, companyIds);
    }
    await direct.end();
    await app.close();
  });

  // ── I-1 · mục tiêu đang giữ việc nhận cùng quyết định với đường tháo ─────────────────────────
  describe("I-1 · mục tiêu đang giữ việc", () => {
    it("R1 · mục tiêu đang giữ việc ngoài phạm vi ghi (phạm vi phòng) ⇒ 403, liên kết giữ, 0 audit mới", async () => {
      const oldGoal = await goalInY();
      const target = await goalInX();
      const t = await seedTask({ departmentId: ouY, assignee: peerY.empId, goalId: oldGoal });
      await assertNoSideGrant(oldGoal, dept, t);
      expect(await goalIdOf(t)).toBe(oldGoal);
      const before = await auditOf([oldGoal, target]);

      expectDenied(await link(dept, target, [t]), 403, "GOAL-ERR-FORBIDDEN");
      expect(await goalIdOf(t)).toBe(oldGoal);
      expect(await auditOf([oldGoal, target])).toHaveLength(before.length);
    });

    it("A1 · mục tiêu đang giữ việc trong phạm vi ghi (phạm vi phòng) ⇒ 201, tiến độ tính lại ở cả hai", async () => {
      const { oldGoal, target, tMove } = await progressFixture();

      const res = await link(dept, target, [tMove]);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.linked).toBe(1);
      expect(await goalIdOf(tMove)).toBe(target);
      expect(await progressOf(oldGoal)).toBe(0);
      expect(await progressOf(target)).toBe(100);
      const atTarget = await auditOf([target]);
      expect(atTarget).toHaveLength(1);
      expect(atTarget[0].action).toBe("GoalTaskLinked");
      expect(atTarget[0].after?.previousGoalId).toBe(oldGoal);
    });

    it("R2 · mục tiêu đang giữ việc ngoài phạm vi ghi (phạm vi cá nhân; mục tiêu phòng) ⇒ 403, liên kết giữ", async () => {
      const oldGoal = await goalInX();
      const target = await ownGoal();
      const t = await seedTask({ departmentId: ouX, assignee: own.empId, goalId: oldGoal });
      await assertNoSideGrant(oldGoal, own, t);
      expect(await goalIdOf(t)).toBe(oldGoal);

      expectDenied(await link(own, target, [t]), 403, "GOAL-ERR-FORBIDDEN");
      expect(await goalIdOf(t)).toBe(oldGoal);
    });

    it("A2 · mục tiêu đang giữ việc là mục tiêu cá nhân của chính người gọi (phạm vi cá nhân) ⇒ 201", async () => {
      const oldGoal = await ownGoal();
      const target = await ownGoal();
      const t = await seedTask({ assignee: own.empId, goalId: oldGoal });

      const res = await link(own, target, [t]);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await goalIdOf(t)).toBe(target);
    });

    it.each(["p-dept", "p-own", "p-co"] as const)(
      "P1 · cùng người gọi + cùng dữ liệu ⇒ tháo và chuyển nhận CÙNG lớp quyết định ở mục tiêu cũ (%s)",
      async (key) => {
        const actor = key === "p-dept" ? dept : key === "p-own" ? own : co;
        const mkTarget = () => (key === "p-own" ? ownGoal() : goalInX());
        const mkHeld = async () => {
          const oldGoal = await goalInY();
          const t = await seedTask({ departmentId: ouY, assignee: actor.empId, goalId: oldGoal });
          await assertNoSideGrant(oldGoal, actor, t);
          expect(await goalIdOf(t)).toBe(oldGoal);
          return { oldGoal, t };
        };

        // Đối chứng: đích nhận việc tự do của cùng người gọi ⇒ mọi khác biệt dưới đây đến từ mục tiêu cũ.
        const control = await link(actor, await mkTarget(), [
          await seedTask({ assignee: actor.empId }),
        ]);
        expect(control.status, JSON.stringify(control.body)).toBe(201);

        const a = await mkHeld();
        const viaUnlink = decisionOf(await unlink(actor, a.oldGoal, a.t));
        const b = await mkHeld();
        const viaMove = decisionOf(await link(actor, await mkTarget(), [b.t]));
        expect(viaMove, `tháo: ${viaUnlink} · chuyển: ${viaMove}`).toBe(viaUnlink);
      },
    );

    it("R3 · mục tiêu đang giữ việc đã chốt kỳ ⇒ 422 GOAL-ERR-005, liên kết giữ, 0 audit mới", async () => {
      const oldGoal = await goalInX({ finalized: true });
      const target = await goalInX();
      const t = await seedTask({ departmentId: ouX, goalId: oldGoal });
      const before = await auditOf([oldGoal, target]);

      expectDenied(await link(co, target, [t]), 422, "GOAL-ERR-005");
      expect(await goalIdOf(t)).toBe(oldGoal);
      expect(await auditOf([oldGoal, target])).toHaveLength(before.length);
    });

    it("A5 · mục tiêu đang giữ việc đã xoá mềm ⇒ 201, audit ghi ở cả mục tiêu đã xoá", async () => {
      const oldGoal = await goalInX({ deleted: true });
      const target = await goalInX();
      const t = await seedTask({ departmentId: ouX, goalId: oldGoal });

      const res = await link(co, target, [t]);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await goalIdOf(t)).toBe(target);
      const atOld = (await auditOf([oldGoal])).filter((r) => r.action === "GoalTaskUnlinked");
      expect(atOld, "audit ở mục tiêu cũ (đã xoá mềm)").toHaveLength(1);
      expect(atOld[0].after?.movedToGoalId).toBe(target);
      expect(atOld[0].before?.taskId).toBe(t);
    });
  });

  // ── I-4 · chuyển thành công ghi dấu ở cả hai đầu ──────────────────────────────────────────────
  describe("I-4 · audit + tiến độ ở cả hai mục tiêu", () => {
    it("A3 · chuyển việc giữa hai mục tiêu chưa chốt ⇒ 201, audit ở mục tiêu cũ mang đích mới, tiến độ cả hai", async () => {
      const { oldGoal, target, tMove } = await progressFixture();

      const res = await link(co, target, [tMove]);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await progressOf(oldGoal)).toBe(0);
      expect(await progressOf(target)).toBe(100);
      const atOld = (await auditOf([oldGoal])).filter((r) => r.action === "GoalTaskUnlinked");
      expect(atOld, "audit ở mục tiêu cũ").toHaveLength(1);
      expect(atOld[0].after?.movedToGoalId).toBe(target);
      expect(atOld[0].before?.taskId).toBe(tMove);
      const atTarget = await auditOf([target]);
      expect(atTarget.map((r) => r.action)).toEqual(["GoalTaskLinked"]);
      expect(atTarget[0].after?.previousGoalId).toBe(oldGoal);
    });
  });

  // ── I-2 · trạng thái mục tiêu đích ──────────────────────────────────────────────────────────
  describe("I-2 · trạng thái mục tiêu đích", () => {
    it.each([
      ["R4", "Completed"],
      ["R5", "Cancelled"],
    ] as const)(
      "%s · mục tiêu đích %s ⇒ 422 GOAL-ERR-016, 0 hàng đổi, 0 audit",
      async (_ca, status) => {
        const target = await goalInX({ status });
        const t = await seedTask({ departmentId: ouX });

        expectDenied(await link(co, target, [t]), 422, "GOAL-ERR-016");
        expect(await goalIdOf(t)).toBeNull();
        expect(await auditOf([target])).toHaveLength(0);
      },
    );

    it("A4 · mục tiêu đích Draft ⇒ 201 (quyết định owner)", async () => {
      const target = await goalInX({ status: "Draft" });
      const t = await seedTask({ departmentId: ouX });

      const res = await link(co, target, [t]);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await goalIdOf(t)).toBe(target);
    });
  });

  // ── I-3 · tất-cả-hoặc-không ─────────────────────────────────────────────────────────────────
  describe("I-3 · lô tất-cả-hoặc-không", () => {
    it("R6 · lô có một việc vi phạm I-1 ⇒ 422, việc hợp lệ cùng lô KHÔNG đổi, 0 audit", async () => {
      const oldGoal = await goalInX({ finalized: true });
      const target = await goalInX();
      const tFree = await seedTask({ departmentId: ouX });
      const tHeld = await seedTask({ departmentId: ouX, goalId: oldGoal });
      const before = await auditOf([oldGoal, target]);

      expectDenied(await link(co, target, [tFree, tHeld]), 422, "GOAL-ERR-005");
      expect(await goalIdOf(tFree)).toBeNull();
      expect(await goalIdOf(tHeld)).toBe(oldGoal);
      expect(await auditOf([oldGoal, target])).toHaveLength(before.length);
    });
  });

  // ── I-5 · quyết định trên hàng đã khoá ──────────────────────────────────────────────────────
  describe("I-5 · đồng thời với một writer khác trên cùng hàng", () => {
    it(
      "R7 · mục tiêu đang giữ việc được chốt kỳ đồng thời ⇒ 422 GOAL-ERR-005, liên kết giữ",
      async () => {
        // progress_percent = 0 khớp dữ liệu (1 việc chưa Done) — giá trị thật, không phải số giả.
        const oldGoal = await goalInX({ progressPercent: 0 });
        const target = await goalInX();
        const t = await seedTask({ departmentId: ouX, goalId: oldGoal });

        const res = await raceAgainst(
          `UPDATE goals SET finalized_at = now()
            WHERE company_id = $1 AND id = $2 AND finalized_at IS NULL`,
          [A.companyId, oldGoal],
          () => link(co, target, [t]),
        );
        expectDenied(res, 422, "GOAL-ERR-005");
        expect(await goalIdOf(t)).toBe(oldGoal);
      },
      RACE_TIMEOUT_MS,
    );

    it(
      "R8 · liên kết của việc đổi đồng thời sang mục tiêu ngoài phạm vi ghi ⇒ 403, giữ giá trị writer kia đã commit",
      async () => {
        const oldGoal = await goalInX();
        const outGoal = await goalInY();
        const target = await goalInX();
        const t = await seedTask({ departmentId: ouX, goalId: oldGoal });
        await assertNoSideGrant(outGoal, dept, t);
        expect(await goalIdOf(t)).toBe(oldGoal);

        const res = await raceAgainst(
          "UPDATE tasks SET goal_id = $3 WHERE company_id = $1 AND id = $2",
          [A.companyId, t, outGoal],
          () => link(dept, target, [t]),
        );
        expectDenied(res, 403, "GOAL-ERR-FORBIDDEN");
        expect(await goalIdOf(t)).toBe(outGoal);
      },
      RACE_TIMEOUT_MS,
    );

    it(
      "R9 · mục tiêu đích được chốt kỳ đồng thời ⇒ 422 GOAL-ERR-005, việc không được gắn",
      async () => {
        const target = await goalInX();
        const t = await seedTask({ departmentId: ouX });

        const res = await raceAgainst(
          `UPDATE goals SET finalized_at = now()
            WHERE company_id = $1 AND id = $2 AND finalized_at IS NULL`,
          [A.companyId, target],
          () => link(co, target, [t]),
        );
        expectDenied(res, 422, "GOAL-ERR-005");
        expect(await goalIdOf(t)).toBeNull();
      },
      RACE_TIMEOUT_MS,
    );
  });

  // ── I-6 · cô lập tenant + hồi quy đường tháo ────────────────────────────────────────────────
  describe("I-6 · cô lập tenant · hồi quy đường tháo", () => {
    it("X1 · việc của công ty khác (đang gắn mục tiêu của công ty đó) ⇒ 404, hàng công ty kia không đổi", async () => {
      const goalOfB = await seedGoal({
        companyId: B.companyId,
        departmentId: ouB,
        ownerEmployeeId: empB.empId,
      });
      const taskOfB = await seedTask({ companyId: B.companyId, goalId: goalOfB });
      const target = await goalInX();

      const res = await link(co, target, [taskOfB]);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(await goalIdOf(taskOfB)).toBe(goalOfB);
      expect(await auditOf([goalOfB, target])).toHaveLength(0);
    });

    it("X2 · mục tiêu đích của công ty khác ⇒ 404, việc không đổi", async () => {
      const goalOfB = await seedGoal({
        companyId: B.companyId,
        departmentId: ouB,
        ownerEmployeeId: empB.empId,
      });
      const t = await seedTask({ departmentId: ouX });

      const res = await link(co, goalOfB, [t]);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(await goalIdOf(t)).toBeNull();
    });

    it("U1 · tháo việc khỏi mục tiêu đã chốt kỳ ⇒ 422 GOAL-ERR-005, liên kết giữ", async () => {
      const oldGoal = await goalInX({ finalized: true });
      const t = await seedTask({ departmentId: ouX, goalId: oldGoal });

      expectDenied(await unlink(co, oldGoal, t), 422, "GOAL-ERR-005");
      expect(await goalIdOf(t)).toBe(oldGoal);
    });
  });
});
