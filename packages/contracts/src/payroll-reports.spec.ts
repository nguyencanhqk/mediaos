import { describe, expect, it } from "vitest";
import { payrollEmployeeListQuerySchema } from "./payroll-employees";
import { payrollSummaryQuerySchema } from "./payroll";
import {
  payrollMonthSpan,
  payrollOverviewQuerySchema,
  payrollReportCodeEnum,
  payrollReportExportQuerySchema,
  payrollReportQuerySchema,
  PAYROLL_REPORT_CODES,
  PAYROLL_REPORT_MAX_MONTHS,
  PAYROLL_SALARY_BANDS,
} from "./payroll-reports";

/** S15-PAYROLL-BE-5 — hợp đồng query của 078–082 · 018 · 036. */
describe("payroll-reports contracts", () => {
  it("7 mã báo cáo, thứ tự hiển thị cố định; mã lạ bị từ chối", () => {
    expect(PAYROLL_REPORT_CODES).toHaveLength(7);
    expect(payrollReportCodeEnum.safeParse("khong-co").success).toBe(false);
  });

  it("payrollMonthSpan đếm cả hai đầu", () => {
    expect(payrollMonthSpan("2026-01", "2026-12")).toBe(12);
    expect(payrollMonthSpan("2026-05", "2026-04")).toBe(0);
    expect(payrollMonthSpan("2025-12", "2026-01")).toBe(2);
  });

  it("081: khoảng ngược / quá trần ⇒ lỗi ở `toMonth`; khoá lạ ⇒ lỗi; phân trang có mặc định", () => {
    const reversed = payrollReportQuerySchema.safeParse({
      fromMonth: "2026-05",
      toMonth: "2026-04",
    });
    expect(reversed.success).toBe(false);
    expect(reversed.error?.issues[0]?.path).toEqual(["toMonth"]);
    // 2024-01..2025-12 = đúng PAYROLL_REPORT_MAX_MONTHS tháng ⇒ nhận; thêm một tháng ⇒ từ chối.
    expect(PAYROLL_REPORT_MAX_MONTHS).toBe(24);
    expect(
      payrollReportQuerySchema.safeParse({ fromMonth: "2024-01", toMonth: "2025-12" }).success,
    ).toBe(true);
    expect(
      payrollReportQuerySchema.safeParse({ fromMonth: "2024-01", toMonth: "2026-01" }).success,
    ).toBe(false);
    expect(payrollReportQuerySchema.safeParse({ foo: "1" }).success).toBe(false);
    const ok = payrollReportQuerySchema.parse({ fiscalYear: "2026" });
    expect(ok).toMatchObject({ fiscalYear: 2026, page: 1, per_page: 20 });
  });

  it("082: KHÔNG nhận phân trang", () => {
    expect(payrollReportExportQuerySchema.safeParse({ page: "2" }).success).toBe(false);
    expect(payrollReportExportQuerySchema.safeParse({ fiscalYear: "2026" }).success).toBe(true);
  });

  it("078: months 1..24, khoá lạ ⇒ lỗi", () => {
    expect(payrollOverviewQuerySchema.safeParse({ months: "0" }).success).toBe(false);
    expect(payrollOverviewQuerySchema.safeParse({ months: "25" }).success).toBe(false);
    expect(payrollOverviewQuerySchema.parse({ months: "6" })).toEqual({ months: 6 });
    expect(payrollOverviewQuerySchema.safeParse({ bar: "1" }).success).toBe(false);
    expect(PAYROLL_SALARY_BANDS[0]).toBe(0);
  });

  it("018: `payrollPeriodId` UUID tuỳ chọn, khoá lạ ⇒ lỗi", () => {
    expect(payrollSummaryQuerySchema.parse({})).toEqual({});
    expect(payrollSummaryQuerySchema.safeParse({ payrollPeriodId: "abc" }).success).toBe(false);
    expect(payrollSummaryQuerySchema.safeParse({ x: "1" }).success).toBe(false);
  });

  it("036: `hasSalaryProfile=false` là FALSE (không phải true — D-18); rác ⇒ lỗi; lặp parse idempotent", () => {
    expect(
      payrollEmployeeListQuerySchema.parse({ hasSalaryProfile: "false" }).hasSalaryProfile,
    ).toBe(false);
    expect(
      payrollEmployeeListQuerySchema.parse({ hasSalaryProfile: "true" }).hasSalaryProfile,
    ).toBe(true);
    expect(payrollEmployeeListQuerySchema.safeParse({ hasSalaryProfile: "yes" }).success).toBe(
      false,
    );
    const once = payrollEmployeeListQuerySchema.parse({ hasSalaryProfile: "false" });
    expect(payrollEmployeeListQuerySchema.parse(once).hasSalaryProfile).toBe(false);
    expect(payrollEmployeeListQuerySchema.parse({}).hasSalaryProfile).toBeUndefined();
  });

  it("036: `insuranceIssue` chỉ nhận 2 giá trị", () => {
    expect(
      payrollEmployeeListQuerySchema.parse({ insuranceIssue: "not-joined" }).insuranceIssue,
    ).toBe("not-joined");
    expect(payrollEmployeeListQuerySchema.safeParse({ insuranceIssue: "abc" }).success).toBe(false);
  });
});
