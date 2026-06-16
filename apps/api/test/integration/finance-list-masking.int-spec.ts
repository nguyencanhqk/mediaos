import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { RevenueService } from "../../src/finance/revenue.service";
import { RevenueRepository } from "../../src/finance/revenue.repository";
import { CostService } from "../../src/finance/cost.service";
import { CostRepository } from "../../src/finance/cost.repository";
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
 * B2(c) MASKING PARITY — list revenue/cost mask field tiền ĐỒNG NHẤT như ProfitService (BẤT BIẾN #3,
 * masking là việc SERVER). Residual g13-ctl 'list masking parity vs ProfitService'.
 *
 * RED-first:
 *  (a) user CÓ list-access nhưng KHÔNG view-finance(isSensitive) → revenue.list/cost.list trả rows với
 *      amount = null (MASKED) — GIỐNG ProfitService.list. Số THẬT vẫn persist (mask chỉ ở DTO).
 *  (b) user CÓ view-finance (finance-manager …000a) → amount = số THẬT (number).
 *  (c) fail-safe mask: ÉP cùng canViewFinance() của ProfitService — nếu kiểm quyền lỗi hạ tầng → mask
 *      null, KHÔNG fail-open. (Khẳng định qua: write-only user (create không view) → amount null.)
 *
 * Postgres THẬT (skipIf khi không có DB). KHÔNG mock RLS.
 */
describe.skipIf(!hasDb)(
  "B2(c) finance list masking parity (revenue/cost mask amount như ProfitService)",
  () => {
    const direct = directPool();
    const app = appPool(2);
    let A: SeededTenant;
    /** finance-manager (…000a): create:finance + view-finance(sensitive). */
    let financeUserA: string;
    /** write-only: create:finance non-sensitive NHƯNG KHÔNG view-finance. */
    let writeOnlyUserA: string;
    let revenueSvc: RevenueService;
    let costSvc: CostService;

    /** Seed 1 revenue gốc qua DIRECT (bypass RLS) — amount 1500.00. Trả id. */
    async function seedRevenue(t: SeededTenant, enteredBy: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO revenue_records
         (company_id, amount, currency, revenue_date, source, entered_by, entry_kind)
       VALUES ($1, 1500.00, 'VND', current_date, 'manual', $2, 'original') RETURNING id`,
        [t.companyId, enteredBy],
      );
      return r.rows[0].id as string;
    }

    /** Seed 1 cost gốc qua DIRECT — amount 2500.00. Trả id. */
    async function seedCost(t: SeededTenant, enteredBy: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO cost_records
         (company_id, cost_type, amount, currency, cost_date, entered_by, entry_kind)
       VALUES ($1, 'other', 2500.00, 'VND', current_date, $2, 'original') RETURNING id`,
        [t.companyId, enteredBy],
      );
      return r.rows[0].id as string;
    }

    beforeAll(async () => {
      A = await seedCompany(direct, "maskA");
      financeUserA = await seedUser(
        direct,
        A.companyId,
        `mask-mgr-${randomUUID().slice(0, 8)}@a.test`,
      );
      await seedUserRole(direct, financeUserA, "00000000-0000-0000-0000-00000000000a", A.companyId);

      // write-only: role có create:finance (non-sensitive) NHƯNG KHÔNG view-finance (sensitive).
      writeOnlyUserA = await seedUser(
        direct,
        A.companyId,
        `mask-wo-${randomUUID().slice(0, 8)}@a.test`,
      );
      const roleId = await seedRole(
        direct,
        A.companyId,
        `mask-writeonly-${randomUUID().slice(0, 8)}`,
      );
      await direct.query(
        `INSERT INTO role_permissions (role_id, permission_id, effect)
       SELECT $1, p.id, 'ALLOW' FROM permissions p
       WHERE p.resource_type='finance' AND p.is_sensitive=false
       ON CONFLICT DO NOTHING`,
        [roleId],
      );
      await seedUserRole(direct, writeOnlyUserA, roleId, A.companyId);

      const db = new DatabaseService();
      const audit = new AuditService();
      const outbox = new OutboxService();
      const permission = new PermissionService(new PermissionRepository(db));
      revenueSvc = new RevenueService(db, new RevenueRepository(db), permission, audit, outbox);
      costSvc = new CostService(db, new CostRepository(db), permission, audit, outbox);
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
      await app.end();
    });

    describe("revenue.list masking", () => {
      it("user KHÔNG view-finance → list revenue trả amount = null (MASKED)", async () => {
        await seedRevenue(A, financeUserA);
        const rows = await revenueSvc.list(A.companyId, writeOnlyUserA, {});
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
          expect(r.amount).toBeNull();
        }
      });

      it("user CÓ view-finance → list revenue trả amount = số THẬT (number)", async () => {
        await seedRevenue(A, financeUserA);
        const rows = await revenueSvc.list(A.companyId, financeUserA, {});
        expect(rows.length).toBeGreaterThan(0);
        const withAmount = rows.find((r) => r.amount != null);
        expect(withAmount).toBeDefined();
        expect(typeof withAmount!.amount).toBe("number");
      });

      it("mask chỉ ở DTO — số THẬT vẫn persist trong DB", async () => {
        const id = await seedRevenue(A, financeUserA);
        const rows = await revenueSvc.list(A.companyId, writeOnlyUserA, {});
        const masked = rows.find((r) => r.id === id);
        expect(masked?.amount).toBeNull();
        const persisted = await direct.query(`SELECT amount FROM revenue_records WHERE id = $1`, [
          id,
        ]);
        expect(persisted.rows[0].amount).not.toBeNull();
      });
    });

    describe("cost.list masking", () => {
      it("user KHÔNG view-finance → list cost trả amount = null (MASKED)", async () => {
        await seedCost(A, financeUserA);
        const rows = await costSvc.list(A.companyId, writeOnlyUserA, {});
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
          expect(r.amount).toBeNull();
        }
      });

      it("user CÓ view-finance → list cost trả amount = số THẬT (number)", async () => {
        await seedCost(A, financeUserA);
        const rows = await costSvc.list(A.companyId, financeUserA, {});
        expect(rows.length).toBeGreaterThan(0);
        const withAmount = rows.find((r) => r.amount != null);
        expect(withAmount).toBeDefined();
        expect(typeof withAmount!.amount).toBe("number");
      });
    });
  },
);
