/**
 * S16-SOCIAL-FE-3B (L5a, ca T1 — vế điều khiển · nền của T4) — thanh bộ lọc của màn Thống kê tương tác.
 *
 * Component chỉ TRÌNH BÀY + phát ý định: nhãn khoảng lấy từ `range` SERVER trả; ‹ › / ô số tuần phát khoảng
 * kế tiếp (đã tính bằng số học chuỗi ở `stats-range`); ô đơn vị dựng option TRONG render từ `units`.
 *
 * Đồng hồ: `2026-10-04T17:30:00Z` = 00:30 thứ Hai 05/10 giờ VN ⇒ tuần hiện tại kết thúc 11/10 (plan B10).
 * Chỉ giả `Date` (không giả timer) để RTL vẫn chạy bình thường.
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../feed/social-test-doubles";
import { DELETED_UNIT_ID, UNIT_ID, makeEngagement } from "../../admin/admin-test-doubles";
import type { StatsRange } from "../lib/stats-range";
import { StatsFilters, type StatsFiltersProps } from "./StatsFilters";

const VN_MONDAY = new Date("2026-10-04T17:30:00Z");
const VN_SUNDAY = new Date("2026-10-04T16:59:00Z");

const GROUP = "Bộ lọc thống kê";
const WEEKS = "Số tuần";
const UNIT = "Đơn vị";
const RESET = "Về hiện tại";

const DEFAULT_8W: StatsRange = { from: "2026-08-17", to: "2026-10-11", weeks: 8 };
const TWO_WEEKS: StatsRange = { from: "2026-09-21", to: "2026-10-04", weeks: 2 };

function renderFilters(over: Partial<StatsFiltersProps> = {}) {
  const onRangeChange = vi.fn();
  const onOrgUnitChange = vi.fn();
  renderWithProviders(
    <StatsFilters
      range={DEFAULT_8W}
      units={makeEngagement().units}
      orgUnitId={undefined}
      isCustomRange={false}
      onRangeChange={onRangeChange}
      onOrgUnitChange={onOrgUnitChange}
      {...over}
    />,
  );
  return { onRangeChange, onOrgUnitChange };
}

const group = (): HTMLElement => screen.getByRole("group", { name: GROUP });
const button = (name: string): HTMLButtonElement => within(group()).getByRole("button", { name });
const weeksSelect = (): HTMLSelectElement => within(group()).getByRole("combobox", { name: WEEKS });
const unitSelect = (): HTMLSelectElement => within(group()).getByRole("combobox", { name: UNIT });
const optionTexts = (select: HTMLSelectElement): (string | null)[] =>
  within(select)
    .getAllByRole("option")
    .map((option) => option.textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(VN_MONDAY);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("khoảng tuần", () => {
  it("(role) nhóm có tên; nhãn khoảng là `range` của SERVER viết kiểu Việt", () => {
    renderFilters();
    expect(within(group()).getByText("17/08/2026 – 11/10/2026")).toBeInTheDocument();
  });

  it("‹ «Lùi 8 tuần» ⇒ phát khoảng lùi đúng 8×7 ngày (thứ Hai 22/06 → Chủ nhật 16/08)", () => {
    const { onRangeChange } = renderFilters();
    fireEvent.click(button("Lùi 8 tuần"));
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onRangeChange).toHaveBeenCalledWith({ from: "2026-06-22", to: "2026-08-16" });
  });

  it("› khoá khi khoảng đang kết thúc ở tuần hiện tại; bấm không phát gì", () => {
    const { onRangeChange } = renderFilters();
    expect(button("Tiến 8 tuần")).toBeDisabled();
    fireEvent.click(button("Tiến 8 tuần"));
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  it("🔴 biên múi giờ: khoảng kết thúc 04/10 — 00:30 thứ Hai giờ VN thì › MỞ (tuần hiện tại đã là 05–11/10)", () => {
    const { onRangeChange } = renderFilters({ range: TWO_WEEKS, isCustomRange: true });
    expect(button("Tiến 2 tuần")).toBeEnabled();
    fireEvent.click(button("Tiến 2 tuần"));
    expect(onRangeChange).toHaveBeenCalledWith({ from: "2026-09-28", to: "2026-10-11" });
  });

  it("đối chứng: 23:59 Chủ nhật 04/10 giờ VN thì › KHOÁ với cùng khoảng đó", () => {
    vi.setSystemTime(VN_SUNDAY);
    renderFilters({ range: TWO_WEEKS, isCustomRange: true });
    expect(button("Tiến 2 tuần")).toBeDisabled();
  });

  it("› đưa về đúng khoảng mặc định (8 tuần tới hết tuần hiện tại) ⇒ phát `null` (không ghi lên URL)", () => {
    const { onRangeChange } = renderFilters({
      range: { from: "2026-06-22", to: "2026-08-16", weeks: 8 },
      isCustomRange: true,
    });
    fireEvent.click(button("Tiến 8 tuần"));
    expect(onRangeChange).toHaveBeenCalledWith(null);
  });
});

describe("ô số tuần", () => {
  it("(role) `<select>` có nhãn; bốn lựa chọn 4 / 8 / 12 / 26 tuần; đang chọn = `range.weeks`", () => {
    renderFilters();
    expect(optionTexts(weeksSelect())).toEqual(["4 tuần", "8 tuần", "12 tuần", "26 tuần"]);
    expect(weeksSelect().value).toBe("8");
  });

  it("đổi sang 4 tuần ⇒ GIỮ ngày kết thúc, phát khoảng 4 tuần", () => {
    const { onRangeChange } = renderFilters();
    fireEvent.change(weeksSelect(), { target: { value: "4" } });
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onRangeChange).toHaveBeenCalledWith({ from: "2026-09-14", to: "2026-10-11" });
  });

  it("đổi về 8 tuần khi đang kết thúc ở tuần hiện tại ⇒ phát `null` (chính là mặc định)", () => {
    const { onRangeChange } = renderFilters({
      range: { from: "2026-09-14", to: "2026-10-11", weeks: 4 },
      isCustomRange: true,
    });
    fireEvent.change(weeksSelect(), { target: { value: "8" } });
    expect(onRangeChange).toHaveBeenCalledWith(null);
  });

  it("số tuần ngoài bốn lựa chọn (URL sửa tay: 5 tuần) ⇒ có thêm đúng lựa chọn đó và nó đang được chọn", () => {
    renderFilters({
      range: { from: "2026-08-31", to: "2026-10-04", weeks: 5 },
      isCustomRange: true,
    });
    expect(optionTexts(weeksSelect())).toEqual([
      "4 tuần",
      "5 tuần",
      "8 tuần",
      "12 tuần",
      "26 tuần",
    ]);
    expect(weeksSelect().value).toBe("5");
  });
});

describe("«Về hiện tại»", () => {
  it("đang ở mặc định ⇒ khoá", () => {
    const { onRangeChange } = renderFilters();
    expect(button(RESET)).toBeDisabled();
    fireEvent.click(button(RESET));
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  it("đang xem khoảng tự chọn ⇒ bấm phát `null`", () => {
    const { onRangeChange } = renderFilters({ range: TWO_WEEKS, isCustomRange: true });
    fireEvent.click(button(RESET));
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onRangeChange).toHaveBeenCalledWith(null);
  });
});

describe("ô đơn vị", () => {
  it("(role) option = «Tất cả đơn vị» + ĐÚNG `units` của response (đơn vị đã xoá có hậu tố)", () => {
    renderFilters();
    expect(optionTexts(unitSelect())).toEqual([
      "Tất cả đơn vị",
      "Phòng Kỹ thuật",
      "Phòng Dự án cũ (đã xoá)",
    ]);
    expect(unitSelect().value).toBe("");
  });

  it("chọn một đơn vị ⇒ phát id của nó; chọn lại «Tất cả đơn vị» ⇒ phát `undefined`", () => {
    const { onOrgUnitChange } = renderFilters({ orgUnitId: DELETED_UNIT_ID });
    expect(unitSelect().value).toBe(DELETED_UNIT_ID);
    fireEvent.change(unitSelect(), { target: { value: UNIT_ID } });
    expect(onOrgUnitChange).toHaveBeenLastCalledWith(UNIT_ID);
    fireEvent.change(unitSelect(), { target: { value: "" } });
    expect(onOrgUnitChange).toHaveBeenLastCalledWith(undefined);
    expect(onOrgUnitChange).toHaveBeenCalledTimes(2);
  });

  it("không có đơn vị nào trong phạm vi ⇒ ô chỉ còn «Tất cả đơn vị»", () => {
    renderFilters({ units: [] });
    expect(optionTexts(unitSelect())).toEqual(["Tất cả đơn vị"]);
  });
});
