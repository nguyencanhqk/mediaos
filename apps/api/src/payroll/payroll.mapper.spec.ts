import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { BonusPenalty, PayrollPeriod, SalaryProfile } from "../db/schema/payroll";
import {
  derivePayslipStatus,
  toBonusPenaltyDto,
  toPayrollLineDto,
  toPayrollPeriodDto,
  toPayrollSummaryDto,
  toPayslipDetailDto,
  toPayslipDto,
  toPayslipItemDto,
  toSalaryProfileDto,
} from "./payroll.mapper";
import type { PayrollActor } from "./payroll.types";

/**
 * S13-PAYROLL-BE-1 — MASK Ở SERVER (SPEC-11 §18, PAY-DEC-006 Phương án B).
 *
 * ⚠️ Assert bằng **`"key" in dto === false`**, KHÔNG bằng `dto.key === undefined`. Hai điều khác
 * nhau: một object có khoá mang giá trị `undefined` VẪN "có khoá", và một bản mapper ghi
 * `baseSalary: undefined` sẽ làm ca `=== undefined` xanh trong khi `JSON.stringify` vẫn khác nhau và
 * FE khai `.optional()` vẫn nhận được tín hiệu "trường này tồn tại".
 *
 * ⚠️ Mỗi ca DENY (vắng khoá) đi CẶP với ca ALLOW (có khoá) — thiếu vế ALLOW thì một mapper luôn-mask
 * cũng làm ca DENY xanh (`deny-cases-vacuous-without-allow-case`).
 */

const actor = (canSeeMoney: boolean): PayrollActor => ({
  actorUserId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  routeKey: canSeeMoney ? "salaryProfileList" : "periodList",
  routeScope: "Company",
  peopleVisibleCond: sql`true`,
  canSeeMoney,
});

const salaryRow = {
  id: "33333333-3333-4333-8333-333333333333",
  companyId: "22222222-2222-4222-8222-222222222222",
  userId: "44444444-4444-4444-8444-444444444444",
  effectiveDate: "2026-09-01",
  baseSalary: "15000000.00",
  allowances: [{ name: "Ăn trưa", amount: 730000 }],
  note: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  createdBy: null,
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  updatedBy: null,
  deletedAt: null,
  deletedBy: null,
} as unknown as SalaryProfile;

const bonusRow = {
  id: "55555555-5555-4555-8555-555555555555",
  companyId: "22222222-2222-4222-8222-222222222222",
  userId: "44444444-4444-4444-8444-444444444444",
  kind: "bonus",
  amount: "500000.00",
  periodMonth: "2026-09",
  reason: "Thưởng dự án",
  status: "Pending",
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  payrollPeriodId: null,
  consumedAt: null,
  createdBy: "11111111-1111-4111-8111-111111111111",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedBy: null,
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  deletedBy: null,
  deletedAt: null,
} as unknown as BonusPenalty;

const periodRow = {
  id: "66666666-6666-4666-8666-666666666666",
  companyId: "22222222-2222-4222-8222-222222222222",
  periodMonth: "2026-09",
  status: "Draft",
  payDate: null,
  attendancePeriodId: null,
  note: null,
  reopenReason: null,
  createdBy: null,
  updatedBy: null,
  calculatedBy: null,
  calculatedAt: null,
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  publishedBy: null,
  publishedAt: null,
  lockedBy: null,
  lockedAt: null,
  payslipsGeneratedBy: null,
  payslipsGeneratedAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  deletedAt: null,
} as unknown as PayrollPeriod;

const MONEY_KEYS_SALARY = ["baseSalary", "allowances"] as const;

