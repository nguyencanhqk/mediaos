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
// 🔴 RED: chưa tồn tại — G13-3 GREEN phải tạo ProfitService/ProfitRepository. Import này khiến CẢ
//    suite ĐỎ ĐÚNG LÝ DO (module-not-found): "chưa có ProfitService". KHÔNG implement GREEN lượt này.
import { ProfitService } from "../../src/finance/profit.service";
import { ProfitRepository } from "../../src/finance/profit.repository";
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
 * G13-3 — DENY-PATH (RED-first, TDD §6 / TASKS §5.5). profit_snapshots = APPEND-ONLY (BẤT BIẾN #2),
 * tài chính nhạy cảm. 5+1 nhóm fail-closed mà GREEN phải thoả:
 *
 *  (a) RLS 2-tenant   — login A KHÔNG đọc snapshot của B (0 row), qua ĐƯỜNG SERVICE + APP role.
 *  (b) Append-only    — app role chỉ SELECT/INSERT; UPDATE/DELETE bị DB từ chối. Service KHÔNG có
 *                       update()/delete() — chỉ create()/list()/findLatest().
 *  (c) Permission     — create thiếu create:finance → ForbiddenException, KHÔNG ghi snapshot (count==).
 *  (d) Audit          — create() ghi audit_logs object_type='profit_snapshot'
 *                       action='ProfitSnapshotCreated' CÙNG tx (count +1).
 *  (e) DB boundary    — target_type rác → profit_snapshots_target_type_check; company + target_id NOT NULL
 *                       → profit_snapshots_target_id_check (qua APP role, đường ghi thật).
 *  (f) view-finance   — caller KHÔNG có view-finance(isSensitive) → số tiền (totalRevenue/profit/margin)
 *                       = null (mask SERVER-side). ALLOW → trả số thật.
 *
 * Postgres THẬT (lane DB mediaos_g13). KHÔNG mock RLS (rủi ro "ảo tưởng xanh").
 */
describe.skipIf(!hasDb)(
  "G13-3 profit deny-path (RLS 2-tenant + append-only + permission + audit + boundary + mask)",
  () => {
    const direct = directPool();
    const app = appPool(2);
    let A: SeededTenant;
    let B: SeededTenant;
    let userA: string;
    /** user A có quyền tài chính ĐẦY ĐỦ (finance-manager …000a: create:finance + view-finance sensitive). */
    let financeUserA: string;
    let svc: ProfitService;

    /** Seed 1 profit snapshot company-scope qua DIRECT (bypass RLS) cho tenant t. Trả id. */
    async function seedSnapshot(t: SeededTenant, createdBy: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO profit_snapshots
           (company_id, target_type, target_id, period_start, period_end,
            total_revenue, total_direct_cost, total_allocated_cost, total_cost, profit, profit_margin, created_by)
         VALUES ($1,'company',NULL,'2026-06-01','2026-06-30',
            1000.00, 400.00, 0.00, 400.00, 600.00, 0.6000, $2) RETURNING id`,
        [t.companyId, createdBy],
      );
      return r.rows[0].id as string;
    }

    /** Đếm snapshot của 1 tenant (qua DIRECT, không lệ thuộc RLS). */
    async function countSnapshots(companyId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM profit_snapshots WHERE company_id = $1`,
        [companyId],
      );
      return r.rows[0].n as number;
    }

    /** Đếm audit profit_snapshot của 1 tenant. */
    async function countProfitAudit(companyId: string, action?: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
         WHERE company_id = $1 AND object_type = 'profit_snapshot'
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
      A = await seedCompany(direct, "finProfA");
      B = await seedCompany(direct, "finProfB");
      userA = await seedUser(direct, A.companyId, `pf-a-${randomUUID().slice(0, 8)}@a.test`);
      await seedUser(direct, B.companyId, `pf-b-${randomUUID().slice(0, 8)}@b.test`);

      // financeUserA: role hệ thống finance-manager (…000a, seed 0074) → create:finance + view-finance.
      financeUserA = await seedUser(direct, A.companyId, `pf-mgr-${randomUUID().slice(0, 8)}@a.test`);
      await seedUserRole(
        direct,
        financeUserA,
        "00000000-0000-0000-0000-00000000000a",
        A.companyId,
      );

      const db = new DatabaseService();
      const audit = new AuditService();
      const outbox = new OutboxService();
      const permission = new PermissionService(new PermissionRepository(db));
      svc = new ProfitService(db, new ProfitRepository(db), permission, audit, outbox);
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
    });

    // ── (a) RLS 2-tenant — login A KHÔNG đọc snapshot của B ──────────────────────
    describe("(a) RLS 2-tenant isolation", () => {
      it("ProfitService.list(A) thấy snapshot A, KHÔNG thấy snapshot B", async () => {
        const snapA = await seedSnapshot(A, financeUserA);
        const snapB = await seedSnapshot(B, financeUserA);
        const rows = await svc.list(A.companyId, financeUserA, {});
        const ids = new Set(rows.map((r) => r.id));
        expect(ids.has(snapA)).toBe(true);
        expect(ids.has(snapB)).toBe(false);
      });

      it("APP role asApp(A) → KHÔNG SELECT được snapshot tenant B (0 row)", async () => {
        const snapB = await seedSnapshot(B, financeUserA);
        const seen = await asApp(A.companyId, async (c) => {
          const r = await c.query(`SELECT id FROM profit_snapshots WHERE id = $1`, [snapB]);
          return r.rowCount ?? 0;
        });
        expect(seen).toBe(0);
      });
    });

    // ── (b) Append-only — app role bị từ chối UPDATE/DELETE (chỉ SELECT/INSERT) ──
    describe("(b) append-only (no UPDATE/DELETE for app role)", () => {
      it("app role KHÔNG có quyền UPDATE profit_snapshots (grant SELECT,INSERT only)", async () => {
        const snapA = await seedSnapshot(A, financeUserA);
        await expect(
          asApp(A.companyId, (c) =>
            c.query(`UPDATE profit_snapshots SET profit = 9999.00 WHERE id = $1`, [snapA]),
          ),
        ).rejects.toThrow(/permission denied|must be owner/i);
      });

      it("app role KHÔNG có quyền DELETE profit_snapshots", async () => {
        const snapA = await seedSnapshot(A, financeUserA);
        await expect(
          asApp(A.companyId, (c) =>
            c.query(`DELETE FROM profit_snapshots WHERE id = $1`, [snapA]),
          ),
        ).rejects.toThrow(/permission denied|must be owner/i);
      });

      it("ProfitService KHÔNG có update()/delete() — mỗi lần tính = 1 INSERT snapshot mới", () => {
        expect((svc as unknown as Record<string, unknown>).update).toBeUndefined();
        expect((svc as unknown as Record<string, unknown>).delete).toBeUndefined();
        expect(typeof svc.create).toBe("function");
        expect(typeof svc.list).toBe("function");
      });
    });

    // ── (c) Permission deny — create thiếu create:finance → 403, 0 side-effect ──
    describe("(c) permission deny (fail-closed)", () => {
      it("create snapshot KHÔNG có create:finance → ForbiddenException, KHÔNG ghi snapshot", async () => {
        // userA: gắn role rỗng (không có create:finance).
        const emptyRole = await seedRole(direct, A.companyId, `pf-noperm-${randomUUID().slice(0, 8)}`);
        await seedUserRole(direct, userA, emptyRole, A.companyId);

        const before = await countSnapshots(A.companyId);
        await expect(
          svc.create(A.companyId, userA, {
            targetType: "company",
            periodStart: "2026-06-01",
            periodEnd: "2026-06-30",
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        const after = await countSnapshots(A.companyId);
        expect(after).toBe(before); // fail-closed: KHÔNG side-effect.
      });
    });

    // ── (d) Audit — create() phát sinh audit object_type='profit_snapshot' ──────
    describe("(d) audit on create", () => {
      it("create() ghi audit_logs object_type='profit_snapshot' action='ProfitSnapshotCreated' (+1)", async () => {
        const before = await countProfitAudit(A.companyId, "ProfitSnapshotCreated");
        const out = await svc.create(A.companyId, financeUserA, {
          targetType: "company",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
        });
        expect(out.id).toBeDefined();
        const after = await countProfitAudit(A.companyId, "ProfitSnapshotCreated");
        expect(after).toBe(before + 1);
      });
    });

    // ── (e) DB boundary validation (KHÔNG chỉ Zod) — CLAUDE.md §6 ────────────────
    describe("(e) DB boundary validation (not just Zod)", () => {
      it("target_type rác → profit_snapshots_target_type_check chặn INSERT (qua APP role)", async () => {
        await expect(
          asApp(A.companyId, (c) =>
            c.query(
              `INSERT INTO profit_snapshots
                 (company_id, target_type, target_id, period_start, period_end,
                  total_revenue, total_direct_cost, total_allocated_cost, total_cost, profit)
               VALUES ($1,'bogus_target_xyz', gen_random_uuid(), '2026-06-01','2026-06-30',
                  1.00, 0.00, 0.00, 0.00, 1.00)`,
              [A.companyId],
            ),
          ),
        ).rejects.toThrow(/profit_snapshots_target_type_check|violates check constraint/i);
      });

      it("company + target_id NOT NULL → profit_snapshots_target_id_check chặn INSERT", async () => {
        await expect(
          asApp(A.companyId, (c) =>
            c.query(
              `INSERT INTO profit_snapshots
                 (company_id, target_type, target_id, period_start, period_end,
                  total_revenue, total_direct_cost, total_allocated_cost, total_cost, profit)
               VALUES ($1,'company', gen_random_uuid(), '2026-06-01','2026-06-30',
                  1.00, 0.00, 0.00, 0.00, 1.00)`,
              [A.companyId],
            ),
          ),
        ).rejects.toThrow(/profit_snapshots_target_id_check|violates check constraint/i);
      });

      it("target ngoài MVP 4 (platform) → BadRequestException service-side, KHÔNG ghi snapshot", async () => {
        const before = await countSnapshots(A.companyId);
        await expect(
          svc.create(A.companyId, financeUserA, {
            targetType: "platform" as unknown as "company",
            targetId: randomUUID(),
            periodStart: "2026-06-01",
            periodEnd: "2026-06-30",
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(await countSnapshots(A.companyId)).toBe(before);
      });
    });

    // ── (f) view-finance mask — DENY ⇒ số tiền null SERVER-side; ALLOW ⇒ số thật ─
    describe("(f) view-finance mask (server-side)", () => {
      it("caller KHÔNG có view-finance → create() trả totalRevenue/profit/margin = null", async () => {
        // user chỉ có create:finance (non-sensitive) nhưng KHÔNG có view-finance (sensitive).
        const writeOnly = await seedUser(
          direct,
          A.companyId,
          `pf-write-${randomUUID().slice(0, 8)}@a.test`,
        );
        // gán role có create/read/update/delete:finance non-sensitive nhưng KHÔNG view-finance:
        // dùng role 'employee'? employee không có finance. Tạo role + grant 4 non-sensitive qua catalog.
        const roleId = await seedRole(direct, A.companyId, `pf-writeonly-${randomUUID().slice(0, 8)}`);
        await direct.query(
          `INSERT INTO role_permissions (role_id, permission_id, effect)
           SELECT $1, p.id, 'ALLOW' FROM permissions p
           WHERE p.resource_type='finance' AND p.action='create' AND p.is_sensitive=false
           ON CONFLICT DO NOTHING`,
          [roleId],
        );
        await seedUserRole(direct, writeOnly, roleId, A.companyId);

        const out = await svc.create(A.companyId, writeOnly, {
          targetType: "company",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
        });
        expect(out.totalRevenue).toBeNull();
        expect(out.totalDirectCost).toBeNull();
        expect(out.totalAllocatedCost).toBeNull();
        expect(out.totalCost).toBeNull();
        expect(out.profit).toBeNull();
        expect(out.profitMargin).toBeNull();
        // số THẬT vẫn được persist (mask chỉ ở DTO trả về).
        const persisted = await direct.query(
          `SELECT total_revenue FROM profit_snapshots WHERE id = $1`,
          [out.id],
        );
        expect(persisted.rows[0].total_revenue).not.toBeNull();
      });

      it("caller CÓ view-finance (finance-manager) → create() trả số tiền thật", async () => {
        const out = await svc.create(A.companyId, financeUserA, {
          targetType: "company",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
        });
        expect(out.totalRevenue).not.toBeNull();
        expect(typeof out.totalRevenue).toBe("number");
        expect(out.profit).not.toBeNull();
      });
    });
  },
);
