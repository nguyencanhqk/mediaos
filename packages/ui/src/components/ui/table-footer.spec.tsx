/**
 * `TableFooter` — «Tổng số · Số dòng/trang · 1–N» (UI-07 §12.3/§12.4 v1.1, S15-UI-SHELL-1).
 *
 * Ca đáng giá nhất: **API không trả tổng ⇒ nói «không rõ tổng», KHÔNG bịa số**
 * (`apifetch-drops-pagination-bare-array`), và **dải trang CUỐI bị kẹp theo tổng** — «121–128» chứ
 * không phải «121–140». Hai chỗ đó là nơi một footer trông-như-đúng nói dối người đọc.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TableFooter } from "./table-footer";

describe("TableFooter", () => {
  it("hiện tổng từ meta.total + dải trang đầu", () => {
    render(<TableFooter page={1} pageSize={20} total={128} onPageChange={vi.fn()} />);
    expect(screen.getByTestId("table-footer-total")).toHaveTextContent("128");
    expect(screen.getByTestId("table-footer-range")).toHaveTextContent("1–20");
  });

  it("trang CUỐI: dải kẹp theo tổng, không tràn quá số bản ghi thật", () => {
    render(<TableFooter page={7} pageSize={20} total={128} onPageChange={vi.fn()} />);
    expect(screen.getByTestId("table-footer-range")).toHaveTextContent("121–128");
  });

  it("total = null (API trả mảng trần) ⇒ «không rõ tổng», KHÔNG in số 0", () => {
    render(<TableFooter page={1} pageSize={20} total={null} hasNext onPageChange={vi.fn()} />);
    const totalCell = screen.getByTestId("table-footer-total");
    expect(totalCell).toHaveTextContent(/không rõ tổng/i);
    expect(totalCell.textContent).not.toMatch(/\d/);
  });

  it("tổng = 0 ⇒ có nói «Tổng số 0» nhưng KHÔNG vẽ dải «1–0»", () => {
    render(<TableFooter page={1} pageSize={20} total={0} onPageChange={vi.fn()} />);
    expect(screen.getByTestId("table-footer-total")).toHaveTextContent("0");
    expect(screen.queryByTestId("table-footer-range")).not.toBeInTheDocument();
  });

  it("một trang duy nhất ⇒ vẫn hiện tổng, KHÔNG hiện nút chuyển trang", () => {
    render(<TableFooter page={1} pageSize={20} total={12} onPageChange={vi.fn()} />);
    expect(screen.getByTestId("table-footer-total")).toHaveTextContent("12");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("bấm «Trang sau» phát HÀM CẬP NHẬT (không phải số tính sẵn từ prop)", () => {
    const onPageChange = vi.fn();
    render(<TableFooter page={1} pageSize={20} total={128} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByRole("button", { name: /trang sau/i }));
    const updater = onPageChange.mock.calls[0][0] as (prev: number) => number;
    expect(typeof updater).toBe("function");
    expect(updater(3)).toBe(4);
  });

  it("bộ chọn «Số dòng/trang» chỉ hiện khi có onPageSizeChange, và phát ra SỐ", () => {
    const { rerender } = render(
      <TableFooter page={1} pageSize={20} total={128} onPageChange={vi.fn()} />,
    );
    expect(screen.queryByTestId("table-footer-page-size")).not.toBeInTheDocument();

    const onPageSizeChange = vi.fn();
    rerender(
      <TableFooter
        page={1}
        pageSize={20}
        total={128}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    fireEvent.change(screen.getByTestId("table-footer-page-size"), { target: { value: "50" } });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("pageSize server trả NGOÀI danh sách vẫn là giá trị đang chọn (select không nói sai)", () => {
    render(
      <TableFooter
        page={1}
        pageSize={25}
        total={128}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );
    const select = screen.getByTestId("table-footer-page-size") as HTMLSelectElement;
    expect(select.value).toBe("25");
    expect([...select.options].map((o) => o.value)).toContain("25");
  });

  it("disabled khoá CẢ chuyển trang lẫn đổi số dòng, nhưng KHÔNG ẩn footer", () => {
    render(
      <TableFooter
        page={2}
        pageSize={20}
        total={128}
        disabled
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("table-footer-total")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /trang sau/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /trang trước/i })).toBeDisabled();
    expect(screen.getByTestId("table-footer-page-size")).toBeDisabled();
  });
});
