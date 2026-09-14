import { describe, expect, it } from "vitest";
import {
  createPayrollTemplateSchema,
  createSalaryComponentSchema,
  createStatutoryRateSchema,
  PAYROLL_SYS_REFS,
  payrollTemplatePreviewSchema,
  putPayrollTemplateComponentsSchema,
  salaryComponentInputKindEnum,
  salaryComponentInputValueTypeEnum,
  salaryComponentListQuerySchema,
  updateSalaryComponentSchema,
  updateStatutoryRateSchema,
  validateFormulaSchema,
} from "./payroll-catalog";

/**
 * S15-PAYROLL-BE-2 — contracts track B. Hai nhóm ca:
 *  (1) MIRROR CHECK hai chiều (enum loại `aggregate`/`engine` · pct 0..100 · cặp valueType · cặp scope);
 *  (2) 🔴 CHỐNG MÃ CHẾT — Zod KHÔNG được chặn thứ mà service trả mã riêng: công thức 501+ ký tự (018) ·
 *      6/8 bậc TNCN (022) · mã `SYS_*` (024) · 121 thành phần (018). Ca (2) đỏ = ai đó thêm cap bằng nhau.
 */

const RATE = {
  effectiveFrom: "2026-01-01",
  siEmployeePct: 8,
  hiEmployeePct: 1.5,
  uiEmployeePct: 1,
  siEmployerPct: 17.5,
  hiEmployerPct: 3,
  uiEmployerPct: 1,
  unionEmployerPct: 2,
  unionEmployeePct: 1,
  siCap: 46800000,
  hiCap: 46800000,
  uiCap: 99200000,
  baseWage: 2340000,
  minRegionWage: 4960000,
  personalDeduction: 11000000,
  dependentDeduction: 4400000,
  pitBrackets: [
    { upTo: 5000000, rate: 5 },
    { upTo: null, rate: 35 },
  ],
};

const UUID = "11111111-1111-4111-8111-111111111111";

