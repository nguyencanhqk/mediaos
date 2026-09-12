/**
 * `DataToolbar` — thanh công cụ chuẩn màn danh sách (UI-07 §10.4, S15-UI-SHELL-1).
 * Component thuần bố cục: không state, không debounce (mỗi màn có nhịp gọi API riêng).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataToolbar } from "./data-toolbar";

describe("DataToolbar", () => {
  it("KHÔNG render ô tìm kiếm khi không truyền onSearchChange", () => {
    render(
      <DataToolbar>
        <span>bộ lọc</span>
      </DataToolbar>,
    );
    expect(screen.queryByTestId("data-toolbar-search")).not.toBeInTheDocument();
    expect(screen.getByText("bộ lọc")).toBeInTheDocument();
  });

  it("gõ vào ô tìm kiếm phát ra giá trị THÔ (không debounce, không trim)", () => {
    const onSearchChange = vi.fn();
    render(<DataToolbar search="" onSearchChange={onSearchChange} />);
    fireEvent.change(screen.getByTestId("data-toolbar-search"), { target: { value: " an " } });
    expect(onSearchChange).toHaveBeenCalledWith(" an ");
  });

  it("ô tìm kiếm là controlled — hiện đúng prop search", () => {
    render(<DataToolbar search="kỳ 09" onSearchChange={vi.fn()} />);
    expect((screen.getByTestId("data-toolbar-search") as HTMLInputElement).value).toBe("kỳ 09");
  });

  it("có aria-label cho trình đọc màn hình (placeholder KHÔNG thay được nhãn)", () => {
    render(<DataToolbar search="" onSearchChange={vi.fn()} searchLabel="Tìm kỳ lương" />);
    expect(screen.getByLabelText("Tìm kỳ lương")).toBeInTheDocument();
  });

  it("render cả slot lọc lẫn slot hành động phải", () => {
    render(
      <DataToolbar actions={<button type="button">⚙</button>}>
        <span>trạng thái</span>
      </DataToolbar>,
    );
    expect(screen.getByText("trạng thái")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "⚙" })).toBeInTheDocument();
  });
});
