import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { CostRepository } from "../../src/finance/cost.repository";
// 🔴 RED: chưa tồn tại — G13-4 GREEN phải tạo ExpenseRequestService/Repository + FinanceTasksService.
//    Import này khiến CẢ suite ĐỎ (module-not-found) ĐÚNG LÝ DO. KHÔNG implement GREEN ở đây.
import { ExpenseRequestService } from "../../src/finance/expense.service";
import { ExpenseRequestRepository } from "../../src/finance/expense.repository";
import { FinanceTasksService } from "../../src/finance/finance-tasks.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedRole,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * G13-4 — Expense Request DENY-PATH (RED-first, TDD §6 / TASKS §5.5).
 * Đề xuất chi duyệt QUA Task Hub (task_type='finance', BẤT BIẾN #4) → khi duyệt SINH cost_record
 * (lineage qua expense_request_id) + ghi expense_approvals (log append-only) + audit. Mirror
 * finance-cost-deny.int-spec.ts. 5 nhóm chốt GREEN phải thoả:
 *
 *  (a) RLS 2-tenant   — ExpenseRequestService.list(A) thấy expense A KHÔNG thấy B (0 row); APP role
 *                       ngoài ngữ cảnh KHÔNG SELECT expense_requests/expense_approvals tenant khác.
 *  (b) Permission fail-closed CREATE — thiếu create:expense-request → ForbiddenException, KHÔNG đổi
 *                       số expense + KHÔNG sinh task (check NGOÀI tx ⇒ 0 side-effect).
 *  (c) Permission fail-closed APPROVE — thiếu approve:expense-request (employee …0008 chỉ create/read)
 *                       → ForbiddenException khi decide(approved); KHÔNG cost_record + KHÔNG approval +
 *                       expense.status vẫn 'pending'.
 *  (d) Append-only expense_approvals — app role bị DB từ chối UPDATE/DELETE; double-approve cùng level
 *                       vi phạm expense_approvals_request_level_uq.
 *  (e) Audit + lineage — create() ghi task_type='finance' + audit 'ExpenseRequestCreated'; approve()
 *                       1 tx sinh cost_record(entry_kind='original', expense_request_id) + approval +
 *                       status='approved'+cost_record_id + đóng task + audit 'ExpenseApproved'/'CostCreated';
 *                       reject() ghi approval(rejected, comment) + status='rejected' + đóng task, KHÔNG cost.
 *
 * Postgres THẬT (CI; local cần Docker). KHÔNG mock RLS (rủi ro "ảo tưởng xanh", plan G2 §6).
 */
describe.skipIf(!hasDb)(
  "G13-4 expense deny-path (RLS 2-tenant + permission fail-closed + append-only + audit/lineage)",
  () => {
    const direct = directPool();
    const app = appPool(2);
    let A: SeededTenant;
    let B: SeededTenant;
    let userA: string;
    let userB: string;
    /** finance-manager (…000a) — có create/read/approve:expense-request + view-finance. */
    let financeUserA: string;
    /** employee (…0008) — chỉ create/read:expense-request, KHÔNG approve. */
    let employeeA: string;
    /** approver hợp lệ tenant A (active) — nhận task duyệt. */
    let approverA: string;
    let svc: ExpenseRequestService;

    /** Seed 1 expense pending qua DIRECT (bypass RLS) cho tenant t. Trả id. */
    async function seedExpense(t: SeededTenant, requestedBy: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO expense_requests
           (company_id, requested_by, title, amount, currency, expense_type, status)
         VALUES ($1, $2, 'Seed expense', 500.00, 'VND', 'software', 'pending') RETURNING id`,
        [t.companyId, requestedBy],
      );
      return r.rows[0].id as string;
    }

    /** Seed 1 approval log qua DIRECT cho 1 expense (để test append-only/uq). Trả id. */
    async function seedApproval(
      companyId: string,
      expenseRequestId: string,
      approverUserId: string,
      level = 1,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO expense_approvals
           (company_id, expense_request_id, approval_level, approver_user_id, decision)
         VALUES ($1, $2, $3, $4, 'approved') RETURNING id`,
        [companyId, expenseRequestId, level, approverUserId],
      );
      return r.rows[0].id as string;
    }

    async function countExpense(companyId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM expense_requests WHERE company_id = $1`,
        [companyId],
      );
      return r.rows[0].n as number;
    }

    async function countCost(companyId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM cost_records WHERE company_id = $1`,
        [companyId],
      );
      return r.rows[0].n as number;
    }

    async function countApprovals(expenseRequestId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM expense_approvals WHERE expense_request_id = $1`,
        [expenseRequestId],
      );
      return r.rows[0].n as number;
    }

    async function countFinanceTasks(companyId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM tasks WHERE company_id = $1 AND task_type = 'finance'`,
        [companyId],
      );
      return r.rows[0].n as number;
    }

    async function countExpenseAudit(companyId: string, action?: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
         WHERE company_id = $1 AND object_type = 'expense_request'
           AND ($2::text IS NULL OR action = $2)`,
        [companyId, action ?? null],
      );
      return r.rows[0].n as number;
    }

    async function getExpense(id: string): Promise<{ status: string; costRecordId: string | null }> {
      const r = await direct.query(
        `SELECT status, cost_record_id FROM expense_requests WHERE id = $1`,
        [id],
      );
      return { status: r.rows[0].status as string, costRecordId: r.rows[0].cost_record_id };
    }

    /** Chạy 1 câu lệnh qua APP role trong ngữ cảnh tenant (set_config local). */
    async function asApp<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
        const out = await fn(c);
        await c.query("ROLLBACK");
        return out;
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

    beforeAll(async () => {
      A = await seedCompany(direct, "expA");
      B = await seedCompany(direct, "expB");
      userA = await seedUser(direct, A.companyId, `exp-a-${randomUUID().slice(0, 8)}@a.test`);
      userB = await seedUser(direct, B.companyId, `exp-b-${randomUUID().slice(0, 8)}@b.test`);
      approverA = await seedUser(direct, A.companyId, `exp-approver-${randomUUID().slice(0, 8)}@a.test`);

      // finance-manager (…000a) — create/read/approve:expense-request (seed 0074).
      financeUserA = await seedUser(direct, A.companyId, `exp-mgr-${randomUUID().slice(0, 8)}@a.test`);
      await seedUserRole(direct, financeUserA, "00000000-0000-0000-0000-00000000000a", A.companyId);

      // employee (…0008) — chỉ create/read:expense-request, KHÔNG approve (seed 0074).
      employeeA = await seedUser(direct, A.companyId, `exp-emp-${randomUUID().slice(0, 8)}@a.test`);
      await seedUserRole(direct, employeeA, "00000000-0000-0000-0000-000000000008", A.companyId);

      const db = new DatabaseService();
      const audit = new AuditService();
      const outbox = new OutboxService();
      const permission = new PermissionService(new PermissionRepository(db));
      const financeTasks = new FinanceTasksService();
      const costRepo = new CostRepository(db);
      svc = new ExpenseRequestService(
        db,
        new ExpenseRequestRepository(db),
        costRepo,
        financeTasks,
        permission,
        audit,
        outbox,
      );
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
    });

    // ── (a) RLS 2-tenant — login A KHÔNG đọc expense của B ───────────────────────
    describe("(a) RLS 2-tenant isolation", () => {
      it("ExpenseRequestService.list(A) thấy expense A, KHÔNG thấy expense B", async () => {
        const expA = await seedExpense(A, userA);
        const expB = await seedExpense(B, userB);
        const rows = await svc.list(A.companyId, financeUserA, {});
        const ids = new Set(rows.map((r) => r.id));
        expect(ids.has(expA)).toBe(true);
        expect(ids.has(expB)).toBe(false);
      });

      it("APP role khác ngữ cảnh → KHÔNG SELECT expense_requests tenant khác (0 row)", async () => {
        const expB = await seedExpense(B, userB);
        const seen = await asApp(A.companyId, async (c) => {
          const r = await c.query(`SELECT id FROM expense_requests WHERE id = $1`, [expB]);
          return r.rowCount ?? 0;
        });
        expect(seen).toBe(0);
      });

      it("APP role khác ngữ cảnh → KHÔNG SELECT expense_approvals tenant khác (0 row)", async () => {
        const expB = await seedExpense(B, userB);
        const apvB = await seedApproval(B.companyId, expB, userB);
        const seen = await asApp(A.companyId, async (c) => {
          const r = await c.query(`SELECT id FROM expense_approvals WHERE id = $1`, [apvB]);
          return r.rowCount ?? 0;
        });
        expect(seen).toBe(0);
      });
    });

    // ── (b) Permission fail-closed CREATE — thiếu create:expense-request → 403, 0 side-effect ──
    describe("(b) permission deny CREATE (fail-closed, 0 side-effect)", () => {
      it("create thiếu create:expense-request → ForbiddenException, KHÔNG expense + KHÔNG task", async () => {
        // userA: role rỗng (không quyền nào).
        const emptyRole = await seedRole(direct, A.companyId, `exp-noperm-${randomUUID().slice(0, 8)}`);
        await seedUserRole(direct, userA, emptyRole, A.companyId);

        const beforeExp = await countExpense(A.companyId);
        const beforeTask = await countFinanceTasks(A.companyId);
        await expect(
          svc.create(A.companyId, userA, {
            title: "Mua phần mềm dựng video",
            amount: 1234.56,
            currency: "VND",
            expenseType: "software",
            approverUserId: approverA,
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        // fail-closed: check NGOÀI tx ⇒ KHÔNG mở tx ⇒ 0 side-effect.
        expect(await countExpense(A.companyId)).toBe(beforeExp);
        expect(await countFinanceTasks(A.companyId)).toBe(beforeTask);
      });
    });

    // ── (c) Permission fail-closed APPROVE — employee thiếu approve → 403, KHÔNG cost/approval ──
    describe("(c) permission deny APPROVE (fail-closed)", () => {
      it("employee (chỉ create/read) decide(approved) → 403, KHÔNG cost + KHÔNG approval + status='pending'", async () => {
        const exp = await seedExpense(A, employeeA);
        const beforeCost = await countCost(A.companyId);

        await expect(
          svc.decide(A.companyId, employeeA, exp, { decision: "approved" }),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(await countCost(A.companyId)).toBe(beforeCost);
        expect(await countApprovals(exp)).toBe(0);
        expect((await getExpense(exp)).status).toBe("pending");
      });
    });

    // ── (d) Append-only expense_approvals — app role no UPDATE/DELETE + uq chặn double ──────────
    describe("(d) append-only expense_approvals", () => {
      it("app role KHÔNG có quyền UPDATE expense_approvals (grant SELECT,INSERT only)", async () => {
        const exp = await seedExpense(A, userA);
        const apv = await seedApproval(A.companyId, exp, approverA);
        await expect(
          asApp(A.companyId, (c) =>
            c.query(`UPDATE expense_approvals SET decision = 'rejected' WHERE id = $1`, [apv]),
          ),
        ).rejects.toThrow(/permission denied|must be owner/i);
      });

      it("app role KHÔNG có quyền DELETE expense_approvals", async () => {
        const exp = await seedExpense(A, userA);
        const apv = await seedApproval(A.companyId, exp, approverA);
        await expect(
          asApp(A.companyId, (c) =>
            c.query(`DELETE FROM expense_approvals WHERE id = $1`, [apv]),
          ),
        ).rejects.toThrow(/permission denied|must be owner/i);
      });

      it("double-approve cùng level → vi phạm expense_approvals_request_level_uq", async () => {
        const exp = await seedExpense(A, userA);
        await seedApproval(A.companyId, exp, approverA, 1);
        await expect(
          direct.query(
            `INSERT INTO expense_approvals
               (company_id, expense_request_id, approval_level, approver_user_id, decision)
             VALUES ($1, $2, 1, $3, 'approved')`,
            [A.companyId, exp, financeUserA],
          ),
        ).rejects.toThrow(/request_level_uq|duplicate key/i);
      });

      it("ExpenseRequestService KHÔNG có update()/delete() — chỉ create()/decide()/list()", () => {
        expect((svc as unknown as Record<string, unknown>).update).toBeUndefined();
        expect((svc as unknown as Record<string, unknown>).delete).toBeUndefined();
        expect(typeof svc.create).toBe("function");
        expect(typeof svc.decide).toBe("function");
        expect(typeof svc.list).toBe("function");
      });
    });

    // ── (e) Audit + lineage — create/approve/reject ─────────────────────────────
    describe("(e) audit + lineage on create / approve / reject", () => {
      it("create() ghi task_type='finance' + audit 'ExpenseRequestCreated' CÙNG tx", async () => {
        const beforeExp = await countExpense(A.companyId);
        const beforeTask = await countFinanceTasks(A.companyId);
        const beforeAudit = await countExpenseAudit(A.companyId, "ExpenseRequestCreated");

        const row = await svc.create(A.companyId, financeUserA, {
          title: "Mua license Adobe",
          description: "Creative Cloud team dựng",
          amount: 4321.5,
          currency: "VND",
          expenseType: "software",
          approverUserId: approverA,
        });

        expect(row.status).toBe("pending");
        // số tiền KHÔNG mask (requester/approver thấy số mình đề xuất).
        expect(row.amount).toBe(4321.5);
        expect(row.taskId).toBeTruthy();

        expect(await countExpense(A.companyId)).toBe(beforeExp + 1);
        expect(await countFinanceTasks(A.companyId)).toBe(beforeTask + 1);
        expect(await countExpenseAudit(A.companyId, "ExpenseRequestCreated")).toBe(beforeAudit + 1);
      });

      it("decide(approved) 1 tx: sinh cost_record(original, expense_request_id) + approval + status + đóng task + audit", async () => {
        const created = await svc.create(A.companyId, financeUserA, {
          title: "Thuê freelancer dựng",
          amount: 2000.0,
          currency: "VND",
          expenseType: "freelancer",
          approverUserId: approverA,
        });

        const beforeCost = await countCost(A.companyId);
        const beforeApproved = await countExpenseAudit(A.companyId, "ExpenseApproved");

        const decided = await svc.decide(A.companyId, financeUserA, created.id, {
          decision: "approved",
        });

        expect(decided.status).toBe("approved");
        expect(decided.costRecordId).toBeTruthy();

        // cost sinh từ duyệt: entry_kind='original' + expense_request_id = lineage.
        const cost = await direct.query(
          `SELECT entry_kind, expense_request_id, amount::text, cost_type FROM cost_records WHERE id = $1`,
          [decided.costRecordId],
        );
        expect(cost.rows[0].entry_kind).toBe("original");
        expect(cost.rows[0].expense_request_id).toBe(created.id);
        expect(cost.rows[0].amount).toBe("2000.00");

        expect(await countCost(A.companyId)).toBe(beforeCost + 1);
        expect(await countApprovals(created.id)).toBe(1);

        // expense persisted status + cost_record_id.
        const persisted = await getExpense(created.id);
        expect(persisted.status).toBe("approved");
        expect(persisted.costRecordId).toBe(decided.costRecordId);

        // task duyệt đã đóng (status approved).
        const task = await direct.query(`SELECT status FROM tasks WHERE id = $1`, [created.taskId]);
        expect(task.rows[0].status).toBe("approved");

        expect(await countExpenseAudit(A.companyId, "ExpenseApproved")).toBe(beforeApproved + 1);
      });

      it("decide(rejected) ghi approval(rejected, comment) + status='rejected' + đóng task, KHÔNG cost", async () => {
        const created = await svc.create(A.companyId, financeUserA, {
          title: "Mua thiết bị (sẽ bị từ chối)",
          amount: 9999.0,
          currency: "VND",
          expenseType: "equipment",
          approverUserId: approverA,
        });

        const beforeCost = await countCost(A.companyId);
        const beforeRejected = await countExpenseAudit(A.companyId, "ExpenseRejected");

        const decided = await svc.decide(A.companyId, financeUserA, created.id, {
          decision: "rejected",
          comment: "Vượt ngân sách quý",
        });

        expect(decided.status).toBe("rejected");
        expect(decided.costRecordId).toBeNull();
        expect(await countCost(A.companyId)).toBe(beforeCost); // KHÔNG sinh cost.
        expect(await countApprovals(created.id)).toBe(1);
        expect((await getExpense(created.id)).status).toBe("rejected");
        expect(await countExpenseAudit(A.companyId, "ExpenseRejected")).toBe(beforeRejected + 1);
      });

      it("decide trên expense KHÔNG 'pending' (đã approved) → BadRequestException (idempotent guard)", async () => {
        const created = await svc.create(A.companyId, financeUserA, {
          title: "Đề xuất duyệt 2 lần",
          amount: 100.0,
          currency: "VND",
          expenseType: "operation",
          approverUserId: approverA,
        });
        await svc.decide(A.companyId, financeUserA, created.id, { decision: "approved" });
        await expect(
          svc.decide(A.companyId, financeUserA, created.id, { decision: "approved" }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("create với approverUserId chéo tenant (user B) → BadRequest (SEC-1 tenant-FK guard), 0 side-effect", async () => {
        const beforeExp = await countExpense(A.companyId);
        await expect(
          svc.create(A.companyId, financeUserA, {
            title: "Approver thuộc tenant khác",
            amount: 50.0,
            currency: "VND",
            expenseType: "other",
            approverUserId: userB, // user B — FK trỏ PK toàn cục, phải chặn app-side.
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(await countExpense(A.companyId)).toBe(beforeExp);
      });
    });
  },
);
