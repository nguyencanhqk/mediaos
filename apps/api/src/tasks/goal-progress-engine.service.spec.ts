import { describe, expect, it, vi } from "vitest";
import {
  GoalProgressEngineService,
  computeChildrenProgress,
  computeManualProgress,
  computeRatioProgress,
} from "./goal-progress-engine.service";

/**
 * S5-GOAL-BE-2 — unit spec CÔNG THỨC đo tiến độ (SPEC-10 §13.1/§13.2) + trần bubble + đóng băng sau
 * chốt kỳ. Colocate `src/**` (bẫy vitest-unit-specs-must-be-colocated: spec ở test/unit KHÔNG chạy).
 *
 * Ở đây KHÔNG có DB: các ca đi-tận-DB (RLS, append-only, gate quyền) nằm ở
 * `test/integration/goal-be2-*.int-spec.ts`. Spec này khoá phần dễ trôi nhất — luật "null ≠ 0%".
 */

const GOAL_ROW = {
  id: "g1",
  level: "department",
  projectId: null,
  parentGoalId: null,
  progressMode: "tasks",
  measureType: "percent",
  targetValue: null,
  currentValue: null,
  progressPercent: null,
  weight: "1",
  status: "Active",
  finalizedAt: null as string | Date | null,
};

function makeEngine(overrides: {
  rows?: Record<string, Record<string, unknown>>;
  taskCounts?: { done: number; total: number };
  children?: { id: string; progressPercent: string | null; weight: string }[];
  projectCounts?: Record<string, number>;
}) {
  const updates: { goalId: string; value: string | null }[] = [];
  const repo = {
    findProgressRowTx: vi.fn((_tx, _c, id: string) =>
      Promise.resolve(overrides.rows?.[id] ?? undefined),
    ),
    countTasksForGoalTx: vi.fn(() =>
      Promise.resolve(overrides.taskCounts ?? { done: 0, total: 0 }),
    ),
    listChildrenForRollupTx: vi.fn(() => Promise.resolve(overrides.children ?? [])),
    updateProgressTx: vi.fn((_tx, _c, goalId: string, value: string | null) => {
      updates.push({ goalId, value });
      return Promise.resolve(true);
    }),
    listProjectModeGoalIdsTx: vi.fn(() => Promise.resolve([])),
    listReconcileTargetsTx: vi.fn(() => Promise.resolve([])),
  };
  const projects = {
    countsByStatusLeafTx: vi.fn(() => Promise.resolve(overrides.projectCounts ?? {})),
  };
  const engine = new GoalProgressEngineService(repo as never, projects as never);
  return { engine, repo, projects, updates };
}

describe("computeManualProgress (SPEC-10 §13.1 mode='manual')", () => {
  it("chưa check-in lần nào ⇒ null, KHÔNG phải 0%", () => {
    expect(computeManualProgress("percent", null, null)).toBeNull();
    expect(computeManualProgress("number", null, 100)).toBeNull();
    expect(computeManualProgress("boolean", null, null)).toBeNull();
  });

  it("percent: giá trị check-in CHÍNH LÀ phần trăm, kẹp về [0,100]", () => {
    expect(computeManualProgress("percent", 42.5, null)).toBe(42.5);
    expect(computeManualProgress("percent", -5, null)).toBe(0);
    expect(computeManualProgress("percent", 180, null)).toBe(100);
  });

  it("number: clamp(current/target×100); target thiếu hoặc ≤ 0 ⇒ null (KHÔNG 0%)", () => {
    expect(computeManualProgress("number", 30, 120)).toBe(25);
    expect(computeManualProgress("number", 500, 100)).toBe(100);
    expect(computeManualProgress("number", 10, null)).toBeNull();
    expect(computeManualProgress("number", 10, 0)).toBeNull();
  });

  it("boolean: 0 ⇒ 0, khác 0 ⇒ 100", () => {
    expect(computeManualProgress("boolean", 0, null)).toBe(0);
    expect(computeManualProgress("boolean", 1, null)).toBe(100);
  });
});

describe("computeRatioProgress (mode='tasks'/'project')", () => {
  it("0 phần tử trong mẫu ⇒ null (chưa gắn việc ≠ 0% tiến độ)", () => {
    expect(computeRatioProgress(0, 0)).toBeNull();
  });

  it("1 Done / 2 đếm được ⇒ 50", () => {
    expect(computeRatioProgress(1, 2)).toBe(50);
  });

  it("làm tròn về đúng scale numeric(5,2)", () => {
    expect(computeRatioProgress(1, 3)).toBe(33.33);
  });
});

describe("computeChildrenProgress (mode='children')", () => {
  it("bình quân CÓ TRỌNG SỐ", () => {
    expect(
      computeChildrenProgress([
        { progress: 100, weight: 3 },
        { progress: 0, weight: 1 },
      ]),
    ).toBe(75);
  });

  it("con chưa đo được (null) loại khỏi CẢ tử VÀ mẫu", () => {
    expect(
      computeChildrenProgress([
        { progress: 80, weight: 1 },
        { progress: null, weight: 9 },
      ]),
    ).toBe(80);
  });

  it("không con nào đo được ⇒ null (không phải 0%)", () => {
    expect(computeChildrenProgress([{ progress: null, weight: 1 }])).toBeNull();
    expect(computeChildrenProgress([])).toBeNull();
  });
});

