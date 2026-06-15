import { describe, expect, it } from "vitest";
import {
  createPayrollPeriodSchema,
  createSalaryProfileSchema,
  payrollPeriodSchema,
  payslipItemSchema,
  payslipSchema,
  runPayrollRequestSchema,
  salaryProfileSchema,
  updateSalaryProfileSchema,
} from "./payroll";

/**
 * G12-1 — Zod contract RED suite cho salary profile (NGUỒN SỰ THẬT DTO).
 * Lương nhạy cảm (ADR-0010): DTO masked KHÔNG bao giờ có field secret/plaintext ngoài
 * baseSalary/allowances có kiểm soát (nullable khi masked).
 */

const validCreate = {
  userId: "22222222-2222-2222-2222-222222222222",
  salaryType: "monthly" as const,
  payCycle: "monthly" as const,
  effectiveDate: "2026-01-01",
  baseSalary: 5000,
  allowances: [{ name: "lunch", amount: 500 }],
};

describe("createSalaryProfileSchema", () => {
  it("accepts a valid create payload", () => {
    const r = createSalaryProfileSchema.safeParse(validCreate);
    expect(r.success).toBe(true);
  });

  it("rejects salaryType outside enum", () => {
    const r = createSalaryProfileSchema.safeParse({ ...validCreate, salaryType: "annual" });
    expect(r.success).toBe(false);
  });

  it("rejects payCycle outside enum", () => {
    const r = createSalaryProfileSchema.safeParse({ ...validCreate, payCycle: "quarterly" });
    expect(r.success).toBe(false);
  });

  it("rejects baseSalary <= 0", () => {
    expect(createSalaryProfileSchema.safeParse({ ...validCreate, baseSalary: 0 }).success).toBe(
      false,
    );
    expect(createSalaryProfileSchema.safeParse({ ...validCreate, baseSalary: -100 }).success).toBe(
      false,
    );
  });

  it("rejects non-ISO effectiveDate", () => {
    const r = createSalaryProfileSchema.safeParse({ ...validCreate, effectiveDate: "01/01/2026" });
    expect(r.success).toBe(false);
  });

  it("rejects an allowance with negative amount", () => {
    const r = createSalaryProfileSchema.safeParse({
      ...validCreate,
      allowances: [{ name: "bonus", amount: -1 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an allowance missing name", () => {
    const r = createSalaryProfileSchema.safeParse({
      ...validCreate,
      allowances: [{ amount: 100 }],
    });
    expect(r.success).toBe(false);
  });

  it("defaults allowances to [] when omitted", () => {
    const { allowances, ...noAllowances } = validCreate;
    const r = createSalaryProfileSchema.parse(noAllowances);
    expect(r.allowances).toEqual([]);
  });

  it("rejects a non-uuid userId", () => {
    const r = createSalaryProfileSchema.safeParse({ ...validCreate, userId: "not-a-uuid" });
    expect(r.success).toBe(false);
  });
});

describe("updateSalaryProfileSchema", () => {
  it("accepts a partial update", () => {
    expect(updateSalaryProfileSchema.safeParse({ baseSalary: 6000 }).success).toBe(true);
    expect(updateSalaryProfileSchema.safeParse({ status: "inactive" }).success).toBe(true);
  });

  it("rejects baseSalary <= 0 on update", () => {
    expect(updateSalaryProfileSchema.safeParse({ baseSalary: 0 }).success).toBe(false);
  });

  it("rejects status outside enum", () => {
    expect(updateSalaryProfileSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});

describe("salaryProfileSchema (masked DTO)", () => {
  it("allows baseSalary=null and allowances=null (masked for unauthorized role)", () => {
    const masked = {
      id: "11111111-1111-1111-1111-111111111111",
      companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      userId: "22222222-2222-2222-2222-222222222222",
      salaryType: "monthly" as const,
      payCycle: "monthly" as const,
      effectiveDate: "2026-01-01",
      baseSalary: null,
      allowances: null,
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(salaryProfileSchema.safeParse(masked).success).toBe(true);
  });

  it("does NOT permit unknown secret/plaintext fields to flow through (strips extras)", () => {
    const parsed = salaryProfileSchema.parse({
      id: "11111111-1111-1111-1111-111111111111",
      companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      userId: "22222222-2222-2222-2222-222222222222",
      salaryType: "monthly",
      payCycle: "monthly",
      effectiveDate: "2026-01-01",
      baseSalary: 5000,
      allowances: [{ name: "lunch", amount: 500 }],
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      secretPlaintext: "should-be-stripped",
    });
    expect((parsed as Record<string, unknown>).secretPlaintext).toBeUndefined();
  });
});

// ── G12-2 payroll period + payslip snapshot ────────────────────────────────────

describe("createPayrollPeriodSchema", () => {
  it("accepts a valid period_month YYYY-MM", () => {
    expect(createPayrollPeriodSchema.safeParse({ periodMonth: "2026-01" }).success).toBe(true);
  });

  it("accepts an optional attendancePeriodId", () => {
    const r = createPayrollPeriodSchema.safeParse({
      periodMonth: "2026-12",
      attendancePeriodId: "33333333-3333-3333-3333-333333333333",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a malformed period_month", () => {
    expect(createPayrollPeriodSchema.safeParse({ periodMonth: "2026-13" }).success).toBe(false);
    expect(createPayrollPeriodSchema.safeParse({ periodMonth: "26-01" }).success).toBe(false);
    expect(createPayrollPeriodSchema.safeParse({ periodMonth: "2026/01" }).success).toBe(false);
  });
});

describe("payrollPeriodSchema", () => {
  const valid = {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    periodMonth: "2026-01",
    status: "draft" as const,
    attendancePeriodId: null,
    kpiLocked: false,
    createdBy: null,
    approvedBy: null,
    approvedAt: null,
    publishedBy: null,
    publishedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a draft, approved and published period (G12-4 FSM)", () => {
    expect(payrollPeriodSchema.safeParse(valid).success).toBe(true);
    expect(
      payrollPeriodSchema.safeParse({
        ...valid,
        status: "approved",
        approvedBy: "22222222-2222-2222-2222-222222222222",
        approvedAt: "2026-01-31T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      payrollPeriodSchema.safeParse({
        ...valid,
        status: "published",
        approvedBy: "22222222-2222-2222-2222-222222222222",
        approvedAt: "2026-01-31T00:00:00.000Z",
        publishedBy: "33333333-3333-3333-3333-333333333333",
        publishedAt: "2026-02-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects a status outside draft/approved/published (e.g. retired 'locked')", () => {
    expect(payrollPeriodSchema.safeParse({ ...valid, status: "locked" }).success).toBe(false);
  });
});

describe("payslipSchema (snapshot, kpi/bonus/penalty nullable slots)", () => {
  const base = {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    payrollPeriodId: "44444444-4444-4444-4444-444444444444",
    userId: "22222222-2222-2222-2222-222222222222",
    salaryProfileId: null,
    baseSalary: 5000,
    totalAllowances: 500,
    gross: 5500,
    net: 5500,
    currency: "VND",
    workDays: 22,
    presentDays: 22,
    lateMinutes: 0,
    kpiAmount: null,
    bonusAmount: null,
    penaltyAmount: null,
    entryKind: "original" as const,
    replacesPayslipId: null,
    createdBy: "22222222-2222-2222-2222-222222222222",
    createdAt: "2026-01-31T00:00:00.000Z",
  };

  it("allows kpi/bonus/penalty = null (slot G8-4 not yet wired)", () => {
    expect(payslipSchema.safeParse(base).success).toBe(true);
  });

  it("allows an adjustment entry chained to a prior payslip", () => {
    const r = payslipSchema.safeParse({
      ...base,
      entryKind: "adjustment",
      replacesPayslipId: "55555555-5555-5555-5555-555555555555",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a payslip missing the company scope field", () => {
    const { companyId, ...noCompany } = base;
    expect(payslipSchema.safeParse(noCompany).success).toBe(false);
  });

  it("rejects an entryKind outside the enum", () => {
    expect(payslipSchema.safeParse({ ...base, entryKind: "deleted" }).success).toBe(false);
  });
});

describe("payslipItemSchema", () => {
  const base = {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    payslipId: "44444444-4444-4444-4444-444444444444",
    itemType: "earning" as const,
    label: "Base salary",
    amount: 5000,
    meta: null,
    createdAt: "2026-01-31T00:00:00.000Z",
  };

  it("accepts the kpi/bonus/penalty slot item types", () => {
    expect(payslipItemSchema.safeParse({ ...base, itemType: "kpi" }).success).toBe(true);
    expect(payslipItemSchema.safeParse({ ...base, itemType: "bonus" }).success).toBe(true);
    expect(payslipItemSchema.safeParse({ ...base, itemType: "penalty" }).success).toBe(true);
  });

  it("rejects an unknown itemType", () => {
    expect(payslipItemSchema.safeParse({ ...base, itemType: "tip" }).success).toBe(false);
  });
});

describe("runPayrollRequestSchema", () => {
  it("accepts a period id with no userIds (whole company)", () => {
    expect(
      runPayrollRequestSchema.safeParse({
        payrollPeriodId: "44444444-4444-4444-4444-444444444444",
      }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid payrollPeriodId", () => {
    expect(runPayrollRequestSchema.safeParse({ payrollPeriodId: "nope" }).success).toBe(false);
  });
});
