import { describe, expect, it } from "vitest";
import {
  createSalaryProfileSchema,
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
