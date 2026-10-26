/**
 * S20-TASK-ASSIGNNOTI-1 — giao việc qua form Tạo (`POST /tasks`) hoặc đổi người/hạn/ưu tiên qua form Sửa
 * (`PATCH /tasks/:taskId`) báo cho người được giao Y NHƯ route chuyên trách (`/assign` · `/change-deadline` ·
 * `/change-priority`). Plan: `docs/plans/S20-TASK-ASSIGNNOTI-1.md` §4 (C1–C12).
 *
 * Bất biến được đo:
 *   E-1  Tạo việc có người phụ trách ≠ người tạo ⇒ đúng 1 outbox `task.assigned`, CÙNG transaction với hàng
 *        việc + activity `TASK_CREATED` + audit `TaskCreated` (đo bằng `xmin` của 4 hàng TRƯỚC khi drain).
 *        Tự giao / không người phụ trách ⇒ 0 outbox (đo ở tầng OUTBOX — engine tự loại actor nên đếm thông
 *        báo sẽ xanh rỗng).
 *   E-2  PATCH đổi người/hạn/ưu tiên phát CÙNG loại sự kiện với route chuyên trách; tập người nhận khớp
 *        `/assign` (người mới ∪ watchers, actor không tự nhận, người cũ không nhận); chỉ đổi tiêu đề/mô tả ⇒
 *        không phát. Payload hạn/ưu tiên mang người phụ trách SAU patch.
 *   E-3  Ghi lỗi giữa chừng ⇒ rollback cả outbox; 403 cổng trường ⇒ 0 outbox; người được giao đang nghỉ ⇒
 *        response tạo việc có `warnings[]` `TASK-WARN-ASSIGNEE-ON-LEAVE`.
 *   E-4  Cross-tenant: hàng outbox mang `company_id` của công ty phát; người công ty khác không chạm được,
 *        không nhận thông báo.
 *   E-5  Payload outbox `task.*` không có `description` / `reason`.
 *
 * App THẬT (AppModule) qua `applyMainPipeline`, engine quyền + bridge NOTI THẬT, Postgres THẬT (lane cô
 * lập). Cổng `hasDb && LANE_DB`. Drain outbox giữ khoá toàn cục (`acquireOutboxWorkerLock`). Không gửi
 * `Idempotency-Key` (interceptor bỏ qua khi thiếu khoá ⇒ mọi request chạy thật). Không `Promise.all` quanh
 * supertest. Người nhận assert theo id người dùng CỤ THỂ của spec — không đếm toàn bảng.
 */

import "reflect-metadata";
import { BadRequestException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { OutboxWorker } from "../../src/events/outbox-worker";
import { GoalProgressEngineService } from "../../src/tasks/goal-progress-engine.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import {
  acquireOutboxWorkerLock,
  OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  type OutboxWorkerLock,
} from "../helpers/outbox-worker-lock";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { grant, seedEmployee, type Pair } from "../helpers/task-file-seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = loginPasswordFixture("s20asn");

type Caller = "QL" | "G0" | "GB";

const DUE0 = "2026-11-20T03:00:00.000Z";
const DUE1 = "2026-12-05T09:30:00.000Z";
/** Ngày nghỉ của C10 — hạn lúc 05:00Z để ngày UTC = ngày theo giờ công ty (F8). */
const LEAVE_DAY = "2026-12-15";
const DUE_ON_LEAVE = `${LEAVE_DAY}T05:00:00.000Z`;
const PRIO0 = "Medium";

const FULL_PAIRS: Pair[] = [
  ["create", "task"],
  ["update", "task"],
  ["assign", "task"],
  ["update-priority", "task"],
  ["update-deadline", "task"],
];

