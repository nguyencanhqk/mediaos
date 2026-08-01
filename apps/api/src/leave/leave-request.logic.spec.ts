/**
 * S3-QA-2 (qa2LeaveApi) — colocated UNIT spec cho các HÀM THUẦN của leave-request.logic.ts.
 *
 * leave-request.logic.ts (helper của LEAVE request workflow) TRƯỚC ĐÂY chưa có spec colocated — các nhánh
 * date-math / duration-guard / holiday-filter chỉ được phủ GIÁN TIẾP qua int-spec đường thật (đắt, cần DB).
 * Bổ sung ở đây phủ TRỰC TIẾP, KHÔNG DB, KHÔNG DI → nâng coverage vùng nhạy cảm LEAVE (CLAUDE.md §6) mà
 * không nhân bản int-spec (BE-2). Không đổi hành vi service — chỉ khẳng định hợp đồng của helper.
 *
 * Không mock: các hàm này thuần số học/tập hợp; ép kiểu row tối thiểu (chỉ field hàm đọc) qua `as`.
 */

import { UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { HolidayView } from "../foundation/holidays/holidays.service";
import type { LeaveDurationType } from "./leave-calc.logic";
import {
  LEAVE_ERR,
  type LeaveTypeRow,
  assertDurationAllowed,
  buildLeaveHolidayDates,
  resolveNegativeAllowance,
  daysBetweenLocalDates,
  mapDayType,
  numOrNull,
  round2,
  yearOf,
} from "./leave-request.logic";

// Chỉ set các field mà hàm đọc — phần còn lại của row không liên quan tới nhánh test.
function typeRow(
  flags: Partial<
    Pick<LeaveTypeRow, "allowFullDay" | "allowHalfDay" | "allowHourly" | "allowMultipleDays">
  >,
): LeaveTypeRow {
  return {
    name: "Loại nghỉ test",
    allowFullDay: null,
    allowHalfDay: null,
    allowHourly: null,
    allowMultipleDays: null,
    ...flags,
  } as unknown as LeaveTypeRow;
}

function holiday(opts: { date: string; status: string; affectsLeave: boolean }): HolidayView {
  return {
    holidayDate: opts.date,
    status: opts.status,
    affectsLeaveCalculation: opts.affectsLeave,
  } as unknown as HolidayView;
}

describe("leave-request.logic — yearOf", () => {
  it("trả về năm dương lịch của startDate (năm hạn mức)", () => {
    expect(yearOf("2027-03-01")).toBe(2027);
    expect(yearOf("2026-12-31")).toBe(2026);
  });
});

describe("leave-request.logic — round2", () => {
  it("làm tròn 2 chữ số, diệt float drift từ /8 + tổng 0.5", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1 / 3)).toBe(0.33);
    expect(round2(0.125)).toBe(0.13); // 0.125*100=12.5 → làm tròn lên 13
    expect(round2(5)).toBe(5); // số nguyên giữ nguyên
  });
});

