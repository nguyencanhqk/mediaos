import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S5-GOAL-DB-1 — GOAL core (goals + goal_updates) + seed module/perms/counter/audit + NOTI catalog.
 *   Migrations 0504–0507 (DB-11 §6/§9 · SPEC-10 §11/§17). RED-before-GREEN.
 *
 * Gate CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env trỏ DB dev chung → hasDb=true
 * nên assert chạm DB chung = ĐỎ-GIẢ; CHỈ chạy trên DB cô lập lane (LANE_DB=mediaos_goaldb1).
 * Colocated `test/**\/*.int-spec.ts` (memory src-green-is-not-integration-green).
 *
 * RED: DB migrate tới 0503 → bảng goals/goal_updates CHƯA có ⇒ seed throw ⇒ suite ĐỎ. GREEN sau 0504–0507.
 *
 * Phủ (plan §3):
 *   1. Cross-tenant deny (RLS+FORCE literal-GUC): app GUC=A KHÔNG thấy/ghi hàng của B.
 *   2. Append-only GRANT ở tầng grant: app UPDATE/DELETE goal_updates → 42501; app DELETE goals → 42501;
 *      app UPDATE goals (soft-delete) OK.
 *   3. CHECK 23514 đúng ca (anchor siết · period · weight · mode_project · self-parent).
 *   4. Seed-assert: module GOAL active · 7 perms is_sensitive=false · ma trận D5 (22 grant) · counter 'goal'
 *      mọi company · audit CHECK ⊇ 'goal' · 2 event GOAL enabled + template default vi-VN · CHECK module ⊇ 'GOAL'.
 *   5. FK: hard-delete goal → tasks.goal_id SET NULL, task.company_id KHÔNG đổi (bẫy composite #247).
 */

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

/** Chạy fn trong 1 transaction app-role có ngữ cảnh tenant (set_config txn-local — PgBouncer txn-mode). */
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
    try {
      await c.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    c.release();
  }
}

/** scope grant cho (role canonical system, action, resource); null nếu KHÔNG có hàng ALLOW. */
async function grantScope(
  direct: Pool,
  role: string,
  action: string,
  resource: string,
): Promise<string | null> {
  const res = await direct.query<{ data_scope: string }>(
    `SELECT rp.data_scope
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name=$1 AND r.company_id IS NULL AND r.deleted_at IS NULL
        AND p.action=$2 AND p.resource_type=$3 AND rp.effect='ALLOW'`,
    [role, action, resource],
  );
  return res.rows.length > 0 ? res.rows[0].data_scope : null;
}

async function seedEmployee(direct: Pool, companyId: string): Promise<string> {
  const u = await seedUser(direct, companyId, `goal-${randomUUID().slice(0, 8)}@x.test`);
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
    [companyId, u],
  );
  return r.rows[0].id as string;
}

/** Cột INSERT goals — mặc định 1 goal EMPLOYEE hợp lệ; override để dựng ca CHECK. */
interface GoalOverride {
  id?: string;
  level?: string;
  departmentId?: string | null;
  projectId?: string | null;
  employeeId?: string | null;
  parentGoalId?: string | null;
  periodStart?: string;
  periodEnd?: string;
  periodType?: string;
  measureType?: string;
  progressMode?: string;
  weight?: number;
  status?: string;
}