describe.skipIf(!runDb)(
  "S20-TASK-ASSIGNNOTI-1 — form Tạo/Sửa báo người được giao như route chuyên trách",
  () => {
    const direct: Pool = directPool();
    let nest: INestApplication;
    let A: SeededTenant;
    let B: SeededTenant;
    let outboxLock: OutboxWorkerLock | undefined;
    const companyIds: string[] = [];
    const token: Partial<Record<Caller, string>> = {};
    const uid: Record<string, string> = {};
    const emp: Record<string, string> = {};

    const http = () => request(nest.getHttpServer());
    const createAs = (who: Caller, body: Record<string, unknown>) =>
      http().post("/tasks").set("Authorization", `Bearer ${token[who]}`).send(body);
    const patchAs = (who: Caller, taskId: string, body: Record<string, unknown>) =>
      http().patch(`/tasks/${taskId}`).set("Authorization", `Bearer ${token[who]}`).send(body);
    const postAs = (who: Caller, path: string, body: Record<string, unknown>) =>
      http().post(path).set("Authorization", `Bearer ${token[who]}`).send(body);

    const uniqueTitle = (tag: string) => `asn-${tag}-${randomUUID().slice(0, 8)}`;

    /** Việc gieo thẳng (công ty A): hạn DUE0 · ưu tiên PRIO0 · người phụ trách `holder` (hoặc không). */
    async function seedTask(holder: string | null): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_status, task_priority, due_at,
                            main_assignee_employee_id, assignee_user_id, creator_user_id)
         VALUES ($1, 'office', $2, 'Todo', $3, $4, $5, $6, $7) RETURNING id`,
        [
          A.companyId,
          uniqueTitle("seed"),
          PRIO0,
          DUE0,
          holder ? emp[holder] : null,
          holder ? uid[holder] : null,
          uid.QL,
        ],
      );
      return r.rows[0].id as string;
    }

    async function addWatcher(taskId: string, who: string): Promise<void> {
      await direct.query(
        `INSERT INTO task_watchers (company_id, task_id, employee_id, watcher_type, status, added_by,
                                    created_by, updated_by)
         VALUES ($1, $2, $3, 'Manual', 'Active', $4, $4, $4)`,
        [A.companyId, taskId, emp[who], uid.QL],
      );
    }

    /** Hàng outbox của MỘT việc (theo `payload.taskId`), lọc loại sự kiện nếu có. */
    async function outboxOf(taskId: string, eventType?: string) {
      const r = await direct.query(
        `SELECT event_type, company_id, payload FROM outbox_events
          WHERE company_id = ANY($1::uuid[]) AND payload->>'taskId' = $2
            AND ($3::text IS NULL OR event_type = $3)`,
        [companyIds, taskId, eventType ?? null],
      );
      return r.rows as Array<{
        event_type: string;
        company_id: string;
        payload: Record<string, unknown>;
      }>;
    }

    async function outboxByTitle(title: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM outbox_events WHERE payload->>'taskTitle' = $1`,
        [title],
      );
      return r.rows[0].n as number;
    }

    /** Số thông báo `eventCode` của việc `taskId` mà người dùng `who` nhận. */
    async function notifCount(who: string, taskId: string, eventCode: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM notifications
          WHERE recipient_user_id = $1 AND source_entity_id = $2 AND event_code = $3
            AND deleted_at IS NULL`,
        [uid[who], taskId, eventCode],
      );
      return r.rows[0].n as number;
    }

    async function drain(): Promise<void> {
      await drainOutboxUntilSettled({ worker: nest.get(OutboxWorker), direct, companyIds });
    }

    function expectStatus(res: request.Response, status: number) {
      expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(status);
    }

    beforeAll(async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "asnA");
      B = await seedCompany(direct, "asnB");
      companyIds.push(A.companyId, B.companyId);
      const user = async (k: string, tenant: SeededTenant) => {
        uid[k] = await seedUser(
          direct,
          tenant.companyId,
          `${k.toLowerCase()}@${tenant.slug}.test`,
          hash,
        );
        emp[k] = await seedEmployee(direct, tenant.companyId, uid[k]);
      };
      // QL = người giao việc · NA/NB = nhân viên được giao · W = người theo dõi · G0 = chỉ update:task.
      for (const k of ["QL", "NA", "NB", "W", "G0"]) await user(k, A);
      await user("GB", B);

      await grant(direct, A.companyId, uid.QL, FULL_PAIRS, "Company");
      await grant(direct, A.companyId, uid.G0, [["update", "task"]], "Company");
      await grant(direct, B.companyId, uid.GB, FULL_PAIRS, "Company");

      const lt = await direct.query(
        `INSERT INTO leave_types (company_id, name, code) VALUES ($1, 'Annual', 'AL') RETURNING id`,
        [A.companyId],
      );
      await direct.query(
        `INSERT INTO leave_requests
           (company_id, user_id, employee_id, leave_type_id, start_date, end_date, total_days, status)
         VALUES ($1, $2, $3, $4, $5, $5, 1, 'Approved')`,
        [A.companyId, uid.NA, emp.NA, lt.rows[0].id, LEAVE_DAY],
      );

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = applyMainPipeline(moduleRef.createNestApplication());
      await nest.init();
      await nest.listen(0);

      const logins: Array<[Caller, SeededTenant]> = [
        ["QL", A],
        ["G0", A],
        ["GB", B],
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

      outboxLock = await acquireOutboxWorkerLock("s20-task-assign-noti");
    }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

    afterAll(async () => {
      await outboxLock?.release();
      // Đóng app TRƯỚC cleanup: worker/bridge còn sống có thể ghi giữa các câu DELETE.
      if (nest) await nest.close();
      if (companyIds.length > 0) {
        for (const tbl of [
          "task_watchers",
          "task_activity_logs",
          "task_assignees",
          "leave_requests",
          "leave_types",
          "tasks",
        ]) {
          await direct
            .query(`DELETE FROM ${tbl} WHERE company_id = ANY($1::uuid[])`, [companyIds])
            .catch(() => undefined);
        }
        await cleanupTenants(direct, companyIds);
      }
      await direct.end();
    });

    // ══ Tạo việc ══════════════════════════════════════════════════════════════════════════════════

    it("C1 · QL tạo việc giao NA ⇒ 1 outbox task.assigned CÙNG tx với việc/activity/audit; NA nhận 1 TASK_ASSIGNED", async () => {
      const res = await createAs("QL", {
        title: uniqueTitle("c1"),
        description: "mô tả nội bộ không được rời transaction",
        assigneeEmployeeId: emp.NA,
      });
      expectStatus(res, 201);
      const taskId = res.body.data.id as string;

      const rows = await outboxOf(taskId, "task.assigned");
      expect(rows, "đúng 1 outbox task.assigned").toHaveLength(1);
      expect(rows[0].company_id, "E-4: hàng outbox mang company_id của công ty phát").toBe(
        A.companyId,
      );
      expect(rows[0].payload.assigneeUserId).toBe(uid.NA);
      expect(rows[0].payload.actorUserId).toBe(uid.QL);

      // CÙNG transaction: xmin của 4 hàng bằng nhau — đọc TRƯỚC drain (worker cập nhật hàng outbox).
      const x = await direct.query(
        `SELECT (SELECT xmin::text FROM tasks WHERE id = $1) AS t,
                (SELECT xmin::text FROM outbox_events
                  WHERE payload->>'taskId' = $2 AND event_type = 'task.assigned') AS o,
                (SELECT xmin::text FROM audit_logs
                  WHERE object_type = 'task' AND object_id = $1 AND action = 'TaskCreated') AS a,
                (SELECT xmin::text FROM task_activity_logs
                  WHERE task_id = $1 AND action = 'TASK_CREATED') AS l`,
        [taskId, taskId],
      );
      const { t, o, a, l } = x.rows[0] as Record<string, string | null>;
      expect(t, "xmin hàng việc").not.toBeNull();
      expect([o, a, l], "outbox · audit · activity cùng transaction với hàng việc").toEqual([
        t,
        t,
        t,
      ]);

      await drain();
      expect(await notifCount("NA", taskId, "TASK_ASSIGNED")).toBe(1);
      expect(await notifCount("QL", taskId, "TASK_ASSIGNED"), "người giao không tự nhận").toBe(0);
    });

    it("C2 · QL tự giao chính mình ⇒ tạo được, 0 outbox task.assigned (đứng cạnh C1)", async () => {
      const res = await createAs("QL", { title: uniqueTitle("c2"), assigneeEmployeeId: emp.QL });
      expectStatus(res, 201);
      expect(await outboxOf(res.body.data.id as string, "task.assigned")).toHaveLength(0);
    });

    it("C3 · tạo không người phụ trách ⇒ 0 outbox", async () => {
      const res = await createAs("QL", { title: uniqueTitle("c3") });
      expectStatus(res, 201);
      expect(await outboxOf(res.body.data.id as string)).toHaveLength(0);
    });

    it("C10 · NA có đơn nghỉ đã duyệt trùng ngày hạn ⇒ response tạo việc có warnings ASSIGNEE-ON-LEAVE", async () => {
      const res = await createAs("QL", {
        title: uniqueTitle("c10"),
        description: "không được vào payload",
        assigneeEmployeeId: emp.NA,
        dueAt: DUE_ON_LEAVE,
      });
      expectStatus(res, 201);
      const codes = ((res.body.data.warnings ?? []) as Array<{ code: string }>).map((w) => w.code);
      expect(res.body.data.warnings, "response tạo việc có mảng warnings").toBeInstanceOf(Array);
      expect(codes).toContain("TASK-WARN-ASSIGNEE-ON-LEAVE");
      const rows = await outboxOf(res.body.data.id as string, "task.assigned");
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0].payload)).not.toContain("description");
    });

    it("C8 · lỗi 400 SAU điểm phát (recompute) ⇒ rollback: 0 việc · 0 outbox · 0 audit · 0 activity", async () => {
      const engine = nest.get(GoalProgressEngineService);
      const spy = vi
        .spyOn(engine, "recomputeProjectGoalsTx")
        .mockRejectedValueOnce(new BadRequestException("TASK-ERR-TEST: lỗi giả sau khi ghi."));
      const title = uniqueTitle("c8");
      try {
        const res = await createAs("QL", { title, assigneeEmployeeId: emp.NA });
        expectStatus(res, 400);
        expect(spy, "điểm lỗi nằm SAU khi đã ghi (chống xanh rỗng)").toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
      const counts = await direct.query(
        `SELECT (SELECT count(*)::int FROM tasks WHERE company_id = $1 AND title = $2) AS tasks,
                (SELECT count(*)::int FROM audit_logs
                  WHERE company_id = $1 AND object_type = 'task' AND after->>'title' = $2) AS audit,
                (SELECT count(*)::int FROM task_activity_logs
                  WHERE company_id = $1 AND new_values->>'title' = $2) AS activity`,
        [A.companyId, title],
      );
      expect(counts.rows[0]).toEqual({ tasks: 0, audit: 0, activity: 0 });
      expect(await outboxByTitle(title), "0 outbox của việc bị rollback").toBe(0);
    });

    // ══ Sửa việc (PATCH) ═══════════════════════════════════════════════════════════════════════════

    it("C4 · PATCH NA→NB (W và QL theo dõi) ⇒ 1 task.assignee_changed; NB 1 · W 1 · QL 0 · NA 0 — khớp /assign trên việc song sinh", async () => {
      const viaPatch = await seedTask("NA");
      const viaAssign = await seedTask("NA");
      for (const id of [viaPatch, viaAssign]) {
        await addWatcher(id, "W");
        await addWatcher(id, "QL");
      }

      expectStatus(await patchAs("QL", viaPatch, { assigneeEmployeeId: emp.NB }), 200);
      expectStatus(
        await postAs("QL", `/tasks/${viaAssign}/assign`, { assigneeEmployeeId: emp.NB }),
        200,
      );
      const rows = await outboxOf(viaPatch);
      expect(rows.map((r) => r.event_type)).toEqual(["task.assignee_changed"]);
      expect(rows[0].payload.oldAssigneeEmployeeId).toBe(emp.NA);
      expect(rows[0].payload.assigneeUserId).toBe(uid.NB);

      await drain();
      const recipients = async (taskId: string) => {
        const out: Record<string, number> = {};
        for (const who of ["NB", "W", "QL", "NA"]) {
          out[who] = await notifCount(who, taskId, "TASK_ASSIGNEE_CHANGED");
        }
        return out;
      };
      const viaPatchSet = await recipients(viaPatch);
      expect(viaPatchSet).toEqual({ NB: 1, W: 1, QL: 0, NA: 0 });
      expect(viaPatchSet, "tập người nhận = tập của /assign").toEqual(await recipients(viaAssign));
    });

    it("C5 · PATCH chưa có người → NA ⇒ 1 task.assigned (y /assign); NA nhận TASK_ASSIGNED", async () => {
      const id = await seedTask(null);
      expectStatus(await patchAs("QL", id, { assigneeEmployeeId: emp.NA }), 200);
      expect((await outboxOf(id)).map((r) => r.event_type)).toEqual(["task.assigned"]);
      await drain();
      expect(await notifCount("NA", id, "TASK_ASSIGNED")).toBe(1);
    });

    it("C6 · PATCH đổi hạn + ưu tiên ⇒ 1 task.due_date_changed + 1 task.priority_changed", async () => {
      const id = await seedTask("NA");
      expectStatus(await patchAs("QL", id, { dueAt: DUE1, priority: "High" }), 200);
      const types = (await outboxOf(id)).map((r) => r.event_type).sort();
      expect(types).toEqual(["task.due_date_changed", "task.priority_changed"]);
    });

    it("C6b · PATCH NA→NB + hạn + ưu tiên một request ⇒ 3 sự kiện; payload hạn/ưu tiên mang NB; NB nhận cả 3, NA 0", async () => {
      const id = await seedTask("NA");
      expectStatus(
        await patchAs("QL", id, { assigneeEmployeeId: emp.NB, dueAt: DUE1, priority: "Urgent" }),
        200,
      );
      const rows = await outboxOf(id);
      expect(rows.map((r) => r.event_type).sort()).toEqual([
        "task.assignee_changed",
        "task.due_date_changed",
        "task.priority_changed",
      ]);
      for (const r of rows) {
        expect(r.payload.assigneeUserId, `${r.event_type}: người phụ trách SAU patch`).toBe(uid.NB);
      }
      await drain();
      const codes = ["TASK_ASSIGNEE_CHANGED", "TASK_DUE_DATE_CHANGED", "TASK_PRIORITY_CHANGED"];
      for (const code of codes) {
        expect(await notifCount("NB", id, code), `NB nhận ${code}`).toBe(1);
        expect(await notifCount("NA", id, code), `NA không nhận ${code}`).toBe(0);
      }
    });

    it("C7 · PATCH chỉ tiêu đề + mô tả ⇒ 0 outbox task.*, vẫn 1 audit TaskUpdated", async () => {
      const id = await seedTask("NA");
      expectStatus(
        await patchAs("QL", id, { title: uniqueTitle("c7"), description: "mô tả mới" }),
        200,
      );
      expect(await outboxOf(id)).toHaveLength(0);
      const aud = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
          WHERE object_type = 'task' AND object_id = $1 AND action = 'TaskUpdated'`,
        [id],
      );
      expect(aud.rows[0].n).toBe(1);
    });

    it("C9 · PATCH đổi người khi thiếu cặp assign ⇒ 403, 0 outbox, việc không đổi", async () => {
      const id = await seedTask("NA");
      expectStatus(await patchAs("G0", id, { assigneeEmployeeId: emp.NB }), 403);
      expect(await outboxOf(id)).toHaveLength(0);
      const row = await direct.query(`SELECT main_assignee_employee_id FROM tasks WHERE id = $1`, [
        id,
      ]);
      expect(row.rows[0].main_assignee_employee_id).toBe(emp.NA);
    });

    // ══ Cross-tenant ══════════════════════════════════════════════════════════════════════════════

    it("C11 · người công ty B không chạm được việc công ty A, không giao được NV công ty A, không nhận thông báo", async () => {
      const id = await seedTask("NA");
      expectStatus(await patchAs("GB", id, { assigneeEmployeeId: emp.GB }), 404);
      expect(await outboxOf(id), "0 outbox cho việc của A").toHaveLength(0);

      const title = uniqueTitle("c11");
      expectStatus(await createAs("GB", { title, assigneeEmployeeId: emp.NA }), 400);
      expect(await outboxByTitle(title), "0 outbox ở cả hai công ty").toBe(0);

      await drain();
      const n = await direct.query(
        `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1`,
        [uid.GB],
      );
      expect(n.rows[0].n, "người B không có thông báo nào").toBe(0);
    });

    it("C12 · mọi outbox task.* của spec không mang description / reason", async () => {
      const r = await direct.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE payload ? 'description' OR payload ? 'reason')::int AS leaked
           FROM outbox_events
          WHERE company_id = ANY($1::uuid[]) AND event_type LIKE 'task.%'`,
        [companyIds],
      );
      expect(r.rows[0].total, "có sự kiện để quét (chống xanh rỗng)").toBeGreaterThan(0);
      expect(r.rows[0].leaked).toBe(0);
    });
  },
);
