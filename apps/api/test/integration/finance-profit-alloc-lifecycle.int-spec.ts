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
  let B: SeededTenant;
  let userB: string;
  let db: DatabaseService;
  let repo: ProfitRepository;

  const PERIOD = { from: "2026-06-01", to: "2026-06-30" };
  const COST_DATE = "2026-06-15";

  /** Seed 1 cost_record (entry_kind + replaces tuỳ ý). opts.companyId/userId để seed tenant khác. Trả id. */
  async function seedCost(
    entryKind: "original" | "adjustment" | "void",
    amount: string,
    replacesRecordId: string | null,
    opts: { companyId?: string; userId?: string } = {},
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO cost_records
         (company_id, cost_type, amount, currency, cost_date, entered_by, entry_kind, replaces_record_id)
       VALUES ($1, 'production', $2, 'VND', $3::date, $4, $5, $6) RETURNING id`,
      [opts.companyId ?? A.companyId, amount, COST_DATE, opts.userId ?? userA, entryKind, replacesRecordId],
    );
    return r.rows[0].id as string;
  }

  /**
   * Seed 1 allocation active trỏ cost → channel. opts.runId + opts.calculatedAt để ép cùng-run và thứ
   * tự thời-gian-run deterministic (dựng đúng trạng thái re-allocate orphaned mà service.allocate chặn).
   * opts.companyId để seed tenant khác (kiểm RLS).
   */
  async function seedAlloc(
    costRecordId: string,
    channelId: string,
    amount: string,
    opts: { runId?: string; calculatedAt?: string; companyId?: string } = {},
  ): Promise<void> {
    await direct.query(
      `INSERT INTO cost_allocations
         (company_id, cost_record_id, allocation_run_id, allocation_target_type,
          allocation_target_id, allocation_method, allocated_amount, calculated_at)
       VALUES ($1, $2, $3, 'channel', $4, 'equal_split', $5, COALESCE($6::timestamptz, now()))`,
      [
        opts.companyId ?? A.companyId,
        costRecordId,
        opts.runId ?? randomUUID(),
        channelId,
        amount,
        opts.calculatedAt ?? null,
      ],
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
    B = await seedCompany(direct, "finProfAllocB");
    userB = await seedUser(direct, B.companyId, `pf-alloc-${randomUUID().slice(0, 8)}@b.test`);
    db = new DatabaseService();
    repo = new ProfitRepository(db);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
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

  it("allocate → adjust → RE-ALLOCATE: chỉ run mới nhất tính (KB1 — KHÔNG đếm đôi)", async () => {
    const ch = randomUUID();
    const c0 = await seedCost("original", "1000.00", null);
    // R0 trên C0 (mốc cũ).
    await seedAlloc(c0, ch, "1000.00", { calculatedAt: "2026-06-15T10:00:00+00" });
    // adjust C0 → C1 (service KHÔNG re-point allocation); re-allocate trên C1 = run R1 mới hơn.
    const c1 = await seedCost("adjustment", "1000.00", c0);
    await seedAlloc(c1, ch, "1000.00", { calculatedAt: "2026-06-15T11:00:00+00" });
    // A0 (C0) còn active + A1 (C1) active. Bug f76f69d đếm CẢ HAI = 200000n.
    // Đúng: cùng lineage {C0,C1} ⇒ chỉ run mới nhất (R1) tính ⇒ 100000n.
    expect(await sumAlloc(ch)).toBe(100000n);
  });

  it("RE-ALLOCATE đổi tập target: target bị bỏ KHÔNG còn tính (chB-drop phantom)", async () => {
    const chA = randomUUID();
    const chB = randomUUID();
    const c0 = await seedCost("original", "1000.00", null);
    // R0 chia C0 cho {chA:600, chB:400} (cùng allocation_run_id, cùng mốc).
    const r0 = randomUUID();
    await seedAlloc(c0, chA, "600.00", { runId: r0, calculatedAt: "2026-06-15T10:00:00+00" });
    await seedAlloc(c0, chB, "400.00", { runId: r0, calculatedAt: "2026-06-15T10:00:00+00" });
    // adjust C0 → C1; re-allocate run R1 mới hơn CHỈ chA (bỏ chB).
    const c1 = await seedCost("adjustment", "1000.00", c0);
    await seedAlloc(c1, chA, "1000.00", { calculatedAt: "2026-06-15T11:00:00+00" });
    // chA: chỉ run thắng R1 = 100000n. chB: R0 không phải run thắng của lineage ⇒ 0n.
    // Bug per-target sẽ trả chB = 40000n (phantom). Bug f76f69d trả chA = 160000n.
    expect(await sumAlloc(chA)).toBe(100000n);
    expect(await sumAlloc(chB)).toBe(0n);
  });

  it("RE-ALLOCATE 3 lần: chỉ run mới nhất (R2) tính, KHÔNG cộng dồn R0+R1+R2", async () => {
    const ch = randomUUID();
    const c0 = await seedCost("original", "1000.00", null);
    await seedAlloc(c0, ch, "1000.00", { calculatedAt: "2026-06-15T08:00:00+00" }); // R0
    const c1 = await seedCost("adjustment", "1000.00", c0);
    await seedAlloc(c1, ch, "1000.00", { calculatedAt: "2026-06-15T09:00:00+00" }); // R1
    const c2 = await seedCost("adjustment", "1000.00", c1);
    await seedAlloc(c2, ch, "1000.00", { calculatedAt: "2026-06-15T10:00:00+00" }); // R2 mới nhất
    // 3 run cùng lineage {C0,C1,C2} đều active ⇒ chỉ R2 tính ⇒ 100000n (KHÔNG 300000n).
    expect(await sumAlloc(ch)).toBe(100000n);
  });

  it("2 lineage độc lập cùng target: CẢ HAI tính (KHÔNG dedup nhầm xuyên lineage)", async () => {
    const ch = randomUUID();
    // Lineage X: cost X0 phân bổ 1000 → ch.
    const x0 = await seedCost("original", "1000.00", null);
    await seedAlloc(x0, ch, "1000.00", { calculatedAt: "2026-06-15T10:00:00+00" });
    // Lineage Y: cost Y0 (độc lập, replaces=null) phân bổ 500 → cùng ch.
    const y0 = await seedCost("original", "500.00", null);
    await seedAlloc(y0, ch, "500.00", { calculatedAt: "2026-06-15T11:00:00+00" });
    // 2 chi phí KHÁC NHAU ⇒ tổng = 1000 + 500 = 1500 ⇒ 150000n (dedup chỉ trong-lineage).
    expect(await sumAlloc(ch)).toBe(150000n);
  });

  it("cross-tenant RLS: allocation tenant B KHÔNG lọt vào SUM của tenant A (cùng channel id)", async () => {
    const ch = randomUUID(); // polymorphic, không FK ⇒ cùng id dùng được ở 2 tenant
    const a0 = await seedCost("original", "1000.00", null); // tenant A
    await seedAlloc(a0, ch, "1000.00");
    // Tenant B: cost + alloc cùng channel id ch.
    const b0 = await seedCost("original", "9999.00", null, { companyId: B.companyId, userId: userB });
    await seedAlloc(b0, ch, "9999.00", { companyId: B.companyId });
    // sumAlloc chạy withTenant(A) ⇒ RLS lọc ⇒ chỉ thấy A = 100000n (KHÔNG kéo 999900n của B).
    expect(await sumAlloc(ch)).toBe(100000n);
  });
});