describe("S13-PAYROLL-BE-1 · masking ở server = VẮNG KHOÁ", () => {
  it("hồ sơ lương — có cặp chở-tiền ⇒ CÓ khoá (ALLOW đối chứng)", () => {
    const dto = toSalaryProfileDto(salaryRow, actor(true));
    for (const k of MONEY_KEYS_SALARY) expect(k in dto, k).toBe(true);
    expect(dto.baseSalary).toBe(15_000_000);
    expect(dto.allowances).toEqual([{ name: "Ăn trưa", amount: 730000 }]);
  });

  it("hồ sơ lương — không có cặp ⇒ VẮNG khoá (không null, không 0)", () => {
    const dto = toSalaryProfileDto(salaryRow, actor(false));
    for (const k of MONEY_KEYS_SALARY) expect(k in dto, k).toBe(false);
    // Vế mạnh hơn: chuỗi JSON không được chứa tên trường tiền nào.
    const json = JSON.stringify(dto);
    for (const k of MONEY_KEYS_SALARY) expect(json).not.toContain(k);
    // Trường không nhạy cảm vẫn còn — mask không được "cắt cả DTO".
    expect(dto.userId).toBe(salaryRow.userId);
    expect(dto.effectiveDate).toBe("2026-09-01");
  });

  it("thưởng/phạt — `amount` theo cùng luật (ALLOW ⇔ DENY)", () => {
    expect("amount" in toBonusPenaltyDto(bonusRow, actor(true))).toBe(true);
    expect(toBonusPenaltyDto(bonusRow, actor(true)).amount).toBe(500_000);

    const masked = toBonusPenaltyDto(bonusRow, actor(false));
    expect("amount" in masked).toBe(false);
    expect(JSON.stringify(masked)).not.toContain("amount");
    // `reason`/`kind` KHÔNG phải số tiền ⇒ vẫn trả (màn duyệt cần đọc lý do).
    expect(masked.reason).toBe("Thưởng dự án");
    expect(masked.kind).toBe("bonus");
  });

  it("DTO kỳ lương KHÔNG có khoá tiền nào — kể cả tổng (SPEC-11 §11.1)", () => {
    const dto = toPayrollPeriodDto(periodRow);
    const json = JSON.stringify(dto);
    for (const k of ["gross", "net", "totalGross", "totalNet", "amount", "baseSalary"]) {
      expect(k in (dto as Record<string, unknown>), k).toBe(false);
      expect(json, k).not.toContain(k);
    }
    // Vết duyệt KHÔNG phải số tiền ⇒ vẫn trả (màn chi tiết kỳ cần hiện ai duyệt lúc nào).
    expect("approvedBy" in dto).toBe(true);
    expect("payslipsGeneratedAt" in dto).toBe(true);
  });

  it("`numeric` của pg là CHUỖI — mapper phải chuyển ở đúng biên DTO", () => {
    const dto = toSalaryProfileDto(salaryRow, actor(true));
    expect(typeof dto.baseSalary).toBe("number");
    expect(typeof salaryRow.baseSalary).toBe("string");
  });
});
// ════════════════════════════════════════════════════════════════════════════════════════════════
// S13-PAYROLL-BE-2 — dòng bảng lương · phiếu lương · breakdown · tổng kỳ · trạng thái DẪN XUẤT
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Actor của route BE-2. **Mọi route BE-2 đều chở tiền** nên `canSeeMoney` luôn `true`; vế `false` chỉ
 * dùng để chứng minh `assertMoneyRoute` NÉM (fail-closed) thay vì trả DTO rỗng khoá tiền im lặng.
 */
const be2Actor = (canSeeMoney: boolean): PayrollActor => ({
  actorUserId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  routeKey: "periodLines",
  routeScope: "Company",
  peopleVisibleCond: sql`true`,
  canSeeMoney,
});

const lineRow = {
  id: "66666666-6666-4666-8666-666666666666",
  payroll_period_id: "77777777-7777-4777-8777-777777777777",
  user_id: "44444444-4444-4444-8444-444444444444",
  salary_profile_id: "33333333-3333-4333-8333-333333333333",
  work_days: "22.00",
  present_days: "18.50",
  paid_leave_days: "1.50",
  unpaid_leave_days: "2.00",
  late_minutes: 35,
  base_amount: "20000000.00",
  allowance_amount: "1000000.00",
  bonus_amount: "0.00",
  penalty_amount: "0.00",
  deduction_amount: "2000000.00",
  adjustment_amount: "-100000.00",
  adjustment_reason: "truy thu tạm ứng",
  gross: "21000000.00",
  net: "18900000.00",
  created_at: new Date("2028-07-01T00:00:00Z"),
  updated_at: new Date("2028-07-01T00:00:00Z"),
};

