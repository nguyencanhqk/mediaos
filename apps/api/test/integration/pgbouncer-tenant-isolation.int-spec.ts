import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directPool, hasPgBouncer, pgbouncerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { seedPlatformAccount } from "../helpers/seed";

/**
 * GX-4 (g2rls) — DENY-PATH CỐT LÕI qua PgBouncer transaction-mode.
 *
 * VÌ SAO: prod chạy mediaos_app QUA PgBouncer transaction-mode (ADR-0003), ở đó MỘT server-connection
 * được TÁI DÙNG cho nhiều client/transaction. RLS ép tenant bằng `set_config('app.current_company_id',$1,true)`
 * (LOCAL, scope transaction). Nếu GUC KHÔNG reset khi transaction commit/rollback, một transaction kế tiếp
 * (tenant khác / không ngữ cảnh) sẽ MANG ngữ cảnh cũ ⇒ RÒ CHÉO TENANT. Test này chứng minh điều đó KHÔNG
 * xảy ra: pool max=1 ÉP đúng 1 server-conn tái dùng.
 *
 * SKIP khi thiếu PGBOUNCER_URL (local dev không cấu hình auth pooler) — KHÔNG đỏ giả. CI bật service pgbouncer.
 * Seed bằng pool DIRECT (owner, bypass RLS); ĐỌC qua pool PgBouncer (mediaos_app, RLS ép thật).
 */

/** Bảng nhạy cảm để chứng minh cross-read 0 row của tenant khác (ngoài users cơ bản). */
const SENSITIVE_TABLES = ["users", "payslips", "revenue_records", "platform_accounts"] as const;

describe.skipIf(!hasPgBouncer)("GX-4 PgBouncer × RLS tenant isolation (pooled conn reuse)", () => {
  const direct = directPool();
  const pool = pgbouncerPool(1); // max=1 ⇒ ép tái dùng đúng 1 server-connection
  let A: SeededTenant;
  let B: SeededTenant;
  const userA = new Map<string, string>(); // table → row id của A
  const userB = new Map<string, string>();

  beforeAll(async () => {
    A = await seedCompany(direct, "pgbA");
    B = await seedCompany(direct, "pgbB");

    // users
    userA.set("users", await seedUser(direct, A.companyId, `pgb-a-${A.slug}@x.test`));
    userB.set("users", await seedUser(direct, B.companyId, `pgb-b-${B.slug}@x.test`));

    // platform_accounts (envelope DUMMY đúng độ dài CHECK — KHÔNG crypto thật, KHÔNG log/giải mã)
    userA.set("platform_accounts", await seedPlatformAccount(direct, A.companyId));
    userB.set("platform_accounts", await seedPlatformAccount(direct, B.companyId));

    // revenue_records (append-only ledger) — seed qua owner
    userA.set("revenue_records", await seedRevenue(direct, A.companyId, userA.get("users")!));
    userB.set("revenue_records", await seedRevenue(direct, B.companyId, userB.get("users")!));

    // payslips (append-only snapshot) — cần payroll_period + user
    userA.set("payslips", await seedPayslip(direct, A.companyId, userA.get("users")!));
    userB.set("payslips", await seedPayslip(direct, B.companyId, userB.get("users")!));
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await pool.end();
  });

  /** Mở 1 transaction LOCAL, set tenant, chạy SELECT, ROLLBACK — như withTenant ở runtime. */
  async function withTenantOnConn<T>(
    c: PoolClient,
    companyId: string,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    await c.query("BEGIN");
    try {
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    }
  }

  it("(1) cùng 1 pooled conn: withTenant(A) thấy A, rồi withTenant(B) thấy B & 0 row của A", async () => {
    const c = await pool.connect();
    try {
      const seenA = await withTenantOnConn(c, A.companyId, async (cc) => {
        const r = await cc.query("SELECT id FROM users");
        return new Set(r.rows.map((x) => x.id as string));
      });
      expect(seenA.has(userA.get("users")!)).toBe(true);
      expect(seenA.has(userB.get("users")!)).toBe(false);

      // CÙNG server-conn (max=1): chuyển sang tenant B → chỉ thấy B, KHÔNG còn rò A.
      const seenB = await withTenantOnConn(c, B.companyId, async (cc) => {
        const r = await cc.query("SELECT id FROM users");
        return new Set(r.rows.map((x) => x.id as string));
      });
      expect(seenB.has(userB.get("users")!)).toBe(true);
      expect(seenB.has(userA.get("users")!), "GUC tenant cũ RÒ sang transaction kế tiếp").toBe(false);
    } finally {
      c.release();
    }
  });

  it("(2) sau transaction có set_config, query NGOÀI transaction kế tiếp → GUC rỗng → 0 row (deny-by-default)", async () => {
    const c = await pool.connect();
    try {
      // Transaction set tenant A rồi COMMIT (LOCAL ⇒ phải reset khi commit qua PgBouncer transaction-mode).
      await withTenantOnConn(c, A.companyId, async (cc) => {
        const r = await cc.query("SELECT id FROM users");
        expect(r.rows.length).toBeGreaterThan(0); // trong ngữ cảnh A: thấy ít nhất user A
        return null;
      });

      // NGAY SAU, NGOÀI transaction (autocommit) trên CÙNG pooled conn: không ngữ cảnh ⇒ 0 row.
      const after = await c.query("SELECT id FROM users");
      expect(
        after.rows.length,
        "GUC LOCAL không reset khi commit ⇒ rò ngữ cảnh tenant qua pooled conn",
      ).toBe(0);
    } finally {
      c.release();
    }
  });

  it("(3) 2-tenant cross-read: login A qua pool → mọi bảng nhạy cảm trả 0 row của B", async () => {
    const c = await pool.connect();
    try {
      await withTenantOnConn(c, A.companyId, async (cc) => {
        for (const table of SENSITIVE_TABLES) {
          const r = await cc.query(`SELECT id FROM ${table}`);
          const ids = new Set(r.rows.map((x) => x.id as string));
          expect(ids.has(userA.get(table)!), `A KHÔNG thấy hàng A trong ${table}`).toBe(true);
          expect(ids.has(userB.get(table)!), `A THẤY hàng B trong ${table} (rò chéo)`).toBe(false);
        }
        return null;
      });
    } finally {
      c.release();
    }
  });
});

// ── Seed helpers (owner/direct — bypass RLS để dựng dữ liệu 2 tenant; KHÔNG nới grant app) ──

async function seedRevenue(direct: ReturnType<typeof directPool>, companyId: string, userId: string) {
  const r = await direct.query(
    `INSERT INTO revenue_records
       (company_id, amount, currency, revenue_date, source, entered_by, entry_kind)
     VALUES ($1, 1000.00, 'VND', current_date, 'manual', $2, 'original') RETURNING id`,
    [companyId, userId],
  );
  return r.rows[0].id as string;
}

async function seedPayslip(direct: ReturnType<typeof directPool>, companyId: string, userId: string) {
  const period = await direct.query(
    `INSERT INTO payroll_periods (company_id, period_month, status)
     VALUES ($1, '2026-01', 'draft') RETURNING id`,
    [companyId],
  );
  const r = await direct.query(
    `INSERT INTO payslips
       (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
     VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $3, 'original') RETURNING id`,
    [companyId, period.rows[0].id, userId],
  );
  return r.rows[0].id as string;
}