/** INSERT 1 goal (direct/superuser). Trả về {ok:true,id} hoặc {ok:false,code} (SQLSTATE, vd 23514). */
async function tryInsertGoal(
  direct: Pool,
  companyId: string,
  ownerEmployeeId: string,
  over: GoalOverride = {},
): Promise<{ ok: true; id: string } | { ok: false; code: string }> {
  const level = over.level ?? "employee";
  const employeeId =
    over.employeeId !== undefined ? over.employeeId : level === "employee" ? ownerEmployeeId : null;
  const cols = {
    id: over.id ?? randomUUID(),
    companyId,
    goalCode: `GOAL-${randomUUID().slice(0, 8)}`,
    name: "rls-goal",
    level,
    departmentId: over.departmentId ?? null,
    projectId: over.projectId ?? null,
    employeeId,
    parentGoalId: over.parentGoalId ?? null,
    ownerEmployeeId,
    periodType: over.periodType ?? "quarter",
    periodStart: over.periodStart ?? "2026-01-01",
    periodEnd: over.periodEnd ?? "2026-03-31",
    measureType: over.measureType ?? "percent",
    progressMode: over.progressMode ?? "manual",
    weight: over.weight ?? 1,
    status: over.status ?? "Draft",
  };
  try {
    const r = await direct.query(
      `INSERT INTO goals
         (id, company_id, goal_code, name, level, department_id, project_id, employee_id,
          parent_goal_id, owner_employee_id, period_type, period_start, period_end,
          measure_type, progress_mode, weight, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [
        cols.id,
        cols.companyId,
        cols.goalCode,
        cols.name,
        cols.level,
        cols.departmentId,
        cols.projectId,
        cols.employeeId,
        cols.parentGoalId,
        cols.ownerEmployeeId,
        cols.periodType,
        cols.periodStart,
        cols.periodEnd,
        cols.measureType,
        cols.progressMode,
        cols.weight,
        cols.status,
      ],
    );
    return { ok: true, id: r.rows[0].id as string };
  } catch (e) {
    return { ok: false, code: (e as { code?: string }).code ?? "" };
  }
}

// Ma trận D5 (SPEC-10 §11 + owner chốt 20/07/2026) — mirror plan. Role vắng = KHÔNG grant (deny).
const GOAL_ROLES = ["employee", "manager", "hr", "company-admin"] as const;
type GoalRole = (typeof GOAL_ROLES)[number];
const GOAL_MATRIX: Record<string, Partial<Record<GoalRole, string>>> = {
  access: { employee: "Own", manager: "Own", hr: "Own", "company-admin": "Own" },
  view: {
    employee: "Department",
    manager: "Department",
    hr: "Company",
    "company-admin": "Company",
  },
  create: { employee: "Own", manager: "Department", "company-admin": "Company" },
  update: { employee: "Own", manager: "Department", "company-admin": "Company" },
  delete: { employee: "Own", manager: "Department", "company-admin": "Company" },
  checkin: { employee: "Own", manager: "Department", "company-admin": "Company" },
  finalize: { manager: "Department", "company-admin": "Company" },
};
const GOAL_TOTAL_GRANTS = 22;

describe.skipIf(!runIsolatedDb)(
  "S5-GOAL-DB-1 GOAL core + seed + NOTI catalog (mig 0504–0507, DB cô lập LANE_DB)",
  () => {
    const direct = directPool();
    const app = appPool(2);

    let A: SeededTenant;
    let B: SeededTenant;
    let empA: string;
    let empB: string;
    let goalA: string;
    let goalB: string;
    let deptA: string;
    let projA: string;

    beforeAll(async () => {
      A = await seedCompany(direct, "goalA");
      B = await seedCompany(direct, "goalB");
      empA = await seedEmployee(direct, A.companyId);
      empB = await seedEmployee(direct, B.companyId);
      // org_unit + project của A cho các ca CHECK anchor.
      const dep = await direct.query(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id`,
        [A.companyId, `goal-dept-${randomUUID().slice(0, 8)}`],
      );
      deptA = dep.rows[0].id as string;
      const prj = await direct.query(
        `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [A.companyId, `goal-prj-${randomUUID().slice(0, 8)}`],
      );
      projA = prj.rows[0].id as string;

      const ga = await tryInsertGoal(direct, A.companyId, empA);
      const gb = await tryInsertGoal(direct, B.companyId, empB);
      if (!ga.ok || !gb.ok) throw new Error("seed goal failed (bảng goals chưa land?)");
      goalA = ga.id;
      goalB = gb.id;
      // 1 check-in ledger cho A (append-only tests).
      const uA = await direct.query(`SELECT user_id FROM employee_profiles WHERE id=$1`, [empA]);
      await direct.query(
        `INSERT INTO goal_updates (company_id, goal_id, update_type, actor_user_id, note)
         VALUES ($1, $2, 'checkin', $3, 'seed-checkin')`,
        [A.companyId, goalA, uA.rows[0].user_id],
      );
    });

    afterAll(async () => {
      // goals/goal_updates KHÔNG nằm trong cleanupTenants → dọn tường minh TRƯỚC (cascade cũng phủ, làm rõ thứ tự).
      for (const id of [A?.companyId, B?.companyId].filter(Boolean)) {
        await direct.query("DELETE FROM goal_updates WHERE company_id = $1", [id]);
        await direct.query("UPDATE tasks SET goal_id = NULL WHERE company_id = $1", [id]);
        await direct.query("DELETE FROM goals WHERE company_id = $1", [id]);
      }
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
    });

    // ── 1. Cross-tenant deny (RLS+FORCE literal-GUC) ──────────────────────────────
    describe("1. Cô lập tenant goals/goal_updates (RLS+FORCE)", () => {
      it("app GUC=A thấy goal của A, KHÔNG thấy goal của B", async () => {
        const seen = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query<{ id: string }>("SELECT id FROM goals");
          return new Set(r.rows.map((x) => x.id));
        });
        expect(seen.has(goalA)).toBe(true);
        expect(seen.has(goalB)).toBe(false);
      });

      it("app GUC=A thấy goal_update của A, KHÔNG thấy của B", async () => {
        // seed 1 update cho B để so
        const uB = await direct.query(`SELECT user_id FROM employee_profiles WHERE id=$1`, [empB]);
        const gb = await direct.query(
          `INSERT INTO goal_updates (company_id, goal_id, update_type, actor_user_id)
           VALUES ($1, $2, 'checkin', $3) RETURNING id`,
          [B.companyId, goalB, uB.rows[0].user_id],
        );
        const idB = gb.rows[0].id as string;
        const seen = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query<{ id: string }>("SELECT id FROM goal_updates");
          return new Set(r.rows.map((x) => x.id));
        });
        expect(seen.has(idB)).toBe(false);
      });

      it("app GUC=A KHÔNG chèn được goal company_id=B (WITH CHECK chặn forge tenant)", async () => {
        await expect(
          asTenant(app, A.companyId, (c) =>
            c.query(
              `INSERT INTO goals
                 (company_id, goal_code, name, level, employee_id, owner_employee_id,
                  period_type, period_start, period_end)
               VALUES ($1, $2, 'forge', 'employee', $3, $3, 'quarter', '2026-01-01', '2026-03-31')`,
              [B.companyId, `GOAL-forge-${randomUUID().slice(0, 8)}`, empB],
            ),
          ),
        ).rejects.toThrow(/row-level security/i);
      });

      it("app ngoài ngữ cảnh tenant → 0 goal", async () => {
        const c = await app.connect();
        try {
          const r = await c.query("SELECT id FROM goals");
          expect(r.rows).toHaveLength(0);
        } finally {
          c.release();
        }
      });
    });

    // ── 2. Append-only GRANT (BẤT BIẾN #2 ở tầng grant, KHÔNG service) ─────────────
    describe("2. Append-only goal_updates + soft-delete goals (grant)", () => {
      it("app INSERT goal_update (đúng tenant) THÀNH CÔNG", async () => {
        const uA = await direct.query(`SELECT user_id FROM employee_profiles WHERE id=$1`, [empA]);
        const inserted = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query(
            `INSERT INTO goal_updates (company_id, goal_id, update_type, actor_user_id)
             VALUES ($1, $2, 'checkin', $3) RETURNING id`,
            [A.companyId, goalA, uA.rows[0].user_id],
          );
          return r.rows[0].id as string;
        });
        expect(inserted).toBeTruthy();
      });

      it("app UPDATE goal_updates bị TỪ CHỐI (append-only — KHÔNG GRANT UPDATE)", async () => {
        await expect(
          asTenant(app, A.companyId, (c) =>
            c.query(`UPDATE goal_updates SET note = 'x' WHERE company_id = $1`, [A.companyId]),
          ),
        ).rejects.toThrow(/permission denied/);
      });

      it("app DELETE goal_updates bị TỪ CHỐI (append-only — KHÔNG GRANT DELETE)", async () => {
        await expect(
          asTenant(app, A.companyId, (c) =>
            c.query(`DELETE FROM goal_updates WHERE company_id = $1`, [A.companyId]),
          ),
        ).rejects.toThrow(/permission denied/);
      });

      it("app UPDATE goals (soft-delete) THÀNH CÔNG (GRANT UPDATE)", async () => {
        const g = await tryInsertGoal(direct, A.companyId, empA);
        if (!g.ok) throw new Error("seed goal for soft-delete failed");
        await asTenant(app, A.companyId, (c) =>
          c.query(`UPDATE goals SET deleted_at = now() WHERE id = $1`, [g.id]),
        );
        const r = await direct.query(`SELECT deleted_at FROM goals WHERE id=$1`, [g.id]);
        expect(r.rows[0].deleted_at).not.toBeNull();
      });

      it("app DELETE goals bị TỪ CHỐI (soft-delete only — KHÔNG GRANT DELETE)", async () => {
        await expect(
          asTenant(app, A.companyId, (c) => c.query(`DELETE FROM goals WHERE id = $1`, [goalA])),
        ).rejects.toThrow(/permission denied/);
      });
    });

    // ── 3. CHECK 23514 đúng ca (bản anchor SIẾT) ─────────────────────────────────
    describe("3. CHECK constraint 23514 (DB-11 §6.1)", () => {
      it("level=department + project_id set → 23514 (anchor)", async () => {
        const r = await tryInsertGoal(direct, A.companyId, empA, {
          level: "department",
          departmentId: deptA,
          projectId: projA,
          employeeId: null,
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe("23514");
      });

      it("level=project + department_id set → 23514 (anchor SIẾT — neo thừa)", async () => {
        const r = await tryInsertGoal(direct, A.companyId, empA, {
          level: "project",
          projectId: projA,
          departmentId: deptA,
          employeeId: null,
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe("23514");
      });

      it("level=employee + project_id set → 23514 (anchor SIẾT)", async () => {
        const r = await tryInsertGoal(direct, A.companyId, empA, {
          level: "employee",
          employeeId: empA,
          projectId: projA,
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe("23514");
      });

      it("period_end < period_start → 23514", async () => {
        const r = await tryInsertGoal(direct, A.companyId, empA, {
          periodStart: "2026-03-31",
          periodEnd: "2026-01-01",
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe("23514");
      });

      it("weight=0 → 23514", async () => {
        const r = await tryInsertGoal(direct, A.companyId, empA, { weight: 0 });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe("23514");
      });

      it("progress_mode='project' + level='employee' → 23514 (GOAL-ERR-012)", async () => {
        const r = await tryInsertGoal(direct, A.companyId, empA, {
          level: "employee",
          employeeId: empA,
          progressMode: "project",
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe("23514");
      });

      it("parent_goal_id = id → 23514 (no self-parent)", async () => {
        const selfId = randomUUID();
        const r = await tryInsertGoal(direct, A.companyId, empA, {
          id: selfId,
          parentGoalId: selfId,
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe("23514");
      });

      it("goal hợp lệ (employee, mode manual) INSERT OK — chứng minh CHECK không quá chặt", async () => {
        const r = await tryInsertGoal(direct, A.companyId, empA);
        expect(r.ok).toBe(true);
      });
    });

    // ── 4. Seed-assert (module · perms · grant D5 · counter · audit CHECK · NOTI) ──
    describe("4. Seed nghiệp vụ (mig 0506 + 0507)", () => {
      it("module GOAL active (Collaboration, sort_order 6)", async () => {
        const r = await direct.query<{ is_active: boolean; module_group: string }>(
          `SELECT is_active, module_group FROM modules WHERE module_code='GOAL' AND deleted_at IS NULL`,
        );
        expect(r.rows.length).toBe(1);
        expect(r.rows[0].is_active).toBe(true);
        expect(r.rows[0].module_group).toBe("Collaboration");
      });

      it("7 cặp quyền goal tồn tại, is_sensitive=false (D1)", async () => {
        const r = await direct.query<{ action: string; is_sensitive: boolean }>(
          `SELECT action, is_sensitive FROM permissions WHERE resource_type='goal'`,
        );
        const actions = new Set(r.rows.map((x) => x.action));
        for (const a of ["access", "view", "create", "update", "delete", "checkin", "finalize"]) {
          expect(actions.has(a), `thiếu cặp (${a}:goal)`).toBe(true);
        }
        expect(r.rows.length).toBe(7);
        expect(r.rows.every((x) => x.is_sensitive === false)).toBe(true);
      });

      for (const action of Object.keys(GOAL_MATRIX)) {
        for (const role of GOAL_ROLES) {
          const expected = GOAL_MATRIX[action][role] ?? null;
          it(`grant ${role} (${action}:goal) = ${expected ?? "—"}`, async () => {
            expect(await grantScope(direct, role, action, "goal")).toBe(expected);
          });
        }
      }

      it("employee KHÔNG có finalize:goal (D5)", async () => {
        expect(await grantScope(direct, "employee", "finalize", "goal")).toBeNull();
      });

      it("hr KHÔNG có cặp ghi (create/update/delete/checkin/finalize):goal (D5)", async () => {
        for (const a of ["create", "update", "delete", "checkin", "finalize"]) {
          expect(await grantScope(direct, "hr", a, "goal"), `hr KHÔNG được ${a}:goal`).toBeNull();
        }
      });

      it("tổng grant goal cho 4 role canonical = 22 (chống over/under-grant)", async () => {
        const r = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name = ANY($1) AND r.company_id IS NULL AND r.deleted_at IS NULL
              AND rp.effect='ALLOW' AND p.resource_type='goal'`,
          [[...GOAL_ROLES]],
        );
        expect(r.rows[0].n).toBe(GOAL_TOTAL_GRANTS);
      });

      it("counter 'goal' cho MỌI company có-lúc-migrate (prefix GOAL-, pad 4, Never, Company)", async () => {
        // Loại A/B (test tạo SAU migrate — company mới nhận counter ở company-creation-time, không phải migration).
        // Verify (c) trong 0506 đã ép per-company coverage TẠI migrate-time; test khẳng định shape + coverage
        // cho mọi company có TRƯỚC test (đúng ý plan "MỌI company" ở thời điểm seed).
        const r = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM companies c
            WHERE c.id <> ALL($1::uuid[])
              AND NOT EXISTS (
                SELECT 1 FROM sequence_counters sc
                 WHERE sc.company_id = c.id AND sc.sequence_key='goal'
                   AND sc.scope_type='Company' AND sc.prefix='GOAL-'
                   AND sc.padding_length=4 AND sc.reset_policy='Never' AND sc.deleted_at IS NULL
              )`,
          [[A.companyId, B.companyId]],
        );
        expect(r.rows[0].n, "company thiếu counter goal ⇒ nextCode goal đầu tiên sẽ 404").toBe(0);
      });

      it("audit_logs CHECK object_type ⊇ 'goal'", async () => {
        // 0474 re-stamp dạng '{...}'::text[] (giá trị BARE, không nháy) ⇒ khớp biên [,{']goal[',}] (phủ cả
        // dạng bare ',goal,' lẫn ARRAY-quoted 'goal'), KHÔNG dùng includes("'goal'") (mất khớp form bare).
        const r = await direct.query<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid='audit_logs'::regclass AND contype='c' AND conname LIKE '%object_type%'`,
        );
        expect(r.rows.some((x) => /[,{']goal[',}]/.test(x.def))).toBe(true);
      });

      it("chk_notification_events_module_code ⊇ 'GOAL'", async () => {
        const r = await direct.query<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid='notification_events'::regclass
              AND conname='chk_notification_events_module_code'`,
        );
        expect(r.rows.length).toBe(1);
        expect(r.rows[0].def.includes("'GOAL'")).toBe(true);
      });

      for (const ev of ["GOAL_ASSIGNED", "GOAL_FINALIZED"]) {
        it(`event ${ev} enabled + template default IN_APP/vi-VN`, async () => {
          const e = await direct.query<{
            is_enabled: boolean;
            module_code: string;
            notification_type: string;
          }>(
            `SELECT is_enabled, module_code, notification_type FROM notification_events
              WHERE event_code=$1 AND company_id IS NULL AND deleted_at IS NULL`,
            [ev],
          );
          expect(e.rows.length, `event ${ev} phải tồn tại GLOBAL`).toBe(1);
          expect(e.rows[0].is_enabled).toBe(true);
          expect(e.rows[0].module_code).toBe("GOAL");
          expect(e.rows[0].notification_type).toBe("Goal");

          const t = await direct.query<{ body_len: number; is_default: boolean; status: string }>(
            `SELECT COALESCE(length(t.body_template),0) AS body_len, t.is_default, t.status
               FROM notification_templates t
               JOIN notification_events ev ON ev.id = t.event_id
              WHERE ev.event_code=$1 AND ev.company_id IS NULL
                AND t.company_id IS NULL AND t.deleted_at IS NULL
                AND t.channel='IN_APP' AND t.locale='vi-VN'`,
            [ev],
          );
          expect(t.rows.length, `event ${ev} phải có ĐÚNG 1 template IN_APP/vi-VN`).toBe(1);
          expect(t.rows[0].status).toBe("Active");
          expect(t.rows[0].is_default).toBe(true);
          expect(t.rows[0].body_len).toBeGreaterThan(0);
        });
      }
    });

    // ── 5. FK hành vi: hard-delete goal → tasks.goal_id SET NULL (đơn cột, KHÔNG composite) ──
    describe("5. FK tasks.goal_id ON DELETE SET NULL (mig 0505)", () => {
      it("xoá cứng goal → task.goal_id NULL, task.company_id KHÔNG đổi", async () => {
        const g = await tryInsertGoal(direct, A.companyId, empA);
        if (!g.ok) throw new Error("seed goal for FK failed");
        const task = await direct.query(
          `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round, goal_id)
           VALUES ($1, 'office', 'goal-linked', 'not_started', 'initial', 0, $2) RETURNING id`,
          [A.companyId, g.id],
        );
        const taskId = task.rows[0].id as string;
        await direct.query(`DELETE FROM goals WHERE id = $1`, [g.id]);
        const r = await direct.query<{ goal_id: string | null; company_id: string }>(
          `SELECT goal_id, company_id FROM tasks WHERE id=$1`,
          [taskId],
        );
        expect(r.rows[0].goal_id).toBeNull();
        expect(r.rows[0].company_id).toBe(A.companyId);
      });
    });
  },
);
