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
// 🔴 RED: chưa tồn tại — G13-2 GREEN phải tạo CostService/CostRepository (mirror revenue). Import này
//    khiến CẢ suite ĐỎ (module-not-found) ĐÚNG LÝ DO: "chưa có CostService". KHÔNG implement GREEN ở đây.
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
 * G13-2 — DENY-PATH (RED-first, TDD §6 / TASKS §5.5). Cost = sổ cái APPEND-ONLY (BẤT BIẾN #2),
 * tài chính nhạy cảm (permission). Mirror finance-revenue-deny.int-spec.ts. 5 chốt GREEN phải thoả:
 *
 *  (a) RLS 2-tenant   — login A KHÔNG đọc cost_records của B (0 row) qua ĐƯỜNG SERVICE + qua APP role.
 *  (b) Append-only    — app role chỉ SELECT/INSERT; UPDATE/DELETE bị DB từ chối (không cấp grant).
 *                       CostService KHÔNG có update()/delete(); chỉ create()/adjust()/void().
 *  (c) Permission     — create cost thiếu create:finance → fail-closed (ForbiddenException), 0 side-effect.
 *  (d) Audit          — adjust()/void() ghi audit_logs object_type='cost_record' cùng tx + chain + uq race.
 *  (e) DB boundary    — cost_type ngoài CHECK → DB từ chối; adjust/void trên bản void → BadRequest.
 *
 * Postgres THẬT (CI; local cần Docker). KHÔNG mock RLS (rủi ro "ảo tưởng xanh", plan G2 §6).
 */
describe.skipIf(!hasDb)("G13-2 cost deny-path (RLS 2-tenant + append-only + permission + audit)", () => {
  const direct = directPool();
  const app = appPool(2);
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  /** user A có quyền tài chính (finance-manager role hệ thống …000a). */
  let financeUserA: string;
  let svc: CostService;

  /** Seed 1 cost gốc qua DIRECT (bypass RLS) cho tenant t. Trả id. */
  async function seedCost(t: SeededTenant, enteredBy: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO cost_records
         (company_id, cost_type, amount, currency, cost_date, entered_by, entry_kind)
       VALUES ($1, 'production', 1000.00, 'VND', current_date, $2, 'original') RETURNING id`,
      [t.companyId, enteredBy],
    );
    return r.rows[0].id as string;
  }

  /** Đếm cost của 1 tenant (qua DIRECT, không lệ thuộc RLS). */
  async function countCost(companyId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM cost_records WHERE company_id = $1`,
      [companyId],
    );
    return r.rows[0].n as number;
  }

  /** Đếm audit cost_record của 1 tenant. */
  async function countCostAudit(companyId: string, action?: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id = $1 AND object_type = 'cost_record'
         AND ($2::text IS NULL OR action = $2)`,
      [companyId, action ?? null],
    );
    return r.rows[0].n as number;
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
      try { await c.query("ROLLBACK"); } catch { /* ignore */ }
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "costA");
    B = await seedCompany(direct, "costB");
    userA = await seedUser(direct, A.companyId, `cost-a-${randomUUID().slice(0, 8)}@a.test`);
    userB = await seedUser(direct, B.companyId, `cost-b-${randomUUID().slice(0, 8)}@b.test`);

    // financeUserA: gắn role hệ thống finance-manager (…000a, seed migration 0074) → có create:finance.
    financeUserA = await seedUser(direct, A.companyId, `cost-mgr-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, financeUserA, "00000000-0000-0000-0000-00000000000a", A.companyId);

    const db = new DatabaseService();
    const audit = new AuditService();
    const outbox = new OutboxService();
    const permission = new PermissionService(new PermissionRepository(db));
    svc = new CostService(db, new CostRepository(db), permission, audit, outbox);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  // ── (a) RLS 2-tenant — login A KHÔNG đọc cost của B ─────────────────────────
  describe("(a) RLS 2-tenant isolation", () => {
    it("CostService.list(A) thấy cost A, KHÔNG thấy cost B", async () => {
      const costA = await seedCost(A, userA);
      const costB = await seedCost(B, userB);
      const rows = await svc.list(A.companyId, financeUserA, {});
      const ids = new Set(rows.map((r) => r.id));
      expect(ids.has(costA)).toBe(true);
      expect(ids.has(costB)).toBe(false);
    });

    it("APP role ngoài/khác ngữ cảnh → KHÔNG SELECT được hàng tenant khác (0 row)", async () => {
      const costB = await seedCost(B, userB);
      const seen = await asApp(A.companyId, async (c) => {
        const r = await c.query(`SELECT id FROM cost_records WHERE id = $1`, [costB]);
        return r.rowCount ?? 0;
      });
      expect(seen).toBe(0);
    });
  });

  // ── (b) Append-only — app role bị từ chối UPDATE/DELETE (chỉ SELECT/INSERT) ──
  describe("(b) append-only (no UPDATE/DELETE for app role)", () => {
    it("app role KHÔNG có quyền UPDATE cost_records (grant SELECT,INSERT only)", async () => {
      const costA = await seedCost(A, userA);
      await expect(
        asApp(A.companyId, (c) =>
          c.query(`UPDATE cost_records SET amount = 9999.00 WHERE id = $1`, [costA]),
        ),
      ).rejects.toThrow(/permission denied|must be owner/i);
    });

    it("app role KHÔNG có quyền DELETE cost_records", async () => {
      const costA = await seedCost(A, userA);
      await expect(
        asApp(A.companyId, (c) =>
          c.query(`DELETE FROM cost_records WHERE id = $1`, [costA]),
        ),
      ).rejects.toThrow(/permission denied|must be owner/i);
    });

    it("CostService KHÔNG có update()/delete() — 'sửa/xoá' = adjust()/void() ghi bản ghi mới", () => {
      expect((svc as unknown as Record<string, unknown>).update).toBeUndefined();
      expect((svc as unknown as Record<string, unknown>).delete).toBeUndefined();
      expect(typeof svc.create).toBe("function");
      expect(typeof svc.adjust).toBe("function");
      expect(typeof svc.void).toBe("function");
    });
  });

  // ── (c) Permission deny — create thiếu create:finance → 403 fail-closed ──────
  describe("(c) permission deny (fail-closed)", () => {
    it("create cost KHÔNG có quyền create:finance → ForbiddenException, KHÔNG ghi bản ghi", async () => {
      // userA: gắn role rỗng (không có create:finance).
      const emptyRole = await seedRole(direct, A.companyId, `cost-noperm-${randomUUID().slice(0, 8)}`);
      await seedUserRole(direct, userA, emptyRole, A.companyId);

      const before = await countCost(A.companyId);
      await expect(
        svc.create(A.companyId, userA, {
          costType: "production",
          amount: 1234.56,
          currency: "VND",
          costDate: "2026-06-12",
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const after = await countCost(A.companyId);
      expect(after).toBe(before); // fail-closed: KHÔNG side-effect khi bị từ chối (check NGOÀI tx).
    });
  });

  // ── (d) Audit — create/adjustment/void phát sinh audit object_type='cost_record' ─
  describe("(d) audit on create/adjustment/void", () => {
    it("create() (có quyền) ghi cost_records 'original' + audit CostCreated CÙNG tx", async () => {
      const before = await countCost(A.companyId);
      const beforeAudit = await countCostAudit(A.companyId, "CostCreated");

      const row = await svc.create(A.companyId, financeUserA, {
        costType: "software",
        amount: 4321.5,
        currency: "VND",
        costDate: "2026-06-12",
        vendorName: "Adobe",
        description: "Creative Cloud team",
      });

      expect(row.entryKind).toBe("original");
      expect(row.replacesRecordId).toBeNull();
      const chk = await direct.query(
        `SELECT cost_type, amount::text, vendor_name FROM cost_records WHERE id = $1`,
        [row.id],
      );
      expect(chk.rows[0].cost_type).toBe("software");
      expect(chk.rows[0].amount).toBe("4321.50");
      expect(chk.rows[0].vendor_name).toBe("Adobe");
      expect(await countCost(A.companyId)).toBe(before + 1);
      expect(await countCostAudit(A.companyId, "CostCreated")).toBe(beforeAudit + 1);
    });

    it("adjust() ghi audit_logs object_type='cost_record' + chain replaces_record_id", async () => {
      const original = await seedCost(A, financeUserA);
      const beforeAudit = await countCostAudit(A.companyId, "CostAdjusted");

      const adjusted = await svc.adjust(A.companyId, financeUserA, original, {
        amount: 2000.0,
        reason: "điều chỉnh chi phí sản xuất",
      });

      const chk = await direct.query(
        `SELECT entry_kind, replaces_record_id FROM cost_records WHERE id = $1`,
        [adjusted.id],
      );
      expect(chk.rows[0].entry_kind).toBe("adjustment");
      expect(chk.rows[0].replaces_record_id).toBe(original);

      const afterAudit = await countCostAudit(A.companyId, "CostAdjusted");
      expect(afterAudit).toBe(beforeAudit + 1);
    });

    it("void() ghi audit_logs object_type='cost_record' (action CostVoided)", async () => {
      const original = await seedCost(A, financeUserA);
      const beforeAudit = await countCostAudit(A.companyId, "CostVoided");

      const voided = await svc.void(A.companyId, financeUserA, original, {
        reason: "ghi nhầm chi phí",
      });

      const chk = await direct.query(
        `SELECT entry_kind, replaces_record_id FROM cost_records WHERE id = $1`,
        [voided.id],
      );
      expect(chk.rows[0].entry_kind).toBe("void");
      expect(chk.rows[0].replaces_record_id).toBe(original);

      const afterAudit = await countCostAudit(A.companyId, "CostVoided");
      expect(afterAudit).toBe(beforeAudit + 1);
    });
  });

  // ── (e) Boundary validation tại DB (KHÔNG chỉ Zod) — CLAUDE.md §6 ────────────
  describe("(e) DB boundary validation (not just Zod)", () => {
    it("cost_type NGOÀI enum CHECK (cost_records_cost_type_check) → DB từ chối INSERT", async () => {
      await expect(
        asApp(A.companyId, (c) =>
          c.query(
            `INSERT INTO cost_records
               (company_id, cost_type, amount, currency, cost_date, entered_by, entry_kind)
             VALUES ($1, 'bogus_cost_xyz', 10.00, 'VND', current_date, $2, 'original')`,
            [A.companyId, financeUserA],
          ),
        ),
      ).rejects.toThrow(/cost_records_cost_type_check|violates check constraint/i);
    });

    it("double-adjust cùng original → bản thứ 2 vi phạm cost_records_replaces_uq (race chống ở DB)", async () => {
      const original = await seedCost(A, financeUserA);
      await svc.adjust(A.companyId, financeUserA, original, {
        amount: 1500.0,
        reason: "điều chỉnh lần 1",
      });
      await expect(
        svc.adjust(A.companyId, financeUserA, original, {
          amount: 1600.0,
          reason: "điều chỉnh lần 2 (phải fail ở DB)",
        }),
      ).rejects.toThrow(/cost_records_replaces_uq|duplicate key value/i);
    });

    it("adjust() trên bản entry_kind='void' → BadRequestException", async () => {
      const original = await seedCost(A, financeUserA);
      const voided = await svc.void(A.companyId, financeUserA, original, {
        reason: "void để đóng chuỗi",
      });
      await expect(
        svc.adjust(A.companyId, financeUserA, voided.id, {
          amount: 999.0,
          reason: "không được điều chỉnh bản void",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("void() trên bản entry_kind='void' → BadRequestException (không void hai lần)", async () => {
      const original = await seedCost(A, financeUserA);
      const voided = await svc.void(A.companyId, financeUserA, original, {
        reason: "void lần 1",
      });
      await expect(
        svc.void(A.companyId, financeUserA, voided.id, {
          reason: "void lần 2 (phải fail)",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
