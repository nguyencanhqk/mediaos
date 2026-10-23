/**
 * S20-TASK-BOARDMOVE-1 (US-TASK-NV-91) — menu ⋯ «Chuyển sang cột…» trên thẻ board, đo riêng phần
 * menu: bàn phím, focus, `aria-*`, và việc thao tác trong menu KHÔNG lọt lên thẻ chứa nó (thẻ bấm/Enter
 * = mở chi tiết). Luồng đổi cột thật (lạc quan · rollback · quyền) đo ở `TaskKanbanPage.spec.tsx`.
 *
 * jsdom KHÔNG tự sinh `click` khi nhấn Enter/Space trên `<button>` (trình duyệt thì có) — các ca bàn
 * phím vì vậy bắn `keyDown` để đo «không lọt lên thẻ», rồi bắn `click` thay cho bước kích hoạt gốc.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import {
  KanbanCardMoveMenu,
  useKanbanCardFocusReturn,
  type MoveTarget,
} from "./KanbanCardMoveMenu";

const TARGETS: MoveTarget[] = [
  { id: "todo", label: "Cần làm" },
  { id: "doing", label: "Đang làm" },
  { id: "review", label: "Chờ review" },
  { id: "done", label: "Hoàn thành" },
];

function renderInCard({
  currentId = "todo",
  targets = TARGETS,
}: { currentId?: string; targets?: MoveTarget[] } = {}) {
  const onMove = vi.fn();
  const onCardClick = vi.fn();
  const onCardKeyDown = vi.fn();
  render(
    // Thẻ giả: cùng hai đường lọt có thật trên board — click và keydown của thẻ (mở chi tiết).
    <div
      data-kanban-card="task-1"
      role="button"
      tabIndex={0}
      onClick={onCardClick}
      onKeyDown={onCardKeyDown}
    >
      <KanbanCardMoveMenu
        task={{ id: "task-1", title: "Soạn hợp đồng" }}
        currentId={currentId}
        move={{ targets, onMove }}
      />
    </div>,
  );
  return { onMove, onCardClick, onCardKeyDown };
}

const trigger = () => screen.getByTestId("kanban-card-move-trigger-task-1");

describe("KanbanCardMoveMenu", () => {
  it("nút ⋯ có aria-label nêu tên việc, aria-haspopup=menu, aria-expanded theo trạng thái mở", () => {
    renderInCard();
    const button = screen.getByRole("button", {
      name: "Chuyển việc «Soạn hợp đồng» sang cột khác",
    });
    expect(button).toBe(trigger());
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("Enter/Space trên nút KHÔNG lọt lên thẻ; mở menu ⇒ focus vào mục đầu, menu có nhãn «Chuyển sang cột…»", async () => {
    const { onCardClick, onCardKeyDown } = renderInCard();
    fireEvent.keyDown(trigger(), { key: "Enter" });
    fireEvent.keyDown(trigger(), { key: " " });
    expect(onCardKeyDown).not.toHaveBeenCalled();

    fireEvent.click(trigger());
    expect(onCardClick).not.toHaveBeenCalled();
    const menu = screen.getByRole("menu", { name: "Chuyển sang cột…" });
    const items = within(menu).getAllByRole("menuitem");
    // Cột hiện tại («Cần làm») không nằm trong danh sách.
    expect(items.map((item) => item.textContent)).toEqual(["Đang làm", "Chờ review", "Hoàn thành"]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
  });

  it("ArrowDown trên nút cũng mở menu (mẫu nút-menu WAI-ARIA)", async () => {
    renderInCard();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
  });

  it("phím mũi tên / Home / End đi vòng giữa các mục; Enter trên mục không lọt lên thẻ", async () => {
    const { onCardKeyDown } = renderInCard();
    fireEvent.click(trigger());
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "Enter" });
    expect(onCardKeyDown).not.toHaveBeenCalled();
  });

  it("chọn một cột ⇒ gọi onMove(taskId, id cột), đóng menu, không lọt click lên thẻ", () => {
    const { onMove, onCardClick } = renderInCard();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Chờ review" }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith("task-1", "review");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("Escape đóng menu và trả focus về nút ⋯; Tab cũng đóng và trả focus", async () => {
    renderInCard();
    fireEvent.click(trigger());
    const first = within(screen.getByRole("menu")).getAllByRole("menuitem")[0];
    await waitFor(() => expect(document.activeElement).toBe(first));
    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger());

    fireEvent.click(trigger());
    const again = within(screen.getByRole("menu")).getAllByRole("menuitem")[0];
    await waitFor(() => expect(document.activeElement).toBe(again));
    fireEvent.keyDown(again, { key: "Tab" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger());
  });

  it("không còn cột nào khác ⇒ báo rõ, không có mục nào để chọn", () => {
    renderInCard({ targets: [{ id: "todo", label: "Cần làm" }] });
    fireEvent.click(trigger());
    expect(screen.getByText("Không còn cột nào khác để chuyển.")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});

/**
 * Thẻ đổi cột ⇒ React vẽ thẻ MỚI ở cột đích (cha khác) ⇒ focus rơi về `body`. Hook trả focus về thẻ
 * mỗi lần nó rơi như vậy (lạc quan, rồi rollback) — nhưng thôi ngay khi người dùng tự đi chỗ khác.
 */
describe("useKanbanCardFocusReturn", () => {
  function Board({ column }: { column: "a" | "b" }) {
    const requestFocus = useKanbanCardFocusReturn();
    const card = (
      <div data-kanban-card="task-1" tabIndex={0} data-testid="card">
        Thẻ
      </div>
    );
    return (
      <>
        <button type="button" onClick={() => requestFocus("task-1")}>
          yêu cầu
        </button>
        <button type="button">nơi khác</button>
        <section key="a">{column === "a" && card}</section>
        <section key="b">{column === "b" && card}</section>
      </>
    );
  }

  it("thẻ remount sang cột khác ⇒ focus về thẻ mới; người dùng focus nơi khác ⇒ thôi giành focus", async () => {
    const { rerender } = render(<Board column="a" />);
    fireEvent.click(screen.getByRole("button", { name: "yêu cầu" }));
    (document.activeElement as HTMLElement | null)?.blur();

    rerender(<Board column="b" />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("card")));

    // Người dùng Tab sang chỗ khác ⇒ yêu cầu hết hiệu lực: thẻ remount tiếp cũng KHÔNG giật focus.
    screen.getByRole("button", { name: "nơi khác" }).focus();
    rerender(<Board column="a" />);
    (document.activeElement as HTMLElement | null)?.blur();
    rerender(<Board column="b" />);
    expect(document.activeElement).not.toBe(screen.getByTestId("card"));
  });
});
