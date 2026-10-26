/**
 * S20-TASK-DUEREMIND-1 — TaskReminderJobHandler (TASK_DUE_SOON / TASK_OVERDUE) trên việc SPEC-06 + Postgres THẬT.
 * Plan: `docs/plans/S20-TASK-DUEREMIND-1.md` §4 (R1–R11 · X1). Thay bản S4-NOTI-BE-3 (gieo cột legacy).
 *
 * Bất biến được đo:
 *  · việc tạo qua `POST /tasks` (task-core: `due_at` + `main_assignee_employee_id`) được nhắc; mở = task_status
 *    ∉ {Done, Cancelled}; chỉ office; chưa xoá; có người phụ trách giải được (hồ sơ còn active);
 *  · `TASK_OVERDUE` tới người phụ trách ∪ reporter/người tạo, không trùng người; chỉ xét hạn trong 7 ngày gần
 *    nhất, số việc bị bỏ do lookback nằm ở metadata;
 *  · một (việc, sự kiện, mốc hạn) phát đúng một lần cho mỗi người nhận — kể cả khi người nhận đã xoá mềm
 *    thông báo; đổi hạn ⇒ mốc mới ⇒ nhắc lại;
 *  · lỗi ở một việc không chặn việc khác, `failed` đếm đúng;
 *  · chạy cho công ty A không đọc/không phát cho công ty B.
 *
 * Đếm theo `recipient_user_id` + `source_entity_id`, gồm cả hàng đã xoá mềm khi ca cần. Handler gọi TRỰC
 * TIẾP qua DI (JobRunner/khoá có unit riêng). Cổng `hasDb && LANE_DB`. Không `Promise.all` quanh supertest.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { DatabaseService } from "../../src/db/db.service";
import { OutboxWorker } from "../../src/events/outbox-worker";
import { NotificationEngineService } from "../../src/notifications/notification-engine.service";
import { TaskReminderJobHandler } from "../../src/notifications/task-reminder.job-handler";
import { queryReminderCandidates } from "../../src/notifications/task-reminder.job-handler.query";
import type { JobRunResult } from "../../src/scheduler/job-handler";
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
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = loginPasswordFixture("duerem");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DUE_SOON = "TASK_DUE_SOON";
const OVERDUE = "TASK_OVERDUE";

type Pair = [action: string, resourceType: string];
type Scope = "Own" | "Company";

const REPORTER_PAIRS: Pair[] = [
  ["read", "task"],
  ["create", "task"],
  ["update-status", "task"],
  ["update-deadline", "task"],
];
const RECIPIENT_PAIRS: Pair[] = [
  ["read", "notification"],
  ["delete", "notification"],
];

interface NotiRow {
  id: string;
  recipient: string;
  dedupeKey: string | null;
  deleted: boolean;
}

function fromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function meta(res: JobRunResult, key: string): unknown {
  return (res.metadata ?? {})[key];
}

describe.skipIf(!runDb)("S20-TASK-DUEREMIND-1 — nhắc hạn việc SPEC-06", () => {
  const direct: Pool = directPool();
  let nest: INestApplication;
  let outboxLock: OutboxWorkerLock | undefined;
  let handler: TaskReminderJobHandler;
  let A: SeededTenant;
  let B: SeededTenant;
  const uid: Record<string, string> = {};
  const emp: Record<string, string> = {};
  const token: Record<string, string> = {};
  const t: Record<string, string> = {};

  async function grant(companyId: string, userId: string, pairs: Pair[], scope: Scope) {
    const roleId = await seedRole(direct, companyId, `duerem-${scope}-${userId.slice(0, 8)}`);
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

  const as = (k: string, m: "post" | "delete", url: string) =>
    request(nest.getHttpServer())[m](url).set("Authorization", `Bearer ${token[k]}`);

  /** Tạo việc qua task-core (`POST /tasks`). `dueInMs` null ⇒ không hạn; `assignee` null ⇒ không phụ trách. */
  async function mkTask(
    who: string,
    title: string,
    assignee: string | null,
    dueInMs: number | null,
  ): Promise<string> {
    const body: Record<string, unknown> = { title };
    if (assignee) body.assigneeEmployeeId = emp[assignee];
    if (dueInMs !== null) body.dueAt = fromNow(dueInMs);
    const res = await as(who, "post", "/tasks").send(body);
    expect(res.status, `POST /tasks ${title}: ${JSON.stringify(res.body)}`).toBe(201);
    return res.body.data.id as string;
  }

  /** Như `mkTask` nhưng hạn là mốc tuyệt đối (ca biên R12); người phụ trách NV. */
  async function mkTaskAt(title: string, dueAt: string): Promise<string> {
    const body = { title, assigneeEmployeeId: emp.nv, dueAt };
    const res = await as("rep", "post", "/tasks").send(body);
    expect(res.status, `POST /tasks ${title}: ${JSON.stringify(res.body)}`).toBe(201);
    return res.body.data.id as string;
  }

  async function setStatus(taskId: string, status: string): Promise<void> {
    const res = await as("rep", "post", `/tasks/${taskId}/change-status`).send({ status });
    expect(res.status, `change-status ${status}: ${JSON.stringify(res.body)}`).toBe(200);
  }

  /** Mọi hàng (kể cả đã xoá mềm) của một sự kiện cho một việc. */
  async function rows(companyId: string, eventCode: string, taskId: string): Promise<NotiRow[]> {
    const r = await direct.query(
      `SELECT id, recipient_user_id AS recipient, dedupe_key AS "dedupeKey",
              (deleted_at IS NOT NULL) AS deleted
         FROM notifications
        WHERE company_id = $1 AND event_code = $2 AND source_entity_id = $3
        ORDER BY created_at`,
      [companyId, eventCode, taskId],
    );
    return r.rows as NotiRow[];
  }

  const of = (list: NotiRow[], who: string) => list.filter((r) => r.recipient === uid[who]);

  async function reminderCount(companyId: string, taskId: string): Promise<number> {
    return (
      (await rows(companyId, DUE_SOON, taskId)).length +
      (await rows(companyId, OVERDUE, taskId)).length
    );
  }

  async function deleteOwn(who: string, eventCode: string, taskId: string): Promise<void> {
    const mine = of(await rows(A.companyId, eventCode, taskId), who).filter((r) => !r.deleted);
    expect(mine, `${who} phải có đúng 1 ${eventCode} còn hiệu lực để xoá`).toHaveLength(1);
    const res = await as(who, "delete", `/notifications/${mine[0]?.id}`);
    expect(res.status, `DELETE /notifications: ${JSON.stringify(res.body)}`).toBe(204);
  }

  const run = (companyId: string) => handler.run({ companyId });

  beforeAll(async () => {
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "dueremA");
    B = await seedCompany(direct, "dueremB");
    for (const c of [A, B]) {
      await direct.query(
        `INSERT INTO sequence_counters
           (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
            reset_policy, increment_by, current_value, status)
         VALUES ($1,'TASK','task','Company','TSK-',4,'Never',1,0,'Active')
         ON CONFLICT DO NOTHING`,
        [c.companyId],
      );
    }

    for (const k of ["rep", "nv", "nv3"]) await actor(k, A, hash);
    for (const k of ["brep", "bnv"]) await actor(k, B, hash);
    await grant(A.companyId, uid.rep, REPORTER_PAIRS, "Company");
    await grant(A.companyId, uid.rep, RECIPIENT_PAIRS, "Own");
    await grant(A.companyId, uid.nv, RECIPIENT_PAIRS, "Own");
    await grant(B.companyId, uid.brep, REPORTER_PAIRS, "Company");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = applyMainPipeline(moduleRef.createNestApplication());
    await nest.init();
    handler = nest.get(TaskReminderJobHandler);
    await login("rep", A);
    await login("nv", A);
    await login("brep", B);

    // Ứng viên dương (lượt đầu).
    t.dueSoon = await mkTask("rep", "duerem-r1-due-soon", "nv", 2 * HOUR_MS);
    t.overdue = await mkTask("rep", "duerem-r2-overdue", "nv", -2 * HOUR_MS);
    t.self = await mkTask("rep", "duerem-r8-self", "rep", -2 * HOUR_MS);
    t.legacy = await mkTask("rep", "duerem-r9-legacy", "nv", -2 * HOUR_MS);
    await direct.query("UPDATE tasks SET main_assignee_employee_id = NULL WHERE id = $1", [
      t.legacy,
    ]);
    // R4c — lượt đầu chỉ người phụ trách là người nhận (chưa có reporter/người tạo).
    t.perRecipient = await mkTask("rep", "duerem-r4c-per-recipient", "nv", -3 * HOUR_MS);
    await direct.query(
      "UPDATE tasks SET reporter_employee_id = NULL, creator_user_id = NULL WHERE id = $1",
      [t.perRecipient],
    );

    // Ứng viên âm (R6 · R11).
    t.done = await mkTask("rep", "duerem-r6-done", "nv", -2 * HOUR_MS);
    await setStatus(t.done, "Done");
    t.cancelled = await mkTask("rep", "duerem-r6-cancelled", "nv", -2 * HOUR_MS);
    await setStatus(t.cancelled, "Cancelled");
    t.deleted = await mkTask("rep", "duerem-r6-deleted", "nv", -2 * HOUR_MS);
    await direct.query("UPDATE tasks SET deleted_at = now() WHERE id = $1", [t.deleted]);
    t.noDue = await mkTask("rep", "duerem-r6-no-due", "nv", null);
    t.noAssignee = await mkTask("rep", "duerem-r6-no-assignee", null, -2 * HOUR_MS);
    t.far = await mkTask("rep", "duerem-r6-far", "nv", 3 * DAY_MS);
    t.otherType = await mkTask("rep", "duerem-r6-other-type", "nv", -2 * HOUR_MS);
    await direct.query("UPDATE tasks SET task_type = 'workflow_step' WHERE id = $1", [t.otherType]);
    t.inactive = await mkTask("rep", "duerem-r11-inactive", "nv3", -2 * HOUR_MS);
    await direct.query("UPDATE employee_profiles SET status = 'inactive' WHERE id = $1", [emp.nv3]);

    // POST /tasks (task.assigned — S20-TASK-ASSIGNNOTI-1) · change-status · change-deadline đều phát outbox.
    // Giữ khoá worker cả spec rồi drain trước khi dọn ⇒ không để event mồ côi cho spec khác nhặt SAU khi
    // user đã bị xoá (audit `notification_skipped` vỡ FK actor — KI-015 / KI-059).
    outboxLock = await acquireOutboxWorkerLock("task-reminder-job");
  }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    try {
      if (outboxLock && A && B) {
        await drainOutboxUntilSettled({
          worker: nest.get(OutboxWorker),
          direct,
          companyIds: [A.companyId, B.companyId],
        });
      }
    } finally {
      await outboxLock?.release();
    }
    await nest?.close();
    if (A && B) await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

  it("R1 · việc hạn trong 24h ⇒ đúng 1 TASK_DUE_SOON cho người phụ trách", async () => {
    const first = await run(A.companyId);
    const list = await rows(A.companyId, DUE_SOON, t.dueSoon);
    expect(list.map((r) => r.recipient)).toEqual([uid.nv]);
    expect(first.failed).toBe(0);
    expect(meta(first, "dueSoonCount")).toBe(1);
    expect(meta(first, "overdueSkippedByLookback")).toBe(0);
    expect(meta(first, "alreadyRemindedCount")).toBe(0);
  });

  it("R2 · việc quá hạn ⇒ TASK_OVERDUE cho người phụ trách VÀ reporter/người tạo", async () => {
    const list = await rows(A.companyId, OVERDUE, t.overdue);
    expect(of(list, "nv")).toHaveLength(1);
    expect(of(list, "rep")).toHaveLength(1);
    expect(list).toHaveLength(2);
  });

  it("R8 · người phụ trách = reporter ⇒ đúng 1 bản", async () => {
    const list = await rows(A.companyId, OVERDUE, t.self);
    expect(list.map((r) => r.recipient)).toEqual([uid.rep]);
  });

  it("R9 · nhánh legacy (chỉ còn assignee_user_id) vẫn được nhắc", async () => {
    expect(of(await rows(A.companyId, OVERDUE, t.legacy), "nv")).toHaveLength(1);
  });

  it("R6 · Done · Cancelled · xoá mềm · không hạn · không phụ trách · +3 ngày · khác office ⇒ 0 bản", async () => {
    for (const k of ["done", "cancelled", "deleted", "noDue", "noAssignee", "far", "otherType"]) {
      expect(await reminderCount(A.companyId, t[k] as string), k).toBe(0);
    }
  });

  it("R11 · hồ sơ người phụ trách đã inactive ⇒ không nhắc ai (không rơi về cột đồng bộ)", async () => {
    expect(await reminderCount(A.companyId, t.inactive as string)).toBe(0);
  });

  it("R3 · chạy thêm 2 lượt ⇒ vẫn đúng 1 bản/người", async () => {
    await run(A.companyId);
    await run(A.companyId);
    expect(await rows(A.companyId, DUE_SOON, t.dueSoon)).toHaveLength(1);
    const overdue = await rows(A.companyId, OVERDUE, t.overdue);
    expect(of(overdue, "nv")).toHaveLength(1);
    expect(of(overdue, "rep")).toHaveLength(1);
  });

  it("R4a · người phụ trách xoá mềm TASK_OVERDUE ⇒ chạy lại 0 bản mới; reporter vẫn đúng 1", async () => {
    await deleteOwn("nv", OVERDUE, t.overdue);
    await run(A.companyId);
    const list = await rows(A.companyId, OVERDUE, t.overdue);
    expect(of(list, "nv").map((r) => r.deleted)).toEqual([true]);
    expect(of(list, "rep").map((r) => r.deleted)).toEqual([false]);
  });

  it("R4b · người phụ trách xoá mềm TASK_DUE_SOON ⇒ chạy lại 0 bản mới", async () => {
    await deleteOwn("nv", DUE_SOON, t.dueSoon);
    await run(A.companyId);
    expect(of(await rows(A.companyId, DUE_SOON, t.dueSoon), "nv").map((r) => r.deleted)).toEqual([
      true,
    ]);
  });

  it("R4c · lọc theo từng người nhận: NV đã xoá vẫn bị bỏ, reporter mới vào vẫn nhận đúng 1", async () => {
    expect(of(await rows(A.companyId, OVERDUE, t.perRecipient), "rep")).toHaveLength(0);
    await deleteOwn("nv", OVERDUE, t.perRecipient);
    await direct.query(
      "UPDATE tasks SET reporter_employee_id = $2, creator_user_id = $3 WHERE id = $1",
      [t.perRecipient, emp.rep, uid.rep],
    );
    await run(A.companyId);
    const list = await rows(A.companyId, OVERDUE, t.perRecipient);
    expect(of(list, "nv").map((r) => r.deleted)).toEqual([true]);
    expect(of(list, "rep").map((r) => r.deleted)).toEqual([false]);
  });

  it("R5 · đổi hạn sang mốc quá hạn khác ⇒ thêm đúng 1 bản/người với khoá mới", async () => {
    const before = await rows(A.companyId, OVERDUE, t.overdue);
    const res = await as("rep", "post", `/tasks/${t.overdue}/change-deadline`).send({
      dueAt: fromNow(-3 * HOUR_MS),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await run(A.companyId);
    const after = await rows(A.companyId, OVERDUE, t.overdue);
    expect(of(after, "nv")).toHaveLength(2);
    expect(of(after, "rep")).toHaveLength(2);
    const newKeys = new Set(after.slice(before.length).map((r) => r.dedupeKey));
    expect(newKeys.size).toBe(1);
    expect(before.map((r) => r.dedupeKey)).not.toContain([...newKeys][0]);
  });

  it("R7 · lookback 7 ngày: −8 ngày không nhắc và được ĐẾM; −6 ngày vẫn nhắc (cùng một lượt)", async () => {
    t.old8 = await mkTask("rep", "duerem-r7-minus-8d", "nv", -8 * DAY_MS);
    t.old6 = await mkTask("rep", "duerem-r7-minus-6d", "nv", -6 * DAY_MS);
    const res = await run(A.companyId);
    expect(await reminderCount(A.companyId, t.old8)).toBe(0);
    const recent = await rows(A.companyId, OVERDUE, t.old6);
    expect(of(recent, "nv")).toHaveLength(1);
    expect(of(recent, "rep")).toHaveLength(1);
    expect(meta(res, "overdueSkippedByLookback")).toBe(1);
  });

  it("R10 · intake ném ở một việc ⇒ việc khác vẫn được nhắc, failed = 1; gỡ lỗi ⇒ việc đó được nhắc", async () => {
    t.failing = await mkTask("rep", "duerem-r10-failing", "nv", -HOUR_MS);
    t.healthy = await mkTask("rep", "duerem-r10-healthy", "nv", -HOUR_MS);
    const engine = nest.get(NotificationEngineService);
    const original = engine.intake.bind(engine);
    const spy = vi.spyOn(engine, "intake").mockImplementation(async (companyId, dto) => {
      if (dto.sourceEntityId === t.failing) throw new Error("R10: lỗi giả ở một việc");
      return original(companyId, dto);
    });
    const res = await run(A.companyId).finally(() => spy.mockRestore());
    expect(res.failed).toBe(1);
    expect(res.success).toBe(res.total - 1);
    expect(await reminderCount(A.companyId, t.failing)).toBe(0);
    expect(of(await rows(A.companyId, OVERDUE, t.healthy), "nv")).toHaveLength(1);

    const retry = await run(A.companyId);
    expect(retry.failed).toBe(0);
    expect(of(await rows(A.companyId, OVERDUE, t.failing), "nv")).toHaveLength(1);
  });

  it("X1 · công ty B có việc quá hạn cùng hình dạng: chạy cho A không đọc/không phát cho B", async () => {
    const beforeB = await run(A.companyId);
    t.b = await mkTask("brep", "duerem-x1-b-overdue", "bnv", -2 * HOUR_MS);
    const afterB = await run(A.companyId);
    expect(await reminderCount(B.companyId, t.b)).toBe(0);
    expect(await reminderCount(A.companyId, t.b)).toBe(0);
    expect(meta(afterB, "overdueCount")).toBe(meta(beforeB, "overdueCount"));
    expect(meta(afterB, "dueSoonCount")).toBe(meta(beforeB, "dueSoonCount"));
    expect(afterB.total).toBe(beforeB.total);

    const forB = await run(B.companyId);
    expect(meta(forB, "overdueCount")).toBe(1);
    const bRows = await rows(B.companyId, OVERDUE, t.b);
    expect(bRows.map((r) => r.recipient).sort()).toEqual([uid.bnv, uid.brep].sort());
    const leaked = await direct.query(
      "SELECT count(*)::int AS n FROM notifications WHERE company_id = $1 AND recipient_user_id = ANY($2::uuid[])",
      [A.companyId, [uid.bnv, uid.brep]],
    );
    expect(leaked.rows[0].n).toBe(0);
  });

  it("R12 · biên cửa sổ: hạn = now và = now+24h là sắp hạn; = now−7d là quá hạn; sớm hơn 1 phút chỉ được đếm", async () => {
    // Mốc cố định 30 ngày tới (phút tròn) ⇒ các việc dưới đây không chạm lượt chạy đồng hồ thật của ca khác.
    const N = Math.ceil(Date.now() / 60_000) * 60_000 + 30 * DAY_MS;
    const MIN = 60_000;
    const at = (ms: number) => mkTaskAt(`duerem-r12-${ms}`, new Date(N + ms).toISOString());
    const e0 = await at(0);
    const e24 = await at(DAY_MS);
    const e24p = await at(DAY_MS + MIN);
    const o1 = await at(-MIN);
    const o7 = await at(-7 * DAY_MS);
    const o7m = await at(-7 * DAY_MS - MIN);
    const db = nest.get(DatabaseService);
    const read = (ms: number) =>
      db.withTenant(A.companyId, (tx) => queryReminderCandidates(tx, A.companyId, new Date(ms)));

    const c = await read(N);
    const soon = c.dueSoon.map((x) => x.id);
    const over = c.overdue.map((x) => x.id);
    expect(soon).toEqual(expect.arrayContaining([e0, e24]));
    expect(soon).not.toContain(e24p);
    expect(over).toEqual(expect.arrayContaining([o1, o7]));
    for (const id of [e0, o7m]) expect(over).not.toContain(id);
    for (const id of [o1, o7, o7m]) expect(soon).not.toContain(id);
    // Đếm bỏ-do-lookback: o7m vào tập đếm đúng tại N; o7 chỉ vào khi lookback vượt qua nó (N + 1 phút).
    expect(c.overdueSkippedByLookback - (await read(N - MIN)).overdueSkippedByLookback).toBe(1);
    expect((await read(N + MIN)).overdueSkippedByLookback - c.overdueSkippedByLookback).toBe(1);
  });
});
