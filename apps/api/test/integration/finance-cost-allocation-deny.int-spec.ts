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
// 🔴 RED: chưa tồn tại — G13-2 GREEN phải tạo CostAllocationService/Repository. Import này khiến CẢ
//    suite ĐỎ (module-not-found) ĐÚNG LÝ DO. KHÔNG implement GREEN trong lượt này.
import { CostAllocationService } from "../../src/finance/cost-allocation.service";
import { CostAllocationRepository } from "../../src/finance/cost-allocation.repository";
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
 * G13-2 (FIN-003) — DENY-PATH cost_allocations (mutable CÓ KIỂM SOÁT — soft-delete, KHÔNG DELETE).
 *
 *  (a) RLS 2-tenant   — allocation của B không thấy khi login A (service + APP role chéo = 0 row).
 *  (b) Permission     — allocate thiếu create:finance → ForbiddenException, 0 dòng allocation ghi.
 *  (c) Append/soft-del— re-allocate = soft-delete set cũ (deleted_at) + insert set mới CÙNG tx + audit
 *                       CostReallocated; app role DELETE cost_allocations bị từ chối (chỉ SELECT,INSERT,UPDATE).
 *  (d) Cents-exact    — SUM(allocated_amount) === amount cost gốc tuyệt đối cho cả 5 kiểu chia.
 *  (e) DB boundary    — cost_allocations_active_uq chặn 2 active cùng (cost,target) khi không soft-delete;
 *                       allocation_method/target_type ngoài CHECK → DB từ chối.
 *  (f) Cross-tenant target guard — allocate target_id thuộc tenant B khi login A → từ chối.
 */
