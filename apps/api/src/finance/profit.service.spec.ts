import { describe, expect, it, vi, beforeEach } from "vitest";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
// 🔴 RED: ProfitService/ProfitRepository CHƯA tồn tại — G13-3 GREEN phải tạo. Import này khiến CẢ
//    suite ĐỎ ĐÚNG LÝ DO (module-not-found). KHÔNG implement GREEN cùng lượt viết test.
import { ProfitService } from "./profit.service";
import type { ProfitRepository } from "./profit.repository";
import type { PermissionService } from "../permission/permission.service";
import type { AuditService } from "../events/audit.service";
import type { OutboxService } from "../events/outbox.service";
import type { DatabaseService, TenantTx } from "../db/db.service";

/**
 * G13-3 — UNIT spec ProfitService (formula/scope/mask), KHÔNG chạm DB (mock repo + db.withTenant).
 *
 * Mục tiêu kiểm:
 *  - Chống ĐẾM ĐÔI theo scope (plan §4.5): company ⇒ allocated=0 + direct=toàn bộ; scope con ⇒
 *    direct theo cột target + allocated theo allocation trỏ target.
 *  - profit = revenue − direct − allocated; tiền tính bằng CENTS integer (không float) khớp profit-calc.ts.
 *  - target ngoài MVP 4 (platform/org_unit/team) → BadRequestException 'chưa hỗ trợ' (KHÔNG ghi snapshot).
 *  - mask SERVER-side: thiếu view-finance ⇒ số tiền = null; lỗi hạ tầng can() ⇒ fail-safe mask (null).
 */

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const CHANNEL = "33333333-3333-3333-3333-333333333333";

/** mock TenantTx — service không chạm field nào của tx trong unit (repo bị mock). */
const FAKE_TX = {} as unknown as TenantTx;

interface Mocks {
  repo: ProfitRepository;
  permissions: PermissionService;
  audit: AuditService;
  outbox: OutboxService;
  db: DatabaseService;
  insertCalls: Array<Record<string, unknown>>;
}

/** allow can() trả ALLOW cho write (create:finance) + tùy chọn ALLOW/deny cho view-finance. */
function buildMocks(opts?: {
  canWrite?: boolean;
  canView?: boolean | "throw";
  revenueCents?: bigint;
  directCents?: bigint;
  allocatedCents?: bigint;
}): Mocks {
  const insertCalls: Array<Record<string, unknown>> = [];
  const repo = {
    sumRevenueEffectiveTx: vi.fn(async () => opts?.revenueCents ?? 0n),
    sumDirectCostEffectiveTx: vi.fn(async () => opts?.directCents ?? 0n),
    sumAllocatedActiveTx: vi.fn(async () => opts?.allocatedCents ?? 0n),
    insertTx: vi.fn(async (_tx: TenantTx, data: Record<string, unknown>) => {
      insertCalls.push(data);
      return { id: "snap-1", ...data };
    }),
    list: vi.fn(async () => []),
    findLatest: vi.fn(async () => null),
  } as unknown as ProfitRepository;

  const permissions = {
    can: vi.fn(async (input: { action: string }) => {
      if (input.action === "view-finance") {
        if (opts?.canView === "throw") throw new Error("infra down");
        return { allow: opts?.canView ?? false, reason: "test" };
      }
      // create:finance
      return { allow: opts?.canWrite ?? true, reason: "test" };
    }),
  } as unknown as PermissionService;

  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
  const outbox = { enqueue: vi.fn(async () => undefined) } as unknown as OutboxService;
  const db = {
    withTenant: vi.fn(async <T>(_companyId: string, fn: (tx: TenantTx) => Promise<T>) => fn(FAKE_TX)),
  } as unknown as DatabaseService;

  return { repo, permissions, audit, outbox, db, insertCalls };
}

function makeService(m: Mocks): ProfitService {
  return new ProfitService(m.db, m.repo, m.permissions, m.audit, m.outbox);
}

