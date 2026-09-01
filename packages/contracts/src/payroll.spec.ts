import { describe, expect, it } from "vitest";
import {
  adjustPayrollLineSchema,
  bonusKindEnum,
  bonusPenaltyStatusEnum,
  createBonusPenaltySchema,
  createPayrollPeriodSchema,
  createSalaryProfileSchema,
  inputSnapshotSchema,
  payrollPeriodStatusEnum,
  payrollWriteResultSchema,
  payslipItemTypeEnum,
  payslipSchema,
  rejectBonusPenaltySchema,
  rejectPayrollPeriodSchema,
  salaryProfileSchema,
} from "./payroll";

/**
 * PAYROLL — Zod contract suite (SPEC-11 · DB-13 §7, mig `0564`).
 *
 * Mục đích KHÔNG phải "kiểm Zod chạy được", mà là ghim **mirror hai chiều ĐÚNG BẰNG** giữa hợp đồng và CHECK
 * đang sống trong DB. Mỗi khối dưới đây có CẢ ca ALLOW lẫn ca DENY — ca DENY đứng một mình là ca xanh-RỖNG
 * (`deny-cases-vacuous-without-allow-case`).
 *
 * Hai lớp lỗi được ghim:
 *  · Zod LỎNG hơn CHECK ⇒ payload qua hợp đồng rồi nổ **500** ở DB (23514/23502).
 *  · Zod CHẶT hơn CHECK ⇒ chặn oan hàng DB vẫn nhận ⇒ mã lỗi CHẾT
 *    (`equal-caps-at-zod-and-service-make-dead-error-code`).
 */

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

describe("PAYROLL enum — mirror CHECK tập giá trị", () => {
  it("payrollPeriodStatusEnum = ĐÚNG 7 giá trị của payroll_periods_status_check (SPEC-01 §17.15)", () => {
    expect(payrollPeriodStatusEnum.options).toEqual([
      "Draft",
      "CollectingData",
      "Calculated",
      "Reviewing",
      "Approved",
      "Paid",
      "Locked",
    ]);
    // Giá trị chữ thường là hình dạng DI SẢN đã bị 0564 gỡ khỏi CHECK — nhận nó là 23514 ở DB.
    expect(payrollPeriodStatusEnum.safeParse("draft").success).toBe(false);
    expect(payrollPeriodStatusEnum.safeParse("published").success).toBe(false);
  });

  it("bonusPenaltyStatusEnum = ĐÚNG 3 giá trị PascalCase (SPEC-01 §17.17)", () => {
    expect(bonusPenaltyStatusEnum.options).toEqual(["Pending", "Approved", "Rejected"]);
    expect(bonusPenaltyStatusEnum.safeParse("draft").success).toBe(false);
  });

  it("bonusKindEnum = bonus|penalty (amount > 0 luôn — kind tách dấu, không dùng số âm)", () => {
    expect(bonusKindEnum.options).toEqual(["bonus", "penalty"]);
  });

  it("payslipItemTypeEnum = ĐÚNG 7 giá trị: bỏ 'kpi', thêm 'adjustment'", () => {
    expect(payslipItemTypeEnum.options).toEqual([
      "earning",
      "deduction",
      "allowance",
      "attendance",
      "bonus",
      "penalty",
      "adjustment",
    ]);
    // 'kpi' đã rời CHECK ở 0564 (KPI ngoài phạm vi sản phẩm) ⇒ giữ trong Zod là enum CHẾT.
    expect(payslipItemTypeEnum.safeParse("kpi").success).toBe(false);
    // 'adjustment' là đích của payroll_period_lines.adjustment_amount ⇒ THIẾU nó là chặn oan.
    expect(payslipItemTypeEnum.safeParse("adjustment").success).toBe(true);
  });
});

describe("input_snapshot_json — mirror CHECK `<> '{}'::jsonb` (payslips + payroll_period_lines)", () => {
  it("ALLOW: object có ít nhất một khoá", () => {
    expect(inputSnapshotSchema.safeParse({ workDays: 22 }).success).toBe(true);
  });

  it("DENY: object RỖNG — cột NOT NULL, KHÔNG DEFAULT, có CHECK; '{}' là snapshot giả", () => {
    expect(inputSnapshotSchema.safeParse({}).success).toBe(false);
  });
});

