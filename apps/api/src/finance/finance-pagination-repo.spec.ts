/**
 * B2(a) PAGINATION repo threading — unit spec (LANE b2). MIRROR attendance.pagination.spec.ts F6.
 *
 * RED-first: RevenueRepository.list / CostRepository.list PHẢI gọi `.limit(opts.limit).offset(opts.offset)`
 * trên query builder với đúng giá trị truyền vào filter. Chứng minh BẤT BIẾN unbounded-query: KHÔNG còn
 * list không LIMIT.
 *
 * DB I/O mock hoàn toàn (spy chuỗi drizzle builder) — không cần Postgres. withTenant mock chạy fn(tx).
 */

import { describe, expect, it, vi } from "vitest";
import { RevenueRepository } from "./revenue.repository";
import { CostRepository } from "./cost.repository";

/** Tạo 1 query builder giả chuỗi-được (mọi method trả this), bắt limit/offset. */
function makeQuerySpy() {
  const limitSpy = vi.fn().mockReturnThis();
  const offsetSpy = vi.fn().mockReturnThis();
  const query: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: limitSpy,
    offset: offsetSpy,
    // awaitable: trả mảng rỗng sau khi offset được gọi
    then: (resolve: (v: unknown[]) => void) => Promise.resolve(resolve([])),
  };
  return { query, limitSpy, offsetSpy };
}

/** DatabaseService giả: withTenant chỉ chạy fn(tx) với tx = query builder giả. */
function makeDb(query: Record<string, unknown>) {
  return {
    withTenant: (_companyId: string, fn: (tx: unknown) => unknown) => fn(query),
  } as unknown as ConstructorParameters<typeof RevenueRepository>[0];
}

describe("RevenueRepository.list — threads limit/offset to query builder", () => {
  it("gọi .limit(opts.limit).offset(opts.offset) với giá trị từ filter", async () => {
    const { query, limitSpy, offsetSpy } = makeQuerySpy();
    const repo = new RevenueRepository(makeDb(query));
    await repo.list("c1", { limit: 25, offset: 75 });
    expect(limitSpy).toHaveBeenCalledWith(25);
    expect(offsetSpy).toHaveBeenCalledWith(75);
  });

  it("mặc định limit=50 offset=0 khi filter thiếu page params", async () => {
    const { query, limitSpy, offsetSpy } = makeQuerySpy();
    const repo = new RevenueRepository(makeDb(query));
    await repo.list("c1", {});
    expect(limitSpy).toHaveBeenCalledWith(50);
    expect(offsetSpy).toHaveBeenCalledWith(0);
  });
});

describe("CostRepository.list — threads limit/offset to query builder", () => {
  it("gọi .limit(opts.limit).offset(opts.offset) với giá trị từ filter", async () => {
    const { query, limitSpy, offsetSpy } = makeQuerySpy();
    const repo = new CostRepository(
      makeDb(query) as unknown as ConstructorParameters<typeof CostRepository>[0],
    );
    await repo.list("c1", { limit: 10, offset: 30 });
    expect(limitSpy).toHaveBeenCalledWith(10);
    expect(offsetSpy).toHaveBeenCalledWith(30);
  });

  it("mặc định limit=50 offset=0 khi filter thiếu page params", async () => {
    const { query, limitSpy, offsetSpy } = makeQuerySpy();
    const repo = new CostRepository(
      makeDb(query) as unknown as ConstructorParameters<typeof CostRepository>[0],
    );
    await repo.list("c1", {});
    expect(limitSpy).toHaveBeenCalledWith(50);
    expect(offsetSpy).toHaveBeenCalledWith(0);
  });
});
