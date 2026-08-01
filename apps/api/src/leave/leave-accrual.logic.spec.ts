import { describe, expect, it } from "vitest";
import {
  ACCRUAL_YEAR_GRACE_DAYS,
  accrualFloorDate,
  buildAccrualPlan,
  cumulativeTarget,
  fullMonthsInYear,
  lastDayOfMonth,
  monthlyAccrualAmount,
  type AccrualEmployeeInput,
  type AccrualPolicyInput,
} from "./leave-accrual.logic";

/**
 * S6-LEAVE-ACCRUAL-1 — unit cho LÕI THUẦN engine cộng dồn phép (không DB).
 * Đây là nơi quyết định "ai được mấy ngày phép" ⇒ phủ ca biên nặng tay hơn CRUD thường.
 * Mốc thời gian mô phỏng bám PROD: hôm nay 2026-08-01, quota 12 ngày/năm ⇒ 1 ngày/tháng.
 */

const POLICY: AccrualPolicyInput = {
  policyId: "p1",
  policyCode: "DEFAULT_ANNUAL",
  leaveTypeId: "t1",
  accrualMethod: "Monthly",
  yearlyQuotaDays: "12.00",
  effectiveFrom: "2020-01-01",
  effectiveTo: null,
};

const EMPLOYEE: AccrualEmployeeInput = {
  employeeId: "e1",
  userId: "u1",
  employeeCode: "1001",
  startDate: "2020-05-10",
  endDate: null,
  status: "active",
};

const policy = (over: Partial<AccrualPolicyInput> = {}): AccrualPolicyInput => ({
  ...POLICY,
  ...over,
});
const employee = (over: Partial<AccrualEmployeeInput> = {}): AccrualEmployeeInput => ({
  ...EMPLOYEE,
  ...over,
});
const plan = (
  over: { policy?: Partial<AccrualPolicyInput>; employee?: Partial<AccrualEmployeeInput> } = {},
  today = "2026-08-01",
) => buildAccrualPlan({ policy: policy(over.policy), employee: employee(over.employee), today });

describe("leave-accrual.logic — số học làm tròn (plan §3.3)", () => {
  it("quota 12 ⇒ đúng 1.0 ngày mỗi tháng, tổng 12.0", () => {
    const amounts = Array.from({ length: 12 }, (_, i) => monthlyAccrualAmount(12, i + 1));
    expect(amounts).toEqual(Array.from({ length: 12 }, () => 1));
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(12, 10);
  });

  it("quota LẺ (15) — mọi số hạng ≤1 chữ số thập phân và tổng ĐÚNG bằng quota (không 15.6)", () => {
    const amounts = Array.from({ length: 12 }, (_, i) => monthlyAccrualAmount(15, i + 1));
    for (const a of amounts) {
      // numeric(5,1) của leave_balances.total_days: quá 1 chữ số ⇒ Postgres làm tròn ⇒ sổ cái lệch số dư.
      expect(Math.round(a * 10)).toBe(a * 10);
    }
    expect(cumulativeTarget(15, 12)).toBe(15);
    expect(Number(amounts.reduce((a, b) => a + b, 0).toFixed(1))).toBe(15);
    // chia đều rồi làm tròn từng tháng sẽ ra 1.3 × 12 = 15.6 — chính là lỗi cách này chặn.
    expect(Number((Math.round((15 / 12) * 10) / 10) * 12)).toBeCloseTo(15.6, 10);
  });

  it("quota lẻ khác (13, 20, 7) — tổng 12 tháng luôn khớp quota làm tròn 1 chữ số", () => {
    for (const q of [7, 13, 20, 18, 11.5]) {
      const total = Array.from({ length: 12 }, (_, i) => monthlyAccrualAmount(q, i + 1)).reduce(
        (a, b) => a + b,
        0,
      );
      expect(Number(total.toFixed(1))).toBe(cumulativeTarget(q, 12));
    }
  });

  it("lastDayOfMonth xử lý đúng năm nhuận", () => {
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2100, 2)).toBe(28);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
  });
});

