/**
 * S16-SOCIAL-FE-3B (L5a, ca C1 — KHÓI) — biểu đồ xu hướng của màn Thống kê tương tác.
 *
 * Recharts trong jsdom chưa từng được đo ở kho này (plan M16 · B13): jsdom không có layout và không có
 * `ResizeObserver` ⇒ ca này chỉ chứng minh «render không ném» với `ResizeObserver` stub CỤC BỘ, cộng phần
 * KHÔNG phụ thuộc layout (tiêu đề · trạng thái rỗng · bảng thay thế của `ChartCard`). Hình vẽ thật của biểu
 * đồ KHÔNG đo được ở đây. Spec của trang sẽ MOCK file này.
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../feed/social-test-doubles";
import { makeEngagement } from "../../admin/admin-test-doubles";
import { EngagementTrendChart } from "./EngagementTrendChart";

const TITLE = "Xu hướng tương tác theo tuần";
const EMPTY = "Chưa có dữ liệu tuần nào để vẽ biểu đồ.";
const SHOW_TABLE = "Xem dạng bảng";

class ResizeObserverStub {
  observe(): void {
    return undefined;
  }
  unobserve(): void {
    return undefined;
  }
  disconnect(): void {
    return undefined;
  }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EngagementTrendChart — khói", () => {
  it("`weekTotals` 0 hàng ⇒ render không ném; có tiêu đề + câu rỗng, không có nút chuyển bảng", () => {
    expect(() => renderWithProviders(<EngagementTrendChart weekTotals={[]} />)).not.toThrow();
    expect(screen.getByRole("heading", { name: TITLE })).toBeInTheDocument();
    expect(screen.getByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SHOW_TABLE })).toBeNull();
  });

  it("có dữ liệu ⇒ render không ném; có tiêu đề, KHÔNG có câu rỗng", () => {
    expect(() =>
      renderWithProviders(<EngagementTrendChart weekTotals={makeEngagement().weekTotals} />),
    ).not.toThrow();
    expect(screen.getByRole("heading", { name: TITLE })).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("mọi giá trị của biểu đồ tới được qua BẢNG (không cần rê chuột): mỗi tuần một hàng, tổng tương tác dẫn đầu", () => {
    renderWithProviders(<EngagementTrendChart weekTotals={makeEngagement().weekTotals} />);
    fireEvent.click(screen.getByRole("button", { name: SHOW_TABLE }));
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Tuần", "Tổng tương tác", "Bài viết", "Bình luận", "Cảm xúc"]);
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((tr) =>
        within(tr)
          .getAllByRole("cell")
          .map((td) => td.textContent),
      );
    expect(rows).toEqual([
      ["21/09/2026 – 27/09/2026", "13", "2", "4", "7"],
      ["28/09/2026 – 04/10/2026", "23", "5", "6", "12"],
    ]);
  });
});
