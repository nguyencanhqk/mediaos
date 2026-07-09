import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S4-TASK-DB-1 — TASK Core deny-path (RED before GREEN, mig 0478).
 *
 * 1. RLS cross-tenant deny trên 5 bảng MỚI (task_assignees · task_watchers · task_checklists ·
 *    task_checklist_items · task_activity_logs): withTenant(A) KHÔNG thấy hàng B (USING) + INSERT
 *    company_id=B bị WITH CHECK chặn.
 * 2. task_activity_logs APPEND-ONLY (BẤT BIẾN #2): app role INSERT OK; UPDATE/DELETE bị DENY (thiếu GRANT).
 * 3. project_members partial-unique MỚI: 2 hàng ACTIVE cùng (company,project,employee) member_status='Active'
 *    → vi phạm uq_project_members_active_employee (đo bằng employee_id + CỘT-STATUS-MỚI, KHÔNG cột legacy).
 * 4. Legacy-row guard (Option-A evolve-additive): hàng tasks legacy (priority='none', status='not_started') +
 *    projects (status='active', priority NULL) chèn SẠCH sau khi CHECK mới apply — CHECK mới KHÔNG đụng cột
 *    legacy; enum legacy vẫn chạy. (Chứng minh ADD CONSTRAINT không FAIL trên hàng lowercase dev/prod.)
 *
 * Gate: hasDb && LANE_DB — .env làm hasDb=true → thiếu LANE_DB thì chạy DB dev chung ⇒ đỏ-giả
 * (memory: integration-test-lane-db-gate). LANE_DB bắt buộc cho DB cô lập mediaos_<lane>.
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

async function asTenant<T>(
  app: Pool,
  companyId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Seed 1 task office legacy + employee_profiles cho tenant → nền FK 5 bảng TASK mới (direct/superuser). */
async function seedTaskChain(
  direct: Pool,
  companyId: string,
): Promise<{ taskId: string; employeeId: string; userId: string }> {
  const userId = await seedUser(direct, companyId, `tc-${randomUUID().slice(0, 8)}@x.test`);
  const emp = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
    [companyId, userId],
  );
  const task = await direct.query(
    `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
     VALUES ($1, 'office', 'tc-task', 'not_started', 'initial', 0) RETURNING id`,
    [companyId],
  );
  return { taskId: task.rows[0].id as string, employeeId: emp.rows[0].id as string, userId };
}

/** Seed 1 hàng cho MỖI bảng TASK mới của tenant. Trả về map table → row id (để khẳng định cô lập chéo). */
async function seedTaskRowsForTenant(
  direct: Pool,
  companyId: string,
): Promise<{ ids: Record<string, string>; taskId: string; employeeId: string; userId: string }> {
  const { taskId, employeeId, userId } = await seedTaskChain(direct, companyId);

  const assignee = await direct.query(
    `INSERT INTO task_assignees (company_id, task_id, employee_id, assignee_role, status, assigned_by)
     VALUES ($1, $2, $3, 'Main', 'Active', $4) RETURNING id`,
    [companyId, taskId, employeeId, userId],
  );
  const watcher = await direct.query(
    `INSERT INTO task_watchers (company_id, task_id, employee_id, watcher_type, status, added_by)
     VALUES ($1, $2, $3, 'Manual', 'Active', $4) RETURNING id`,
    [companyId, taskId, employeeId, userId],
  );
  const checklist = await direct.query(
    `INSERT INTO task_checklists (company_id, task_id, title, order_index)
     VALUES ($1, $2, 'tc-checklist', 0) RETURNING id`,
    [companyId, taskId],
  );
  const item = await direct.query(
    `INSERT INTO task_checklist_items (company_id, task_id, checklist_id, title, is_done, order_index)
     VALUES ($1, $2, $3, 'tc-item', false, 0) RETURNING id`,
    [companyId, taskId, checklist.rows[0].id],
  );
  const log = await direct.query(
    `INSERT INTO task_activity_logs
       (company_id, task_id, actor_user_id, actor_employee_id, action, target_type, target_id)
     VALUES ($1, $2, $3, $4, 'TASK_CREATED', 'Task', $2) RETURNING id`,
    [companyId, taskId, userId, employeeId],
  );

  return {
    ids: {
      task_assignees: assignee.rows[0].id as string,
      task_watchers: watcher.rows[0].id as string,
      task_checklists: checklist.rows[0].id as string,
      task_checklist_items: item.rows[0].id as string,
      task_activity_logs: log.rows[0].id as string,
    },
    taskId,
    employeeId,
    userId,
  };
}

describe.skipIf(!hasLaneDb)("S4-TASK-DB-1 TASK Core deny-path + append-only + guards", () => {
  const direct = directPool();
  const app = appPool(2);

  let A: SeededTenant;
  let B: SeededTenant;
  let bRows: Record<string, string>;
  let bTaskId: string;
  let bEmployeeId: string;
  let aLogId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "task-deny-a");
    B = await seedCompany(direct, "task-deny-b");
    const b = await seedTaskRowsForTenant(direct, B.companyId);
    bRows = b.ids;
    bTaskId = b.taskId;
    bEmployeeId = b.employeeId;

    const a = await seedTaskRowsForTenant(direct, A.companyId);
    aLogId = a.ids.task_activity_logs;
  });

  afterAll(async () => {
    // Xoá tường minh 5 bảng mới TRƯỚC cleanupTenants (cleanupTenants chưa biết chúng — cascade qua tasks/
    // companies cũng phủ, nhưng xoá tường minh cho rõ thứ tự FK con→cha).
    for (const companyId of [A.companyId, B.companyId]) {
      await direct.query("DELETE FROM task_activity_logs WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM task_checklist_items WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM task_checklists WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM task_watchers WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM task_assignees WHERE company_id = $1", [companyId]);
    }
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  // ── 1. RLS cross-tenant deny trên 5 bảng mới ──────────────────────────────────
  const NEW_TABLES = [
    "task_assignees",
    "task_watchers",
    "task_checklists",
    "task_checklist_items",
    "task_activity_logs",
  ] as const;

  for (const table of NEW_TABLES) {
    it(`withTenant(A): KHÔNG SELECT được hàng ${table} của B (RLS USING)`, async () => {
      const rows = await asTenant(app, A.companyId, async (c) => {
        const r = await c.query(`SELECT id FROM ${table} WHERE id = $1`, [bRows[table]]);
        return r.rows;
      });
      expect(rows).toHaveLength(0);
    });
  }

  it("withTenant(A): INSERT task_assignees company_id=B bị RLS WITH CHECK chặn", async () => {
    await expect(
      asTenant(app, A.companyId, async (c) => {
        await c.query(
          `INSERT INTO task_assignees (company_id, task_id, employee_id, assignee_role, status)
           VALUES ($1, $2, $3, 'CoAssignee', 'Active')`,
          [B.companyId, bTaskId, bEmployeeId],
        );
      }),
    ).rejects.toThrow();
  });

  it("withTenant(A): INSERT task_activity_logs company_id=B bị RLS WITH CHECK chặn", async () => {
    await expect(
      asTenant(app, A.companyId, async (c) => {
        await c.query(
          `INSERT INTO task_activity_logs (company_id, task_id, action, target_type)
           VALUES ($1, $2, 'TASK_UPDATED', 'Task')`,
          [B.companyId, bTaskId],
        );
      }),
    ).rejects.toThrow();
  });

  // ── 2. task_activity_logs APPEND-ONLY (BẤT BIẾN #2) ───────────────────────────
  describe("task_activity_logs append-only (mediaos_app)", () => {
    it("INSERT via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
      const inserted = await asTenant(app, A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO task_activity_logs (action, target_type)
           VALUES ('TASK_STATUS_CHANGED', 'Task') RETURNING id`,
        );
        return r.rows[0].id as string;
      });
      expect(inserted).toBeTruthy();
    });

    it("app role UPDATE is DENIED (append-only — no UPDATE grant)", async () => {
      await expect(
        asTenant(app, A.companyId, async (c) => {
          await c.query(`UPDATE task_activity_logs SET message = 'mutated' WHERE id = $1`, [
            aLogId,
          ]);
        }),
      ).rejects.toThrow(/permission denied/);
    });

    it("app role DELETE is DENIED (append-only — no DELETE grant)", async () => {
      await expect(
        asTenant(app, A.companyId, async (c) => {
          await c.query(`DELETE FROM task_activity_logs WHERE id = $1`, [aLogId]);
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });

  // ── 3. project_members partial-unique MỚI (employee_id + member_status='Active') ──
  describe("project_members anti-dup theo CỘT MỚI (member_status='Active' + employee_id)", () => {
    it("2 member ACTIVE cùng (company,project,employee) → uq_project_members_active_employee violation", async () => {
      const proj = await direct.query(
        `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [A.companyId, `pm-dup-${randomUUID().slice(0, 8)}`],
      );
      const projectId = proj.rows[0].id as string;
      const u1 = await seedUser(direct, A.companyId, `pm1-${randomUUID().slice(0, 8)}@x.test`);
      const u2 = await seedUser(direct, A.companyId, `pm2-${randomUUID().slice(0, 8)}@x.test`);
      const emp = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [A.companyId, u1],
      );
      const employeeId = emp.rows[0].id as string;

      // user_id (legacy NOT NULL) khác nhau — chứng minh unique MỚI đo bằng employee_id, KHÔNG user_id.
      await direct.query(
        `INSERT INTO project_members (company_id, project_id, user_id, employee_id, member_status)
         VALUES ($1, $2, $3, $4, 'Active')`,
        [A.companyId, projectId, u1, employeeId],
      );
      await expect(
        direct.query(
          `INSERT INTO project_members (company_id, project_id, user_id, employee_id, member_status)
           VALUES ($1, $2, $3, $4, 'Active')`,
          [A.companyId, projectId, u2, employeeId],
        ),
      ).rejects.toThrow(/uq_project_members_active_employee|duplicate key/);
    });

    it("legacy project_members_active_uq (user_id) VẪN LIVE — 2 member cùng user_id active → violation", async () => {
      const proj = await direct.query(
        `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [A.companyId, `pm-legacy-${randomUUID().slice(0, 8)}`],
      );
      const projectId = proj.rows[0].id as string;
      const u = await seedUser(direct, A.companyId, `pml-${randomUUID().slice(0, 8)}@x.test`);
      await direct.query(
        `INSERT INTO project_members (company_id, project_id, user_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [A.companyId, projectId, u],
      );
      await expect(
        direct.query(
          `INSERT INTO project_members (company_id, project_id, user_id, status)
           VALUES ($1, $2, $3, 'active')`,
          [A.companyId, projectId, u],
        ),
      ).rejects.toThrow(/project_members_active_uq|duplicate key/);
    });
  });

  // ── 4. Legacy-row guard (Option-A evolve-additive) ────────────────────────────
  describe("legacy-row guard — CHECK mới KHÔNG đụng cột legacy lowercase", () => {
    it("tasks legacy (priority='none', status='not_started') chèn SẠCH sau CHECK mới", async () => {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round, priority)
         VALUES ($1, 'office', 'legacy-task', 'not_started', 'initial', 0, 'none') RETURNING id`,
        [A.companyId],
      );
      expect(r.rows[0].id).toBeTruthy();
    });

    it("projects legacy (status='active', priority NULL) chèn SẠCH sau CHECK mới", async () => {
      const r = await direct.query(
        `INSERT INTO projects (company_id, name, status, priority)
         VALUES ($1, $2, 'active', NULL) RETURNING id`,
        [A.companyId, `legacy-prj-${randomUUID().slice(0, 8)}`],
      );
      expect(r.rows[0].id).toBeTruthy();
    });

    it("cột MỚI task_status='Todo' hợp lệ; TitleCase sai 'todo' bị chk_tasks_task_status chặn", async () => {
      const ok = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round, task_status, task_priority)
         VALUES ($1, 'office', 'new-cols', 'not_started', 'initial', 0, 'Todo', 'High') RETURNING id`,
        [A.companyId],
      );
      expect(ok.rows[0].id).toBeTruthy();
      await expect(
        direct.query(
          `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round, task_status)
           VALUES ($1, 'office', 'bad-status', 'not_started', 'initial', 0, 'todo') RETURNING id`,
          [A.companyId],
        ),
      ).rejects.toThrow(/chk_tasks_task_status/);
    });
  });
});
