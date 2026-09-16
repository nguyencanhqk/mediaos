/**
 * S15-PAYROLL-FE-1 — luật parse/validate/build của form hồ sơ lương v2 (`salary-profile-form.ts`).
 * Mỗi luật trong docblock của module có ít nhất một ca ĐỎ-nếu-sai; ca «trống ≠ 0» và «không catalog ⇒ vắng
 * khoá items» là hai ca tiền — sai là máy tính lương đóng BH trên 0 đồng / audit ghi «0 khoản» do FE bịa.
 */
import { describe, expect, it } from "vitest";
import {
  buildSalaryProfilePayload,
  EMPTY_SALARY_PROFILE_FORM,
  parseMoneyInput,
  validateSalaryProfileForm,
  type SalaryProfileFormState,
} from "./salary-profile-form";

const USER = "11111111-2222-3333-4444-555555555555";

const valid = (over: Partial<SalaryProfileFormState> = {}): SalaryProfileFormState => ({
  ...EMPTY_SALARY_PROFILE_FORM,
  userId: USER,
  effectiveDate: "2026-10-01",
  baseSalary: "20000000",
  ...over,
});

describe("parseMoneyInput", () => {
  it("trống ⇒ null (KHÔNG phải 0)", () => {
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("   ")).toBeNull();
  });
  it("số ⇒ number; rác ⇒ NaN để caller báo lỗi, không nuốt", () => {
    expect(parseMoneyInput("1500000")).toBe(1_500_000);
    expect(Number.isNaN(parseMoneyInput("abc"))).toBe(true);
  });
});

describe("validateSalaryProfileForm — mirror CHECK", () => {
  it("[allow] form tối thiểu hợp lệ (mặc định GROSS · EMPLOYEE · 100%)", () => {
    const v = validateSalaryProfileForm(valid(), { catalogAvailable: true });
    expect(v.errors).toEqual([]);
    expect(v.badItemIndexes).toEqual([]);
  });

  it("[deny] baseSalary 0 / trống / âm ⇒ baseSalaryInvalid (CHECK salary_profile_base_positive_check)", () => {
    for (const baseSalary of ["0", "", "-5"]) {
      const v = validateSalaryProfileForm(valid({ baseSalary }), { catalogAvailable: true });
      expect(v.errors, baseSalary).toContain("salaryProfileForm.baseSalaryInvalid");
    }
  });

  it("[deny] payRatioPct ngoài (0, 100] ⇒ payRatioInvalid (CHECK salary_profiles_pay_ratio_check)", () => {
    for (const payRatioPct of ["0", "100.01", "", "-1"]) {
      const v = validateSalaryProfileForm(valid({ payRatioPct }), { catalogAvailable: true });
      expect(v.errors, payRatioPct).toContain("salaryProfileForm.payRatioInvalid");
    }
    expect(
      validateSalaryProfileForm(valid({ payRatioPct: "100" }), { catalogAvailable: true }).errors,
    ).toEqual([]);
  });

  it("[deny] lương BH / thử việc âm hoặc rác ⇒ moneyInvalid; trống thì HỢP LỆ", () => {
    expect(
      validateSalaryProfileForm(valid({ insuranceSalary: "-1" }), { catalogAvailable: true })
        .errors,
    ).toContain("salaryProfileForm.moneyInvalid");
    expect(
      validateSalaryProfileForm(valid({ probationSalary: "x" }), { catalogAvailable: true }).errors,
    ).toContain("salaryProfileForm.moneyInvalid");
    expect(
      validateSalaryProfileForm(valid({ insuranceSalary: "", probationSalary: "" }), {
        catalogAvailable: true,
      }).errors,
    ).toEqual([]);
  });

  it("[deny] items: thiếu mã / định mức âm ⇒ itemIncomplete + đúng chỉ số dòng", () => {
    const v = validateSalaryProfileForm(
      valid({
        items: [
          { componentCode: "PC_AN_TRUA", amount: "500000", isActive: true, note: "" },
          { componentCode: "", amount: "1", isActive: true, note: "" },
          { componentCode: "PC_XANG", amount: "-1", isActive: true, note: "" },
        ],
      }),
      { catalogAvailable: true },
    );
    expect(v.errors).toContain("salaryProfileForm.itemIncomplete");
    expect(v.badItemIndexes).toEqual([1, 2]);
  });

  it("[deny] items trùng mã ⇒ itemDuplicate, dòng thứ hai bị đánh dấu (409 014 profile-item-duplicate ở server)", () => {
    const v = validateSalaryProfileForm(
      valid({
        items: [
          { componentCode: "PC_AN_TRUA", amount: "500000", isActive: true, note: "" },
          { componentCode: "PC_AN_TRUA", amount: "600000", isActive: false, note: "" },
        ],
      }),
      { catalogAvailable: true },
    );
    expect(v.errors).toContain("salaryProfileForm.itemDuplicate");
    expect(v.badItemIndexes).toEqual([1]);
  });

  it("không catalog ⇒ items KHÔNG được kiểm (không có bảng thì không có gì để kiểm)", () => {
    const v = validateSalaryProfileForm(
      valid({ items: [{ componentCode: "", amount: "", isActive: true, note: "" }] }),
      { catalogAvailable: false },
    );
    expect(v.errors).toEqual([]);
  });
});

describe("buildSalaryProfilePayload", () => {
  it("trống ⇒ insuranceSalary/probationSalary = null (NULL = «dùng lương cơ bản»), KHÔNG phải 0", () => {
    const p = buildSalaryProfilePayload(valid(), { catalogAvailable: true });
    expect(p.insuranceSalary).toBeNull();
    expect(p.probationSalary).toBeNull();
    expect(p.baseSalary).toBe(20_000_000);
    expect(p.payRatioPct).toBe(100);
    expect(p.salaryType).toBe("GROSS");
    expect(p.pitPayer).toBe("EMPLOYEE");
    expect("note" in p).toBe(false);
  });

  it("số nhập ⇒ number; note/ghi chú dòng trim, trống thì VẮNG khoá", () => {
    const p = buildSalaryProfilePayload(
      valid({
        insuranceSalary: "18000000",
        probationSalary: "17000000",
        payRatioPct: "85",
        salaryType: "NET",
        pitPayer: "COMPANY",
        note: "  điều chỉnh  ",
        items: [{ componentCode: "PC_AN_TRUA", amount: "500000", isActive: false, note: "  " }],
      }),
      { catalogAvailable: true },
    );
    expect(p).toMatchObject({
      insuranceSalary: 18_000_000,
      probationSalary: 17_000_000,
      payRatioPct: 85,
      salaryType: "NET",
      pitPayer: "COMPANY",
      note: "điều chỉnh",
    });
    expect(p.items).toEqual([{ componentCode: "PC_AN_TRUA", amount: 500_000, isActive: false }]);
  });

  it("[deny] không catalog ⇒ payload VẮNG KHOÁ items (không gửi [] giả vờ «không phụ cấp»)", () => {
    const p = buildSalaryProfilePayload(
      valid({ items: [{ componentCode: "PC_AN_TRUA", amount: "1", isActive: true, note: "" }] }),
      { catalogAvailable: false },
    );
    expect("items" in p).toBe(false);
  });

  it("[allow đối chứng] có catalog ⇒ items CÓ MẶT kể cả khi rỗng (người dùng quyết «không khoản»)", () => {
    const p = buildSalaryProfilePayload(valid({ items: [] }), { catalogAvailable: true });
    expect(p.items).toEqual([]);
  });
});
