import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { ProfitRepository } from "../../src/finance/profit.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G13-3 — Vòng đời allocation × profit snapshot (regression cho MEDIUM gate-finding).
 *
 * `adjust()`/`void()` KHÔNG đụng cost_allocations → allocation luôn trỏ record được phân bổ lúc đó.
 * `sumAllocatedActiveTx` PHẢI phân biệt:
 *   - cost chỉ bị ADJUST  ⇒ GIỮ allocation (cost vẫn có thật; phân bổ cũ hợp lệ tới khi re-allocate).
 *     ⚠️ Bug cũ dùng `NOT EXISTS replaces` ⇒ rớt allocation này về 0 ⇒ THỔI PHỒNG profit sub-scope.
 *   - cost bị VOID (kể cả chuỗi adjust→void) ⇒ LOẠI allocation (cost bị huỷ).
 *
 * Seed cost_records/cost_allocations TRỰC TIẾP (bypass service) để dựng đúng trạng thái orphaned mà
 * service.allocate() chặn không cho tạo. allocation_target polymorphic (không FK) ⇒ channel id tuỳ ý.
 * Postgres THẬT (lane DB mediaos_g13).
 */
describe.skipIf(!hasDb)("G13-3 profit allocation lifecycle (adjust giữ · void loại)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let userA: string;
  let db: DatabaseService;
  let repo: ProfitRepository;

  const PERIOD = { from: "2026-06-01", to: "2026-06-30" };
  const COST_DATE = "2026-06-15";

  /** Seed 1 cost_record (entry_kind + replaces tuỳ ý). Trả id. */
  async function seedCost(
    entryKind: "original" | "adjustment" | "void",
    amount: string,
    replacesRecordId: string | null,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO cost_records
         (company_id, cost_type, amount, currency, cost_date, entered_by, entry_kind, replaces_record_id)
       VALUES ($1, 'production', $2, 'VND', $3::date, $4, $5, $6) RETURNING id`,
      [A.companyId, amount, COST_DATE, userA, entryKind, replacesRecordId],
    );
    return r.rows[0].id as string;
  }

  /** Seed 1 allocation active trỏ cost → channel. */
  async function seedAlloc(costRecordId: string, channelId: string, amount: string): Promise<void> {
    await direct.query(
      `INSERT INTO cost_allocations
         (company_id, cost_record_id, allocation_run_id, allocation_target_type,
          allocation_target_id, allocation_method, allocated_amount)
       VALUES ($1, $2, $3, 'channel', $4, 'equal_split', $5)`,
      [A.companyId, costRecordId, randomUUID(), channelId, amount],
    );
  }

  /** allocated cost (cents) cho channel scope, qua RLS tenant A. */
  async function sumAlloc(channelId: string): Promise<bigint> {
    return db.withTenant(A.companyId, (tx) =>
      repo.sumAllocatedActiveTx(tx, PERIOD, { type: "channel", id: channelId }),
    );
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "finProfAlloc");
    userA = await seedUser(direct, A.companyId, `pf-alloc-${randomUUID().slice(0, 8)}@a.test`);
    db = new DatabaseService();
    repo = new ProfitRepository(db);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("allocate → snapshot: allocation được tính (baseline)", async () => {
    const ch = randomUUID();
    const c0 = await seedCost("original", "1000.00", null);
    await seedAlloc(c0, ch, "1000.00");
    expect(await sumAlloc(ch)).toBe(100000n);
  });

  it("allocate → ADJUST cost → snapshot: allocation VẪN được tính (fix; bug cũ rớt về 0)", async () => {
    const ch = randomUUID();
    const c0 = await seedCost("original", "1000.00", null);
    await seedAlloc(c0, ch, "1000.00");
    // adjust C0 → C1 (amount đổi 1000→1200); allocation A0 vẫn trỏ C0 (service không re-point).
    await seedCost("adjustment", "1200.00", c0);
    expect(await sumAlloc(ch)).toBe(100000n);
  });

  it("allocate → adjust → VOID → snapshot: allocation bị loại (lineage void nhiều bước)", async () => {
    const ch = randomUUID();
    const c0 = await seedCost("original", "1000.00", null);
    await seedAlloc(c0, ch, "1000.00");
    const c1 = await seedCost("adjustment", "1200.00", c0);
    await seedCost("void", "1200.00", c1); // V replaces C1 ⇒ lineage {C0,C1} voided
    expect(await sumAlloc(ch)).toBe(0n);
  });

  it("allocate → VOID trực tiếp → snapshot: allocation bị loại", async () => {
    const ch = randomUUID();
    const c0 = await seedCost("original", "1000.00", null);
    await seedAlloc(c0, ch, "1000.00");
    await seedCost("void", "1000.00", c0); // V replaces C0 trực tiếp
    expect(await sumAlloc(ch)).toBe(0n);
  });
});
