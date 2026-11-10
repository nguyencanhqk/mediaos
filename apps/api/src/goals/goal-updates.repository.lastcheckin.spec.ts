import { describe, expect, it } from "vitest";
import type { TenantTx } from "../db/db.service";
import { GoalUpdatesRepository } from "./goal-updates.repository";

/** Fake tx đếm số lần `select` — chứng minh MỘT truy vấn gộp cho cả lô mục tiêu. */
function fakeTx(rows: { goalId: string; lastAt: Date | string }[]) {
  const calls = { select: 0, groupBy: 0 };
  const chain = {
    from: () => chain,
    where: () => chain,
    groupBy: () => {
      calls.groupBy += 1;
      return Promise.resolve(rows);
    },
  };
  const tx = {
    select: () => {
      calls.select += 1;
      return chain;
    },
  } as unknown as TenantTx;
  return { tx, calls };
}

describe("GoalUpdatesRepository.lastCheckinByGoalIdsTx", () => {
  it("N mục tiêu ⇒ đúng MỘT truy vấn GROUP BY, không truy vấn từng mục tiêu", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const { tx, calls } = fakeTx([
      { goalId: "a", lastAt: new Date("2026-10-05T01:00:00Z") },
      { goalId: "c", lastAt: "2026-10-06T01:00:00Z" },
    ]);
    const map = await new GoalUpdatesRepository().lastCheckinByGoalIdsTx(tx, "co", ids);
    expect(calls.select).toBe(1);
    expect(calls.groupBy).toBe(1);
    expect(map.get("a")).toBe("2026-10-05T01:00:00.000Z");
    expect(map.get("c")).toBe("2026-10-06T01:00:00.000Z");
    expect(map.has("b")).toBe(false);
  });

  it("danh sách rỗng ⇒ 0 truy vấn", async () => {
    const { tx, calls } = fakeTx([]);
    const map = await new GoalUpdatesRepository().lastCheckinByGoalIdsTx(tx, "co", []);
    expect(calls.select).toBe(0);
    expect(map.size).toBe(0);
  });
});
