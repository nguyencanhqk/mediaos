/**
 * `DetailPageHeader` — khối đầu trang màn CHI TIẾT (UI-07 §13.7, S15-UI-SHELL-1).
 *
 * Hai luật đáng neo:
 * 1. **`⋯` ẩn CẢ NÚT khi 0 mục** — menu rỗng là một cánh cửa mở vào phòng trống.
 * 2. **`←` gọi callback của màn, KHÔNG `history.back()`** — vào bằng deep-link thì không có lịch sử
 *    để lùi. Neo bằng cách: không truyền `onBack` ⇒ không có nút nào để bấm.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetailPageHeader } from "./detail-page-header";

describe("DetailPageHeader", () => {
  it("render tiêu đề + dòng phụ + chip trạng thái", () => {
    render(
      <DetailPageHeader
        title="Kỳ lương 09/2026"
        subtitle="PR-2609 · Toàn công ty"
        status={<span>Đã duyệt</span>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Kỳ lương 09/2026" })).toBeInTheDocument();
    expect(screen.getByText("PR-2609 · Toàn công ty")).toBeInTheDocument();
    expect(screen.getByText("Đã duyệt")).toBeInTheDocument();
  });

  it("nút ← gọi onBack của màn", () => {
    const onBack = vi.fn();
    render(<DetailPageHeader title="Phiếu lương" onBack={onBack} />);
    fireEvent.click(screen.getByTestId("detail-header-back"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("không truyền onBack ⇒ KHÔNG render nút ← (không có fallback history.back() ngầm)", () => {
    render(<DetailPageHeader title="Phiếu lương" />);
    expect(screen.queryByTestId("detail-header-back")).not.toBeInTheDocument();
  });

  it("overflowItems rỗng / không truyền ⇒ ẩn CẢ nút ⋯", () => {
    const { rerender } = render(<DetailPageHeader title="Kỳ lương" />);
    expect(screen.queryByTestId("detail-header-overflow")).not.toBeInTheDocument();

    rerender(<DetailPageHeader title="Kỳ lương" overflowItems={[]} />);
    expect(screen.queryByTestId("detail-header-overflow")).not.toBeInTheDocument();
  });

  it("có mục ⇒ hiện ⋯; bấm mục gọi onSelect rồi ĐÓNG menu", () => {
    const onSelect = vi.fn();
    render(
      <DetailPageHeader
        title="Kỳ lương"
        overflowItems={[{ key: "lock", label: "Khoá kỳ", onSelect }]}
      />,
    );

    fireEvent.click(screen.getByTestId("detail-header-overflow"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Khoá kỳ" }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menuitem", { name: "Khoá kỳ" })).not.toBeInTheDocument();
  });

  it("mục disabled: KHÔNG gọi onSelect, và có tooltip nói lý do", () => {
    const onSelect = vi.fn();
    render(
      <DetailPageHeader
        title="Kỳ lương"
        overflowItems={[
          {
            key: "reopen",
            label: "Mở lại kỳ",
            onSelect,
            disabled: true,
            disabledReason: "Kỳ chưa khoá",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("detail-header-overflow"));
    const item = screen.getByRole("menuitem", { name: "Mở lại kỳ" });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute("title", "Kỳ chưa khoá");

    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("bàn phím: Escape đóng menu ⋯", () => {
    render(
      <DetailPageHeader
        title="Kỳ lương"
        overflowItems={[{ key: "lock", label: "Khoá kỳ", onSelect: vi.fn() }]}
      />,
    );
    fireEvent.click(screen.getByTestId("detail-header-overflow"));
    expect(screen.getByRole("menuitem", { name: "Khoá kỳ" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Khoá kỳ" })).not.toBeInTheDocument();
  });

  it("hành động chính render ở phải, cạnh ⋯", () => {
    render(
      <DetailPageHeader
        title="Kỳ lương"
        actions={<button type="button">Tính lương</button>}
        overflowItems={[{ key: "x", label: "Xuất XLSX", onSelect: vi.fn() }]}
      />,
    );
    expect(screen.getByRole("button", { name: "Tính lương" })).toBeInTheDocument();
    expect(screen.getByTestId("detail-header-overflow")).toBeInTheDocument();
  });
});