describe("ProfitService — formula & scope (chống đếm đôi)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("company scope: allocated=0 (chỉ tái phân phối nội bộ), direct=toàn bộ cost", async () => {
    const m = buildMocks({
      canWrite: true,
      canView: true,
      revenueCents: 100_000_00n,
      directCents: 60_000_00n,
      allocatedCents: 9_999_00n, // dù repo trả >0, company scope PHẢI ép 0 (chống đếm đôi)
    });
    const svc = makeService(m);
    const out = await svc.create(COMPANY, USER, {
      targetType: "company",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    // company ⇒ KHÔNG gọi allocated (hoặc bỏ qua kết quả) — allocated=0 trong snapshot.
    expect(out.totalAllocatedCost).toBe(0);
    expect(out.totalDirectCost).toBe(60_000);
    expect(out.totalCost).toBe(60_000);
    expect(out.profit).toBe(40_000);
    expect(out.profitMargin).toBeCloseTo(0.4, 4);
  });

  it("scope con (channel): direct theo cột target + allocated theo allocation trỏ target", async () => {
    const m = buildMocks({
      canWrite: true,
      canView: true,
      revenueCents: 50_000_00n,
      directCents: 20_000_00n,
      allocatedCents: 5_000_00n,
    });
    const svc = makeService(m);
    const out = await svc.create(COMPANY, USER, {
      targetType: "channel",
      targetId: CHANNEL,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    expect(out.totalDirectCost).toBe(20_000);
    expect(out.totalAllocatedCost).toBe(5_000);
    expect(out.totalCost).toBe(25_000);
    expect(out.profit).toBe(25_000);
    // scope con PHẢI gọi sumAllocatedActiveTx với target.
    expect(m.repo.sumAllocatedActiveTx).toHaveBeenCalled();
  });

  it("target ngoài MVP 4 (platform/org_unit/team) → BadRequestException, KHÔNG ghi snapshot", async () => {
    const m = buildMocks({ canWrite: true });
    const svc = makeService(m);
    await expect(
      svc.create(COMPANY, USER, {
        // ép qua type cast: contract chỉ cho 4, nhưng service phải tự defend ở runtime.
        targetType: "platform" as unknown as "company",
        targetId: CHANNEL,
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(m.insertCalls.length).toBe(0); // KHÔNG ghi snapshot.
  });

  it("permission deny create:finance → ForbiddenException, KHÔNG mở tx (0 side-effect)", async () => {
    const m = buildMocks({ canWrite: false });
    const svc = makeService(m);
    await expect(
      svc.create(COMPANY, USER, {
        targetType: "company",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(m.db.withTenant).not.toHaveBeenCalled();
    expect(m.insertCalls.length).toBe(0);
  });
});

describe("ProfitService — mask SERVER-side (view-finance)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create() ALLOW view-finance → trả số tiền thật", async () => {
    const m = buildMocks({ canWrite: true, canView: true, revenueCents: 10_00n, directCents: 4_00n });
    const out = await makeService(m).create(COMPANY, USER, {
      targetType: "company",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    expect(out.totalRevenue).toBe(10);
    expect(out.profit).toBe(6);
  });

  it("create() DENY view-finance → số tiền = null (mask server-side, vẫn ghi snapshot thật)", async () => {
    const m = buildMocks({ canWrite: true, canView: false, revenueCents: 10_00n, directCents: 4_00n });
    const out = await makeService(m).create(COMPANY, USER, {
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
    // snapshot vẫn được GHI số thật (mask chỉ ở DTO trả về, KHÔNG ở giá trị persist).
    expect(m.insertCalls.length).toBe(1);
    expect(m.insertCalls[0].profit).toBe("6.00");
  });

  it("can() view-finance lỗi hạ tầng → fail-safe MASK (null), KHÔNG fail-open ra số", async () => {
    const m = buildMocks({ canWrite: true, canView: "throw", revenueCents: 10_00n });
    const out = await makeService(m).create(COMPANY, USER, {
      targetType: "company",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    expect(out.totalRevenue).toBeNull();
    expect(out.profit).toBeNull();
  });

  it("list() áp mask cho mọi snapshot (DENY → null)", async () => {
    const m = buildMocks({ canView: false });
    (m.repo.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "s1",
        companyId: COMPANY,
        targetType: "company",
        targetId: null,
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        totalRevenue: "100.00",
        totalDirectCost: "40.00",
        totalAllocatedCost: "0.00",
        totalCost: "40.00",
        profit: "60.00",
        profitMargin: "0.6000",
        calculatedAt: new Date().toISOString(),
        createdBy: USER,
      },
    ]);
    const rows = await makeService(m).list(COMPANY, USER, {});
    expect(rows[0].totalRevenue).toBeNull();
    expect(rows[0].profit).toBeNull();
  });
});
