/**
 * S15-PAYROLL-FE-1 — luật parse/validate/build của form hồ sơ lương v2 (`salary-profile-form.ts`).
 * Mỗi luật trong docblock của module có ít nhất một ca ĐỎ-nếu-sai; ca «trống ≠ 0» và «không catalog ⇒ vắng
 * khoá items» là hai ca tiền — sai là máy tính lương đóng BH trên 0 đồng / audit ghi «0 khoản» do FE bịa.
 */
import { describe, expect, it } from "vitest";
import type { SalaryProfileDto } from "@mediaos/contracts";
import {
  buildSalaryProfilePayload,
  buildSalaryProfileUpdatePayload,
  isLegacyAllowanceProfile,
  EMPTY_SALARY_PROFILE_FORM,
  parseMoneyInput,
  salaryProfileFormFromDto,
  validateSalaryProfileEdit,
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

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// S15-PAYROLL-FE-5 — chế độ SỬA (PAYROLL-API-022). Ba hàm dưới đây là hàng rào chống mất tiền:
// payload sửa là DIFF, nên cái người dùng không đụng thì BE không chạm (plan §2 D3).
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const DTO = (over: Partial<SalaryProfileDto> = {}): SalaryProfileDto =>
  ({
    id: "prof-1",
    companyId: "co-1",
    userId: USER,
    effectiveDate: "2026-10-01",
    baseSalary: 20_000_000,
    allowances: [],
    salaryType: "GROSS",
    pitPayer: "EMPLOYEE",
    payRatioPct: 100,
    note: null,
    items: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  }) as SalaryProfileDto;

describe("salaryProfileFormFromDto", () => {
  it("trường VẮNG KHOÁ (server mask) ⇒ ô trống, KHÔNG phải «0»", () => {
    const form = salaryProfileFormFromDto(DTO({ baseSalary: undefined, payRatioPct: undefined }));
    expect(form.baseSalary).toBe("");
    expect(form.payRatioPct).toBe("");
  });

  it("null = «dùng lương cơ bản» / «không áp dụng» ⇒ cũng ra ô trống", () => {
    const form = salaryProfileFormFromDto(DTO());
    expect(form.insuranceSalary).toBe("");
    expect(form.probationSalary).toBe("");
    expect(form.note).toBe("");
  });

  it("items[] của DTO ⇒ dòng nháp; amount vắng khoá ⇒ ô trống", () => {
    const form = salaryProfileFormFromDto(
      DTO({
        items: [
          {
            id: "i1",
            componentCode: "PC_AN_TRUA",
            componentName: "Ăn trưa",
            kind: "earning",
            amount: 500_000,
            isActive: true,
            note: null,
          },
          {
            id: "i2",
            componentCode: "PC_XE",
            componentName: null,
            kind: null,
            isActive: false,
            note: "cũ",
          },
        ],
      } as Partial<SalaryProfileDto>),
    );
    expect(form.items).toEqual([
      { componentCode: "PC_AN_TRUA", amount: "500000", isActive: true, note: "" },
      { componentCode: "PC_XE", amount: "", isActive: false, note: "cũ" },
    ]);
  });
});

describe("buildSalaryProfileUpdatePayload — DIFF", () => {
  const initialOf = (over: Partial<SalaryProfileDto> = {}) => salaryProfileFormFromDto(DTO(over));

  it("không đổi gì ⇒ payload RỖNG (thân rỗng vẫn sinh hàng audit changedFields:[] ở BE)", () => {
    const init = initialOf();
    expect(
      buildSalaryProfileUpdatePayload(init, init, { catalogAvailable: true, itemsLocked: false }),
    ).toEqual({});
  });

  it("chỉ đổi ghi chú ⇒ CHỈ khoá note (không kèm baseSalary/items người dùng không đụng)", () => {
    const init = initialOf();
    const p = buildSalaryProfileUpdatePayload(
      init,
      { ...init, note: "điều chỉnh quý 4" },
      { catalogAvailable: true, itemsLocked: false },
    );
    expect(p).toEqual({ note: "điều chỉnh quý 4" });
  });

  it("🔴 [tiền] phiên bản DI SẢN (allowances có, items rỗng) + không đụng bảng phụ cấp ⇒ payload VẮNG KHOÁ items", () => {
    // `items` vắng ⇒ BE không chạm salary_profile_items VÀ không chạm cột allowances. Gửi `[]` ở đây
    // là xoá sạch phụ cấp trong im lặng — kỳ sau trả thiếu tiền mà không lỗi nào phát ra.
    const init = initialOf({ allowances: [{ name: "Ăn trưa", amount: 500_000 }], items: [] });
    const p = buildSalaryProfileUpdatePayload(
      init,
      { ...init, note: "x" },
      { catalogAvailable: true, itemsLocked: false },
    );
    expect("items" in p).toBe(false);
  });

  it("[allow đối chứng] có đụng bảng phụ cấp ⇒ items CÓ MẶT (kể cả xoá hết ⇒ [])", () => {
    const init = initialOf({
      items: [
        {
          id: "i1",
          componentCode: "PC_AN_TRUA",
          componentName: "Ăn trưa",
          kind: "earning",
          amount: 500_000,
          isActive: true,
          note: null,
        },
      ],
    } as Partial<SalaryProfileDto>);
    const p = buildSalaryProfileUpdatePayload(
      init,
      { ...init, items: [] },
      { catalogAvailable: true, itemsLocked: false },
    );
    expect(p.items).toEqual([]);
  });

  it("🔴 [deny] thiếu view:salary-component ⇒ KHÔNG BAO GIỜ gửi items, kể cả khi state lệch", () => {
    const init = initialOf({
      items: [
        {
          id: "i1",
          componentCode: "PC_AN_TRUA",
          componentName: "Ăn trưa",
          kind: "earning",
          amount: 500_000,
          isActive: true,
          note: null,
        },
      ],
    } as Partial<SalaryProfileDto>);
    const p = buildSalaryProfileUpdatePayload(
      init,
      { ...init, items: [] },
      { catalogAvailable: false, itemsLocked: false },
    );
    expect("items" in p).toBe(false);
  });

  it("xoá ghi chú ⇒ note: null (KHÔNG chuỗi rỗng — schema 022 nhận nullable)", () => {
    const init = initialOf({ note: "cũ" });
    const p = buildSalaryProfileUpdatePayload(
      init,
      { ...init, note: "  " },
      { catalogAvailable: true, itemsLocked: false },
    );
    expect(p).toEqual({ note: null });
  });

  it("xoá lương thử việc ⇒ null (= «không áp dụng»), KHÔNG phải 0", () => {
    const init = initialOf({ probationSalary: 17_000_000 });
    const p = buildSalaryProfileUpdatePayload(
      init,
      { ...init, probationSalary: "" },
      { catalogAvailable: true, itemsLocked: false },
    );
    expect(p).toEqual({ probationSalary: null });
  });

  it("KHÔNG BAO GIỜ có khoá userId (schema 022 không nhận — người của phiên bản là bất biến)", () => {
    const init = initialOf();
    const p = buildSalaryProfileUpdatePayload(
      init,
      { ...init, userId: "kẻ-khác", effectiveDate: "2026-11-01" },
      { catalogAvailable: true, itemsLocked: false },
    );
    expect("userId" in p).toBe(false);
    expect(p).toEqual({ effectiveDate: "2026-11-01" });
  });
});

describe("validateSalaryProfileEdit — chỉ kiểm trường ĐÃ đổi", () => {
  const initialOf = (over: Partial<SalaryProfileDto> = {}) => salaryProfileFormFromDto(DTO(over));

  it("[mask] lương bị mask ⇒ ô trống, không đổi ⇒ HỢP LỆ (không ép gõ lại số mù)", () => {
    const init = initialOf({ baseSalary: undefined });
    const v = validateSalaryProfileEdit(
      init,
      { ...init, note: "x" },
      { catalogAvailable: true, itemsLocked: false },
    );
    expect(v.errors).toEqual([]);
  });

  it("không đổi gì ⇒ lỗi «chưa đổi gì» (nút Lưu khoá)", () => {
    const init = initialOf();
    expect(
      validateSalaryProfileEdit(init, init, { catalogAvailable: true, itemsLocked: false }).errors,
    ).toEqual(["salaryProfileForm.noChange"]);
  });

  it("đổi lương thành 0 ⇒ lỗi (mirror CHECK baseSalary > 0)", () => {
    const init = initialOf();
    const v = validateSalaryProfileEdit(
      init,
      { ...init, baseSalary: "0" },
      { catalogAvailable: true, itemsLocked: false },
    );
    expect(v.errors).toContain("salaryProfileForm.baseSalaryInvalid");
  });

  it("đổi tỉ lệ hưởng ra ngoài (0,100] ⇒ lỗi", () => {
    const init = initialOf();
    expect(
      validateSalaryProfileEdit(
        init,
        { ...init, payRatioPct: "101" },
        { catalogAvailable: true, itemsLocked: false },
      ).errors,
    ).toContain("salaryProfileForm.payRatioInvalid");
  });

  it("hai dòng phụ cấp trùng mã ⇒ lỗi tại chỗ (chặn trước 409 profile-item-duplicate)", () => {
    const init = initialOf();
    const dup = {
      ...init,
      items: [
        { componentCode: "PC_AN_TRUA", amount: "1", isActive: true, note: "" },
        { componentCode: "PC_AN_TRUA", amount: "2", isActive: true, note: "" },
      ],
    };
    const v = validateSalaryProfileEdit(init, dup, { catalogAvailable: true, itemsLocked: false });
    expect(v.errors).toContain("salaryProfileForm.itemDuplicate");
    expect(v.badItemIndexes).toEqual([1]);
  });
});

/**
 * 🔴 S15-PAYROLL-FE-5 — nhánh "CÓ đụng bảng phụ cấp" của hồ sơ DI SẢN.
 *
 * Luật DIFF (D3) chỉ bịt nhánh "KHÔNG đụng". Hồ sơ di sản (`allowances` có, `items` rỗng) prefill ra
 * bảng RỖNG ⇒ phụ cấp cũ không hiện để mà diff; thêm một dòng là BE ghi đè cả cột `allowances` từ
 * mảng vừa gửi (`salary-profiles.service.ts` §update) ⇒ mất tiền với mã 200.
 */
describe("isLegacyAllowanceProfile + khoá items của hồ sơ di sản", () => {
  const initialOf = (over: Partial<SalaryProfileDto> = {}) => salaryProfileFormFromDto(DTO(over));
  const LEGACY: Partial<SalaryProfileDto> = {
    allowances: [{ name: "Ăn trưa", amount: 500_000 }],
    items: [],
  };

  it("nhận diện: có allowances + 0 items ⇒ DI SẢN", () => {
    expect(isLegacyAllowanceProfile(DTO(LEGACY))).toBe(true);
  });

  it("[đối chứng] đã chuyển sang danh mục (có items) ⇒ KHÔNG phải di sản", () => {
    expect(
      isLegacyAllowanceProfile(
        DTO({
          allowances: [{ name: "Ăn trưa", amount: 500_000 }],
          items: [
            {
              id: "it-1",
              componentCode: "PC_AN_TRUA",
              componentName: "Ăn trưa",
              kind: null,
              amount: 500_000,
              isActive: true,
              note: null,
            },
          ],
        } as Partial<SalaryProfileDto>),
      ),
    ).toBe(false);
  });

  it("[đối chứng] không có allowances ⇒ KHÔNG phải di sản", () => {
    expect(isLegacyAllowanceProfile(DTO({ allowances: [], items: [] }))).toBe(false);
  });

  it("🔴 [tiền] di sản + người dùng THÊM một khoản ⇒ payload VẪN vắng khoá items (không ghi đè mù)", () => {
    const init = initialOf(LEGACY);
    const touched: SalaryProfileFormState = {
      ...init,
      items: [{ componentCode: "PC_XE_DUA_DON", amount: "300000", isActive: true, note: "" }],
    };
    const payload = buildSalaryProfileUpdatePayload(init, touched, {
      catalogAvailable: true,
      itemsLocked: true,
    });
    expect("items" in payload).toBe(false);
  });

  it("[đối chứng] CÙNG thao tác trên hồ sơ KHÔNG di sản ⇒ items CÓ MẶT", () => {
    const init = initialOf();
    const touched: SalaryProfileFormState = {
      ...init,
      items: [{ componentCode: "PC_XE_DUA_DON", amount: "300000", isActive: true, note: "" }],
    };
    const payload = buildSalaryProfileUpdatePayload(init, touched, {
      catalogAvailable: true,
      itemsLocked: false,
    });
    expect(payload.items).toEqual([
      { componentCode: "PC_XE_DUA_DON", amount: 300_000, isActive: true },
    ]);
  });

  it("di sản + CHỈ đổi ghi chú ⇒ vẫn sửa được (khoá bảng phụ cấp KHÔNG khoá cả hộp)", () => {
    const init = initialOf(LEGACY);
    const payload = buildSalaryProfileUpdatePayload(
      init,
      { ...init, note: "ghi chú mới" },
      { catalogAvailable: true, itemsLocked: true },
    );
    expect(payload).toEqual({ note: "ghi chú mới" });
  });

  it("di sản + chỉ đụng bảng phụ cấp ⇒ payload rỗng ⇒ validate báo «chưa đổi gì» (nút Lưu khoá)", () => {
    const init = initialOf(LEGACY);
    const touched: SalaryProfileFormState = {
      ...init,
      items: [{ componentCode: "PC_XE_DUA_DON", amount: "300000", isActive: true, note: "" }],
    };
    expect(
      validateSalaryProfileEdit(init, touched, { catalogAvailable: true, itemsLocked: true })
        .errors,
    ).toContain("salaryProfileForm.noChange");
  });
});

describe("validateSalaryProfileEdit — trần ghi chú", () => {
  const initialOf = (over: Partial<SalaryProfileDto> = {}) => salaryProfileFormFromDto(DTO(over));

  it("ghi chú 501 ký tự ⇒ lỗi có CHỮ riêng (không rơi vào 400 chung)", () => {
    const init = initialOf();
    expect(
      validateSalaryProfileEdit(
        init,
        { ...init, note: "x".repeat(501) },
        { catalogAvailable: true, itemsLocked: false },
      ).errors,
    ).toContain("salaryProfileForm.noteTooLong");
  });

  it("[biên] đúng 500 ký tự ⇒ hợp lệ", () => {
    const init = initialOf();
    expect(
      validateSalaryProfileEdit(
        init,
        { ...init, note: "x".repeat(500) },
        { catalogAvailable: true, itemsLocked: false },
      ).errors,
    ).toEqual([]);
  });
});
