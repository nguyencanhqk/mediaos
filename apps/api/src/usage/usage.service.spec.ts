import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsageService } from "./usage.service";
import type { UsageQuery } from "@mediaos/contracts";

/**
 * CS-7 UsageService unit tests.
 *
 * Kiểm tra:
 * 1. withTenant gọi với companyId đúng (tenant isolation).
 * 2. 2 tenant độc lập không cross-leak.
 * 3. User DTO mapping: lastLoginAt → ISO / null, fullName null, departmentName null.
 * 4. Shape tổng quát của response.
 */

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Build a full drizzle-like select chain supporting:
 * .select().from().where() → resolves
 * .select().from().leftJoin().leftJoin().where().orderBy() → resolves
 *
 * `resolveWith` is what the final await resolves to.
 */
function makeChain(resolveWith: unknown[]): Record<string, AnyFn> {
  const terminal: Promise<unknown[]> & {
    orderBy: AnyFn;
    where: AnyFn;
    leftJoin: AnyFn;
  } = Object.assign(Promise.resolve(resolveWith), {
    orderBy: vi.fn(() => Promise.resolve(resolveWith)),
    where: vi.fn(() => terminal),
    leftJoin: vi.fn(() => terminal),
  });
  // Make all chain methods return terminal so any chaining works
  return {
    from: vi.fn(() => terminal),
  };
}

/**
 * Build a mock DatabaseService whose withTenant calls fn(tx).
 * tx.select() returns a fresh chain per call, resolving with sequences[n].
 */
function buildMockDb(sequences: unknown[][]) {
  let callIdx = 0;

  const mockWithTenant = vi.fn(async (companyId: string, fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      select: vi.fn((_cols?: unknown) => {
        const rows = sequences[callIdx++] ?? [];
        return makeChain(rows);
      }),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
      })),
    };
    return fn(tx);
  });

  return { withTenant: mockWithTenant };
}

const EMPTY_QUERY: UsageQuery = {};

// ── Default sequences for a full getTenantUsage call ──────────────────────────
// Order: countLogins, countActiveUsers, countTasksCreated, countTasksCompleted, listUsers
function makeDefaultSequences(overrides: {
  loginCount?: number;
  activeUserCount?: number;
  tasksCreated?: number;
  tasksCompleted?: number;
  users?: unknown[];
}): unknown[][] {
  return [
    [{ value: overrides.loginCount ?? 0 }],
    [{ value: overrides.activeUserCount ?? 0 }],
    [{ value: overrides.tasksCreated ?? 0 }],
    [{ value: overrides.tasksCompleted ?? 0 }],
    overrides.users ?? [],
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UsageService — tenant isolation", () => {
  it("calls withTenant with the correct companyId", async () => {
    const mockDb = buildMockDb(makeDefaultSequences({ loginCount: 5 }));
    const service = new UsageService(mockDb as never);
    await service.getTenantUsage(COMPANY_A, EMPTY_QUERY);
    expect(mockDb.withTenant).toHaveBeenCalledWith(COMPANY_A, expect.any(Function));
  });

  it("does NOT call withTenant with company B when querying company A", async () => {
    const mockDb = buildMockDb(makeDefaultSequences({}));
    const service = new UsageService(mockDb as never);
    await service.getTenantUsage(COMPANY_A, EMPTY_QUERY);
    for (const [companyId] of (mockDb.withTenant as ReturnType<typeof vi.fn>).mock.calls) {
      expect(companyId).toBe(COMPANY_A);
      expect(companyId).not.toBe(COMPANY_B);
    }
  });
});

describe("UsageService — aggregation shape", () => {
  it("returns all-zero shape when DB returns empty", async () => {
    const mockDb = buildMockDb(makeDefaultSequences({}));
    const service = new UsageService(mockDb as never);
    const result = await service.getTenantUsage(COMPANY_A, EMPTY_QUERY);
    expect(result).toMatchObject({
      loginCount: 0,
      activeUserCount: 0,
      tasksCreated: 0,
      tasksCompleted: 0,
      users: [],
    });
  });

  it("returns populated counts from DB sequences", async () => {
    const mockDb = buildMockDb(
      makeDefaultSequences({ loginCount: 42, activeUserCount: 7, tasksCreated: 15, tasksCompleted: 8 }),
    );
    const service = new UsageService(mockDb as never);
    const result = await service.getTenantUsage(COMPANY_A, EMPTY_QUERY);
    expect(result.loginCount).toBe(42);
    expect(result.activeUserCount).toBe(7);
    expect(result.tasksCreated).toBe(15);
    expect(result.tasksCompleted).toBe(8);
  });
});

describe("UsageService — user DTO mapping", () => {
  it("maps lastLoginAt Date → ISO string", async () => {
    const loginDate = new Date("2026-06-17T12:00:00Z");
    const userRow = {
      userId: USER_1,
      fullName: "Test User",
      email: "user@example.com",
      lastLoginAt: loginDate,
      departmentName: "Marketing",
    };
    const mockDb = buildMockDb(makeDefaultSequences({ users: [userRow] }));
    const service = new UsageService(mockDb as never);
    const result = await service.getTenantUsage(COMPANY_A, EMPTY_QUERY);
    expect(result.users[0].lastLoginAt).toBe(loginDate.toISOString());
  });

  it("maps lastLoginAt null → null (user never logged in)", async () => {
    const userRow = {
      userId: USER_2,
      fullName: null,
      email: "new@example.com",
      lastLoginAt: null,
      departmentName: null,
    };
    const mockDb = buildMockDb(makeDefaultSequences({ users: [userRow] }));
    const service = new UsageService(mockDb as never);
    const result = await service.getTenantUsage(COMPANY_A, EMPTY_QUERY);
    expect(result.users[0].lastLoginAt).toBeNull();
    expect(result.users[0].fullName).toBeNull();
    expect(result.users[0].departmentName).toBeNull();
  });

  it("maps userId and email correctly", async () => {
    const userRow = {
      userId: USER_1,
      fullName: "Trần Thị B",
      email: "b@company.vn",
      lastLoginAt: null,
      departmentName: "Nhân sự",
    };
    const mockDb = buildMockDb(makeDefaultSequences({ users: [userRow] }));
    const service = new UsageService(mockDb as never);
    const result = await service.getTenantUsage(COMPANY_A, EMPTY_QUERY);
    expect(result.users[0].userId).toBe(USER_1);
    expect(result.users[0].email).toBe("b@company.vn");
    expect(result.users[0].departmentName).toBe("Nhân sự");
  });
});

describe("UsageService — 2-tenant isolation (no cross-leak)", () => {
  it("two separate service instances with different companyIds never share context", async () => {
    const mockDbA = buildMockDb(makeDefaultSequences({ loginCount: 10, activeUserCount: 2 }));
    const mockDbB = buildMockDb(makeDefaultSequences({ loginCount: 5, activeUserCount: 1 }));
    const serviceA = new UsageService(mockDbA as never);
    const serviceB = new UsageService(mockDbB as never);

    await serviceA.getTenantUsage(COMPANY_A, EMPTY_QUERY);
    await serviceB.getTenantUsage(COMPANY_B, EMPTY_QUERY);

    const aCall = (mockDbA.withTenant as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const bCall = (mockDbB.withTenant as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(aCall).toBe(COMPANY_A);
    expect(bCall).toBe(COMPANY_B);
    expect(aCall).not.toBe(bCall);
  });
});
