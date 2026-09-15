import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  bankAccountLast4,
  isLegacyPaidTrail,
  toPaymentBatchDto,
  toPaymentLineDto,
  toPayrollAdvanceDto,
  toPayrollBudgetDto,
} from "./payroll-disbursement.mapper";
import type { PayrollActor } from "./payroll.types";

/**
 * S15-PAYROLL-BE-4 — mapper track C (plan §6.1.4). Ba điều chỉ chứng minh được ở tầng thuần:
 *  1. `bankAccountLast4` DẪN XUẤT từ SNAPSHOT (không phải settings hiện tại): NULL ⇒ null · chuỗi ngắn hơn 4 ⇒
 *     nguyên chuỗi · dài ⇒ 4 ký tự cuối. DTO dòng chi **KHÔNG BAO GIỜ** có khoá `bankAccountSnapshot`/`bankAccountNumber`.
 *  2. `legacyPaidTrail` (DB-2 LOW-2, O-1 lối A): kỳ `Locked` di sản có `paid_* := published_*` ⇒ true; kỳ v2 chi thật
 *     (paid_at ≠ published_at hoặc paid_by ≠ published_by) ⇒ false; chưa chi ⇒ false.
 *  3. Mask = VẮNG KHOÁ: `canSeeMoney=false` ⇒ `amount`/`net`/`totalNet`/`plannedAmount` vắng (không null, không 0).
 */

const actor = (canSeeMoney: boolean): PayrollActor => ({
  actorUserId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  routeKey: "batchLines",
  routeScope: "Company",
  peopleVisibleCond: sql`true`,
  canSeeMoney,
});

const T0 = new Date("2028-06-30T10:00:00.000Z");
const T1 = new Date("2028-07-05T09:00:00.000Z");
const U1 = "33333333-3333-4333-8333-333333333333";
const U2 = "44444444-4444-4444-8444-444444444444";

describe("S15-PAYROLL-BE-4 · bankAccountLast4 — dẫn xuất từ snapshot", () => {
  it.each([
    [null, null],
    [undefined, null],
    ["", null],
    ["123", "123"],
    ["1234", "1234"],
    ["0123456789", "6789"],
  ])("%j ⇒ %j", (input, expected) => {
    expect(bankAccountLast4(input as string | null | undefined)).toBe(expected);
  });
});

describe("S15-PAYROLL-BE-4 · isLegacyPaidTrail — kỳ Locked di sản (O-1 lối A)", () => {
  it("paid_* = published_* (cùng mốc, cùng người) ⇒ true", () => {
    expect(isLegacyPaidTrail({ paidAt: T0, paidBy: U1, publishedAt: T0, publishedBy: U1 })).toBe(
      true,
    );
    // Cùng mốc nhưng đến từ chuỗi ISO (hàng đọc thô) ⇒ vẫn true.
    expect(
      isLegacyPaidTrail({
        paidAt: T0.toISOString(),
        paidBy: U1,
        publishedAt: T0,
        publishedBy: U1,
      }),
    ).toBe(true);
  });

  it("khác mốc (chi thật sau phát hành) ⇒ false", () => {
    expect(isLegacyPaidTrail({ paidAt: T1, paidBy: U1, publishedAt: T0, publishedBy: U1 })).toBe(
      false,
    );
  });

  it("cùng mốc nhưng khác người ⇒ false", () => {
    expect(isLegacyPaidTrail({ paidAt: T0, paidBy: U2, publishedAt: T0, publishedBy: U1 })).toBe(
      false,
    );
  });

  it("chưa chi (paid_* NULL) ⇒ false, kể cả khi published_* cũng NULL", () => {
    expect(
      isLegacyPaidTrail({ paidAt: null, paidBy: null, publishedAt: T0, publishedBy: U1 }),
    ).toBe(false);
    expect(
      isLegacyPaidTrail({ paidAt: null, paidBy: null, publishedAt: null, publishedBy: null }),
    ).toBe(false);
  });
});