describe("recomputeGoalTx — đóng băng + bubble", () => {
  it("goal đã chốt kỳ ⇒ KHÔNG đọc nguồn số, KHÔNG ghi (SPEC-10 §13.4)", async () => {
    const { engine, repo } = makeEngine({
      rows: { g1: { ...GOAL_ROW, finalizedAt: "2026-07-01T00:00:00.000Z" } },
      taskCounts: { done: 5, total: 5 },
    });
    await engine.recomputeGoalTx({} as never, "co", "g1");
    expect(repo.countTasksForGoalTx).not.toHaveBeenCalled();
    expect(repo.updateProgressTx).not.toHaveBeenCalled();
  });

  it("mode='tasks' 1 Done/2 ⇒ ghi 50.00 và bubble lên cha mode='children'", async () => {
    const { engine, updates } = makeEngine({
      rows: {
        g1: { ...GOAL_ROW, parentGoalId: "p1" },
        p1: { ...GOAL_ROW, id: "p1", progressMode: "children", parentGoalId: null },
      },
      taskCounts: { done: 1, total: 2 },
      children: [{ id: "g1", progressPercent: "50.00", weight: "1" }],
    });
    await engine.recomputeGoalTx({} as never, "co", "g1");
    expect(updates).toEqual([
      { goalId: "g1", value: "50.00" },
      { goalId: "p1", value: "50.00" },
    ]);
  });

  it("cha KHÔNG phải mode='children' ⇒ dừng bubble (cha đo bằng nguồn khác)", async () => {
    const { engine, updates } = makeEngine({
      rows: {
        g1: { ...GOAL_ROW, parentGoalId: "p1" },
        p1: { ...GOAL_ROW, id: "p1", progressMode: "manual", parentGoalId: null },
      },
      taskCounts: { done: 1, total: 1 },
    });
    await engine.recomputeGoalTx({} as never, "co", "g1");
    expect(updates).toEqual([{ goalId: "g1", value: "100.00" }]);
  });

  it("dây chuyền cha vô hạn (dữ liệu lệch) ⇒ dừng ở trần 3 bậc, KHÔNG đệ quy vô tận", async () => {
    // Mỗi nút là cha của chính nó theo mắt xích -> nếu không có trần thì treo.
    const rows: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 10; i += 1) {
      rows[`n${i}`] = {
        ...GOAL_ROW,
        id: `n${i}`,
        progressMode: i === 0 ? "tasks" : "children",
        parentGoalId: `n${i + 1}`,
      };
    }
    const { engine, updates } = makeEngine({
      rows,
      taskCounts: { done: 1, total: 1 },
      children: [{ id: "x", progressPercent: "100.00", weight: "1" }],
    });
    await engine.recomputeGoalTx({} as never, "co", "n0");
    // n0 + tối đa 3 bậc cha.
    expect(updates.map((u) => u.goalId)).toEqual(["n0", "n1", "n2", "n3"]);
  });

  it("giá trị KHÔNG đổi ⇒ không UPDATE (mỗi lần tick task không bump hàng goal)", async () => {
    const { engine, repo } = makeEngine({
      rows: { g1: { ...GOAL_ROW, progressPercent: "50.00" } },
      taskCounts: { done: 1, total: 2 },
    });
    await engine.recomputeGoalTx({} as never, "co", "g1");
    expect(repo.updateProgressTx).not.toHaveBeenCalled();
  });

  it("mode='project' đọc countsByStatusLeafTx, loại Cancelled khỏi MẪU SỐ", async () => {
    const { engine, updates, projects } = makeEngine({
      rows: { g1: { ...GOAL_ROW, id: "g1", progressMode: "project", projectId: "pr1" } },
      projectCounts: { Todo: 1, "In Progress": 0, "In Review": 0, Done: 1, Cancelled: 8 },
    });
    await engine.recomputeGoalTx({} as never, "co", "g1");
    expect(projects.countsByStatusLeafTx).toHaveBeenCalledOnce();
    // 1 Done / (1 Todo + 1 Done) = 50 — 8 việc huỷ KHÔNG kéo tiến độ xuống 10%.
    expect(updates).toEqual([{ goalId: "g1", value: "50.00" }]);
  });

  it("mode='project' mà dự án 0 việc ⇒ null (chưa đo), KHÔNG 0%", async () => {
    const { engine, updates } = makeEngine({
      rows: {
        g1: { ...GOAL_ROW, progressMode: "project", projectId: "pr1", progressPercent: "40.00" },
      },
      projectCounts: { Todo: 0, Done: 0, Cancelled: 0 },
    });
    await engine.recomputeGoalTx({} as never, "co", "g1");
    expect(updates).toEqual([{ goalId: "g1", value: null }]);
  });
});
