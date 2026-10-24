/**
 * S20-GOAL-QUICKCHECKIN-1 — helper thuần của trạng thái cây (US-GOAL-QL-92): đọc/ghi nhớ an toàn,
 * cắt trần, tìm nhánh có con và nhánh tổ tiên của kết quả lọc.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalTreeNodeDto } from "@mediaos/contracts";
import {
  GOAL_TREE_COLLAPSED_KEY,
  GOAL_TREE_COLLAPSED_MAX,
  ancestorGoalIdsOf,
  collectParentGoalIds,
  readCollapsedGoalIds,
  writeCollapsedGoalIds,
} from "./goal-tree-state";

const leaf = (id: string, children: GoalTreeNodeDto[] = []) =>
  ({ id, children }) as unknown as GoalTreeNodeDto;

const TREE = [leaf("a", [leaf("a1", [leaf("a1x")]), leaf("a2")]), leaf("b")];

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("goal-tree-state — nhớ nhánh gập", () => {
  it("ghi rồi đọc lại đúng tập", () => {
    writeCollapsedGoalIds(new Set(["a", "a1"]));
    expect([...readCollapsedGoalIds()]).toEqual(["a", "a1"]);
  });

  it("giá trị rác (không phải mảng chuỗi) ⇒ tập rỗng, bỏ phần tử không phải chuỗi", () => {
    window.localStorage.setItem(GOAL_TREE_COLLAPSED_KEY, JSON.stringify({ a: 1 }));
    expect(readCollapsedGoalIds().size).toBe(0);
    window.localStorage.setItem(GOAL_TREE_COLLAPSED_KEY, JSON.stringify(["a", 3, "", null]));
    expect([...readCollapsedGoalIds()]).toEqual(["a"]);
  });

  it("cắt ở trần, giữ phần MỚI nhất", () => {
    const ids = Array.from({ length: GOAL_TREE_COLLAPSED_MAX + 5 }, (_, i) => `g-${i}`);
    writeCollapsedGoalIds(new Set(ids));
    const read = readCollapsedGoalIds();
    expect(read.size).toBe(GOAL_TREE_COLLAPSED_MAX);
    expect(read.has("g-0")).toBe(false);
    expect(read.has(`g-${GOAL_TREE_COLLAPSED_MAX + 4}`)).toBe(true);
  });

  it("localStorage ném lỗi ⇒ đọc trả rỗng, ghi không ném", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readCollapsedGoalIds().size).toBe(0);
    expect(() => writeCollapsedGoalIds(new Set(["a"]))).not.toThrow();
  });
});

describe("goal-tree-state — duyệt cây", () => {
  it("collectParentGoalIds chỉ lấy nút có con", () => {
    expect(collectParentGoalIds(TREE)).toEqual(["a", "a1"]);
  });

  it("ancestorGoalIdsOf trả mọi tổ tiên của id cần lộ, không gồm chính nó", () => {
    expect([...ancestorGoalIdsOf(TREE, new Set(["a1x"]))].sort()).toEqual(["a", "a1"]);
    expect([...ancestorGoalIdsOf(TREE, new Set(["a2"]))]).toEqual(["a"]);
    expect(ancestorGoalIdsOf(TREE, new Set()).size).toBe(0);
    expect(ancestorGoalIdsOf(TREE, new Set(["b"])).size).toBe(0);
  });
});
