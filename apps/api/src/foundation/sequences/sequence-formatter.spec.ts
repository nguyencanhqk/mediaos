import { describe, expect, it } from "vitest";
import { buildCode } from "./sequence-formatter";

/**
 * FOUNDATION-BE-2 — formatter thuần-hàm (BACKEND-04 §8.6). prefix + datePattern(tz công ty,
 * UTC-at-rest qua tz.util) + zero-pad(value, paddingLength) + suffix. value vượt padding KHÔNG bị cắt.
 */
describe("buildCode (sequence formatter)", () => {
  const TZ = "Asia/Ho_Chi_Minh";

  it("zero-pads value theo paddingLength với prefix", () => {
    expect(buildCode({ prefix: "EMP", paddingLength: 5, value: 42, timeZone: TZ })).toBe("EMP00042");
  });

  it("paddingLength=0 KHÔNG pad", () => {
    expect(buildCode({ prefix: "X", paddingLength: 0, value: 7, timeZone: TZ })).toBe("X7");
  });

  it("value vượt paddingLength KHÔNG bị cắt chuỗi", () => {
    // 123456 > 5 chữ số → giữ nguyên 6 chữ số (không truncate).
    expect(buildCode({ prefix: "INV", paddingLength: 5, value: 123456, timeZone: TZ })).toBe(
      "INV123456",
    );
  });

  it("suffix nối SAU phần số", () => {
    expect(buildCode({ prefix: "PO-", suffix: "-VN", paddingLength: 4, value: 9, timeZone: TZ })).toBe(
      "PO-0009-VN",
    );
  });

  it("datePattern yyyyMM chèn đúng kỳ theo tz công ty (UTC-at-rest)", () => {
    // 2026-01-15T18:00:00Z = 2026-01-16 01:00 giờ VN (UTC+7) → vẫn tháng 2026-01.
    const now = new Date("2026-01-15T18:00:00Z");
    expect(
      buildCode({ prefix: "INV", datePattern: "yyyyMM", paddingLength: 4, value: 3, now, timeZone: TZ }),
    ).toBe("INV2026010003");
  });

  it("datePattern dùng wall-clock tz công ty: cuối tháng UTC nhưng đã sang tháng kế ở VN", () => {
    // 2026-01-31T18:00:00Z = 2026-02-01 01:00 giờ VN → datePattern phải là 2026-02 (KHÔNG 2026-01).
    const now = new Date("2026-01-31T18:00:00Z");
    expect(
      buildCode({ prefix: "INV", datePattern: "yyyyMM", paddingLength: 3, value: 1, now, timeZone: TZ }),
    ).toBe("INV202602001");
  });

  it("datePattern yyyy-MM-dd với separator + suffix", () => {
    const now = new Date("2026-03-09T10:00:00Z"); // 17:00 VN cùng ngày
    expect(
      buildCode({
        prefix: "LV-",
        datePattern: "yyyy-MM-dd",
        suffix: "/A",
        paddingLength: 2,
        value: 5,
        now,
        timeZone: TZ,
      }),
    ).toBe("LV-2026-03-0905/A");
  });

  it("không prefix/suffix/datePattern → chỉ phần số đã pad", () => {
    expect(buildCode({ paddingLength: 6, value: 100, timeZone: TZ })).toBe("000100");
  });

  it("hỗ trợ value bigint", () => {
    expect(buildCode({ prefix: "B", paddingLength: 4, value: 12n, timeZone: TZ })).toBe("B0012");
  });
});
