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
/** Lấy hàm cập nhật của lần gọi gần nhất — `onPageChange` nhận `(prev) => next`, không nhận số. */
function lastUpdater(fn: ReturnType<typeof vi.fn>): (prev: number) => number {
  const call = fn.mock.calls.at(-1);
  if (!call) throw new Error("onPageChange chưa được gọi lần nào");
  return call[0] as (prev: number) => number;
}

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
    expect(lastUpdater(onPageChange)(3)).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    expect(lastUpdater(onPageChange)(3)).toBe(4);
  });

  it("phát HÀM CẬP NHẬT, không phải số tính sẵn — hai cú nhấn nhanh phải đi ĐỦ hai trang", () => {
    // Bản chép tay cũ dùng `setPage((p) => p + 1)`. Nếu component phát số tính sẵn từ prop `page`,
    // hai cú nhấn trước khi React render lại cùng ra một số ⇒ cú thứ hai thành no-op câm.
    const onPageChange = vi.fn();
    render(<PaginationFooter page={3} totalPages={7} onPageChange={onPageChange} />);
    const next = screen.getByRole("button", { name: "Trang sau" });

    fireEvent.click(next);
    fireEvent.click(next); // prop `page` VẪN là 3 — chưa render lại

    expect(onPageChange).toHaveBeenCalledTimes(2);
    // Áp lần lượt hai hàm cập nhật lên state thật: 3 → 4 → 5, KHÔNG phải 3 → 4 → 4.
    let state = 3;
    for (const [updater] of onPageChange.mock.calls) state = updater(state);
    expect(state).toBe(5);
  });

  it("kẹp trần khi biết tổng số trang, và KHÔNG kẹp khi không biết", () => {
    const withTotal = vi.fn();
    const { unmount } = render(
      <PaginationFooter page={2} totalPages={4} onPageChange={withTotal} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    expect(lastUpdater(withTotal)(9)).toBe(4); // state vượt trần ⇒ kẹp về totalPages
    unmount();

    const noTotal = vi.fn();
    render(<PaginationFooter page={2} hasNext onPageChange={noTotal} />);
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    expect(lastUpdater(noTotal)(9)).toBe(10); // không biết trần ⇒ đi tiếp như bản cũ
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