describe("salary_profiles — versioned, không còn salaryType/payCycle/currency/status", () => {
  const validCreate = {
    userId: UUID_B,
    effectiveDate: "2026-01-01",
    baseSalary: 15_000_000,
    allowances: [{ name: "Ăn trưa", amount: 730_000 }],
  };

  it("ALLOW: payload tối thiểu hợp lệ", () => {
    const r = createSalaryProfileSchema.safeParse(validCreate);
    expect(r.success).toBe(true);
  });

  it("DENY: baseSalary <= 0 — mirror CHECK salary_profile_base_positive_check", () => {
    expect(createSalaryProfileSchema.safeParse({ ...validCreate, baseSalary: 0 }).success).toBe(
      false,
    );
    expect(createSalaryProfileSchema.safeParse({ ...validCreate, baseSalary: -1 }).success).toBe(
      false,
    );
  });

  it("DTO chấp nhận VẮNG KHOÁ tiền (server mask) — không phải null, không phải 0", () => {
    const masked = {
      id: UUID_A,
      companyId: UUID_A,
      userId: UUID_B,
      effectiveDate: "2026-01-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    // Caller không giữ ('view','salary-profile') ⇒ server trả DTO VẮNG baseSalary/allowances.
    expect(salaryProfileSchema.safeParse(masked).success).toBe(true);
    // `null` KHÔNG phải hình dạng mask hợp đồng đã chốt (server-masking-needs-optional-fe-schema).
    expect(salaryProfileSchema.safeParse({ ...masked, baseSalary: null }).success).toBe(false);
    // Và bản KHÔNG mask vẫn đi qua — kẻo ca trên xanh-rỗng.
    expect(salaryProfileSchema.safeParse({ ...masked, baseSalary: 15_000_000 }).success).toBe(true);
  });
});

describe("payroll_periods — period_month regex + comment bắt buộc khi reject", () => {
  it("ALLOW/DENY period_month — mirror payroll_periods_month_check", () => {
    expect(createPayrollPeriodSchema.safeParse({ periodMonth: "2026-01" }).success).toBe(true);
    expect(createPayrollPeriodSchema.safeParse({ periodMonth: "2026-12" }).success).toBe(true);
    expect(createPayrollPeriodSchema.safeParse({ periodMonth: "2026-13" }).success).toBe(false);
    expect(createPayrollPeriodSchema.safeParse({ periodMonth: "2026-00" }).success).toBe(false);
    expect(createPayrollPeriodSchema.safeParse({ periodMonth: "2026-1" }).success).toBe(false);
  });

  it("reject BẮT BUỘC comment (SPEC-11 §13.1) — chuỗi khoảng trắng cũng bị chặn", () => {
    expect(rejectPayrollPeriodSchema.safeParse({ reason: "Sai số công tháng 1" }).success).toBe(
      true,
    );
    expect(rejectPayrollPeriodSchema.safeParse({}).success).toBe(false);
    expect(rejectPayrollPeriodSchema.safeParse({ reason: "   " }).success).toBe(false);
  });
});

describe("route GHI không chở tiền — cặp view-line tách khỏi cặp calculate (SPEC-11 §11.1)", () => {
  it("envelope chỉ có {id,status,affectedLines,warnings} — thêm khoá tiền là đường đọc CỬA SAU", () => {
    const r = payrollWriteResultSchema.safeParse({
      id: UUID_A,
      status: "Calculated",
      affectedLines: 12,
      warnings: [],
    });
    expect(r.success).toBe(true);
    // Ghim tập khoá: nếu ai đó thêm `gross`/`net` vào envelope thì ca này ĐỎ.
    expect(Object.keys(payrollWriteResultSchema.shape).sort()).toEqual([
      "affectedLines",
      "id",
      "status",
      "warnings",
    ]);
  });
});

describe("adjust-line — mirror ĐÚNG BẰNG payroll_period_lines_adjustment_check", () => {
  it("ALLOW: adjustmentAmount = 0 KHÔNG cần lý do", () => {
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: 0 }).success).toBe(true);
  });

  it("ALLOW: khác 0 kèm lý do — cả dấu DƯƠNG (truy lĩnh) lẫn ÂM (truy thu)", () => {
    expect(
      adjustPayrollLineSchema.safeParse({
        adjustmentAmount: 500_000,
        adjustmentReason: "Truy lĩnh",
      }).success,
    ).toBe(true);
    // adjustment_amount CỐ Ý nằm ngoài CHECK amounts (>= 0) ⇒ Zod cấm số âm là CHẶT HƠN DB = chặn oan.
    expect(
      adjustPayrollLineSchema.safeParse({
        adjustmentAmount: -500_000,
        adjustmentReason: "Truy thu",
      }).success,
    ).toBe(true);
  });

  it("DENY: khác 0 mà thiếu lý do — để lọt là 23514 ở DB", () => {
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: 500_000 }).success).toBe(false);
  });
});

