/**
 * S16-SOCIAL-FE-3B (L5a, ca T1 — vế số học) — khoảng tuần của màn Thống kê tương tác (`SOC-SCREEN-011`).
 *
 * Mọi phép tính là số học trên CHUỖI ngày `YYYY-MM-DD`; chỉ «tuần hiện tại» đọc đồng hồ, và đọc theo MÚI GIỜ
 * CÔNG TY. Mốc chọn sao cho UTC và giờ VN rơi vào HAI TUẦN khác nhau (plan B10): `2026-10-04T17:30:00Z` là
 * Chủ nhật 04/10 theo UTC nhưng đã là 00:30 thứ Hai 05/10 giờ VN ⇒ tuần hiện tại kết thúc `2026-10-11`.
 * Tính theo UTC / giờ máy thì ra `2026-10-04` — ca đỏ trên MỌI máy, không chỉ máy ngoài giờ VN.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { feedEngagementQuerySchema } from "@mediaos/contracts";
import {
  STATS_WEEK_OPTIONS,
  asUrlRange,
  canShiftForward,
  currentWeekEnd,
  formatStatsDate,
  rangeForWeeks,
  shiftIsoDate,
  shiftRange,
  weekEndOf,
  type StatsRange,
} from "./stats-range";

/** 00:30 thứ Hai 05/10/2026 giờ VN — còn là Chủ nhật 04/10 theo UTC. */
const VN_MONDAY = new Date("2026-10-04T17:30:00Z");
/** 23:59 Chủ nhật 04/10/2026 giờ VN — UTC cũng Chủ nhật 04/10. */
const VN_SUNDAY = new Date("2026-10-04T16:59:00Z");

const MONDAY = 1;
const SUNDAY = 0;
/** Thứ trong tuần của một ngày lịch (0 = Chủ nhật) — tính UTC thuần, không phụ thuộc múi giờ máy. */
const weekdayOf = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const range = (from: string, to: string, weeks: number): StatsRange => ({ from, to, weeks });
/** 8 tuần mặc định của server tại `VN_MONDAY`. */
const DEFAULT_8W = range("2026-08-17", "2026-10-11", 8);
/** 2 tuần kết thúc Chủ nhật 04/10 (fixture `makeEngagement`). */
const TWO_WEEKS = range("2026-09-21", "2026-10-04", 2);

afterEach(() => {
  vi.useRealTimers();
});

describe("STATS_WEEK_OPTIONS", () => {
  it("đúng bốn lựa chọn 4 / 8 / 12 / 26 tuần (viết tay)", () => {
    expect([...STATS_WEEK_OPTIONS]).toEqual([4, 8, 12, 26]);
  });
});

describe("shiftIsoDate — dịch ngày lịch bằng số học chuỗi", () => {
  it.each([
    ["2026-09-28", -7, "2026-09-21"],
    ["2026-09-28", 7, "2026-10-05"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2028-03-01", -1, "2028-02-29"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-10-04", 0, "2026-10-04"],
  ])("%s dịch %i ngày ⇒ %s", (date, days, expected) => {
    expect(shiftIsoDate(date, days)).toBe(expected);
  });

  it.each(["2026-02-30", "2026-13-01", "abc", "", "2026-9-1"])(
    "ngày không tồn tại / sai dạng «%s» ⇒ null",
    (date) => {
      expect(shiftIsoDate(date, 7)).toBeNull();
    },
  );
});

describe("currentWeekEnd — Chủ nhật của tuần hiện tại theo GIỜ CÔNG TY", () => {
  it("00:30 thứ Hai 05/10 giờ VN (UTC còn Chủ nhật 04/10) ⇒ 2026-10-11", () => {
    expect(currentWeekEnd(VN_MONDAY)).toBe("2026-10-11");
  });

  it("23:59 Chủ nhật 04/10 giờ VN ⇒ 2026-10-04 (chính ngày đó)", () => {
    expect(currentWeekEnd(VN_SUNDAY)).toBe("2026-10-04");
  });

  it("giữa tuần (thứ Tư 07/10 giờ VN) ⇒ 2026-10-11", () => {
    expect(currentWeekEnd(new Date("2026-10-07T03:00:00Z"))).toBe("2026-10-11");
  });

  it("không truyền `now` ⇒ đọc đồng hồ hệ thống (`vi.setSystemTime`)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(VN_MONDAY);
    expect(currentWeekEnd()).toBe("2026-10-11");
  });
});

