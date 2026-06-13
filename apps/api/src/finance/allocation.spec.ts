import { describe, expect, it } from "vitest";
import { allocateCostSchema } from "@mediaos/contracts";
import { computeAllocationLines, percentOfTotal, staticWeight } from "./allocation";
import { MoneyError, sumCents } from "./money";

const T = (id: string, weight: number) => ({
  targetType: "channel" as const,
  targetId: `00000000-0000-0000-0000-0000000000${id}`,
  weight,
});

describe("allocation — computeAllocationLines (SUM === total)", () => {
  it("equal_split 3 target, dư dồn cuối", () => {
    const lines = computeAllocationLines(10000n, [T("01", 1), T("02", 1), T("03", 1)]);
    expect(lines.map((l) => l.allocatedCents)).toEqual([3333n, 3333n, 3334n]);
    expect(sumCents(lines.map((l) => l.allocatedCents))).toBe(10000n);
  });

  it("by_video_count weighted [2,3,5]", () => {
    const lines = computeAllocationLines(10000n, [T("01", 2), T("02", 3), T("03", 5)]);
    expect(lines.map((l) => l.allocatedCents)).toEqual([2000n, 3000n, 5000n]);
    expect(lines.map((l) => l.percent)).toEqual([20, 30, 50]);
  });

  it("manual_percent 33.33/33.33/33.34 → SUM đúng", () => {
    const lines = computeAllocationLines(10000n, [T("01", 33.33), T("02", 33.33), T("03", 33.34)]);
    expect(sumCents(lines.map((l) => l.allocatedCents))).toBe(10000n);
  });

  it("by_revenue_ratio (weight = revenue cents)", () => {
    const lines = computeAllocationLines(90000n, [T("01", 100000), T("02", 200000)]);
    expect(lines.map((l) => l.allocatedCents)).toEqual([30000n, 60000n]);
    expect(sumCents(lines.map((l) => l.allocatedCents))).toBe(90000n);
  });

  it("target trọng số 0 nhận 0 cent (không nhận dư)", () => {
    const lines = computeAllocationLines(10001n, [T("01", 1), T("02", 1), T("03", 0)]);
    expect(lines[2].allocatedCents).toBe(0n);
    expect(lines[2].percent).toBe(0);
    expect(sumCents(lines.map((l) => l.allocatedCents))).toBe(10001n);
  });

  it("ném khi tổng weight = 0", () => {
    expect(() => computeAllocationLines(10000n, [T("01", 0), T("02", 0)])).toThrow(MoneyError);
  });
});

describe("allocation — percentOfTotal", () => {
  it("4dp floor", () => {
    expect(percentOfTotal(3333n, 10000n)).toBe(33.33);
    expect(percentOfTotal(1n, 3n)).toBeCloseTo(33.3333, 4);
  });
  it("null khi total = 0", () => {
    expect(percentOfTotal(0n, 0n)).toBeNull();
  });
});

describe("allocation — staticWeight", () => {
  it("equal/manual/hours", () => {
    expect(staticWeight("equal_split", {})).toBe(1);
    expect(staticWeight("manual_percent", { percent: 40 })).toBe(40);
    expect(staticWeight("by_work_hours", { hours: 8 })).toBe(8);
  });
  it("ném cho method resolve-từ-DB", () => {
    expect(() => staticWeight("by_video_count", {})).toThrow();
  });
});

describe("allocation — contract allocateCostSchema (validate 6 method)", () => {
  const ch = (id: string) => `00000000-0000-0000-0000-0000000000${id}`;

  it("manual_percent: tổng percent != 100 → fail", () => {
    const r = allocateCostSchema.safeParse({
      method: "manual_percent",
      targets: [
        { targetType: "channel", targetId: ch("01"), percent: 40 },
        { targetType: "channel", targetId: ch("02"), percent: 40 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("manual_percent: tổng = 100 → ok", () => {
    const r = allocateCostSchema.safeParse({
      method: "manual_percent",
      targets: [
        { targetType: "channel", targetId: ch("01"), percent: 60 },
        { targetType: "channel", targetId: ch("02"), percent: 40 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("manual_percent thiếu percent → fail", () => {
    const r = allocateCostSchema.safeParse({
      method: "manual_percent",
      targets: [{ targetType: "channel", targetId: ch("01") }],
    });
    expect(r.success).toBe(false);
  });

  it("by_work_hours thiếu hours → fail", () => {
    const r = allocateCostSchema.safeParse({
      method: "by_work_hours",
      targets: [{ targetType: "channel", targetId: ch("01") }],
    });
    expect(r.success).toBe(false);
  });

  it("target trùng nhau → fail", () => {
    const r = allocateCostSchema.safeParse({
      method: "equal_split",
      targets: [
        { targetType: "channel", targetId: ch("01") },
        { targetType: "channel", targetId: ch("01") },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("equal_split / by_video_count / by_task_count / by_revenue_ratio: hợp lệ không cần percent/hours", () => {
    for (const method of ["equal_split", "by_video_count", "by_task_count", "by_revenue_ratio"] as const) {
      const r = allocateCostSchema.safeParse({
        method,
        targets: [
          { targetType: "channel", targetId: ch("01") },
          { targetType: "project", targetId: ch("02") },
        ],
      });
      expect(r.success, method).toBe(true);
    }
  });
});
