import { describe, expect, it } from "vitest";
import type { AllocationTargetInput } from "@mediaos/contracts";
// 🔴 RED: chưa tồn tại — GREEN tạo cost-allocation.service.ts với resolveStaticWeights (thuần, KHÔNG DB)
//    cho 3 method tĩnh (equal_split/manual_percent/by_work_hours). Import này khiến suite ĐỎ
//    ĐÚNG LÝ DO: "chưa có resolveStaticWeights". KHÔNG implement GREEN trong lượt này.
import {
  DB_RESOLVED_METHODS,
  isDbResolvedMethod,
  resolveStaticWeights,
} from "./cost-allocation.service";
import { computeAllocationLines } from "./allocation";
import { sumCents } from "./money";

/**
 * G13-2 (FIN-003) — UNIT (KHÔNG DB): resolveStaticWeights cho 3 method tĩnh + phân loại method
 * resolve-từ-DB. 3 method DB (by_video_count/by_task_count/by_revenue_ratio) resolve qua repository
 * (COUNT/SUM theo target trong kỳ) — test ở finance-cost-allocation-deny.int-spec.ts (Postgres thật).
 *
 * Khẳng định CỐT LÕI: dù method nào, computeAllocationLines giữ SUM(allocatedCents) === totalCents
 * (BẤT BIẾN cents-exact — money.ts dồn dư target cuối).
 */

const ch = (id: string): AllocationTargetInput["targetId"] =>
  `00000000-0000-0000-0000-0000000000${id}`;

describe("resolveStaticWeights — 3 method tĩnh (không DB)", () => {
  it("equal_split → weight 1 cho mỗi target", () => {
    const targets: AllocationTargetInput[] = [
      { targetType: "channel", targetId: ch("01") },
      { targetType: "project", targetId: ch("02") },
      { targetType: "team", targetId: ch("03") },
    ];
    const weights = resolveStaticWeights("equal_split", targets);
    expect(weights).toEqual([1, 1, 1]);
  });

  it("manual_percent → weight = percent người nhập (tổng 100)", () => {
    const targets: AllocationTargetInput[] = [
      { targetType: "channel", targetId: ch("01"), percent: 60 },
      { targetType: "channel", targetId: ch("02"), percent: 40 },
    ];
    expect(resolveStaticWeights("manual_percent", targets)).toEqual([60, 40]);
  });

  it("by_work_hours → weight = giờ nhập tay (G11 attendance chưa merge)", () => {
    const targets: AllocationTargetInput[] = [
      { targetType: "team", targetId: ch("01"), hours: 8 },
      { targetType: "team", targetId: ch("02"), hours: 16 },
    ];
    expect(resolveStaticWeights("by_work_hours", targets)).toEqual([8, 16]);
  });

  it("method resolve-từ-DB ném (caller phải resolve qua repository)", () => {
    const targets: AllocationTargetInput[] = [{ targetType: "channel", targetId: ch("01") }];
    for (const method of DB_RESOLVED_METHODS) {
      expect(() => resolveStaticWeights(method, targets)).toThrow();
    }
  });
});

describe("isDbResolvedMethod — phân loại method", () => {
  it("by_video_count/by_task_count/by_revenue_ratio = DB-resolved", () => {
    expect(isDbResolvedMethod("by_video_count")).toBe(true);
    expect(isDbResolvedMethod("by_task_count")).toBe(true);
    expect(isDbResolvedMethod("by_revenue_ratio")).toBe(true);
  });
  it("equal_split/manual_percent/by_work_hours = tĩnh", () => {
    expect(isDbResolvedMethod("equal_split")).toBe(false);
    expect(isDbResolvedMethod("manual_percent")).toBe(false);
    expect(isDbResolvedMethod("by_work_hours")).toBe(false);
  });
});

describe("cents-exact — SUM === total cho weights của 5 kiểu", () => {
  const cases: Array<{ name: string; weights: number[]; total: bigint }> = [
    { name: "equal_split 3 target", weights: [1, 1, 1], total: 10000n },
    { name: "manual_percent 33.33/33.33/33.34", weights: [33.33, 33.33, 33.34], total: 10000n },
    { name: "by_video_count [2,3,5]", weights: [2, 3, 5], total: 10000n },
    { name: "by_task_count [7,0,3]", weights: [7, 0, 3], total: 99999n },
    { name: "by_revenue_ratio cents [100000,200000]", weights: [100000, 200000], total: 90000n },
  ];

  for (const c of cases) {
    it(`${c.name} → SUM(allocatedCents) === total`, () => {
      const targets = c.weights.map((w, i) => ({
        targetType: "channel" as const,
        targetId: ch(String(10 + i).padStart(2, "0")),
        weight: w,
      }));
      const lines = computeAllocationLines(c.total, targets);
      expect(sumCents(lines.map((l) => l.allocatedCents))).toBe(c.total);
    });
  }
});
