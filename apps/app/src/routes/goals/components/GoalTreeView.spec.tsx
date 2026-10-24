/**
 * S20-GOAL-QUICKCHECKIN-1 — GoalTreeView (US-GOAL-QL-92 cây thu gọn/mở + US-GOAL-NV-91 check-in trên nút):
 *  (t1) thu gọn một nhánh ⇒ con ẩn, aria-expanded=false; dựng lại (tải lại) vẫn thu gọn.
 *  (t2) «Thu gọn tất cả» ⇒ chỉ còn nút gốc; «Mở tất cả» ⇒ bung lại.
 *  (t3) bàn phím theo mẫu WAI-ARIA tree: ← thu gọn / về cha, → mở / xuống con đầu; focus không mất.
 *  (t4) localStorage bị chặn ⇒ bung hết như cũ, không lỗi, vẫn thu gọn được trong phiên.
 *  (t5) nhánh chứa id cần lộ (kết quả lọc) tự mở dù đã nhớ thu gọn.
 *  (t6) biểu tượng Check-in: chỉ khi có quyền; bấm ⇒ onCheckin, KHÔNG onSelect; khoá khi Nháp.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import type { GoalTreeNodeDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { GoalTreeView } from "./GoalTreeView";
import { GOAL_TREE_COLLAPSED_KEY } from "../goal-tree-state";

function node(id: string, name: string, children: GoalTreeNodeDto[] = []): GoalTreeNodeDto {
  return {
    id,
    companyId: "co-1",
    goalCode: `GOAL-${id}`,
    name,
    description: null,
    level: "department",
    departmentId: null,
    projectId: null,
    employeeId: null,
    parentGoalId: null,
    ownerEmployeeId: "emp-1",
    periodType: "quarter",
    periodStart: "2026-10-01",
    periodEnd: "2026-12-31",
    measureType: "percent",
    targetValue: 100,
    currentValue: 10,
    unit: "%",
    progressMode: "manual",
    progressPercent: 10,
    weight: 1,
    status: "Active",
    finalizedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    children,
  };
}

const TREE: GoalTreeNodeDto[] = [
  node("a", "Phòng Kinh doanh", [node("a1", "Dự án Alpha", [node("a1x", "Chị Lan")])]),
  node("b", "Phòng Kỹ thuật", [node("b1", "Dự án Beta")]),
];

interface Props {
  nodes?: GoalTreeNodeDto[];
  canCheckin?: boolean;
  revealIds?: ReadonlySet<string>;
}

function renderTree({ nodes = TREE, canCheckin = false, revealIds }: Props = {}) {
  const onSelect = vi.fn();
  const onCheckin = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <GoalTreeView
        nodes={nodes}
        onSelect={onSelect}
        canCheckin={canCheckin}
        onCheckin={onCheckin}
        revealIds={revealIds}
      />
    </I18nextProvider>,
  );
  return { onSelect, onCheckin, unmount: view.unmount };
}

const itemOf = (name: string) =>
  screen.getByRole("treeitem", { name: new RegExp(`^${name}`) }) as HTMLElement;
const rowOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GoalTreeView — thu gọn / mở rộng (US-GOAL-QL-92)", () => {
  it("(t0) mặc định bung hết, aria-expanded=true trên nút có con, KHÔNG có trên lá", () => {
    renderTree();
    expect(screen.getByText("Chị Lan")).toBeInTheDocument();
    expect(itemOf("Phòng Kinh doanh")).toHaveAttribute("aria-expanded", "true");
    expect(itemOf("Chị Lan")).not.toHaveAttribute("aria-expanded");
  });

  it("(t1) thu gọn một nhánh ⇒ con ẩn, aria-expanded=false; tải lại vẫn thu gọn", () => {
    const first = renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn Dự án Alpha" }));
    expect(screen.queryByText("Chị Lan")).not.toBeInTheDocument();
    expect(itemOf("Dự án Alpha")).toHaveAttribute("aria-expanded", "false");
    first.unmount();

    renderTree();
    expect(screen.queryByText("Chị Lan")).not.toBeInTheDocument();
    expect(itemOf("Dự án Alpha")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Dự án Beta")).toBeInTheDocument();
  });

  it("(t2) «Thu gọn tất cả» ⇒ chỉ còn nút gốc; «Mở tất cả» ⇒ bung lại", () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn tất cả" }));
    expect(screen.getAllByRole("treeitem").map((el) => el.getAttribute("aria-level"))).toEqual([
      "1",
      "1",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Mở tất cả" }));
    expect(screen.getByText("Chị Lan")).toBeInTheDocument();
    expect(screen.getByText("Dự án Beta")).toBeInTheDocument();
  });

  it("(t3) bàn phím: ← thu gọn, → mở rồi xuống con, ← ở con về cha; focus không mất", () => {
    renderTree();
    const root = rowOf("Phòng Kinh doanh");
    root.focus();
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(itemOf("Phòng Kinh doanh")).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(root);

    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(itemOf("Phòng Kinh doanh")).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(root);

    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(document.activeElement).toBe(rowOf("Dự án Alpha"));

    fireEvent.keyDown(rowOf("Dự án Alpha"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(rowOf("Chị Lan"));

    fireEvent.keyDown(rowOf("Chị Lan"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(rowOf("Dự án Alpha"));
  });

  it("(t4) localStorage bị chặn ⇒ bung hết, không lỗi, vẫn thu gọn được trong phiên", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    renderTree();
    expect(screen.getByText("Chị Lan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn Phòng Kinh doanh" }));
    expect(screen.queryByText("Dự án Alpha")).not.toBeInTheDocument();
  });

  it("(t4b) giá trị nhớ hỏng ⇒ coi như chưa nhớ, bung hết", () => {
    window.localStorage.setItem(GOAL_TREE_COLLAPSED_KEY, "{không phải json");
    renderTree();
    expect(screen.getByText("Chị Lan")).toBeInTheDocument();
  });

  it("(t5) nhánh chứa kết quả lọc tự mở dù đã nhớ thu gọn", () => {
    window.localStorage.setItem(GOAL_TREE_COLLAPSED_KEY, JSON.stringify(["a", "a1"]));
    renderTree({ revealIds: new Set(["a1x"]) });
    expect(screen.getByText("Chị Lan")).toBeInTheDocument();
    expect(itemOf("Phòng Kinh doanh")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("GoalTreeView — check-in trên nút (US-GOAL-NV-91)", () => {
  it("(t6a) không có quyền check-in ⇒ không có biểu tượng", () => {
    renderTree();
    expect(screen.queryByRole("button", { name: /^Check-in / })).not.toBeInTheDocument();
  });

  it("(t6b) Active: bấm biểu tượng ⇒ onCheckin(node), KHÔNG onSelect; với tới bằng bàn phím", () => {
    const { onCheckin, onSelect } = renderTree({ canCheckin: true });
    const icon = screen.getByRole("button", { name: "Check-in Dự án Beta" });
    expect(icon.tagName).toBe("BUTTON");
    expect(icon).not.toHaveAttribute("tabindex", "-1");
    fireEvent.click(icon);
    expect(onCheckin).toHaveBeenCalledWith(expect.objectContaining({ id: "b1" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("(t6c) Nháp ⇒ biểu tượng khoá + lý do, bấm không làm gì", () => {
    const { onCheckin, onSelect } = renderTree({
      canCheckin: true,
      nodes: [{ ...node("d", "Mục tiêu nháp"), status: "Draft" }],
    });
    const icon = screen.getByRole("button", { name: "Check-in Mục tiêu nháp" });
    expect(icon).toHaveAttribute("aria-disabled", "true");
    expect(icon.getAttribute("title")).toContain("Nháp");
    fireEvent.click(icon);
    expect(onCheckin).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
