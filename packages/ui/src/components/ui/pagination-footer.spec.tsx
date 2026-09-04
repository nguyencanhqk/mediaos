import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaginationFooter } from "./pagination-footer";

/**
 * S14-FE-DEBT-1 — footer phân trang SERVER-side dùng chung.
 *
 * Thay 27 bản chép tay rải khắp `apps/app` (10 hình dạng). Hai điều phải giữ:
 * (1) nút phải CÓ TÊN KHẢ TRUY CẬP — 10 bản cũ render trần ký tự `‹`/`›`, không
 *     `aria-label`, không i18n ⇒ trình đọc màn hình đọc ra "‹";
 * (2) ẩn/hiện phải khớp cả ba khuôn guard cũ (`lastPage > 1` · `totalPages > 1` ·
 *     `page > 1 || hasNext`) — cả ba tương đương `hasPrev || hasNext`.
 */
describe("PaginationFooter", () => {
  it("nút prev/next có TÊN KHẢ TRUY CẬP (lỗi a11y của 10 bản glyph `‹`/`›`)", () => {
    render(<PaginationFooter page={2} totalPages={5} onPageChange={vi.fn()} />);
    // setup.ts nạp i18n THẬT (resources vi của web-core) ⇒ tên khả truy cập là chuỗi vi,
    // KHÔNG phải "‹" như 10 bản cũ.
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeInTheDocument();
  });

  it("hiện chỉ báo trang `page / totalPages`", () => {
    render(<PaginationFooter page={3} totalPages={7} onPageChange={vi.fn()} />);
    expect(screen.getByText("3 / 7")).toBeInTheDocument();
  });

  it("phát trang TRƯỚC và trang SAU qua onPageChange", () => {
    const onPageChange = vi.fn();
    render(<PaginationFooter page={3} totalPages={7} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Trang trước" }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);

    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    expect(onPageChange).toHaveBeenLastCalledWith(4);
  });

  it("kẹp biên: ở trang đầu prev TẮT, ở trang cuối next TẮT", () => {
    const { rerender } = render(
      <PaginationFooter page={1} totalPages={4} onPageChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeEnabled();

    rerender(<PaginationFooter page={4} totalPages={4} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeDisabled();
  });

  it("ẩn hoàn toàn khi KHÔNG còn chiều nào đi được (thay guard `lastPage > 1`)", () => {
    const { container } = render(
      <PaginationFooter page={1} totalPages={1} onPageChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("`disabled` (đang fetch) tắt CẢ HAI nút dù còn trang đi được", () => {
    render(<PaginationFooter page={2} totalPages={5} disabled onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeDisabled();
  });

  it("hasPrev/hasNext tường minh THẮNG suy diễn từ page/totalPages (khuôn `meta.hasNext`)", () => {
    // Server nói hết trang dù page < totalPages (vd tổng đổi giữa hai lần fetch).
    render(<PaginationFooter page={2} totalPages={9} hasNext={false} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeEnabled();
  });

  it("không biết tổng số trang (khuôn TaskListPage) vẫn đi tiếp được nhờ hasNext", () => {
    render(<PaginationFooter page={2} hasNext onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeEnabled();
    // Không có totalPages ⇒ KHÔNG bịa chỉ báo "2 / undefined".
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
  });

  it("hiện dải bản ghi khi có `range` (khuôn α: `1–20 trên 57`)", () => {
    render(
      <PaginationFooter
        page={1}
        totalPages={3}
        range={{ from: 1, to: 20, total: 57 }}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText("1–20 trên 57")).toBeInTheDocument();
  });

  it("không có `range` thì KHÔNG render ô dải (khuôn glyph)", () => {
    render(<PaginationFooter page={1} totalPages={3} onPageChange={vi.fn()} />);
    expect(screen.queryByText(/trên/)).not.toBeInTheDocument();
  });
});
