/**
 * `ColumnPicker` — ⚙ chọn cột ở toolbar (UI-07 §10.4 mục 10, S15-UI-SHELL-1).
 *
 * Hai luật đáng neo nhất:
 * 1. **Cột `locked` hiện NHƯNG không bấm được** — ẩn hẳn thì người dùng đi tìm cột «Kỳ» mãi không thấy.
 * 2. **Danh sách chỉ gồm cột caller truyền vào.** Picker KHÔNG tự đọc cột từ đâu khác: cột đã bị
 *    server mask phải vắng khỏi cả picker, và điều đó chỉ đúng nếu component không có nguồn thứ hai.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColumnPicker } from "./column-picker";
import type { ColumnOption } from "../../hooks/use-column-visibility";

const OPTIONS: ColumnOption[] = [
  { id: "month", label: "Kỳ", locked: true },
  { id: "status", label: "Trạng thái" },
  { id: "note", label: "Ghi chú" },
];

function open() {
  fireEvent.click(screen.getByTestId("column-picker-trigger"));
}

describe("ColumnPicker", () => {
  it("đóng mặc định; bấm ⚙ mở danh sách cột", () => {
    render(<ColumnPicker options={OPTIONS} hiddenIds={[]} onToggle={vi.fn()} />);
    expect(screen.queryByText("Trạng thái")).not.toBeInTheDocument();

    open();
    expect(screen.getByText("Kỳ")).toBeInTheDocument();
    expect(screen.getByText("Trạng thái")).toBeInTheDocument();
    expect(screen.getByText("Ghi chú")).toBeInTheDocument();
  });

  it("cột đang ẩn hiện ô KHÔNG tick; bấm phát ra onToggle đúng id", () => {
    const onToggle = vi.fn();
    render(<ColumnPicker options={OPTIONS} hiddenIds={["note"]} onToggle={onToggle} />);
    open();

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[2].checked).toBe(false);

    fireEvent.click(boxes[1]);
    expect(onToggle).toHaveBeenCalledWith("status");
  });

  it("cột locked: HIỆN trong danh sách, tick sẵn, disabled ⇒ không phát onToggle", () => {
    const onToggle = vi.fn();
    // hiddenIds cố tình chứa cột locked — picker vẫn phải vẽ nó là ĐANG HIỆN.
    render(<ColumnPicker options={OPTIONS} hiddenIds={["month"]} onToggle={onToggle} />);
    open();

    const locked = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(screen.getByText("Kỳ")).toBeInTheDocument();
    expect(locked.checked).toBe(true);
    expect(locked.disabled).toBe(true);

    fireEvent.click(locked);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("nút «Mặc định» ẩn khi đang ở bộ mặc định, hiện khi đã đổi", () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <ColumnPicker
        options={OPTIONS}
        hiddenIds={[]}
        onToggle={vi.fn()}
        onReset={onReset}
        isDefault
      />,
    );
    open();
    expect(screen.queryByTestId("column-picker-reset")).not.toBeInTheDocument();

    rerender(
      <ColumnPicker
        options={OPTIONS}
        hiddenIds={["note"]}
        onToggle={vi.fn()}
        onReset={onReset}
        isDefault={false}
      />,
    );
    fireEvent.click(screen.getByTestId("column-picker-reset"));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("không truyền onReset ⇒ không có nút «Mặc định» dù đã đổi bộ cột", () => {
    render(
      <ColumnPicker options={OPTIONS} hiddenIds={["note"]} onToggle={vi.fn()} isDefault={false} />,
    );
    open();
    expect(screen.queryByTestId("column-picker-reset")).not.toBeInTheDocument();
  });

  it("bàn phím: Escape đóng panel (điều khiển được không cần chuột)", () => {
    render(<ColumnPicker options={OPTIONS} hiddenIds={[]} onToggle={vi.fn()} />);
    open();
    expect(screen.getByText("Trạng thái")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Trạng thái")).not.toBeInTheDocument();
  });

  it("ô tick là <input type=checkbox> THẬT trong <label> ⇒ Tab tới + Space bật/tắt được", () => {
    render(<ColumnPicker options={OPTIONS} hiddenIds={[]} onToggle={vi.fn()} />);
    open();
    for (const box of screen.getAllByRole("checkbox")) {
      expect(box.tagName).toBe("INPUT");
      // Không có tabindex=-1 ⇒ nằm trong luồng Tab tự nhiên.
      expect(box).not.toHaveAttribute("tabindex", "-1");
    }
  });

  it("0 cột ⇒ KHÔNG render nút ⚙ (nút mở ra panel rỗng là cổng dẫn vào phòng trống)", () => {
    render(<ColumnPicker options={[]} hiddenIds={[]} onToggle={vi.fn()} />);
    expect(screen.queryByTestId("column-picker-trigger")).not.toBeInTheDocument();
  });
});