const payslipRow = {
  id: "88888888-8888-4888-8888-888888888888",
  company_id: "22222222-2222-4222-8222-222222222222",
  payroll_period_id: "77777777-7777-4777-8777-777777777777",
  user_id: "44444444-4444-4444-8444-444444444444",
  salary_profile_id: "33333333-3333-4333-8333-333333333333",
  base_salary: "20000000.00",
  total_allowances: "1000000.00",
  bonus_amount: "0.00",
  penalty_amount: "0.00",
  deduction_amount: "2000000.00",
  adjustment_amount: "-100000.00",
  gross: "21000000.00",
  net: "18900000.00",
  work_days: "22.00",
  present_days: "18.50",
  paid_leave_days: "1.50",
  unpaid_leave_days: "2.00",
  late_minutes: 35,
  created_by: "11111111-1111-4111-8111-111111111111",
  created_at: new Date("2028-07-01T00:00:00Z"),
  period_status: "Paid",
  acknowledged_at: null,
};

const itemRow = {
  id: "99999999-9999-4999-8999-999999999999",
  payslip_id: "88888888-8888-4888-8888-888888888888",
  item_type: "earning",
  label: "Lương cơ bản (theo ngày công)",
  amount: "20000000.00",
  sort_order: 10,
  meta: { rate: "1000000" },
  created_at: new Date("2028-07-01T00:00:00Z"),
};

const summaryRow = {
  payroll_period_id: "77777777-7777-4777-8777-777777777777",
  period_month: "2028-06",
  status: "Paid",
  headcount: 42,
  total_gross: "512400000.00",
  total_net: "486180000.00",
};

const MONEY_KEYS_LINE = [
  "baseAmount",
  "allowanceAmount",
  "bonusAmount",
  "penaltyAmount",
  "deductionAmount",
  "adjustmentAmount",
  "adjustmentReason",
  "gross",
  "net",
] as const;

describe("S13-PAYROLL-BE-2 · assertMoneyRoute — fail-closed, không trả DTO rỗng khoá tiền", () => {
  it("route chở tiền mà `canSeeMoney = false` ⇒ NÉM (không im lặng)", () => {
    // Nhánh strip của `when()` trên route BE-2 là code không cổng nào chạm. Nếu một WO sau vô tình
    // đưa `periodLines` vào MONEY_FREE_ROUTES, mapper sẽ lặng lẽ trả bảng lương TRẮNG. Ca này biến
    // sai-cấu-hình thành lỗi ồn.
    expect(() => toPayrollLineDto(lineRow, be2Actor(false))).toThrow(/CHỞ TIỀN/);
    expect(() => toPayslipDto(payslipRow, be2Actor(false))).toThrow(/CHỞ TIỀN/);
    expect(() => toPayslipItemDto(itemRow, be2Actor(false))).toThrow(/CHỞ TIỀN/);
    expect(() => toPayrollSummaryDto(summaryRow, be2Actor(false))).toThrow(/CHỞ TIỀN/);
  });

  it("ĐỐI CHỨNG ALLOW: `canSeeMoney = true` ⇒ KHÔNG ném, và CÓ ĐỦ khoá tiền", () => {
    const dto = toPayrollLineDto(lineRow, be2Actor(true));
    for (const k of MONEY_KEYS_LINE) {
      expect(k in dto, `thiếu khoá tiền ${k} ở nhánh ALLOW`).toBe(true);
    }
  });
});

