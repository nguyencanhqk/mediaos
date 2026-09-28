import {
  DATA_SCOPES,
  FEED_ENGAGEMENT_MAX_WEEKS,
  feedEngagementQuerySchema,
  snapToIsoWeeks,
  type DataScope,
} from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import { statsScopeFilter } from "./social-stats-scope";

/**
 * S16-SOCIAL-BE-3B — luật thuần của thống kê tương tác: phạm vi D5 (VÉT CẠN trên `DATA_SCOPES` của contracts)
 * + tham số D1 (nắn tuần ISO bằng số học UTC, trần 26 tuần, `from`/`to` đi cùng nhau).
 */
describe("statsScopeFilter (plan D5)", () => {
  const UNIT = "11111111-1111-4111-8111-111111111111";

  const EXPECTED: Record<DataScope, "all" | "units" | "none"> = {
    System: "all",
    Company: "all",
    Department: "units",
    Team: "none",
    Own: "none",
  };

  it.each([...DATA_SCOPES])("%s ⇒ đúng loại (bảng kỳ vọng phủ ĐỦ enum)", (scope) => {
    expect(EXPECTED[scope]).toBeDefined();
    expect(statsScopeFilter(scope, [UNIT]).kind).toBe(EXPECTED[scope]);
  });

  it("Department mang ĐÚNG tập đơn vị (bản sao, không tham chiếu mảng gốc)", () => {
    const ids = [UNIT];
    const f = statsScopeFilter("Department", ids);
    expect(f).toEqual({ kind: "units", ids: [UNIT] });
    if (f.kind === "units") expect(f.ids).not.toBe(ids);
  });

  it("Department với tập RỖNG ⇒ none (fail-closed, không bao giờ match-all)", () => {
    expect(statsScopeFilter("Department", [])).toEqual({ kind: "none" });
  });

  it("Own/Team KHÔNG nhận số của công ty dù có đơn vị", () => {
    expect(statsScopeFilter("Own", [UNIT])).toEqual({ kind: "none" });
    expect(statsScopeFilter("Team", [UNIT])).toEqual({ kind: "none" });
  });

  it("giá trị scope lạ lúc chạy ⇒ none", () => {
    expect(statsScopeFilter("Galaxy" as DataScope, [UNIT])).toEqual({ kind: "none" });
  });
});

describe("snapToIsoWeeks (plan D1 — số học UTC)", () => {
  it("thứ Tư → thứ Hai tuần đó; thứ Tư → Chủ nhật tuần đó", () => {
    // 2026-09-23 là thứ Tư.
    expect(snapToIsoWeeks("2026-09-23", "2026-09-23")).toEqual({
      from: "2026-09-21",
      to: "2026-09-27",
      weeks: 1,
    });
  });

  it("biên Chủ nhật / thứ Hai: Chủ nhật thuộc tuần TRƯỚC, thứ Hai mở tuần mới", () => {
    expect(snapToIsoWeeks("2026-09-27", "2026-09-28")).toEqual({
      from: "2026-09-21",
      to: "2026-10-04",
      weeks: 2,
    });
  });

  it("qua ranh giới năm", () => {
    // 2026-01-01 là thứ Năm ⇒ thứ Hai là 2025-12-29.
    expect(snapToIsoWeeks("2026-01-01", "2026-01-01")?.from).toBe("2025-12-29");
  });

  it("ngày không tồn tại ⇒ null", () => {
    expect(snapToIsoWeeks("2026-02-30", "2026-03-01")).toBeNull();
  });

  it("KHÔNG phụ thuộc TZ tiến trình (chạy dưới TZ âm)", () => {
    const before = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(snapToIsoWeeks("2026-09-27", "2026-09-28")).toEqual({
        from: "2026-09-21",
        to: "2026-10-04",
        weeks: 2,
      });
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

describe("feedEngagementQuerySchema (plan D1)", () => {
  it("vắng from/to ⇒ hợp lệ, không bịa khoảng (server tính theo TZ công ty)", () => {
    expect(feedEngagementQuerySchema.parse({})).toEqual({ orgUnitId: undefined });
  });

  it("trả khoảng ĐÃ nắn", () => {
    expect(feedEngagementQuerySchema.parse({ from: "2026-09-23", to: "2026-09-30" })).toEqual({
      from: "2026-09-21",
      to: "2026-10-04",
      orgUnitId: undefined,
    });
  });

  it.each([
    ["chỉ from", { from: "2026-09-21" }],
    ["chỉ to", { to: "2026-09-21" }],
    ["from > to", { from: "2026-09-28", to: "2026-09-21" }],
    ["ngày không tồn tại", { from: "2026-02-30", to: "2026-03-02" }],
    ["sai định dạng", { from: "2026-9-1", to: "2026-09-21" }],
    ["năm 0000", { from: "0000-01-01", to: "0000-01-02" }],
    ["orgUnitId không phải uuid", { orgUnitId: "abc" }],
    ["tham số lạ (strict)", { page: "1" }],
  ])("%s ⇒ lỗi", (_label, input) => {
    expect(feedEngagementQuerySchema.safeParse(input).success).toBe(false);
  });

  it(`đúng ${FEED_ENGAGEMENT_MAX_WEEKS} tuần sau nắn ⇒ hợp lệ; thêm 1 ngày tràn sang tuần sau ⇒ lỗi`, () => {
    // 2026-01-05 là thứ Hai; 26 tuần kết thúc Chủ nhật 2026-07-05.
    expect(
      feedEngagementQuerySchema.safeParse({ from: "2026-01-05", to: "2026-07-05" }).success,
    ).toBe(true);
    expect(
      feedEngagementQuerySchema.safeParse({ from: "2026-01-05", to: "2026-07-06" }).success,
    ).toBe(false);
  });

  it("nắn làm khoảng vượt trần dù ngày thô chưa vượt ⇒ lỗi (trần áp SAU nắn)", () => {
    // Chủ nhật 2026-01-04 → thứ Hai 2025-12-29; thứ Hai 2026-06-29 → Chủ nhật 2026-07-05 ⇒ 27 tuần.
    expect(
      feedEngagementQuerySchema.safeParse({ from: "2026-01-04", to: "2026-06-29" }).success,
    ).toBe(false);
  });
});
