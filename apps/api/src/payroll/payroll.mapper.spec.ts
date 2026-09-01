import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { BonusPenalty, PayrollPeriod, SalaryProfile } from "../db/schema/payroll";
import { toBonusPenaltyDto, toPayrollPeriodDto, toSalaryProfileDto } from "./payroll.mapper";
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