describe("S15-PAYROLL-BE-4 · DTO track C — mask = VẮNG KHOÁ, không lộ snapshot TK", () => {
  const advanceRow = {
    id: "55555555-5555-4555-8555-555555555555",
    companyId: actor(true).companyId,
    userId: U1,
    amount: "2500000.00",
    deductPeriodMonth: "2028-07",
    reason: "ứng lương",
    status: "Pending",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    payrollPeriodId: null,
    consumedAt: null,
    createdAt: T0,
    createdBy: U2,
    updatedAt: T0,
    updatedBy: U2,
    deletedAt: null,
    deletedBy: null,
  };

  it("toPayrollAdvanceDto — amount là SỐ khi thấy tiền; VẮNG KHOÁ khi không", () => {
    const seen = toPayrollAdvanceDto(advanceRow, actor(true));
    expect(seen.amount).toBe(2500000);
    expect(seen.createdAt).toBe(T0.toISOString());
    const masked = toPayrollAdvanceDto(advanceRow, actor(false));
    expect("amount" in masked).toBe(false);
  });

  it("toPaymentLineDto — chỉ `bankAccountLast4`; KHÔNG khoá nào chứa số TK đầy đủ; net theo cổng tiền", () => {
    const row = {
      id: "66666666-6666-4666-8666-666666666666",
      companyId: actor(true).companyId,
      batchId: "77777777-7777-4777-8777-777777777777",
      userId: U1,
      payslipId: "88888888-8888-4888-8888-888888888888",
      bankAccountSnapshot: "0123456789",
      bankNameSnapshot: "VCB",
      accountHolderSnapshot: "NGUYEN VAN A",
      paidAt: null,
      createdAt: T0,
      createdBy: U2,
      updatedAt: T0,
      updatedBy: U2,
      deletedAt: null,
      deletedBy: null,
      net: "12345678.00",
    };
    const person = { userId: U1, displayName: "Nguyễn Văn A", employeeCode: "NV001" };
    const dto = toPaymentLineDto(row, person, actor(true));
    expect(dto.bankAccountLast4).toBe("6789");
    expect(dto.bankName).toBe("VCB");
    expect(dto.accountHolder).toBe("NGUYEN VAN A");
    expect(dto.fullName).toBe("Nguyễn Văn A");
    expect(dto.employeeCode).toBe("NV001");
    expect(dto.net).toBe(12345678);
    expect(JSON.stringify(dto)).not.toContain("0123456789");
    expect(Object.keys(dto)).not.toContain("bankAccountSnapshot");
    expect(Object.keys(dto)).not.toContain("bankAccountNumber");
    const masked = toPaymentLineDto(row, undefined, actor(false));
    expect("net" in masked).toBe(false);
    expect(masked.fullName).toBeNull();
    expect(masked.employeeCode).toBeNull();
  });

  it("toPaymentBatchDto — lineCount/paidLineCount là số ĐẾM (luôn có); totalNet theo cổng tiền", () => {
    const row = {
      id: "77777777-7777-4777-8777-777777777777",
      companyId: actor(true).companyId,
      payrollPeriodId: "99999999-9999-4999-8999-999999999999",
      code: "CT-202806-BANK-ABCD1234",
      method: "bank",
      status: "Draft",
      payDate: "2028-07-10",
      completedBy: null,
      completedAt: null,
      note: null,
      createdAt: T0,
      createdBy: U2,
      updatedAt: T0,
      updatedBy: U2,
      deletedAt: null,
      deletedBy: null,
      periodMonth: "2028-06",
      lineCount: 8,
      paidLineCount: 3,
      totalNet: "99000000.00",
    };
    const dto = toPaymentBatchDto(row, actor(true));
    expect(dto.lineCount).toBe(8);
    expect(dto.paidLineCount).toBe(3);
    expect(dto.totalNet).toBe(99000000);
    expect(dto.payDate).toBe("2028-07-10");
    expect(dto.periodMonth).toBe("2028-06");
    const masked = toPaymentBatchDto(row, actor(false));
    expect("totalNet" in masked).toBe(false);
    expect(masked.lineCount).toBe(8);
  });

  it("toPayrollBudgetDto — variance = planned − actual, cả ba theo cổng tiền", () => {
    const row = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: actor(true).companyId,
      fiscalYear: 2028,
      orgUnitId: null,
      plannedAmount: "1000000000.00",
      note: null,
      createdAt: T0,
      createdBy: U2,
      updatedAt: T0,
      updatedBy: U2,
      deletedAt: null,
      deletedBy: null,
      orgUnitName: null,
      actualAmount: "250000000.50",
    };
    const dto = toPayrollBudgetDto(row, actor(true));
    expect(dto.plannedAmount).toBe(1000000000);
    expect(dto.actualAmount).toBe(250000000.5);
    expect(dto.variance).toBe(749999999.5);
    expect(dto.orgUnitId).toBeNull();
    const masked = toPayrollBudgetDto(row, actor(false));
    expect("plannedAmount" in masked).toBe(false);
    expect("actualAmount" in masked).toBe(false);
    expect("variance" in masked).toBe(false);
    expect(masked.fiscalYear).toBe(2028);
  });
});
