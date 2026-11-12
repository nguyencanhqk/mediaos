import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { TenantTx } from "../db/db.service";
import type { GoalRefViewer } from "./task-goal-ref.policy";
import { isGoalFilterVisibleTx } from "./task-core.goal-filter";
import {
  buildMyTasksPagination,
  loadMyTasksForListTx,
  myTasksBaseWhere,
} from "./task-my-tasks.query";

const dialect = new PgDialect();
const COMPANY = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("myTasksBaseWhere", () => {
  it.each([null, "33333333-3333-4333-8333-333333333333"])(
    "luôn có company_id + deleted_at IS NULL (empId=%s)",
    (empId) => {
      const q = dialect.sqlToQuery(myTasksBaseWhere(COMPANY, USER, empId));
      expect(q.sql).toContain("tk.company_id =");
      expect(q.sql).toContain("tk.deleted_at is null");
      expect(q.params).toContain(COMPANY);
    },
  );
});

describe("buildMyTasksPagination", () => {
  it("bị cắt ⇒ has_next true, total_pages = ceil(total/per_page)", () => {
    const p = buildMyTasksPagination(115, 517, true);
    expect(p).toMatchObject({
      page: 1,
      per_page: 115,
      total: 517,
      has_next: true,
      has_prev: false,
    });
    expect(p.total_pages).toBe(5);
  });
  it("không cắt ⇒ has_next false; rỗng ⇒ per_page ≥ 1", () => {
    expect(buildMyTasksPagination(0, 0, false)).toMatchObject({
      per_page: 1,
      total_pages: 0,
      has_next: false,
    });
  });
});

describe("loadMyTasksForListTx", () => {
  const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
  function fakeTx(sequence: unknown[][]): { tx: TenantTx; execute: ReturnType<typeof vi.fn> } {
    const execute = vi.fn();
    for (const rows of sequence) execute.mockResolvedValueOnce({ rows });
    return { tx: { execute } as unknown as TenantTx, execute };
  }

  it("không includeClosed ⇒ đúng 1 truy vấn (mở), không cắt", async () => {
    const { tx, execute } = fakeTx([rowsOf(3)]);
    const r = await loadMyTasksForListTx(tx, COMPANY, USER, null, false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ truncated: false, total: 3 });
  });
  it("includeClosed dưới trần ⇒ không đếm thêm, không báo cắt", async () => {
    const { tx, execute } = fakeTx([rowsOf(2), rowsOf(3)]);
    const r = await loadMyTasksForListTx(tx, COMPANY, USER, null, true, 5);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ truncated: false, total: 5 });
    expect(r.items).toHaveLength(5);
  });
  it("chạm trần ⇒ cắt đúng trần, đếm thêm, báo cắt", async () => {
    const { tx, execute } = fakeTx([rowsOf(2), rowsOf(6), [{ n: 40 }]]);
    const r = await loadMyTasksForListTx(tx, COMPANY, USER, null, true, 5);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ truncated: true, total: 42 });
    expect(r.items).toHaveLength(7);
  });
});

describe("isGoalFilterVisibleTx", () => {
  const tx = {} as TenantTx;
  it("viewer che hết (khoá API / không view:goal) ⇒ false, KHÔNG truy vấn", async () => {
    const policy = { visibleGoalIdsTx: vi.fn() };
    const viewer = { userId: USER, companyId: COMPANY, scope: null } as unknown as GoalRefViewer;
    expect(await isGoalFilterVisibleTx(policy, tx, viewer, "g1")).toBe(false);
    expect(policy.visibleGoalIdsTx).not.toHaveBeenCalled();
  });
  it("ALLOW đứng cạnh: mục tiêu có trong tập đọc được ⇒ true; vắng ⇒ false", async () => {
    const viewer = {
      userId: USER,
      companyId: COMPANY,
      scope: "Company",
    } as unknown as GoalRefViewer;
    const yes = { visibleGoalIdsTx: vi.fn().mockResolvedValue(new Set(["g1"])) };
    const no = { visibleGoalIdsTx: vi.fn().mockResolvedValue(new Set()) };
    expect(await isGoalFilterVisibleTx(yes, tx, viewer, "g1")).toBe(true);
    expect(await isGoalFilterVisibleTx(no, tx, viewer, "g1")).toBe(false);
  });
});