describe("S13-PAYROLL-BE-2 · mapper dòng bảng lương / phiếu lương", () => {
  it("dòng: `numeric` chuỗi → number ở ĐÚNG biên DTO; 5 đại lượng NGÀY luôn có mặt", () => {
    const dto = toPayrollLineDto(lineRow, be2Actor(true));
    expect(dto.baseAmount).toBe(20_000_000);
    expect(dto.net).toBe(18_900_000);
    // `adjustmentAmount` CÓ DẤU — mirror: nó cố ý nằm NGOÀI `payroll_period_lines_amounts_check`.
    expect(dto.adjustmentAmount).toBe(-100_000);
    // Ngày công không phải tiền ⇒ không bao giờ bị mask; thập phân nửa ngày giữ nguyên (BE-1B).
    expect(dto.presentDays).toBe(18.5);
    expect(dto.paidLeaveDays).toBe(1.5);
    expect(dto.lateMinutes).toBe(35);
  });

  it("tổng kỳ: `totalGross`/`totalNet` là **number**, KHÔNG chuỗi (đảo API-18 §6.3 — plan D2)", () => {
    const dto = toPayrollSummaryDto(summaryRow, be2Actor(true));
    expect(typeof dto.totalGross).toBe("number");
    expect(dto.totalGross).toBe(512_400_000);
    expect(dto.totalNet).toBe(486_180_000);
    expect(dto.headcount).toBe(42);
  });

  it("dòng breakdown: `meta` đi CÙNG CỔNG MASK với `amount` (jsonb tự do cạnh trường tiền)", () => {
    const shown = toPayslipItemDto(itemRow, be2Actor(true));
    expect(shown.amount).toBe(20_000_000);
    expect("meta" in shown).toBe(true);
    // Vế mask không có ca ALLOW/DENY qua HTTP (mọi route BE-2 chở tiền) nên đối chứng nằm ở
    // `assertMoneyRoute` phía trên: cấu hình sai KHÔNG được biến thành DTO nửa vời.
  });

  it("chi tiết phiếu = phiếu + items + `acknowledgedAt`", () => {
    const dto = toPayslipDetailDto(payslipRow, [itemRow], be2Actor(true));
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0].itemType).toBe("earning");
    expect(dto.acknowledgedAt).toBeNull();
  });
});

describe("S13-PAYROLL-BE-2 · derivePayslipStatus — DẪN XUẤT, fail-closed", () => {
  it.each([
    ["Paid", null, "Published"],
    ["Locked", null, "Published"],
    ["Paid", new Date("2028-07-02T00:00:00Z"), "Acknowledged"],
    ["Locked", new Date("2028-07-02T00:00:00Z"), "Acknowledged"],
    ["Draft", null, "Generated"],
    ["CollectingData", null, "Generated"],
    ["Calculated", null, "Generated"],
    ["Reviewing", null, "Generated"],
    ["Approved", null, "Generated"],
  ])("kỳ %s + ack=%s ⇒ %s", (periodStatus, ack, expected) => {
    expect(derivePayslipStatus(periodStatus as string, ack as Date | null)).toBe(expected);
  });

  it("trạng thái kỳ NGOÀI phổ ⇒ `null` (fail-closed), KHÔNG đoán là `Published`", () => {
    // Đoán sai chiều đó là nói với nhân viên rằng phiếu đã phát hành trong khi chưa.
    expect(derivePayslipStatus("SomethingNew", null)).toBeNull();
    expect(derivePayslipStatus("", new Date())).toBeNull();
  });

  it("ĐỐI CHỨNG: ack CHỈ nâng trạng thái khi kỳ đã phát hành", () => {
    // Hàng ack không thể tồn tại khi kỳ chưa phát hành (route 033 chặn), nhưng nếu dữ liệu di sản có,
    // trạng thái vẫn phải là `Generated` — sự tồn tại của ack KHÔNG được tự nó nghĩa là đã phát hành.
    expect(derivePayslipStatus("Approved", new Date())).toBe("Generated");
  });
});