describe("leave-accrual.logic — D-A1 chỉ cấp kỳ ĐÃ kết thúc", () => {
  it("hôm nay 01/08/2026 ⇒ cấp T1..T7, KHÔNG có T8", () => {
    const { periods } = plan();
    expect(periods.map((p) => p.periodKey)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
    ]);
    expect(periods.reduce((s, p) => s + p.amountDays, 0)).toBe(7);
  });

  it("ĐỨNG ĐÚNG ngày cuối tháng (31/07) ⇒ tháng 7 CHƯA kết thúc, chưa được cấp", () => {
    const { periods } = plan({}, "2026-07-31");
    expect(periods.map((p) => p.periodKey)).not.toContain("2026-07");
    expect(periods).toHaveLength(6);
  });

  it("sang ngày 01/08 ⇒ tháng 7 được cấp (biên +1 ngày)", () => {
    expect(plan({}, "2026-08-01").periods.map((p) => p.periodKey)).toContain("2026-07");
  });

  it("transaction_date của kỳ tháng LUÔN là ngày cuối tháng (khoá idempotency mig 0536)", () => {
    const dates = plan().periods.map((p) => p.transactionDate);
    expect(dates).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
    ]);
  });

  it("năm nhuận: kỳ 02/2028 ghi sổ ngày 29/02/2028", () => {
    const { periods } = plan({}, "2028-03-05");
    expect(periods.find((p) => p.periodKey === "2028-02")?.transactionDate).toBe("2028-02-29");
  });
});

describe("leave-accrual.logic — D-A2 bù theo ngày vào làm", () => {
  it("vào làm GIỮA tháng ⇒ tháng đó KHÔNG tính, tháng kế mới tính", () => {
    const { periods } = plan({ employee: { startDate: "2026-06-22" } });
    expect(periods.map((p) => p.periodKey)).toEqual(["2026-07"]);
  });

  it("vào làm ĐÚNG ngày 1 ⇒ tháng đó ĐƯỢC tính", () => {
    const { periods } = plan({ employee: { startDate: "2026-06-01" } });
    expect(periods.map((p) => p.periodKey)).toEqual(["2026-06", "2026-07"]);
  });

  it("hồ sơ dữ liệu PROD thật (4 nhóm) ⇒ 7 · 5 · 4 · 1 tháng", () => {
    const cases: [string, number][] = [
      ["2017-03-02", 7],
      ["2026-02-23", 5],
      ["2026-03-15", 4],
      ["2026-06-22", 1],
    ];
    for (const [startDate, expected] of cases) {
      expect(plan({ employee: { startDate } }).periods).toHaveLength(expected);
    }
  });
});