describe("S15-PAYROLL-BE-2 · contracts payroll-catalog", () => {
  describe("mirror CHECK", () => {
    it("enum nhập loại đúng `aggregate` và `engine` (chỉ seeder tạo được)", () => {
      expect(salaryComponentInputKindEnum.options).not.toContain("aggregate");
      expect(salaryComponentInputKindEnum.options).toHaveLength(6);
      expect(salaryComponentInputValueTypeEnum.options).toEqual(["formula", "fixed", "profile_item"]);
    });

    it("cặp valueType ↔ formula/fixedAmount ở payload tạo mới", () => {
      const base = { code: "AN_CA", name: "Ăn ca", kind: "tax_exempt" };
      expect(createSalaryComponentSchema.safeParse({ ...base, valueType: "fixed", fixedAmount: 730000 }).success).toBe(true);
      expect(createSalaryComponentSchema.safeParse({ ...base, valueType: "fixed", formula: "1" }).success).toBe(false);
      expect(createSalaryComponentSchema.safeParse({ ...base, valueType: "formula", formula: "SYS_BASE_SALARY" }).success).toBe(true);
      expect(createSalaryComponentSchema.safeParse({ ...base, valueType: "formula", formula: "1", fixedAmount: 1 }).success).toBe(false);
      expect(createSalaryComponentSchema.safeParse({ ...base, valueType: "profile_item" }).success).toBe(true);
      expect(createSalaryComponentSchema.safeParse({ ...base, valueType: "engine" }).success).toBe(false);
    });

    it("tỉ lệ 0..100 bước 0,01 · trần/lương cơ sở > 0", () => {
      expect(createStatutoryRateSchema.safeParse(RATE).success).toBe(true);
      expect(createStatutoryRateSchema.safeParse({ ...RATE, siEmployeePct: 100.01 }).success).toBe(false);
      expect(createStatutoryRateSchema.safeParse({ ...RATE, siEmployeePct: 8.005 }).success).toBe(false);
      expect(createStatutoryRateSchema.safeParse({ ...RATE, siCap: 0 }).success).toBe(false);
      expect(createStatutoryRateSchema.safeParse({ ...RATE, personalDeduction: 0 }).success).toBe(true);
    });

    it("cặp scope ↔ orgUnitId ở payload tạo mẫu", () => {
      expect(createPayrollTemplateSchema.safeParse({ code: "M1", name: "Mẫu", scope: "company" }).success).toBe(true);
      expect(createPayrollTemplateSchema.safeParse({ code: "M1", name: "Mẫu", scope: "org_unit" }).success).toBe(false);
      expect(createPayrollTemplateSchema.safeParse({ code: "M1", name: "Mẫu", orgUnitId: UUID }).success).toBe(false);
      expect(createPayrollTemplateSchema.safeParse({ code: "M1", name: "Mẫu", scope: "org_unit", orgUnitId: UUID }).success).toBe(true);
    });
  });

  describe("🔴 chống mã CHẾT — Zod không cap bằng service", () => {
    it("công thức 10.000 ký tự QUA Zod (parser trả 422 018 formula-too-long, không phải 400)", () => {
      const formula = "1" + " ".repeat(9999);
      expect(validateFormulaSchema.safeParse({ formula }).success).toBe(true);
      expect(
        createSalaryComponentSchema.safeParse({ code: "X", name: "X", kind: "earning", valueType: "formula", formula }).success,
      ).toBe(true);
    });

    it("mã mang tiền tố SYS_/TL_/GT_ QUA Zod (service trả 409 024 component-code-reserved)", () => {
      for (const code of ["SYS_GROSS", "TL_X", "GT_X", "TONG_KHAU_TRU", "MIN", "AND"]) {
        expect(
          createSalaryComponentSchema.safeParse({ code, name: "x", kind: "earning", valueType: "profile_item" }).success,
          code,
        ).toBe(true);
      }
      expect(createSalaryComponentSchema.safeParse({ code: "lowercase", name: "x", kind: "earning", valueType: "profile_item" }).success).toBe(false);
    });

    it("6 bậc và 8 bậc TNCN QUA Zod (service trả 422 022 statutory-rate-incomplete)", () => {
      const brackets = (n: number) => Array.from({ length: n }, (_, i) => ({ upTo: i === n - 1 ? null : (i + 1) * 1000000, rate: 5 }));
      expect(createStatutoryRateSchema.safeParse({ ...RATE, pitBrackets: brackets(6) }).success).toBe(true);
      expect(createStatutoryRateSchema.safeParse({ ...RATE, pitBrackets: brackets(8) }).success).toBe(true);
      expect(createStatutoryRateSchema.safeParse({ ...RATE, pitBrackets: brackets(51) }).success).toBe(false);
    });

    it("121 thành phần QUA Zod (service trả 422 018 template-too-many-components); 1001 bị chặn ở payload", () => {
      const list = (n: number) => ({ components: Array.from({ length: n }, () => ({ componentId: UUID })) });
      expect(putPayrollTemplateComponentsSchema.safeParse(list(121)).success).toBe(true);
      expect(putPayrollTemplateComponentsSchema.safeParse(list(1001)).success).toBe(false);
    });
  });

  describe("PATCH & query", () => {
    it("047 không cho đổi `code` (khoá lạ ⇒ 400) và đòi ít nhất một trường", () => {
      expect(updateSalaryComponentSchema.safeParse({ code: "NEW" }).success).toBe(false);
      expect(updateSalaryComponentSchema.safeParse({}).success).toBe(false);
      expect(updateSalaryComponentSchema.safeParse({ delete: true }).success).toBe(true);
      expect(updateSalaryComponentSchema.safeParse({ delete: false }).success).toBe(false);
    });

    it("058 PATCH từng phần hợp lệ, rỗng bị chặn", () => {
      expect(updateStatutoryRateSchema.safeParse({ note: "sửa ghi chú" }).success).toBe(true);
      expect(updateStatutoryRateSchema.safeParse({}).success).toBe(false);
    });

    it("query boolean: 'false' ⇒ false (z.coerce.boolean sẽ ra true) và idempotent khi pipe chạy lại", () => {
      const once = salaryComponentListQuerySchema.parse({ isSystem: "false", isActive: "true" });
      expect(once.isSystem).toBe(false);
      expect(once.isActive).toBe(true);
      expect(salaryComponentListQuerySchema.parse(once)).toEqual(once);
    });
  });

  describe("preview 054", () => {
    const statutory = { ...RATE } as Record<string, unknown>;
    delete statutory.effectiveFrom;
    delete statutory.baseWage;
    delete statutory.minRegionWage;

    it("SYS_* lạ bị chặn; thiếu khoá thì hợp lệ (mặc định 0 ở service)", () => {
      expect(payrollTemplatePreviewSchema.safeParse({ statutory, inputs: { SYS_BASE_SALARY: "20000000" } }).success).toBe(true);
      expect(payrollTemplatePreviewSchema.safeParse({ statutory, inputs: { SYS_GROSS: "1" } }).success).toBe(false);
      expect(payrollTemplatePreviewSchema.safeParse({ statutory }).success).toBe(true);
    });

    it("giá trị giả là CHUỖI thập phân — số thực bị chặn", () => {
      expect(payrollTemplatePreviewSchema.safeParse({ statutory, inputs: { SYS_BASE_SALARY: 20000000 } }).success).toBe(false);
      expect(payrollTemplatePreviewSchema.safeParse({ statutory, inputs: { SYS_BASE_SALARY: "1e7" } }).success).toBe(false);
    });

    it("danh sách SYS_* có đủ 15 biến gồm 3 biến BE-2 thêm", () => {
      expect(PAYROLL_SYS_REFS).toHaveLength(15);
      expect(PAYROLL_SYS_REFS).toEqual(expect.arrayContaining(["SYS_BONUS_AMOUNT", "SYS_PENALTY_AMOUNT", "SYS_ADVANCE_AMOUNT"]));
    });
  });
});
