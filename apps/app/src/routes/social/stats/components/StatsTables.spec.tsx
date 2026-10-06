/**
 * S16-SOCIAL-FE-3B (L5a, ca T3 — vế bảng) — hai bảng số liệu của màn Thống kê tương tác: «Theo tuần»
 * (`weekTotals`) và «Theo đơn vị» (`rows` đã gộp bằng `unitTotals`).
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY; phần tử truy vấn bằng role + tên trợ năng.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FeedEngagementWeekDto } from "@mediaos/contracts";
import { renderWithProviders } from "../../feed/social-test-doubles";
import { UNIT_ID, makeEngagement } from "../../admin/admin-test-doubles";
import { unitTotals } from "../lib/stats-aggregate";
import { UnitTotalsTable } from "./UnitTotalsTable";
import { WeekTotalsTable } from "./WeekTotalsTable";

const WEEK_TABLE = "Tương tác theo tuần";
const UNIT_TABLE = "Tương tác theo đơn vị";
const STRAY_UNIT_ID = "99999999-9999-4999-8999-999999999999";

const headers = (table: HTMLElement): (string | null)[] =>
  within(table)
    .getAllByRole("columnheader")
    .map((th) => th.textContent);
const rowHeaders = (table: HTMLElement): (string | null)[] =>
  within(table)
    .getAllByRole("rowheader")
    .map((th) => th.textContent);
const cellsOf = (table: HTMLElement, rowName: string): (string | null)[] => {
  const row = within(table).getByRole("rowheader", { name: rowName }).closest("tr");
  if (row === null) throw new Error(`không tìm thấy hàng «${rowName}»`);
  return within(row)
    .getAllByRole("cell")
    .map((td) => td.textContent);
};

afterEach(() => {
  cleanup();
});

describe("WeekTotalsTable — «Theo tuần»", () => {
  const weekTable = (): HTMLElement => screen.getByRole("table", { name: WEEK_TABLE });

  it("(role) bảng có tên + ĐÚNG năm `columnheader`; mỗi tuần một hàng, `rowheader` là khoảng thứ Hai – Chủ nhật", () => {
    renderWithProviders(<WeekTotalsTable weekTotals={makeEngagement().weekTotals} />);
    expect(headers(weekTable())).toEqual([
      "Tuần",
      "Bài viết",
      "Bình luận",
      "Cảm xúc",
      "Thành viên hoạt động",
    ]);
    expect(rowHeaders(weekTable())).toEqual(["21/09/2026 – 27/09/2026", "28/09/2026 – 04/10/2026"]);
  });

  it("ô số đúng theo `weekTotals` của server (không tính lại ở FE)", () => {
    renderWithProviders(<WeekTotalsTable weekTotals={makeEngagement().weekTotals} />);
    expect(cellsOf(weekTable(), "21/09/2026 – 27/09/2026")).toEqual(["2", "4", "7", "3"]);
    expect(cellsOf(weekTable(), "28/09/2026 – 04/10/2026")).toEqual(["5", "6", "12", "5"]);
  });

  it("tuần toàn 0 ⇒ vẫn vẽ hàng với số 0; số lớn có dấu ngăn nghìn; không ô nào là NaN", () => {
    const weeks: FeedEngagementWeekDto[] = [
      { weekStart: "2026-09-21", posts: 0, comments: 0, reactions: 0, activeMembers: 0 },
      { weekStart: "2026-09-28", posts: 1234, comments: 0, reactions: 56789, activeMembers: 12 },
    ];
    renderWithProviders(<WeekTotalsTable weekTotals={weeks} />);
    expect(cellsOf(weekTable(), "21/09/2026 – 27/09/2026")).toEqual(["0", "0", "0", "0"]);
    expect(cellsOf(weekTable(), "28/09/2026 – 04/10/2026")).toEqual(["1.234", "0", "56.789", "12"]);
    expect(weekTable().textContent).not.toContain("NaN");
  });
});

describe("UnitTotalsTable — «Theo đơn vị»", () => {
  const unitTable = (): HTMLElement => screen.getByRole("table", { name: UNIT_TABLE });

  it("(role) bảng có tên + ĐÚNG bốn `columnheader` — KHÔNG có cột thành viên (số distinct không cộng dồn được)", () => {
    renderWithProviders(<UnitTotalsTable rows={unitTotals(makeEngagement())} />);
    expect(headers(unitTable())).toEqual(["Đơn vị", "Bài viết", "Bình luận", "Cảm xúc"]);
    expect(unitTable().textContent).not.toContain("Thành viên");
  });

  it("đơn vị đã xoá có hậu tố «(đã xoá)»; hàng `orgUnitId: null` là «Chưa gán đơn vị»", () => {
    renderWithProviders(<UnitTotalsTable rows={unitTotals(makeEngagement())} />);
    expect(rowHeaders(unitTable())).toEqual([
      "Phòng Kỹ thuật",
      "Phòng Dự án cũ (đã xoá)",
      "Chưa gán đơn vị",
    ]);
    expect(cellsOf(unitTable(), "Phòng Kỹ thuật")).toEqual(["5", "9", "16"]);
    expect(cellsOf(unitTable(), "Phòng Dự án cũ (đã xoá)")).toEqual(["1", "0", "1"]);
    expect(cellsOf(unitTable(), "Chưa gán đơn vị")).toEqual(["1", "1", "2"]);
  });

  it("`rows` thưa: đơn vị không có hoạt động ⇒ ô là «0», không ô nào là NaN hay rỗng", () => {
    const data = makeEngagement({
      rows: [
        {
          weekStart: "2026-09-28",
          orgUnitId: UNIT_ID,
          posts: 4,
          comments: 0,
          reactions: 0,
          activeMembers: 1,
        },
      ],
    });
    renderWithProviders(<UnitTotalsTable rows={unitTotals(data)} />);
    expect(cellsOf(unitTable(), "Phòng Kỹ thuật")).toEqual(["4", "0", "0"]);
    expect(cellsOf(unitTable(), "Phòng Dự án cũ (đã xoá)")).toEqual(["0", "0", "0"]);
    expect(unitTable().textContent).not.toContain("NaN");
  });

  it("hàng của đơn vị không có trong `units` ⇒ «Đơn vị không xác định» (khác «Chưa gán đơn vị»)", () => {
    const data = makeEngagement({
      rows: [
        {
          weekStart: "2026-09-28",
          orgUnitId: STRAY_UNIT_ID,
          posts: 2,
          comments: 1,
          reactions: 3,
          activeMembers: 1,
        },
      ],
    });
    renderWithProviders(<UnitTotalsTable rows={unitTotals(data)} />);
    expect(cellsOf(unitTable(), "Đơn vị không xác định")).toEqual(["2", "1", "3"]);
    expect(within(unitTable()).queryByRole("rowheader", { name: "Chưa gán đơn vị" })).toBeNull();
  });
});