describe("leave-accrual.logic — chặn bằng end_date (data integrity, plan §1.1 F1)", () => {
  it("nghỉ việc GIỮA tháng ⇒ tháng đó KHÔNG được cấp", () => {
    const { periods } = plan({ employee: { startDate: "2024-01-01", endDate: "2026-04-21" } });
    expect(periods.map((p) => p.periodKey)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("nghỉ việc ĐÚNG ngày cuối tháng ⇒ tháng đó VẪN được cấp (đã làm trọn)", () => {
    const { periods } = plan({ employee: { startDate: "2024-01-01", endDate: "2026-03-31" } });
    expect(periods.map((p) => p.periodKey)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("nghỉ việc từ NĂM TRƯỚC ⇒ 0 ngày phép của năm nay (295 vs 245 — 2 hồ sơ PROD)", () => {
    expect(
      plan({ employee: { startDate: "2025-02-05", endDate: "2025-03-05", status: "resigned" } })
        .periods,
    ).toEqual([]);
    expect(
      plan({ employee: { startDate: "2025-05-05", endDate: "2025-05-24", status: "resigned" } })
        .periods,
    ).toEqual([]);
  });

  it.each([["resigned"], ["terminated"]])(
    "status=%s mà THIẾU end_date ⇒ DỪNG + báo, KHÔNG đoán ngày nghỉ",
    (status) => {
      const result = plan({ employee: { status, endDate: null } });
      expect(result.periods).toEqual([]);
      expect(result.skipReason).toBe("TERMINATED_WITHOUT_END_DATE");
    },
  );

  it("status=inactive (tạm nghỉ, chưa rời) ⇒ VẪN cộng dồn bình thường", () => {
    expect(plan({ employee: { status: "inactive" } }).periods).toHaveLength(7);
  });
});

describe("leave-accrual.logic — bỏ qua PHẢI có lý do (không bao giờ im lặng)", () => {
  it("thiếu start_date ⇒ 0 kỳ + MISSING_START_DATE (KHÔNG mặc định 01/01)", () => {
    const result = plan({ employee: { startDate: null } });
    expect(result.periods).toEqual([]);
    expect(result.skipReason).toBe("MISSING_START_DATE");
  });

  it("thiếu user_id ⇒ MISSING_USER (leave_balances.user_id NOT NULL)", () => {
    expect(plan({ employee: { userId: null } }).skipReason).toBe("MISSING_USER");
  });

  it.each([
    ["None", "METHOD_DISABLED"],
    ["Manual", "METHOD_DISABLED"],
  ])("accrual_method=%s ⇒ %s, engine KHÔNG đụng vào (D-A4)", (accrualMethod, reason) => {
    const result = plan({ policy: { accrualMethod } });
    expect(result.periods).toEqual([]);
    expect(result.skipReason).toBe(reason);
  });

  it.each([[null], [""], ["0"], ["-5"], ["abc"]])(
    "yearly_quota_days=%s ⇒ MISSING_QUOTA (cấu hình câm bị BÁO, không âm thầm cấp 0)",
    (yearlyQuotaDays) => {
      const result = plan({ policy: { yearlyQuotaDays } });
      expect(result.periods).toEqual([]);
      expect(result.skipReason).toBe("MISSING_QUOTA");
    },
  );

  it("có cấp được ⇒ skipReason = null", () => {
    expect(plan().skipReason).toBeNull();
  });
});

describe("leave-accrual.logic — hiệu lực chính sách", () => {
  it("kỳ trước effective_from ⇒ không cấp", () => {
    const { periods } = plan({ policy: { effectiveFrom: "2026-04-01" } });
    expect(periods.map((p) => p.periodKey)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07"]);
  });

  it("effective_to cắt giữa kỳ ⇒ kỳ đó KHÔNG cấp (chính sách phải phủ TRỌN kỳ)", () => {
    const { periods } = plan({ policy: { effectiveTo: "2026-05-15" } });
    expect(periods.map((p) => p.periodKey)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });
});

describe("leave-accrual.logic — cửa sổ bù kỳ đã qua (plan §3.5)", () => {
  it("sàn = 01/01 của năm chứa (hôm nay − 45 ngày)", () => {
    expect(accrualFloorDate("2026-08-01")).toBe("2026-01-01");
    expect(accrualFloorDate("2027-01-01")).toBe("2026-01-01");
    expect(accrualFloorDate("2027-02-20")).toBe("2027-01-01");
    expect(ACCRUAL_YEAR_GRACE_DAYS).toBe(45);
  });

  it("chạy 00:00 ngày 01/01/2027 ⇒ VẪN thấy kỳ 12/2026 (không mất tháng cuối năm)", () => {
    const { periods } = plan({}, "2027-01-01");
    expect(periods.map((p) => p.periodKey)).toContain("2026-12");
    expect(periods).toHaveLength(12);
  });

  it("chạy 20/02/2027 ⇒ 2026 đã rơi khỏi cửa sổ, chỉ còn kỳ 01/2027", () => {
    const { periods } = plan({}, "2027-02-20");
    expect(periods.map((p) => p.periodKey)).toEqual(["2027-01"]);
  });

  it("KHÔNG BAO GIỜ bù ngược nhiều năm dù effective_from = 2020 (nợ phép ảo)", () => {
    const { periods } = plan();
    expect(periods.every((p) => p.year === 2026)).toBe(true);
  });
});

describe("leave-accrual.logic — Yearly / Prorated (plan §3.2, giả định §3.6)", () => {
  const yearly = (over: Partial<AccrualEmployeeInput> = {}, today = "2026-08-01") =>
    buildAccrualPlan({
      policy: policy({ accrualMethod: "Yearly", effectiveFrom: "2026-01-01" }),
      employee: employee(over),
      today,
    });

  it("Yearly ⇒ 1 kỳ/năm, cấp TRỌN quota, ghi sổ ngày 01/01", () => {
    const { periods } = yearly();
    expect(periods).toEqual([
      { periodKey: "2026", year: 2026, transactionDate: "2026-01-01", amountDays: 12 },
    ]);
  });

  it("Yearly + vào làm GIỮA năm ⇒ năm đó KHÔNG cấp (khác Prorated)", () => {
    expect(yearly({ startDate: "2026-03-15" }).periods).toEqual([]);
  });

  it("Prorated + vào làm giữa năm ⇒ cấp theo số tháng làm TRỌN", () => {
    const { periods } = buildAccrualPlan({
      policy: policy({ accrualMethod: "Prorated", effectiveFrom: "2026-01-01" }),
      employee: employee({ startDate: "2026-03-15" }),
      today: "2026-08-01",
    });
    // tháng làm trọn = T4..T12 = 9 ⇒ 12 × 9/12 = 9.0
    expect(fullMonthsInYear(employee({ startDate: "2026-03-15" }), 2026)).toBe(9);
    expect(periods).toEqual([
      { periodKey: "2026", year: 2026, transactionDate: "2026-01-01", amountDays: 9 },
    ]);
  });

  it("ngày ghi sổ Yearly (01/01) KHÔNG trùng ngày ghi sổ Monthly nào (khoá mig 0536 đơn ánh)", () => {
    const monthlyDates = new Set(plan().periods.map((p) => p.transactionDate));
    expect(monthlyDates.has("2026-01-01")).toBe(false);
  });

  it("năm chưa bắt đầu ⇒ không cấp trước", () => {
    expect(yearly({}, "2025-12-31").periods).toEqual([]);
  });
});