describe("shiftRange — ‹ lùi / › tiến đúng N tuần", () => {
  it("lùi 8 tuần: `from` và `to` cùng lùi đúng 8×7 ngày; đầu là thứ Hai, cuối là Chủ nhật", () => {
    const next = shiftRange(DEFAULT_8W, "back", VN_MONDAY);
    expect(next).toStrictEqual({ from: "2026-06-22", to: "2026-08-16" });
    expect(weekdayOf(next?.from ?? "")).toBe(MONDAY);
    expect(weekdayOf(next?.to ?? "")).toBe(SUNDAY);
  });

  it("lùi 2 tuần: đúng 2×7 ngày", () => {
    expect(shiftRange(TWO_WEEKS, "back", VN_MONDAY)).toStrictEqual({
      from: "2026-09-07",
      to: "2026-09-20",
    });
  });

  it("tiến 2 tuần khi còn xa hiện tại: đúng 2×7 ngày", () => {
    const next = shiftRange(range("2026-08-24", "2026-09-06", 2), "forward", VN_MONDAY);
    expect(next).toStrictEqual({ from: "2026-09-07", to: "2026-09-20" });
    expect(weekdayOf(next?.from ?? "")).toBe(MONDAY);
    expect(weekdayOf(next?.to ?? "")).toBe(SUNDAY);
  });

  it("tiến mà vượt tuần hiện tại ⇒ dừng ở tuần hiện tại, GIỮ số tuần", () => {
    expect(shiftRange(TWO_WEEKS, "forward", VN_MONDAY)).toStrictEqual({
      from: "2026-09-28",
      to: "2026-10-11",
    });
  });

  it("đang ở tuần hiện tại ⇒ không tiến được (null)", () => {
    expect(shiftRange(DEFAULT_8W, "forward", VN_MONDAY)).toBeNull();
  });

  it("lùi ra ngoài miền ngày của hợp đồng (trước năm 1900) ⇒ null, không sinh tham số chắc chắn 400", () => {
    expect(shiftRange(range("1900-01-01", "1900-01-07", 1), "back", VN_MONDAY)).toBeNull();
  });

  it("mọi khoảng trả ra đều qua `feedEngagementQuerySchema`", () => {
    const results = [
      shiftRange(DEFAULT_8W, "back", VN_MONDAY),
      shiftRange(TWO_WEEKS, "forward", VN_MONDAY),
      shiftRange(range("2026-04-13", "2026-10-11", 26), "back", VN_MONDAY),
    ];
    for (const result of results) {
      expect(result).not.toBeNull();
      expect(feedEngagementQuerySchema.safeParse(result).success).toBe(true);
    }
  });
});

describe("canShiftForward — › khoá ở tuần hiện tại", () => {
  it("🔴 biên múi giờ: khoảng kết thúc 04/10 — 00:30 thứ Hai giờ VN thì TIẾN ĐƯỢC, 23:59 Chủ nhật giờ VN thì KHÔNG", () => {
    expect(canShiftForward(TWO_WEEKS, VN_MONDAY)).toBe(true);
    expect(canShiftForward(TWO_WEEKS, VN_SUNDAY)).toBe(false);
  });

  it("khoảng kết thúc đúng Chủ nhật tuần hiện tại (hoặc sau đó) ⇒ không tiến được", () => {
    expect(canShiftForward(DEFAULT_8W, VN_MONDAY)).toBe(false);
    expect(canShiftForward(range("2026-10-12", "2026-10-18", 1), VN_MONDAY)).toBe(false);
  });
});

describe("rangeForWeeks — đổi số tuần, GIỮ ngày kết thúc", () => {
  it("2 → 4 tuần: `to` giữ nguyên, `from` = `to` − 4×7 + 1 ngày, là thứ Hai", () => {
    const next = rangeForWeeks(TWO_WEEKS, 4);
    expect(next).toStrictEqual({ from: "2026-09-07", to: "2026-10-04" });
    expect(weekdayOf(next?.from ?? "")).toBe(MONDAY);
  });

  it("26 tuần (trần của hợp đồng) ⇒ qua schema", () => {
    const next = rangeForWeeks(TWO_WEEKS, 26);
    expect(next).toStrictEqual({ from: "2026-04-06", to: "2026-10-04" });
    expect(feedEngagementQuerySchema.safeParse(next).success).toBe(true);
  });

  it.each([27, 0, -4, 2.5, Number.NaN])("số tuần không hợp lệ (%s) ⇒ null", (weeks) => {
    expect(rangeForWeeks(TWO_WEEKS, weeks)).toBeNull();
  });
});

describe("asUrlRange — khoảng MẶC ĐỊNH của server không ghi lên URL", () => {
  it("8 tuần kết thúc tuần hiện tại ⇒ null (để server tự tính)", () => {
    expect(asUrlRange({ from: "2026-08-17", to: "2026-10-11" }, VN_MONDAY)).toBeNull();
  });

  it("4 tuần kết thúc tuần hiện tại / 8 tuần ở quá khứ ⇒ giữ nguyên", () => {
    const fourWeeks = { from: "2026-09-14", to: "2026-10-11" };
    const past = { from: "2026-06-22", to: "2026-08-16" };
    expect(asUrlRange(fourWeeks, VN_MONDAY)).toStrictEqual(fourWeeks);
    expect(asUrlRange(past, VN_MONDAY)).toStrictEqual(past);
  });

  it("null vào ⇒ null ra", () => {
    expect(asUrlRange(null, VN_MONDAY)).toBeNull();
  });
});

describe("weekEndOf · formatStatsDate", () => {
  it("Chủ nhật của tuần bắt đầu thứ Hai 28/09 là 04/10; ngày sai ⇒ null", () => {
    expect(weekEndOf("2026-09-28")).toBe("2026-10-04");
    expect(weekEndOf("2026-02-30")).toBeNull();
  });

  it("`YYYY-MM-DD` ⇒ `DD/MM/YYYY` bằng cắt chuỗi; chuỗi sai dạng trả nguyên văn", () => {
    expect(formatStatsDate("2026-09-21")).toBe("21/09/2026");
    expect(formatStatsDate("2026-01-05")).toBe("05/01/2026");
    expect(formatStatsDate("abc")).toBe("abc");
  });
});