describe("leave-request.logic — daysBetweenLocalDates", () => {
  it("dương khi to sau from (thuần số học lịch, không tz)", () => {
    expect(daysBetweenLocalDates("2027-03-01", "2027-03-05")).toBe(4);
    expect(daysBetweenLocalDates("2027-03-01", "2027-03-01")).toBe(0);
  });

  it("âm khi to trước from (defensive — caller tự chặn)", () => {
    expect(daysBetweenLocalDates("2027-03-05", "2027-03-01")).toBe(-4);
  });

  it("qua ranh giới tháng/năm vẫn đúng số ngày lịch", () => {
    expect(daysBetweenLocalDates("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetweenLocalDates("2027-02-28", "2027-03-01")).toBe(1); // 2027 không nhuận
  });
});

describe("leave-request.logic — mapDayType (khớp CHECK chk_leave_request_days_day_type)", () => {
  it("HalfDay → 'Half Day' (CÓ khoảng trắng)", () => {
    expect(mapDayType("HalfDay")).toBe("Half Day");
  });
  it("Hourly → 'Hourly'", () => {
    expect(mapDayType("Hourly")).toBe("Hourly");
  });
  it("FullDay / MultipleDays / null → 'Full Day'", () => {
    expect(mapDayType("FullDay")).toBe("Full Day");
    expect(mapDayType("MultipleDays")).toBe("Full Day");
    expect(mapDayType(null)).toBe("Full Day");
  });
});

describe("leave-request.logic — numOrNull", () => {
  it("chuỗi numeric → number; null → null (numeric NULL từ ledger)", () => {
    expect(numOrNull("12.50")).toBe(12.5);
    expect(numOrNull("0")).toBe(0);
    expect(numOrNull(null)).toBeNull();
  });
});

describe("leave-request.logic — assertDurationAllowed", () => {
  it("KHÔNG throw khi cờ = null (chưa cấu hình → cho phép)", () => {
    for (const d of ["FullDay", "HalfDay", "Hourly", "MultipleDays"] as LeaveDurationType[]) {
      expect(() => assertDurationAllowed(typeRow({}), d)).not.toThrow();
    }
  });

  it("KHÔNG throw khi cờ = true (được phép tường minh)", () => {
    expect(() => assertDurationAllowed(typeRow({ allowHalfDay: true }), "HalfDay")).not.toThrow();
  });

  it("throw 422 LEAVE-ERR-DURATION-NOT-ALLOWED khi cờ = false (chặn tường minh)", () => {
    try {
      assertDurationAllowed(typeRow({ allowHourly: false }), "Hourly");
      throw new Error("phải throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      expect((e as UnprocessableEntityException).getResponse()).toMatchObject({
        code: LEAVE_ERR.DURATION_NOT_ALLOWED,
      });
    }
  });

  it("chỉ chặn ĐÚNG durationType bị set false, không ảnh hưởng loại khác", () => {
    const row = typeRow({ allowMultipleDays: false, allowFullDay: true });
    expect(() => assertDurationAllowed(row, "FullDay")).not.toThrow();
    expect(() => assertDurationAllowed(row, "MultipleDays")).toThrow(UnprocessableEntityException);
  });
});

describe("leave-request.logic — buildLeaveHolidayDates", () => {
  it("chỉ gom holiday Active + affectsLeaveCalculation=true", () => {
    const set = buildLeaveHolidayDates([
      holiday({ date: "2027-03-01", status: "Active", affectsLeave: true }),
      holiday({ date: "2027-03-02", status: "Active", affectsLeave: false }), // không ảnh hưởng leave
      holiday({ date: "2027-03-03", status: "Inactive", affectsLeave: true }), // không Active
    ]);
    expect(set.has("2027-03-01")).toBe(true);
    expect(set.has("2027-03-02")).toBe(false);
    expect(set.has("2027-03-03")).toBe(false);
    expect(set.size).toBe(1);
  });

  it("mảng rỗng → set rỗng (không lỗi)", () => {
    expect(buildLeaveHolidayDates([]).size).toBe(0);
  });

  it("KHÔNG dùng affectsAttendance để quyết định (chỉ affectsLeaveCalculation)", () => {
    // Một holiday chỉ ảnh hưởng chấm công (affectsLeave=false) → KHÔNG vào set leave.
    const set = buildLeaveHolidayDates([
      holiday({ date: "2027-05-01", status: "Active", affectsLeave: false }),
    ]);
    expect(set.size).toBe(0);
  });
});

// ═══════════════════════ S6-LEAVE-MAXNEG-1 — resolveNegativeAllowance ═══════════════════════
// Hợp đồng khoá ở đây là NGHĨA CỦA NULL (quyết định D-1): allowNegative=true + max=NULL ⇒ 0, KHÔNG
// phải "vô hạn". Trước WO này allowNegative=true bỏ qua MỌI kiểm tra ⇒ nợ phép không giới hạn dù
// form vẫn cho HR nhập trần — đúng họ bẫy "giao diện hứa, backend không làm" của accrual_method.
describe("resolveNegativeAllowance (S6-LEAVE-MAXNEG-1)", () => {
  const type = (allow: boolean | null) => ({ allowNegativeBalance: allow }) as LeaveTypeRow;
  const policy = (allow: boolean | null, max: string | null) =>
    ({ allowNegativeBalance: allow, maxNegativeDays: max }) as never;

  it("không cho âm → maxNegative = 0", () => {
    expect(resolveNegativeAllowance(undefined, type(false))).toEqual({
      allowNegative: false,
      maxNegative: 0,
    });
  });

  it("cho âm + trần 5 → nhận đúng 5", () => {
    expect(resolveNegativeAllowance(policy(true, "5"), type(null))).toEqual({
      allowNegative: true,
      maxNegative: 5,
    });
  });

  it("D-1: cho âm + trần NULL → 0 (fail-closed), KHÔNG phải vô hạn", () => {
    expect(resolveNegativeAllowance(policy(true, null), type(null))).toEqual({
      allowNegative: true,
      maxNegative: 0,
    });
  });

  it("trần âm hoặc numeric hỏng → 0, không bao giờ thành vô hạn", () => {
    expect(resolveNegativeAllowance(policy(true, "-3"), type(null)).maxNegative).toBe(0);
    expect(resolveNegativeAllowance(policy(true, "khong-phai-so"), type(null)).maxNegative).toBe(0);
  });

  it("chính sách ghi đè loại nghỉ (policy ?? type ?? false)", () => {
    expect(resolveNegativeAllowance(policy(false, "9"), type(true)).allowNegative).toBe(false);
    expect(resolveNegativeAllowance(policy(null, "9"), type(true)).allowNegative).toBe(true);
    expect(resolveNegativeAllowance(undefined, type(true)).maxNegative).toBe(0);
  });

  it("giữ 2 chữ số thập phân cho trần nửa ngày", () => {
    expect(resolveNegativeAllowance(policy(true, "2.5"), type(null)).maxNegative).toBe(2.5);
  });
});