describe.skipIf(!hasDb)("G13-2 cost-allocation deny-path (RLS + perm + soft-delete + cents-exact + uq + cross-tenant)", () => {
  const direct = directPool();
  const app = appPool(2);
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  let financeUserA: string;
  /** channel của A (target hợp lệ trong tenant A). */
  let channelA1: string;
  let channelA2: string;
  /** channel của B (target tenant khác — cross-tenant guard). */
  let channelB1: string;
  let allocSvc: CostAllocationService;

  /** Seed 1 cost gốc qua DIRECT cho tenant t. Trả id. amount mặc định 1000.00. */
  async function seedCost(t: SeededTenant, enteredBy: string, amount = "1000.00"): Promise<string> {
    const r = await direct.query(
      `INSERT INTO cost_records
         (company_id, cost_type, amount, currency, cost_date, entered_by, entry_kind)
       VALUES ($1, 'production', $2, 'VND', current_date, $3, 'original') RETURNING id`,
      [t.companyId, amount, enteredBy],
    );
    return r.rows[0].id as string;
  }

  /** Seed 1 channel cho tenant t (target phân bổ hợp lệ). Trả id. */
  async function seedChannel(t: SeededTenant, name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO channels (company_id, name, platform, platform_id)
       VALUES ($1, $2, 'youtube', (SELECT id FROM platforms WHERE code = 'youtube')) RETURNING id`,
      [t.companyId, `${name}-${randomUUID().slice(0, 8)}`],
    );
    return r.rows[0].id as string;
  }

  /** Seed 1 team cho tenant t (target phân bổ hợp lệ trong tenant). Trả id. */
  async function seedTeam(t: SeededTenant, name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO teams (company_id, name) VALUES ($1, $2) RETURNING id`,
      [t.companyId, `${name}-${randomUUID().slice(0, 8)}`],
    );
    return r.rows[0].id as string;
  }

  /** Đếm allocation ACTIVE (deleted_at IS NULL) của 1 cost. */
  async function countActiveAlloc(costId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM cost_allocations WHERE cost_record_id = $1 AND deleted_at IS NULL`,
      [costId],
    );
    return r.rows[0].n as number;
  }

  /** SUM allocated_amount (cents-exact check) cho run mới nhất (active) của 1 cost. */
  async function sumActiveAlloc(costId: string): Promise<string> {
    const r = await direct.query(
      `SELECT COALESCE(SUM(allocated_amount), 0)::text AS s
       FROM cost_allocations WHERE cost_record_id = $1 AND deleted_at IS NULL`,
      [costId],
    );
    return r.rows[0].s as string;
  }

  /** Đếm audit cost_allocation của 1 tenant. */
  async function countAllocAudit(companyId: string, action?: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id = $1 AND object_type = 'cost_allocation'
         AND ($2::text IS NULL OR action = $2)`,
      [companyId, action ?? null],
    );
    return r.rows[0].n as number;
  }

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
    A = await seedCompany(direct, "allocA");
    B = await seedCompany(direct, "allocB");
    userA = await seedUser(direct, A.companyId, `alloc-a-${randomUUID().slice(0, 8)}@a.test`);
    userB = await seedUser(direct, B.companyId, `alloc-b-${randomUUID().slice(0, 8)}@b.test`);
    financeUserA = await seedUser(direct, A.companyId, `alloc-mgr-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, financeUserA, "00000000-0000-0000-0000-00000000000a", A.companyId);

    channelA1 = await seedChannel(A, "chA1");
    channelA2 = await seedChannel(A, "chA2");
    channelB1 = await seedChannel(B, "chB1");

    const db = new DatabaseService();
    const audit = new AuditService();
    const outbox = new OutboxService();
    const permission = new PermissionService(new PermissionRepository(db));
    allocSvc = new CostAllocationService(
      db,
      new CostAllocationRepository(db),
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

  // ── (a) RLS 2-tenant ─────────────────────────────────────────────────────────
  describe("(a) RLS 2-tenant isolation", () => {
    it("allocation của B 0 row khi APP role login A (SELECT chéo)", async () => {
      const costB = await seedCost(B, userB);
      // Seed 1 allocation trực tiếp cho B (qua DIRECT bypass RLS).
      await direct.query(
        `INSERT INTO cost_allocations
           (company_id, cost_record_id, allocation_run_id, allocation_target_type,
            allocation_target_id, allocation_method, allocated_amount)
         VALUES ($1, $2, $3, 'channel', $4, 'equal_split', 1000.00)`,
        [B.companyId, costB, randomUUID(), channelB1],
      );
      const seen = await asApp(A.companyId, async (c) => {
        const r = await c.query(
          `SELECT id FROM cost_allocations WHERE cost_record_id = $1`,
          [costB],
        );
        return r.rowCount ?? 0;
      });
      expect(seen).toBe(0);
    });
  });

  // ── (b) Permission deny (fail-closed) ─────────────────────────────────────────
  describe("(b) permission deny (fail-closed)", () => {
    it("allocate thiếu create:finance → ForbiddenException, 0 dòng allocation ghi", async () => {
      const emptyRole = await seedRole(direct, A.companyId, `alloc-noperm-${randomUUID().slice(0, 8)}`);
      await seedUserRole(direct, userA, emptyRole, A.companyId);
      const costA = await seedCost(A, financeUserA);

      await expect(
        allocSvc.allocate(A.companyId, userA, costA, {
          method: "equal_split",
          targets: [{ targetType: "channel", targetId: channelA1 }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await countActiveAlloc(costA)).toBe(0); // fail-closed: check NGOÀI tx.
    });
  });

  // ── (c) Append/soft-delete (re-allocate) + no DELETE grant ────────────────────
  describe("(c) re-allocate = soft-delete + insert (no DELETE)", () => {
    it("re-allocate soft-delete set cũ (deleted_at) + insert set mới CÙNG tx + audit CostReallocated", async () => {
      const costA = await seedCost(A, financeUserA, "900.00");
      // Run 1: equal_split 1 target.
      await allocSvc.allocate(A.companyId, financeUserA, costA, {
        method: "equal_split",
        targets: [{ targetType: "channel", targetId: channelA1 }],
      });
      expect(await countActiveAlloc(costA)).toBe(1);
      const beforeAudit = await countAllocAudit(A.companyId, "CostReallocated");

      // Run 2: re-allocate equal_split 2 target → set cũ soft-deleted, set mới active.
      const result = await allocSvc.allocate(A.companyId, financeUserA, costA, {
        method: "equal_split",
        targets: [
          { targetType: "channel", targetId: channelA1 },
          { targetType: "channel", targetId: channelA2 },
        ],
      });
      expect(result.allocations.length).toBe(2);
      // Active phải là 2 (set mới); set cũ (1 dòng) đã deleted_at.
      expect(await countActiveAlloc(costA)).toBe(2);
      const deleted = await direct.query(
        `SELECT count(*)::int AS n FROM cost_allocations WHERE cost_record_id = $1 AND deleted_at IS NOT NULL`,
        [costA],
      );
      expect(deleted.rows[0].n).toBe(1);
      const afterAudit = await countAllocAudit(A.companyId, "CostReallocated");
      expect(afterAudit).toBe(beforeAudit + 1);
    });

    it("app role KHÔNG có quyền DELETE cost_allocations (chỉ SELECT,INSERT,UPDATE)", async () => {
      const costA = await seedCost(A, financeUserA);
      await direct.query(
        `INSERT INTO cost_allocations
           (company_id, cost_record_id, allocation_run_id, allocation_target_type,
            allocation_target_id, allocation_method, allocated_amount)
         VALUES ($1, $2, $3, 'channel', $4, 'equal_split', 1000.00)`,
        [A.companyId, costA, randomUUID(), channelA1],
      );
      await expect(
        asApp(A.companyId, (c) =>
          c.query(`DELETE FROM cost_allocations WHERE cost_record_id = $1`, [costA]),
        ),
      ).rejects.toThrow(/permission denied|must be owner/i);
    });
  });

  // ── (d) Cents-exact — SUM(allocated_amount) === amount cost gốc cho cả 5 kiểu ─
  describe("(d) cents-exact (SUM === cost amount)", () => {
    it("equal_split 3 target → SUM allocated === 100.00 (dồn dư target cuối)", async () => {
      const costA = await seedCost(A, financeUserA, "100.00");
      const teamA = await seedTeam(A, "teamEq");
      await allocSvc.allocate(A.companyId, financeUserA, costA, {
        method: "equal_split",
        targets: [
          { targetType: "channel", targetId: channelA1 },
          { targetType: "channel", targetId: channelA2 },
          { targetType: "team", targetId: teamA },
        ],
      });
      expect(await sumActiveAlloc(costA)).toBe("100.00");
    });

    it("manual_percent 33.33/33.33/33.34 → SUM === cost amount", async () => {
      const costA = await seedCost(A, financeUserA, "1000.00");
      const teamA = await seedTeam(A, "teamPct");
      await allocSvc.allocate(A.companyId, financeUserA, costA, {
        method: "manual_percent",
        targets: [
          { targetType: "channel", targetId: channelA1, percent: 33.33 },
          { targetType: "channel", targetId: channelA2, percent: 33.33 },
          { targetType: "team", targetId: teamA, percent: 33.34 },
        ],
      });
      expect(await sumActiveAlloc(costA)).toBe("1000.00");
    });

    it("by_work_hours [8,16,24] → SUM === cost amount", async () => {
      const costA = await seedCost(A, financeUserA, "777.77");
      const t1 = await seedTeam(A, "teamH1");
      const t2 = await seedTeam(A, "teamH2");
      const t3 = await seedTeam(A, "teamH3");
      await allocSvc.allocate(A.companyId, financeUserA, costA, {
        method: "by_work_hours",
        targets: [
          { targetType: "team", targetId: t1, hours: 8 },
          { targetType: "team", targetId: t2, hours: 16 },
          { targetType: "team", targetId: t3, hours: 24 },
        ],
      });
      expect(await sumActiveAlloc(costA)).toBe("777.77");
    });
  });

  // ── (e) DB boundary ────────────────────────────────────────────────────────
  describe("(e) DB boundary validation", () => {
    it("cost_allocations_active_uq chặn 2 active cùng (cost,target) khi KHÔNG soft-delete", async () => {
      const costA = await seedCost(A, financeUserA);
      const runId = randomUUID();
      await asApp(A.companyId, async (c) => {
        await c.query(
          `INSERT INTO cost_allocations
             (company_id, cost_record_id, allocation_run_id, allocation_target_type,
              allocation_target_id, allocation_method, allocated_amount)
           VALUES ($1, $2, $3, 'channel', $4, 'equal_split', 500.00)`,
          [A.companyId, costA, runId, channelA1],
        );
        // 2nd active alloc cùng (cost, target_type, target_id) → uq vi phạm.
        await expect(
          c.query(
            `INSERT INTO cost_allocations
               (company_id, cost_record_id, allocation_run_id, allocation_target_type,
                allocation_target_id, allocation_method, allocated_amount)
             VALUES ($1, $2, $3, 'channel', $4, 'equal_split', 500.00)`,
            [A.companyId, costA, randomUUID(), channelA1],
          ),
        ).rejects.toThrow(/cost_allocations_active_uq|duplicate key value/i);
      });
    });

    it("allocation_method NGOÀI CHECK → DB từ chối INSERT", async () => {
      const costA = await seedCost(A, financeUserA);
      await expect(
        asApp(A.companyId, (c) =>
          c.query(
            `INSERT INTO cost_allocations
               (company_id, cost_record_id, allocation_run_id, allocation_target_type,
                allocation_target_id, allocation_method, allocated_amount)
             VALUES ($1, $2, $3, 'channel', $4, 'bogus_method', 100.00)`,
            [A.companyId, costA, randomUUID(), channelA1],
          ),
        ),
      ).rejects.toThrow(/cost_allocations_method_check|violates check constraint/i);
    });
  });

  // ── (f) Cross-tenant target guard ─────────────────────────────────────────────
  describe("(f) cross-tenant target guard", () => {
    it("allocate target_id (channel) thuộc tenant B khi login A → từ chối (service validate target)", async () => {
      const costA = await seedCost(A, financeUserA);
      await expect(
        allocSvc.allocate(A.companyId, financeUserA, costA, {
          method: "equal_split",
          targets: [{ targetType: "channel", targetId: channelB1 }],
        }),
      ).rejects.toThrow();
      expect(await countActiveAlloc(costA)).toBe(0);
    });
  });
});
