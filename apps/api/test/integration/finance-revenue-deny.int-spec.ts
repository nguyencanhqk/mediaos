import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
// 🔴 RED: chưa tồn tại — G13-1 GREEN phải tạo Service/Repo revenue. Import này khiến CẢ suite ĐỎ
//    (module-not-found) ĐÚNG LÝ DO: "chưa có RevenueService". KHÔNG implement GREEN trong lượt này.
import { RevenueService } from "../../src/finance/revenue.service";
import { RevenueRepository } from "../../src/finance/revenue.repository";
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
 * G13-1 — DENY-PATH (RED-first, TDD §6 / TASKS §5.5). Revenue = sổ cái APPEND-ONLY (BẤT BIẾN #2),
 * tài chính nhạy cảm (permission). 4 chốt fail-closed mà GREEN phải thoả:
 *
 *  (a) RLS 2-tenant   — login A KHÔNG đọc revenue_records của B (0 row). (Lưới rộng ở
 *                       tenant-isolation.int-spec qua rls-registry; ở đây khẳng định lại qua ĐƯỜNG SERVICE.)
 *  (b) Append-only    — app role chỉ SELECT/INSERT; UPDATE/DELETE bị DB từ chối (không cấp grant).
 *                       "Sửa/xoá" = ghi bản ghi mới (entry_kind adjustment|void). Service KHÔNG có
 *                       update()/delete(); chỉ create()/adjust()/void().
 *  (c) Permission     — create revenue thiếu quyền create:finance → fail-closed (ForbiddenException),
 *                       KHÔNG ghi bản ghi (kiểm đếm = 0).
 *  (d) Audit          — adjust()/void() phát sinh audit_logs object_type='revenue_record' cùng tx.
 *
 * Postgres THẬT (CI; local cần Docker). KHÔNG mock RLS (rủi ro "ảo tưởng xanh", plan G2 §6).
 */
describe.skipIf(!hasDb)("G13-1 revenue deny-path (RLS 2-tenant + append-only + permission + audit)", () => {
  const direct = directPool();
  const app = appPool(2);
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  /** user A có quyền tài chính (finance-manager role hệ thống …000a). */
  let financeUserA: string;
  let svc: RevenueService;

  /** Seed 1 revenue gốc qua DIRECT (bypass RLS) cho tenant t. Trả id. */
  async function seedRevenue(t: SeededTenant, enteredBy: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO revenue_records
         (company_id, amount, currency, revenue_date, source, entered_by, entry_kind)
       VALUES ($1, 1000.00, 'VND', current_date, 'manual', $2, 'original') RETURNING id`,
      [t.companyId, enteredBy],
    );
    return r.rows[0].id as string;
  }

  /** Đếm revenue của 1 tenant (qua DIRECT, không lệ thuộc RLS). */
  async function countRevenue(companyId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM revenue_records WHERE company_id = $1`,
      [companyId],
    );
    return r.rows[0].n as number;
  }

  /** Đếm audit revenue_record của 1 tenant. */
  async function countRevenueAudit(companyId: string, action?: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id = $1 AND object_type = 'revenue_record'
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
    A = await seedCompany(direct, "finA");
    B = await seedCompany(direct, "finB");
    userA = await seedUser(direct, A.companyId, `fin-a-${randomUUID().slice(0, 8)}@a.test`);
    userB = await seedUser(direct, B.companyId, `fin-b-${randomUUID().slice(0, 8)}@b.test`);

    // financeUserA: gắn role hệ thống finance-manager (…000a, seed migration 0074) → có create:finance.
    financeUserA = await seedUser(direct, A.companyId, `fin-mgr-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, financeUserA, "00000000-0000-0000-0000-00000000000a", A.companyId);

    const db = new DatabaseService();
    const audit = new AuditService();
    const outbox = new OutboxService();
    const permission = new PermissionService(new PermissionRepository(db));
    svc = new RevenueService(db, new RevenueRepository(db), permission, audit, outbox);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  // ── (a) RLS 2-tenant — login A KHÔNG đọc revenue của B ──────────────────────
  describe("(a) RLS 2-tenant isolation", () => {
    it("RevenueService.list(A) thấy revenue A, KHÔNG thấy revenue B", async () => {
      const revA = await seedRevenue(A, userA);
      const revB = await seedRevenue(B, userB);
      const rows = await svc.list(A.companyId, financeUserA, {});
      const ids = new Set(rows.map((r) => r.id));
      expect(ids.has(revA)).toBe(true);
      expect(ids.has(revB)).toBe(false);
    });

    it("APP role ngoài/khác ngữ cảnh → KHÔNG SELECT được hàng tenant khác (0 row)", async () => {
      const revB = await seedRevenue(B, userB);
      const seen = await asApp(A.companyId, async (c) => {
        const r = await c.query(`SELECT id FROM revenue_records WHERE id = $1`, [revB]);
        return r.rowCount ?? 0;
      });
      expect(seen).toBe(0);
    });
  });

  // ── (b) Append-only — app role bị từ chối UPDATE/DELETE (chỉ SELECT/INSERT) ──
  describe("(b) append-only (no UPDATE/DELETE for app role)", () => {
    it("app role KHÔNG có quyền UPDATE revenue_records (grant SELECT,INSERT only)", async () => {
      const revA = await seedRevenue(A, userA);
      await expect(
        asApp(A.companyId, (c) =>
          c.query(`UPDATE revenue_records SET amount = 9999.00 WHERE id = $1`, [revA]),
        ),
      ).rejects.toThrow(/permission denied|must be owner/i);
    });

    it("app role KHÔNG có quyền DELETE revenue_records", async () => {
      const revA = await seedRevenue(A, userA);
      await expect(
        asApp(A.companyId, (c) =>
          c.query(`DELETE FROM revenue_records WHERE id = $1`, [revA]),
        ),
      ).rejects.toThrow(/permission denied|must be owner/i);
    });

    it("RevenueService KHÔNG có update()/delete() — 'sửa/xoá' = adjust()/void() ghi bản ghi mới", () => {
      // Hợp đồng append-only: chỉ create/adjust/void. update/delete trực tiếp là vi phạm BẤT BIẾN #2.
      expect((svc as unknown as Record<string, unknown>).update).toBeUndefined();
      expect((svc as unknown as Record<string, unknown>).delete).toBeUndefined();
      expect(typeof svc.adjust).toBe("function");
      expect(typeof svc.void).toBe("function");
    });
  });

  // ── (c) Permission deny — create thiếu create:finance → 403 fail-closed ──────
  describe("(c) permission deny (fail-closed)", () => {
    it("create revenue KHÔNG có quyền create:finance → ForbiddenException, KHÔNG ghi bản ghi", async () => {
      // userA: gắn role rỗng (không có create:finance).
      const emptyRole = await seedRole(direct, A.companyId, `fin-noperm-${randomUUID().slice(0, 8)}`);
      await seedUserRole(direct, userA, emptyRole, A.companyId);

      const before = await countRevenue(A.companyId);
      await expect(
        svc.create(A.companyId, userA, {
          amount: 1234.56,
          currency: "VND",
          revenueDate: "2026-06-12",
          source: "manual",
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const after = await countRevenue(A.companyId);
      expect(after).toBe(before); // fail-closed: KHÔNG side-effect khi bị từ chối.
    });
  });

  // ── (d) Audit — adjustment/void phát sinh audit object_type='revenue_record' ─
  describe("(d) audit on adjustment/void", () => {
    it("adjust() ghi audit_logs object_type='revenue_record' + chain replaces_record_id", async () => {
      const original = await seedRevenue(A, financeUserA);
      const beforeAudit = await countRevenueAudit(A.companyId, "RevenueAdjusted");

      const adjusted = await svc.adjust(A.companyId, financeUserA, original, {
        amount: 2000.0,
        reason: "điều chỉnh số liệu adsense",
      });

      // bản ghi mới entry_kind='adjustment' trỏ về bản gốc (append-only chain).
      const chk = await direct.query(
        `SELECT entry_kind, replaces_record_id FROM revenue_records WHERE id = $1`,
        [adjusted.id],
      );
      expect(chk.rows[0].entry_kind).toBe("adjustment");
      expect(chk.rows[0].replaces_record_id).toBe(original);

      const afterAudit = await countRevenueAudit(A.companyId, "RevenueAdjusted");
      expect(afterAudit).toBe(beforeAudit + 1);
    });

    it("void() ghi audit_logs object_type='revenue_record' (action VoidRevenue)", async () => {
      const original = await seedRevenue(A, financeUserA);
      const beforeAudit = await countRevenueAudit(A.companyId, "RevenueVoided");

      const voided = await svc.void(A.companyId, financeUserA, original, {
        reason: "ghi nhầm doanh thu",
      });

      const chk = await direct.query(
        `SELECT entry_kind, replaces_record_id FROM revenue_records WHERE id = $1`,
        [voided.id],
      );
      expect(chk.rows[0].entry_kind).toBe("void");
      expect(chk.rows[0].replaces_record_id).toBe(original);

      const afterAudit = await countRevenueAudit(A.companyId, "RevenueVoided");
      expect(afterAudit).toBe(beforeAudit + 1);
    });
  });
});
