import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService, type TenantTx } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { CostAllocationService } from "../../src/finance/cost-allocation.service";
import { CostAllocationRepository } from "../../src/finance/cost-allocation.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * B2(b) N+1 — allocate() với N target phải batch: TỔNG số query DB thực thi phải ≤ ngưỡng tất định,
 * KHÔNG tỉ lệ ~3N (per-target targetExistsTx + per-line insertTx). Residual MEDIUM g13-2.
 *
 * Đếm query: bọc DatabaseService.withTenant → Proxy tx đếm mỗi lần gọi execute/insert/update/select.
 * equal_split (KHÔNG DB-resolved) → loại biến thiên resolveWeightTx; mọi query còn lại là kiểm-target +
 * soft-delete + insert + audit + outbox. N=50 target: ~3N (≥150) là defect; mục tiêu ≤ MAX_QUERIES.
 *
 * Postgres THẬT (skipIf khi không có DB). KHÔNG mock RLS — chạy đường ghi thật.
 */

/** Ngưỡng tổng query/op cho allocate (target ≤ 200 theo contract). Batch ⇒ hằng số nhỏ, KHÔNG ~3N. */
const MAX_QUERIES_PER_ALLOCATE = 30;

/** Bọc DatabaseService để đếm số DB-op trong 1 lần withTenant (allocate). */
class CountingDatabaseService extends DatabaseService {
  public queryCount = 0;
  reset(): void {
    this.queryCount = 0;
  }
  override async withTenant<T>(companyId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return super.withTenant(companyId, (tx) => {
      const counted = new Proxy(tx as object, {
        get: (target, prop, receiver) => {
          const orig = Reflect.get(target, prop, receiver);
          // Đếm mỗi lần khởi tạo 1 câu lệnh DB (mỗi câu = 1 round-trip thật).
          if (
            typeof orig === "function" &&
            (prop === "execute" || prop === "insert" || prop === "update" || prop === "select")
          ) {
            return (...args: unknown[]) => {
              this.queryCount += 1;
              return (orig as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return orig;
        },
      }) as TenantTx;
      return fn(counted);
    });
  }
}

describe.skipIf(!hasDb)("B2(b) allocate query-count (batch — KHÔNG N+1)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let financeUserA: string;
  let countingDb: CountingDatabaseService;
  let allocSvc: CostAllocationService;

  async function seedCost(
    t: SeededTenant,
    enteredBy: string,
    amount = "100000.00",
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO cost_records
         (company_id, cost_type, amount, currency, cost_date, entered_by, entry_kind)
       VALUES ($1, 'production', $2, 'VND', current_date, $3, 'original') RETURNING id`,
      [t.companyId, amount, enteredBy],
    );
    return r.rows[0].id as string;
  }

  async function seedTeam(t: SeededTenant, name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO teams (company_id, name) VALUES ($1, $2) RETURNING id`,
      [t.companyId, `${name}-${randomUUID().slice(0, 8)}`],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "qcntA");
    financeUserA = await seedUser(
      direct,
      A.companyId,
      `qcnt-mgr-${randomUUID().slice(0, 8)}@a.test`,
    );
    await seedUserRole(direct, financeUserA, "00000000-0000-0000-0000-00000000000a", A.companyId);

    countingDb = new CountingDatabaseService();
    const audit = new AuditService();
    const outbox = new OutboxService();
    const permission = new PermissionService(new PermissionRepository(new DatabaseService()));
    allocSvc = new CostAllocationService(
      countingDb,
      new CostAllocationRepository(countingDb),
      permission,
      audit,
      outbox,
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it(`allocate N=50 target (equal_split) → tổng query ≤ ${MAX_QUERIES_PER_ALLOCATE} (batch, KHÔNG ~3N)`, async () => {
    const N = 50;
    const targets = [];
    for (let i = 0; i < N; i += 1) {
      const teamId = await seedTeam(A, `qt${i}`);
      targets.push({ targetType: "team" as const, targetId: teamId });
    }
    const costA = await seedCost(A, financeUserA);

    countingDb.reset();
    const result = await allocSvc.allocate(A.companyId, financeUserA, costA, {
      method: "equal_split",
      targets,
    });

    expect(result.allocations.length).toBe(N);
    // ~3N ≈ 150 query là defect (per-target exists + per-line insert + load + soft-delete + audit + outbox).
    // Batch ⇒ hằng số nhỏ KHÔNG phụ thuộc N.
    expect(countingDb.queryCount).toBeLessThanOrEqual(MAX_QUERIES_PER_ALLOCATE);
  });

  it("allocate N=10 và N=50 → query-count KHÔNG tăng tuyến tính theo N (batch tất định)", async () => {
    async function countFor(n: number): Promise<number> {
      const targets = [];
      for (let i = 0; i < n; i += 1) {
        const teamId = await seedTeam(A, `lt${n}_${i}`);
        targets.push({ targetType: "team" as const, targetId: teamId });
      }
      const costA = await seedCost(A, financeUserA);
      countingDb.reset();
      await allocSvc.allocate(A.companyId, financeUserA, costA, { method: "equal_split", targets });
      return countingDb.queryCount;
    }
    const q10 = await countFor(10);
    const q50 = await countFor(50);
    // Nếu ~3N: q50-q10 ≈ 120. Batch: chênh lệch nhỏ (insert batch 1 lệnh bất kể N).
    expect(q50 - q10).toBeLessThanOrEqual(5);
  });
});
