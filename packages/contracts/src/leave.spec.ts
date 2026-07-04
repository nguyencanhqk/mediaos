import { describe, expect, it } from "vitest";
import { LEAVE_TYPE_CODES, leaveTypeCodeSchema } from "./index";

/**
 * S3-LEAVE-SEED-2 — hằng canonical mã loại nghỉ (DB-10 §14.3 CHỐT 2026-07-04: code thắng, mã ngắn).
 * Khoá hợp đồng (8 mã cố định) để FE/seeder bind từ đây — KHÔNG hard-code chuỗi — chống lệch âm thầm.
 */
describe("LEAVE_TYPE_CODES / leaveTypeCodeSchema", () => {
  it("LEAVE_TYPE_CODES có ĐÚNG 8 khoá canonical (khoá hợp đồng chống drift)", () => {
    expect(Object.keys(LEAVE_TYPE_CODES).sort()).toEqual(
      [
        "ANNUAL",
        "SICK",
        "UNPAID",
        "OTHER",
        "MATERNITY",
        "MARRIAGE",
        "BEREAVEMENT",
        "COMPENSATORY",
      ].sort(),
    );
  });

  it("mỗi khoá tự ánh xạ về đúng giá trị chuỗi cùng tên (mã NGẮN, KHÔNG hậu tố _LEAVE)", () => {
    for (const [key, value] of Object.entries(LEAVE_TYPE_CODES)) {
      expect(value).toBe(key);
    }
  });

  it.each([
    LEAVE_TYPE_CODES.ANNUAL,
    LEAVE_TYPE_CODES.SICK,
    LEAVE_TYPE_CODES.UNPAID,
    LEAVE_TYPE_CODES.OTHER,
    LEAVE_TYPE_CODES.MATERNITY,
    LEAVE_TYPE_CODES.MARRIAGE,
    LEAVE_TYPE_CODES.BEREAVEMENT,
    LEAVE_TYPE_CODES.COMPENSATORY,
  ])("leaveTypeCodeSchema chấp nhận mã canonical %s", (code) => {
    expect(leaveTypeCodeSchema.parse(code)).toBe(code);
  });

  it("REJECT mã lạ (không thuộc 8 canonical)", () => {
    expect(() => leaveTypeCodeSchema.parse("ANNUAL_LEAVE")).toThrow();
    expect(() => leaveTypeCodeSchema.parse("annual")).toThrow();
    expect(() => leaveTypeCodeSchema.parse("SOMETHING_ELSE")).toThrow();
    expect(() => leaveTypeCodeSchema.parse("")).toThrow();
  });
});
