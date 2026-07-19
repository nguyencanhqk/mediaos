/**
 * S5-TASK-DETAIL-1 — Integration (Postgres THẬT, DB CÔ LẬP): tách gate lịch sử nghiệp vụ task
 * (GAP 2, DECISIONS-04 D-29) + GET /tasks/:id/watchers (GAP 4).
 *
 * Phủ activity (GET /tasks/:id/activity — guard read:task + service involvement/audit-pair):
 *   V1 assignee (read:task, KHÔNG pair audit) → 200 + thấy dòng log.
 *   V2 creator → 200 · V3 reporter → 200 · V4 watcher Active → 200.
 *   V5 NGOÀI CUỘC (read:task, không liên quan) → 403 TASK-ERR-042 (deny-path THẬT).
 *   V6 pair audit (hr-style: view:task-audit-log + read:task) → 200 với task KHÔNG liên quan.
 *   V7 pair audit mà THIẾU read:task → 403 (hệ quả D-29.4 — pin tường minh, seed thật luôn cấp cả hai).
 *   V8 cross-tenant taskId B → 404 (không lộ tồn tại).
 *   V9 enrich: log đổi assignee chỉ lưu employeeId → DTO trả kèm assigneeName (GAP 1 server-side).
 *   V10 task soft-deleted: người liên quan VẪN đọc được (ledger durability).
 *
 * Phủ watchers (GET/POST/DELETE /tasks/:id/watchers — gate watch:task):
 *   W1 vòng đời: POST tự theo dõi → GET thấy mình (employeeName+userId) → DELETE id của mình 204 → GET rỗng.
 *   W2 GET thiếu watch:task → 403 (PermissionGuard).
 *   W3 GET cross-tenant taskId B → 404.
 *   W4 DELETE watcher NGƯỜI KHÁC → 404 (self-only, không lộ).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/tasks →
 * vitest include src/**\/*.spec.ts. app.close() TRƯỚC cleanup (chống FK 23503 outbox-flake).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../auth/password.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";

describe.skipIf(!runDb)(
  "S5-TASK-DETAIL-1 — activity involvement (D-29) + watchers list (deny-path + cô lập tenant)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    // users theo vai
    let uAssignee = "";
    let uCreator = "";
    let uReporter = "";
    let uWatcher = "";
    let uWatcher2 = "";
    let uOutsider = "";
    let uAudit = "";
    let uAuditNoRead = "";
    // employees
    let eAssignee = "";
    let eReporter = "";
    let eWatcher = "";
    // tasks
    let T1 = ""; // task chính: assignee/creator/reporter/watcher đều liên quan
    let T2 = ""; // task soft-deleted, assignee liên quan
    let T3 = ""; // task cho vòng đời watcher W1 (không đụng bộ watcher của T1)
    let TB = ""; // tenant B
    let watcherRowT1 = ""; // watcher planted của uWatcher trên T1 (V4 + W4)
    let logStatusId = "";

    const tokens = new Map<string, string>();

    async function seedEmp(companyId: string, userId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id`,
        [companyId, userId],
      );
      return r.rows[0].id as string;
    }

    async function grantPairs(
      companyId: string,
      userId: string,
      pairs: Array<[string, string, boolean]>,
    ): Promise<void> {
      const role = await seedRole(direct, companyId, `tdw-${randomUUID().slice(0, 8)}`);
      for (const [action, resource, sensitive] of pairs) {
        const perm = await seedPermissionCatalog(direct, action, resource, sensitive);
        await seedRolePermission(direct, role, perm, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, role, companyId);
    }

    async function plantTask(opts: {
      companyId: string;
      title: string;
      assigneeEmployeeId?: string | null;
      assigneeUserId?: string | null;
      creatorUserId?: string | null;
      reporterEmployeeId?: string | null;
      deleted?: boolean;
    }): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id,
                            assignee_user_id, creator_user_id, reporter_employee_id, deleted_at)
         VALUES ($1,'office',$2,'Todo',$3,$4,$5,$6,$7) RETURNING id`,
        [
          opts.companyId,
          opts.title,
          opts.assigneeEmployeeId ?? null,
          opts.assigneeUserId ?? null,
          opts.creatorUserId ?? null,
          opts.reporterEmployeeId ?? null,
          opts.deleted ? new Date().toISOString() : null,
        ],
      );
      return r.rows[0].id as string;
    }

    async function plantWatcher(
      companyId: string,
      taskId: string,
      employeeId: string,
      byUserId: string,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO task_watchers (company_id, task_id, employee_id, watcher_type, status, added_by, created_by, updated_by)
         VALUES ($1,$2,$3,'Manual','Active',$4,$4,$4) RETURNING id`,
        [companyId, taskId, employeeId, byUserId],
      );
      return r.rows[0].id as string;
    }

    async function plantActivity(
      companyId: string,
      taskId: string,
      action: string,
      oldValues: unknown,
      newValues: unknown,
      createdAt: string,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO task_activity_logs (company_id, task_id, action, target_type, old_values, new_values, created_at)
         VALUES ($1,$2,$3,'Task',$4,$5,$6) RETURNING id`,
        [
          companyId,
          taskId,
          action,
          oldValues === null ? null : JSON.stringify(oldValues),
          newValues === null ? null : JSON.stringify(newValues),
          createdAt,
        ],
      );
      return r.rows[0].id as string;
    }

    async function login(slug: string, email: string): Promise<string> {
      const cached = tokens.get(email);
      if (cached) return cached;
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      const token = res.body.data.accessToken as string;
      tokens.set(email, token);
      return token;
    }

    function get(token: string, url: string) {
      return request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);
    }
    function post(token: string, url: string) {
      return request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`);
    }
    function del(token: string, url: string) {
      return request(app.getHttpServer()).delete(url).set("Authorization", `Bearer ${token}`);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);

      A = await seedCompany(direct, "tdwA");
      B = await seedCompany(direct, "tdwB");
      companyIds.push(A.companyId, B.companyId);

      uAssignee = await seedUser(direct, A.companyId, `assignee@${A.slug}.test`, hash);
      uCreator = await seedUser(direct, A.companyId, `creator@${A.slug}.test`, hash);
      uReporter = await seedUser(direct, A.companyId, `reporter@${A.slug}.test`, hash);
      uWatcher = await seedUser(direct, A.companyId, `watcher@${A.slug}.test`, hash);
      uWatcher2 = await seedUser(direct, A.companyId, `watcher2@${A.slug}.test`, hash);
      uOutsider = await seedUser(direct, A.companyId, `outsider@${A.slug}.test`, hash);
      uAudit = await seedUser(direct, A.companyId, `audit@${A.slug}.test`, hash);
      uAuditNoRead = await seedUser(direct, A.companyId, `auditnoread@${A.slug}.test`, hash);

      // Tên để assert enrich (users.full_name — nguồn tên qua employee_profiles.user_id).
      await direct.query(`UPDATE users SET full_name = 'Ngô Assignee' WHERE id = $1`, [uAssignee]);
      await direct.query(`UPDATE users SET full_name = 'Trần Watcher' WHERE id = $1`, [uWatcher]);

      eAssignee = await seedEmp(A.companyId, uAssignee);
      eReporter = await seedEmp(A.companyId, uReporter);
      eWatcher = await seedEmp(A.companyId, uWatcher);
      // uWatcher2 cần hồ sơ nhân viên để W4 đi vào nhánh so-khớp chủ-watcher (không rơi 404 vì thiếu employee).
      await seedEmp(A.companyId, uWatcher2);

      // Grants — theo D-29: activity cần read:task (guard); watchers cần watch:task.
      await grantPairs(A.companyId, uAssignee, [
        ["read", "task", false],
        // W2 deny-path: uAssignee KHÔNG có watch:task.
      ]);
      await grantPairs(A.companyId, uCreator, [["read", "task", false]]);
      await grantPairs(A.companyId, uReporter, [["read", "task", false]]);
      await grantPairs(A.companyId, uWatcher, [
        ["read", "task", false],
        ["watch", "task", false],
      ]);
      await grantPairs(A.companyId, uWatcher2, [
        ["read", "task", false],
        ["watch", "task", false],
      ]);
      await grantPairs(A.companyId, uOutsider, [["read", "task", false]]);
      await grantPairs(A.companyId, uAudit, [
        ["read", "task", false],
        ["watch", "task", false],
        ["view", "task-audit-log", true],
      ]);
      await grantPairs(A.companyId, uAuditNoRead, [["view", "task-audit-log", true]]);

      T1 = await plantTask({
        companyId: A.companyId,
        title: "T1 involvement",
        assigneeEmployeeId: eAssignee,
        assigneeUserId: uAssignee,
        creatorUserId: uCreator,
        reporterEmployeeId: eReporter,
      });
      T2 = await plantTask({
        companyId: A.companyId,
        title: "T2 soft-deleted",
        assigneeEmployeeId: eAssignee,
        assigneeUserId: uAssignee,
        deleted: true,
      });
      T3 = await plantTask({ companyId: A.companyId, title: "T3 watcher lifecycle" });
      TB = await plantTask({ companyId: B.companyId, title: "TB tenant B" });

      watcherRowT1 = await plantWatcher(A.companyId, T1, eWatcher, uWatcher);

      logStatusId = await plantActivity(
        A.companyId,
        T1,
        "TASK_STATUS_CHANGED",
        { status: "Todo" },
        { status: "In Progress" },
        "2026-07-10T08:00:00.000Z",
      );
      await plantActivity(
        A.companyId,
        T1,
        "TASK_ASSIGNEE_CHANGED",
        { assigneeEmployeeId: null },
        { assigneeEmployeeId: eAssignee },
        "2026-07-11T08:00:00.000Z",
      );
      await plantActivity(
        A.companyId,
        T2,
        "TASK_STATUS_CHANGED",
        { status: "Todo" },
        { status: "Done" },
        "2026-07-12T08:00:00.000Z",
      );
      await plantActivity(
        A.companyId,
        TB,
        "TASK_STATUS_CHANGED",
        { status: "Todo" },
        { status: "Done" },
        "2026-07-12T09:00:00.000Z",
      );
    });

    afterAll(async () => {
      if (app) await app.close();
      if (direct) {
        for (const tbl of [
          "task_activity_logs",
          "task_watchers",
          "task_assignees",
          "tasks",
          "employee_profiles",
        ]) {
          await direct
            .query(`DELETE FROM ${tbl} WHERE company_id = ANY($1::uuid[])`, [companyIds])
            .catch(() => undefined);
        }
        await cleanupTenants(direct, companyIds);
      }
    });

    // ════════ Activity — involvement (D-29) ════════

    for (const [label, email] of [
      ["V1 assignee", "assignee"],
      ["V2 creator", "creator"],
      ["V3 reporter", "reporter"],
      ["V4 watcher Active", "watcher"],
    ] as const) {
      it(`${label} (read:task, KHÔNG pair audit) → 200 + thấy dòng log`, async () => {
        const token = await login(A.slug, `${email}@${A.slug}.test`);
        const res = await get(token, `/tasks/${T1}/activity`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const rows = res.body.data as Array<{ id: string; action: string }>;
        expect(rows.map((r) => r.id)).toContain(logStatusId);
      });
    }

    it("V5 — NGOÀI CUỘC (read:task, không liên quan) → 403 TASK-ERR-042", async () => {
      const token = await login(A.slug, `outsider@${A.slug}.test`);
      const res = await get(token, `/tasks/${T1}/activity`);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain("TASK-ERR-042");
    });

    it("V6 — pair audit + read:task (hr-style): 200 với task KHÔNG liên quan", async () => {
      const token = await login(A.slug, `audit@${A.slug}.test`);
      const res = await get(token, `/tasks/${T1}/activity`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("V7 — pair audit mà THIẾU read:task → 403 ở guard (hệ quả D-29.4, pin tường minh)", async () => {
      const token = await login(A.slug, `auditnoread@${A.slug}.test`);
      const res = await get(token, `/tasks/${T1}/activity`);
      expect(res.status).toBe(403);
    });

    it("V8 — cross-tenant taskId B → 404 (không lộ tồn tại)", async () => {
      const token = await login(A.slug, `audit@${A.slug}.test`);
      expect((await get(token, `/tasks/${TB}/activity`)).status).toBe(404);
      expect((await get(token, `/tasks/${randomUUID()}/activity`)).status).toBe(404);
    });

    it("V9 — enrich assigneeName: log chỉ lưu employeeId, DTO trả kèm tên (GAP 1)", async () => {
      const token = await login(A.slug, `assignee@${A.slug}.test`);
      const res = await get(token, `/tasks/${T1}/activity`);
      expect(res.status).toBe(200);
      const rows = res.body.data as Array<{
        action: string;
        oldValues: Record<string, unknown> | null;
        newValues: Record<string, unknown> | null;
      }>;
      const assignRow = rows.find((r) => r.action === "TASK_ASSIGNEE_CHANGED");
      expect(assignRow, "thiếu dòng TASK_ASSIGNEE_CHANGED").toBeDefined();
      expect(assignRow?.newValues?.assigneeEmployeeId).toBe(eAssignee);
      expect(assignRow?.newValues?.assigneeName).toBe("Ngô Assignee");
      // oldValues.assigneeEmployeeId = null → KHÔNG bịa tên.
      expect(assignRow?.oldValues?.assigneeName).toBeUndefined();
    });

    it("V10 — task soft-deleted: người liên quan vẫn đọc được lịch sử (ledger durability)", async () => {
      const token = await login(A.slug, `assignee@${A.slug}.test`);
      const res = await get(token, `/tasks/${T2}/activity`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((res.body.data as unknown[]).length).toBeGreaterThan(0);
    });

    // ════════ Watchers — GET list + vòng đời (GAP 4) ════════

    it("W1 — vòng đời: POST theo dõi → GET thấy mình (tên+userId) → DELETE 204 → GET rỗng", async () => {
      const token = await login(A.slug, `watcher@${A.slug}.test`);
      expect((await post(token, `/tasks/${T3}/watchers`).send({})).status).toBe(201);

      const listRes = await get(token, `/tasks/${T3}/watchers`);
      expect(listRes.status, JSON.stringify(listRes.body)).toBe(200);
      const rows = listRes.body.data as Array<{
        id: string;
        employeeId: string;
        employeeName: string | null;
        userId: string | null;
        status: string;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].employeeId).toBe(eWatcher);
      expect(rows[0].userId).toBe(uWatcher);
      expect(rows[0].employeeName).toBe("Trần Watcher");
      expect(rows[0].status).toBe("Active");

      expect((await del(token, `/tasks/${T3}/watchers/${rows[0].id}`)).status).toBe(204);
      const after = await get(token, `/tasks/${T3}/watchers`);
      expect(after.status).toBe(200);
      expect(after.body.data).toEqual([]);
    });

    it("W2 — GET watchers thiếu watch:task → 403 (PermissionGuard deny-path)", async () => {
      const token = await login(A.slug, `assignee@${A.slug}.test`);
      expect((await get(token, `/tasks/${T1}/watchers`)).status).toBe(403);
    });

    it("W3 — GET watchers cross-tenant taskId B → 404", async () => {
      const token = await login(A.slug, `watcher@${A.slug}.test`);
      expect((await get(token, `/tasks/${TB}/watchers`)).status).toBe(404);
    });

    it("W4 — DELETE watcher NGƯỜI KHÁC → 404 (self-only, không lộ) + watcher vẫn còn", async () => {
      const token2 = await login(A.slug, `watcher2@${A.slug}.test`);
      expect((await del(token2, `/tasks/${T1}/watchers/${watcherRowT1}`)).status).toBe(404);
      const token = await login(A.slug, `watcher@${A.slug}.test`);
      const res = await get(token, `/tasks/${T1}/watchers`);
      expect((res.body.data as Array<{ id: string }>).map((w) => w.id)).toContain(watcherRowT1);
    });
  },
);
