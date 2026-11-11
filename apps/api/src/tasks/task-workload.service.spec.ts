/**
 * S20-TASK-WORKLOAD-1 — service «Đội của tôi»: dựng phản hồi, thứ tự gọi tz→withTenant (D5), DTO đóng (D7).
 */
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { taskWorkloadRowSchema, TASK_WORKLOAD_MAX_ROWS } from "@mediaos/contracts";

const calls: string[] = [];
vi.mock("../dashboard/dashboard-company-tz.util", () => ({
  resolveCompanyTz: vi.fn(async () => {
    calls.push("tz");
    return "Asia/Ho_Chi_Minh";
  }),
}));

import { TaskWorkloadService } from "./task-workload.service";

const USER = { id: "u-1", companyId: "c-1", viaApiKey: false };
const counts = (o: Partial<Record<string, number | null>> = {}) => ({
  activeCount: 1,
  overdueCount: 0,
  dueSoon7dCount: 0,
  inReviewCount: 0,
  maxOverdueDays: null as number | null,
  ...o,
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function build(opts: {
  scope?: "Own" | "Team" | "Company";
  agg: Array<{ employeeId: string | null } & ReturnType<typeof counts>>;
  names?: Map<string, string | null>;
}) {
  calls.length = 0;
  const withTenant = vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => {
    calls.push("withTenant");
    return fn({});
  });
  const core = {
    resolveReadScope: vi.fn(async () => ({
      scope: opts.scope ?? "Team",
      scopeCond: sql`true`,
      exists: sql`true`,
    })),
  };
  const repo = {
    aggregateTx: vi.fn(async () => opts.agg),
    assigneeNamesTx: vi.fn(async () => opts.names ?? new Map()),
  };
  const svc = new TaskWorkloadService(
    { withTenant } as never,
    core as never,
    repo as never,
    () => new Date("2026-11-11T03:00:00Z"),
  );
  return { svc, withTenant, core, repo };
}

describe("TaskWorkloadService", () => {
  beforeEach(() => calls.splice(0));

  it("gọi resolveCompanyTz XONG rồi mới mở withTenant, và withTenant đúng 1 lần (chống lồng transaction)", async () => {
    const { svc, withTenant } = build({ agg: [] });
    await svc.getWorkload(USER, {});
    expect(calls).toEqual(["tz", "withTenant"]);
    expect(withTenant).toHaveBeenCalledTimes(1);
  });

  it("tách nhóm NULL thành `unassigned`, còn lại là items", async () => {
    const { svc } = build({
      agg: [
        { employeeId: null, ...counts({ activeCount: 2 }) },
        { employeeId: id(1), ...counts() },
      ],
      names: new Map([[id(1), "An"]]),
    });
    const out = await svc.getWorkload(USER, {});
    expect(out.unassigned?.activeCount).toBe(2);
    expect(out.items.map((r) => r.employeeId)).toEqual([id(1)]);
    expect(out.items[0]?.displayName).toBe("An");
    expect(out.truncated).toBe(false);
  });

  it("Own ⇒ unassigned = null dù tầng dưới lỡ trả nhóm NULL (phòng thủ kép)", async () => {
    const { svc } = build({
      scope: "Own",
      agg: [
        { employeeId: null, ...counts() },
        { employeeId: id(1), ...counts() },
      ],
    });
    const out = await svc.getWorkload(USER, {});
    expect(out.unassigned).toBeNull();
    expect(out.items).toHaveLength(1);
  });

  it("101 người ⇒ cắt 100 + truncated=true; 100 người ⇒ không cắt", async () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ employeeId: id(i + 1), ...counts() }));
    const over = await build({ agg: mk(TASK_WORKLOAD_MAX_ROWS + 1) }).svc.getWorkload(USER, {});
    expect(over.items).toHaveLength(TASK_WORKLOAD_MAX_ROWS);
    expect(over.truncated).toBe(true);
    const exact = await build({ agg: mk(TASK_WORKLOAD_MAX_ROWS) }).svc.getWorkload(USER, {});
    expect(exact.items).toHaveLength(TASK_WORKLOAD_MAX_ROWS);
    expect(exact.truncated).toBe(false);
  });

  it("sắp: quá hạn giảm dần, rồi số ngày trễ, rồi đang làm; cùng bộ số ⇒ theo tên (null cuối)", async () => {
    const { svc } = build({
      agg: [
        { employeeId: id(1), ...counts({ overdueCount: 1, maxOverdueDays: 1 }) },
        { employeeId: id(2), ...counts({ overdueCount: 3, maxOverdueDays: 2 }) },
        { employeeId: id(3), ...counts() },
        { employeeId: id(4), ...counts() },
        { employeeId: id(5), ...counts() },
      ],
      names: new Map<string, string | null>([
        [id(1), "Một"],
        [id(2), "Hai"],
        [id(3), "Zed"],
        [id(4), null],
        [id(5), "Anh"],
      ]),
    });
    const out = await svc.getWorkload(USER, {});
    expect(out.items.map((r) => r.employeeId)).toEqual([id(2), id(1), id(5), id(3), id(4)]);
  });

  it("mỗi dòng đúng 7 khoá và qua schema strict (không email/avatar/userId)", async () => {
    const { svc } = build({
      agg: [{ employeeId: id(1), ...counts() }],
      names: new Map([[id(1), "An"]]),
    });
    const out = await svc.getWorkload(USER, {});
    expect(out.items).toHaveLength(1);
    for (const row of out.items) {
      expect(() => taskWorkloadRowSchema.strict().parse(row)).not.toThrow();
      expect(Object.keys(row).sort()).toEqual(
        [
          "activeCount",
          "displayName",
          "dueSoon7dCount",
          "employeeId",
          "inReviewCount",
          "maxOverdueDays",
          "overdueCount",
        ].sort(),
      );
    }
  });

  it("scopeExists truyền xuống repository đúng là `exists` của resolveReadScope (cùng phạm vi GET /tasks)", async () => {
    const { svc, repo, core } = build({ agg: [] });
    const sentinel = sql`select 1`;
    core.resolveReadScope.mockResolvedValueOnce({
      scope: "Team",
      scopeCond: sql`true`,
      exists: sentinel,
    });
    await svc.getWorkload(USER, {});
    const arg = (repo.aggregateTx.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(arg["scopeExists"]).toBe(sentinel);
  });

  it("truyền bộ lọc + đồng hồ cố định xuống repository (cửa sổ tính một lần)", async () => {
    const { svc, repo } = build({ agg: [] });
    await svc.getWorkload(USER, { projectId: id(9), departmentId: id(8) });
    const arg = (repo.aggregateTx.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(arg["projectId"]).toBe(id(9));
    expect(arg["departmentId"]).toBe(id(8));
    expect(arg["tz"]).toBe("Asia/Ho_Chi_Minh");
    expect((arg["windowEnd"] as Date).toISOString()).toBe("2026-11-18T17:00:00.000Z");
  });
});
