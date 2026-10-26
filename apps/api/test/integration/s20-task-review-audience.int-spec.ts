/**
 * S20-TASK-DUEREMIND-1 (done_when 4) — việc vào «Chờ duyệt» ⇒ Owner/Manager CÒN HIỆU LỰC của dự án nhận
 * `TASK_STATUS_CHANGED`. Plan: `docs/plans/S20-TASK-DUEREMIND-1.md` §4 (A1–A7 · X2).
 *
 * Đường thật: change-status / move-state → outbox `task.status_changed` → `OutboxWorker` → bridge →
 * `TaskNotiBridgeRegistrar` → engine → `notifications`. Không mock quyền/engine.
 *
 * Diễn viên (dự án P tạo qua `POST /projects`, cột mặc định có «Chờ duyệt» + một cột review thứ hai gieo thêm):
 *  · QL1 — Owner (người tạo dự án) và là người tạo mọi việc;
 *  · QL2 — Manager THUẦN: không tạo/không phụ trách/không theo dõi ⇒ thông báo đổi trạng thái DUY NHẤT có thể
 *    của QL2 là tín hiệu In Review (dedupe TimeWindow 300s của TASK_STATUS_CHANGED không che được ca này);
 *  · QLR — Manager đã bị gỡ (member_status 'Removed');
 *  · NV — Member, người phụ trách và người đổi trạng thái;
 *  · BO — người dùng công ty B, gieo một hàng thành viên công ty B trỏ vào dự án P.
 *
 * Kéo giữa hai cột cùng nhóm review đo trên `outbox_events` (không đếm thông báo — một sự kiện thừa cũng có
 * thể bị nuốt trong cùng bucket dedupe). Cổng `hasDb && LANE_DB`. Không `Promise.all` quanh supertest.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { OutboxWorker } from "../../src/events/outbox-worker";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import {
  acquireOutboxWorkerLock,
  OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  type OutboxWorkerLock,
} from "../helpers/outbox-worker-lock";
import {
  cleanupTenants,
  seedCompany,
  seedCrossTenantViolation,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = loginPasswordFixture("revaud");
const STATUS_CHANGED = "TASK_STATUS_CHANGED";
const IN_REVIEW = "In Review";

type Pair = [action: string, resourceType: string];

interface StatusRow {
  id: string;
  toStatus: string | null;
}

describe.skipIf(!runDb)(
  "S20-TASK-DUEREMIND-1 — chủ/quản lý dự án được báo khi việc vào Chờ duyệt",
  () => {
    const direct: Pool = directPool();
    let nest: INestApplication;
    let A: SeededTenant;
    let B: SeededTenant;
    let outboxLock: OutboxWorkerLock | undefined;
    const uid: Record<string, string> = {};
    const emp: Record<string, string> = {};
    const token: Record<string, string> = {};
    const t: Record<string, string> = {};
    let projectP = "";
    let reviewCol1 = "";
    let reviewCol2 = "";

    async function grant(companyId: string, userId: string, pairs: Pair[]): Promise<void> {
      const roleId = await seedRole(direct, companyId, `revaud-${userId.slice(0, 8)}`);
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
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    async function actor(k: string, tenant: SeededTenant, hash: string): Promise<void> {
      uid[k] = await seedUser(direct, tenant.companyId, `${k}@${tenant.slug}.test`, hash);
      emp[k] = (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id`,
          [tenant.companyId, uid[k]],
        )
      ).rows[0].id as string;
    }

    async function login(k: string, tenant: SeededTenant): Promise<void> {
      const res = await request(nest.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: tenant.slug, email: `${k}@${tenant.slug}.test`, password: LOGIN_PW });
      expect(res.status, `login ${k}: ${JSON.stringify(res.body)}`).toBe(200);
      token[k] = res.body.data.accessToken as string;
    }

    const post = (k: string, url: string) =>
      request(nest.getHttpServer()).post(url).set("Authorization", `Bearer ${token[k]}`);

    async function ok(k: string, url: string, body: Record<string, unknown>, status = 200) {
      const res = await post(k, url).send(body);
      expect(res.status, `${k} POST ${url}: ${JSON.stringify(res.body)}`).toBe(status);
      return res.body.data as Record<string, unknown>;
    }

    async function mkTask(title: string, inProject: boolean): Promise<string> {
      const body: Record<string, unknown> = { title, assigneeEmployeeId: emp.nv };
      if (inProject) body.projectId = projectP;
      return (await ok("ql1", "/tasks", body, 201)).id as string;
    }

    async function addMember(k: string, role: string, removed = false): Promise<void> {
      await direct.query(
        `INSERT INTO project_members (company_id, project_id, user_id, employee_id, project_role,
                                    member_status, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          A.companyId,
          projectP,
          uid[k],
          emp[k],
          role,
          removed ? "Removed" : "Active",
          removed ? new Date() : null,
        ],
      );
    }

    const drain = () =>
      drainOutboxUntilSettled({
        worker: nest.get(OutboxWorker),
        direct,
        companyIds: [A.companyId, B.companyId],
      });

    async function statusRows(who: string, taskId: string): Promise<StatusRow[]> {
      const r = await direct.query(
        `SELECT id, payload->>'toStatus' AS "toStatus" FROM notifications
        WHERE company_id = $1 AND event_code = $2 AND recipient_user_id = $3 AND source_entity_id = $4`,
        [A.companyId, STATUS_CHANGED, uid[who], taskId],
      );
      return r.rows as StatusRow[];
    }

    async function statusEvents(taskId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM outbox_events
        WHERE company_id = $1 AND event_type = 'task.status_changed' AND payload->>'taskId' = $2`,
        [A.companyId, taskId],
      );
      return r.rows[0].n as number;
    }

    beforeAll(async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "revaudA");
      B = await seedCompany(direct, "revaudB");
      await direct.query(
        `INSERT INTO sequence_counters
         (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
          reset_policy, increment_by, current_value, status)
       VALUES ($1,'TASK','task','Company','TSK-',4,'Never',1,0,'Active')
       ON CONFLICT DO NOTHING`,
        [A.companyId],
      );
      for (const k of ["ql1", "ql2", "qlr", "nv"]) await actor(k, A, hash);
      await actor("bo", B, hash);

      await grant(A.companyId, uid.ql1, [
        ["read", "project"],
        ["create", "project"],
        ["read", "task"],
        ["create", "task"],
      ]);
      await grant(A.companyId, uid.ql2, [
        ["read", "task"],
        ["update-status", "task"],
      ]);
      await grant(A.companyId, uid.nv, [
        ["read", "task"],
        ["update-status", "task"],
        ["update-state", "task"],
      ]);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = applyMainPipeline(moduleRef.createNestApplication());
      await nest.init();
      for (const k of ["ql1", "ql2", "nv"]) await login(k, A);

      projectP = (await ok("ql1", "/projects", { name: `revaud-p-${A.slug}` }, 201)).id as string;
      const owner = await direct.query(
        `SELECT count(*)::int AS n FROM project_members
        WHERE project_id = $1 AND user_id = $2 AND project_role = 'Owner' AND member_status = 'Active'`,
        [projectP, uid.ql1],
      );
      expect(owner.rows[0].n, "QL1 phải là Owner Active của P").toBe(1);
      await addMember("ql2", "Manager");
      await addMember("qlr", "Manager", true);
      await addMember("nv", "Member");

      reviewCol1 = (
        await direct.query(
          `SELECT id FROM project_states
          WHERE project_id = $1 AND state_group = 'review' AND deleted_at IS NULL`,
          [projectP],
        )
      ).rows[0].id as string;
      reviewCol2 = (
        await direct.query(
          `INSERT INTO project_states (company_id, project_id, name, state_group, sort_order)
         VALUES ($1,$2,'Chờ duyệt 2','review',6) RETURNING id`,
          [A.companyId, projectP],
        )
      ).rows[0].id as string;

      await seedCrossTenantViolation(direct, (client) =>
        client.query(
          `INSERT INTO project_members (company_id, project_id, user_id, employee_id, project_role, member_status)
         VALUES ($1,$2,$3,$4,'Owner','Active')`,
          [B.companyId, projectP, uid.bo, emp.bo],
        ),
      );

      t.change = await mkTask("revaud-a1-change-status", true);
      t.move = await mkTask("revaud-a2-move-state", true);
      t.progress = await mkTask("revaud-a6-in-progress", true);
      t.noProject = await mkTask("revaud-a6-no-project", false);
      t.byManager = await mkTask("revaud-a7-by-manager", true);

      outboxLock = await acquireOutboxWorkerLock("s20-task-review-audience");
      await drain();
    }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

    afterAll(async () => {
      await outboxLock?.release();
      await nest?.close();
      if (A && B) await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
    });

    it("A1 · NV đổi Todo → In Review ⇒ Manager thuần QL2 nhận đúng 1; NV (actor) không nhận", async () => {
      await ok("nv", `/tasks/${t.change}/change-status`, { status: IN_REVIEW });
      await drain();
      expect((await statusRows("ql2", t.change)).map((r) => r.toStatus)).toEqual([IN_REVIEW]);
      expect(await statusRows("nv", t.change)).toHaveLength(0);
    });

    it("A5 · QL1 vừa người tạo vừa Owner ⇒ đúng 1 thông báo In Review", async () => {
      const mine = await statusRows("ql1", t.change);
      expect(mine.filter((r) => r.toStatus === IN_REVIEW)).toHaveLength(1);
      expect(mine).toHaveLength(1);
    });

    it("A4 · Manager đã bị gỡ khỏi P không nhận", async () => {
      expect(await statusRows("qlr", t.change)).toHaveLength(0);
    });

    it("A2 · NV kéo sang cột «Chờ duyệt» ⇒ QL2 nhận đúng 1", async () => {
      await ok("nv", `/tasks/${t.move}/move-state`, { stateId: reviewCol1 });
      await drain();
      expect((await statusRows("ql2", t.move)).map((r) => r.toStatus)).toEqual([IN_REVIEW]);
      expect(await statusRows("qlr", t.move)).toHaveLength(0);
    });

    it("A3 · kéo giữa hai cột cùng nhóm review ⇒ không phát sự kiện đổi trạng thái", async () => {
      const before = await statusEvents(t.move);
      expect(before).toBe(1);
      await ok("nv", `/tasks/${t.move}/move-state`, { stateId: reviewCol2 });
      await drain();
      expect(await statusEvents(t.move)).toBe(before);
      expect(await statusRows("ql2", t.move)).toHaveLength(1);
    });

    it("A6 · trạng thái khác (In Progress) ⇒ QL2 không nhận; người tạo vẫn nhận như cũ", async () => {
      await ok("nv", `/tasks/${t.progress}/change-status`, { status: "In Progress" });
      await drain();
      expect(await statusRows("ql2", t.progress)).toHaveLength(0);
      expect((await statusRows("ql1", t.progress)).map((r) => r.toStatus)).toEqual(["In Progress"]);
    });

    it("A6 · việc ngoài dự án vào In Review ⇒ QL2 không nhận; người tạo vẫn nhận như cũ", async () => {
      await ok("nv", `/tasks/${t.noProject}/change-status`, { status: IN_REVIEW });
      await drain();
      expect(await statusRows("ql2", t.noProject)).toHaveLength(0);
      expect((await statusRows("ql1", t.noProject)).map((r) => r.toStatus)).toEqual([IN_REVIEW]);
    });

    it("A7 · QL2 tự đổi sang In Review ⇒ QL2 (actor) không nhận; QL1 nhận", async () => {
      await ok("ql2", `/tasks/${t.byManager}/change-status`, { status: IN_REVIEW });
      await drain();
      expect(await statusRows("ql2", t.byManager)).toHaveLength(0);
      expect((await statusRows("ql1", t.byManager)).map((r) => r.toStatus)).toEqual([IN_REVIEW]);
    });

    it("X2 · thành viên công ty B gieo vào P không bao giờ là người nhận", async () => {
      const r = await direct.query(
        "SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1",
        [uid.bo],
      );
      expect(r.rows[0].n).toBe(0);
    });
  },
);
