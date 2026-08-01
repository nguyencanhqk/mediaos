import { describe, expect, it } from "vitest";
import {
  LEAVE_TYPE_CODES,
  createLeavePolicySchema,
  hasMaxNegativeForAllowNegative,
  hasValidCarryForwardDeadline,
  leaveTypeCodeSchema,
} from "./index";

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

/**
 * S6-LEAVE-CARRYOVER-1 — mốc hết hạn phép chuyển. CHECK ở DB chỉ chặn được khoảng thô (1..12 / 1..31);
 * luật "ngày phải có thật trên lịch" nằm ở đây và được form Chính sách dùng lại y hệt (một hàm, không
 * có bản sao thứ hai để trôi).
 */
describe("hasValidCarryForwardDeadline (S6-LEAVE-CARRYOVER-1)", () => {
  it("công tắc TẮT ⇒ không soi mốc (chính sách tắt thì mốc vô nghĩa, bắt lỗi chỉ làm HR không lưu nổi)", () => {
    expect(
      hasValidCarryForwardDeadline({
        allowCarryForward: false,
        carryForwardExpiryMonth: 2,
        carryForwardExpiryDay: 31,
      }),
    ).toBe(true);
  });

  it("chấp nhận mốc có thật, kể cả 29/02 (engine cắt về 28/02 ở năm không nhuận)", () => {
    expect(
      hasValidCarryForwardDeadline({
        allowCarryForward: true,
        carryForwardExpiryMonth: 3,
        carryForwardExpiryDay: 31,
      }),
    ).toBe(true);
    expect(
      hasValidCarryForwardDeadline({
        allowCarryForward: true,
        carryForwardExpiryMonth: 2,
        carryForwardExpiryDay: 29,
      }),
    ).toBe(true);
  });

  it("CHẶN mốc không có thật trên lịch (31/02, 31/04, 30/02)", () => {
    for (const [month, day] of [
      [2, 31],
      [4, 31],
      [2, 30],
      [6, 31],
      [9, 31],
      [11, 31],
    ]) {
      expect(
        hasValidCarryForwardDeadline({
          allowCarryForward: true,
          carryForwardExpiryMonth: month,
          carryForwardExpiryDay: day,
        }),
      ).toBe(false);
    }
  });

  it("bật công tắc mà thiếu mốc ⇒ KHÔNG hợp lệ (không đoán hộ)", () => {
    expect(
      hasValidCarryForwardDeadline({
        allowCarryForward: true,
        carryForwardExpiryMonth: null,
        carryForwardExpiryDay: null,
      }),
    ).toBe(false);
  });
});

describe("createLeavePolicySchema — cấu hình chuyển tiếp", () => {
  const base = {
    leaveTypeId: "11111111-1111-4111-8111-111111111111",
    policyCode: "STD",
    name: "Chính sách chuẩn",
    policyScope: "Company" as const,
    effectiveFrom: "2026-01-01",
  };

  it("mặc định: tắt chuyển tiếp, mốc 31/03 (owner D-A3)", () => {
    const parsed = createLeavePolicySchema.parse(base);
    expect(parsed.allowCarryForward).toBe(false);
    expect(parsed.carryForwardExpiryMonth).toBe(3);
    expect(parsed.carryForwardExpiryDay).toBe(31);
    expect(parsed.maxCarryForwardDays).toBeUndefined();
  });

  it("REJECT mốc vô nghĩa khi bật chuyển tiếp, báo đúng vào ô ngày", () => {
    const r = createLeavePolicySchema.safeParse({
      ...base,
      allowCarryForward: true,
      carryForwardExpiryMonth: 2,
      carryForwardExpiryDay: 31,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["carryForwardExpiryDay"]);
  });

  it("REJECT bật chuyển tiếp trên phạm vi KHÔNG phải Toàn công ty (engine không đọc tới)", () => {
    const r = createLeavePolicySchema.safeParse({
      ...base,
      policyScope: "Department" as const,
      departmentId: "22222222-2222-4222-8222-222222222222",
      allowCarryForward: true,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "allowCarryForward")).toBe(true);
    }
  });

  it("phạm vi khác mà KHÔNG bật chuyển tiếp ⇒ vẫn lưu được", () => {
    expect(
      createLeavePolicySchema.safeParse({
        ...base,
        policyScope: "Department" as const,
        departmentId: "22222222-2222-4222-8222-222222222222",
      }).success,
    ).toBe(true);
  });

  it("REJECT trần âm", () => {
    expect(
      createLeavePolicySchema.safeParse({
        ...base,
        allowCarryForward: true,
        maxCarryForwardDays: -1,
      }).success,
    ).toBe(false);
  });
});

/**
 * S6-LEAVE-MAXNEG-1 — engine coi trần bỏ trống là 0 (fail-closed). Ràng buộc này KHÔNG phải lớp an
 * toàn (thiếu trần chỉ làm chặt hơn) mà là lớp chống CẤU HÌNH VÔ NGHĨA: "cho nợ phép + không trần"
 * hành xử y hệt "không cho nợ phép", tức HR bật một công tắc không có tác dụng gì.
 */
describe("hasMaxNegativeForAllowNegative (S6-LEAVE-MAXNEG-1)", () => {
  it("không bật cho-âm → luôn hợp lệ, trần không liên quan", () => {
    expect(hasMaxNegativeForAllowNegative({ allowNegativeBalance: false })).toBe(true);
    expect(hasMaxNegativeForAllowNegative({})).toBe(true);
    expect(
      hasMaxNegativeForAllowNegative({ allowNegativeBalance: false, maxNegativeDays: null }),
    ).toBe(true);
  });

  it("bật cho-âm mà trần trống/0/âm → KHÔNG hợp lệ", () => {
    expect(hasMaxNegativeForAllowNegative({ allowNegativeBalance: true })).toBe(false);
    expect(
      hasMaxNegativeForAllowNegative({ allowNegativeBalance: true, maxNegativeDays: null }),
    ).toBe(false);
    expect(hasMaxNegativeForAllowNegative({ allowNegativeBalance: true, maxNegativeDays: 0 })).toBe(
      false,
    );
  });

  it("bật cho-âm + trần > 0 → hợp lệ", () => {
    expect(
      hasMaxNegativeForAllowNegative({ allowNegativeBalance: true, maxNegativeDays: 0.5 }),
    ).toBe(true);
    expect(hasMaxNegativeForAllowNegative({ allowNegativeBalance: true, maxNegativeDays: 5 })).toBe(
      true,
    );
  });

  it("createLeavePolicySchema REJECT cho-âm thiếu trần, báo đúng vào ô maxNegativeDays", () => {
    const base = {
      leaveTypeId: "11111111-1111-4111-8111-111111111111",
      policyCode: "STD",
      name: "Chính sách chuẩn",
      policyScope: "Company" as const,
      effectiveFrom: "2026-01-01",
    };
    const r = createLeavePolicySchema.safeParse({ ...base, allowNegativeBalance: true });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("maxNegativeDays"))).toBe(true);
    }
    expect(
      createLeavePolicySchema.safeParse({
        ...base,
        allowNegativeBalance: true,
        maxNegativeDays: 5,
      }).success,
    ).toBe(true);
  });
});