describe("bonus_penalties — reason NOT NULL + reject bắt buộc decisionNote", () => {
  const valid = {
    userId: UUID_B,
    kind: "penalty" as const,
    amount: 200_000,
    periodMonth: "2026-01",
    reason: "Đi trễ 5 lần",
  };

  it("ALLOW: payload đầy đủ", () => {
    expect(createBonusPenaltySchema.safeParse(valid).success).toBe(true);
  });

  it("DENY: amount <= 0 — mirror bonus_penalties_amount_check (kind tách dấu, không dùng số âm)", () => {
    expect(createBonusPenaltySchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
    expect(createBonusPenaltySchema.safeParse({ ...valid, amount: -1 }).success).toBe(false);
  });

  it("DENY: thiếu reason — 0564 đặt cột NOT NULL, để lọt là 23502", () => {
    const { reason: _drop, ...noReason } = valid;
    expect(createBonusPenaltySchema.safeParse(noReason).success).toBe(false);
    expect(createBonusPenaltySchema.safeParse({ ...valid, reason: "   " }).success).toBe(false);
  });

  it("reject BẮT BUỘC decisionNote — mirror bonus_penalties_reject_note_check", () => {
    expect(rejectBonusPenaltySchema.safeParse({ decisionNote: "Không hợp lệ" }).success).toBe(true);
    expect(rejectBonusPenaltySchema.safeParse({}).success).toBe(false);
  });
});

describe("payslips — append-only + trạng thái DẪN XUẤT", () => {
  const base = {
    id: UUID_A,
    companyId: UUID_A,
    payrollPeriodId: UUID_A,
    userId: UUID_B,
    salaryProfileId: null,
    status: "Published" as const,
    workDays: 22,
    presentDays: 20,
    paidLeaveDays: 1,
    unpaidLeaveDays: 1,
    lateMinutes: 30,
    createdBy: UUID_B,
    createdAt: "2026-02-01T00:00:00.000Z",
  };

  it("DTO KHÔNG có updatedAt/deletedAt — bảng append-only (bất biến #2)", () => {
    expect(Object.keys(payslipSchema.shape)).not.toContain("updatedAt");
    expect(Object.keys(payslipSchema.shape)).not.toContain("deletedAt");
  });

  it("status là DẪN XUẤT và CHO PHÉP null — nhánh fail-closed mặc định (SPEC-11 §13.2)", () => {
    expect(payslipSchema.safeParse({ ...base, status: null }).success).toBe(true);
    expect(payslipSchema.safeParse({ ...base, status: "Acknowledged" }).success).toBe(true);
    expect(payslipSchema.safeParse({ ...base, status: "Voided" }).success).toBe(false);
  });

  it("mọi trường tiền VẮNG KHOÁ khi bị mask; adjustmentAmount vẫn nhận số ÂM", () => {
    // Bản mask hoàn toàn (caller không giữ cặp chở-tiền) — đây là hình dạng THẬT server trả.
    expect(payslipSchema.safeParse(base).success).toBe(true);
    // Bản đầy đủ — kẻo ca trên xanh-rỗng.
    expect(
      payslipSchema.safeParse({
        ...base,
        baseSalary: 15_000_000,
        totalAllowances: 730_000,
        bonusAmount: 0,
        penaltyAmount: 200_000,
        deductionAmount: 500_000,
        adjustmentAmount: -300_000,
        gross: 15_730_000,
        net: 14_730_000,
      }).success,
    ).toBe(true);
    // gross/net âm bị chặn (mirror payslips_amounts_check), nhưng adjustmentAmount âm thì KHÔNG.
    expect(payslipSchema.safeParse({ ...base, net: -1 }).success).toBe(false);
  });
});
