/**
 * S15-PAYROLL-FE-1 — luật builder 039/041/042 (`employee-forms.ts`). Hai ca quan trọng nhất là hai ca PII:
 * ô số TK trống ⇒ VẮNG KHOÁ (giữ số cũ, không gửi `""` bị `.min(1)` chặn, không gửi `null` = xoá), và
 * «xoá TK» ⇒ đủ BỐN khoá null (mirror CHECK cặp trên hàng SAU MERGE).
 */
import { describe, expect, it } from "vitest";
import type { PayrollDependentDto, PayrollEmployeeSettingsDto } from "@mediaos/contracts";
import {
  buildCreateDependentPayload,
  buildEmployeeSettingsPayload,
  DEPENDENT_DELETE_PAYLOAD,
  dependentFormFromDto,
  EMPTY_DEPENDENT_FORM,
  isDependentEffectiveOn,
  settingsFormFromDto,
  todayIsoDate,
  validateDependentForm,
  validateEmployeeSettings,
} from "./employee-forms";

const USER = "11111111-2222-3333-4444-555555555555";

const settingsDto = (
  over: Partial<PayrollEmployeeSettingsDto> = {},
): PayrollEmployeeSettingsDto => ({
  userId: USER,
  joinsSocialInsurance: true,
  socialInsuranceNo: "0123456789",
  joinsUnion: false,
  bankAccountLast4: "6789",
  bankName: "VCB",
  bankBranch: null,
  accountHolder: "NGUYEN VAN A",
  ...over,
});

describe("settingsFormFromDto — ô số TK luôn trống (write-only)", () => {
  it("không bao giờ điền sẵn số TK, kể cả khi DTO có last4", () => {
    const form = settingsFormFromDto(settingsDto());
    expect(form.bankAccountNumber).toBe("");
    expect(form.bankName).toBe("VCB");
    expect(form.clearBank).toBe(false);
  });
  it("DTO null (hàng chưa tồn tại) ⇒ form rỗng, không throw", () => {
    expect(settingsFormFromDto(null).joinsSocialInsurance).toBe(false);
  });
});

describe("buildEmployeeSettingsPayload", () => {
  it('[deny] số TK trống ⇒ VẮNG KHOÁ bankAccountNumber (giữ số cũ) — không `""`, không null', () => {
    const p = buildEmployeeSettingsPayload(settingsFormFromDto(settingsDto()));
    expect("bankAccountNumber" in p).toBe(false);
    expect(p.bankName).toBe("VCB");
    expect(p.bankBranch).toBeNull();
    expect(p.accountHolder).toBe("NGUYEN VAN A");
  });

  it("[allow] gõ số mới ⇒ có khoá bankAccountNumber đã trim", () => {
    const p = buildEmployeeSettingsPayload({
      ...settingsFormFromDto(settingsDto()),
      bankAccountNumber: " 0011223344 ",
    });
    expect(p.bankAccountNumber).toBe("0011223344");
  });

  it("«xoá TK» ⇒ ĐỦ BỐN khoá null cùng lúc, kể cả khi ô số TK có gõ gì đó", () => {
    const p = buildEmployeeSettingsPayload({
      ...settingsFormFromDto(settingsDto()),
      bankAccountNumber: "999",
      clearBank: true,
    });
    expect(p).toMatchObject({
      bankAccountNumber: null,
      bankName: null,
      bankBranch: null,
      accountHolder: null,
    });
    expect(p.joinsSocialInsurance).toBe(true);
    expect(p.socialInsuranceNo).toBe("0123456789");
  });

  it("chuỗi trắng ⇒ null (socialInsuranceNo · bankBranch)", () => {
    const p = buildEmployeeSettingsPayload({
      ...settingsFormFromDto(settingsDto()),
      socialInsuranceNo: "   ",
      bankBranch: " ",
    });
    expect(p.socialInsuranceNo).toBeNull();
    expect(p.bankBranch).toBeNull();
  });
});

describe("validateEmployeeSettings — cặp số TK ⇒ tên NH + chủ TK", () => {
  it("[deny] gõ số mới mà thiếu chủ TK ⇒ bankPairError", () => {
    const form = { ...settingsFormFromDto(null), bankAccountNumber: "123", bankName: "VCB" };
    expect(validateEmployeeSettings(form, false)).toBe("insurance.bankPairError");
  });
  it("[deny] đang có TK cũ, xoá tên NH mà không «xoá TK» ⇒ bankPairError (server 422 chắc chắn)", () => {
    const form = { ...settingsFormFromDto(settingsDto()), bankName: "" };
    expect(validateEmployeeSettings(form, true)).toBe("insurance.bankPairError");
  });
  it("[allow] «xoá TK» thì bỏ qua cặp; không có TK cũ và không gõ số mới thì tên NH trống là hợp lệ", () => {
    expect(
      validateEmployeeSettings({ ...settingsFormFromDto(null), clearBank: true }, true),
    ).toBeNull();
    expect(validateEmployeeSettings(settingsFormFromDto(null), false)).toBeNull();
  });
});

const dependentDto = (over: Partial<PayrollDependentDto> = {}): PayrollDependentDto => ({
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  userId: USER,
  fullName: "Nguyễn Bé",
  relationship: "Child",
  dependentTaxCode: null,
  dateOfBirth: "2020-01-15",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  ...over,
});

describe("dependent form — validate + build (mirror payroll_dependents_period_check)", () => {
  it("[deny] effectiveTo < effectiveFrom ⇒ dateOrder", () => {
    const form = {
      ...dependentFormFromDto(dependentDto()),
      effectiveFrom: "2026-05-01",
      effectiveTo: "2026-04-30",
    };
    expect(validateDependentForm(form)).toBe("dependentForm.dateOrder");
  });
  it("[allow] effectiveTo = effectiveFrom hợp lệ; trống hợp lệ", () => {
    const base = dependentFormFromDto(dependentDto());
    expect(validateDependentForm({ ...base, effectiveTo: base.effectiveFrom })).toBeNull();
    expect(validateDependentForm({ ...base, effectiveTo: "" })).toBeNull();
  });
  it("[deny] thiếu họ tên / thiếu ngày bắt đầu / ngày rác", () => {
    expect(validateDependentForm({ ...EMPTY_DEPENDENT_FORM })).toBe(
      "dependentForm.fullNameRequired",
    );
    expect(validateDependentForm({ ...EMPTY_DEPENDENT_FORM, fullName: "A" })).toBe(
      "dependentForm.effectiveFromInvalid",
    );
    expect(
      validateDependentForm({
        ...EMPTY_DEPENDENT_FORM,
        fullName: "A",
        effectiveFrom: "2026-01-01",
        dateOfBirth: "15/01/2020",
      }),
    ).toBe("dependentForm.dateInvalid");
  });
  it("build: trim họ tên, chuỗi trắng ⇒ null (MST · ngày sinh · effectiveTo)", () => {
    const p = buildCreateDependentPayload({
      fullName: "  Nguyễn Bé ",
      relationship: "Spouse",
      dependentTaxCode: " ",
      dateOfBirth: "",
      effectiveFrom: "2026-01-01",
      effectiveTo: "",
    });
    expect(p).toEqual({
      fullName: "Nguyễn Bé",
      relationship: "Spouse",
      dependentTaxCode: null,
      dateOfBirth: null,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
  });
  it("xoá mềm = {delete:true} — không có route DELETE riêng", () => {
    expect(DEPENDENT_DELETE_PAYLOAD).toEqual({ delete: true });
  });
});

describe("isDependentEffectiveOn", () => {
  it("khoảng mở (effectiveTo null) phủ mọi ngày ≥ effectiveFrom", () => {
    expect(isDependentEffectiveOn(dependentDto(), "2026-09-16")).toBe(true);
    expect(isDependentEffectiveOn(dependentDto(), "2025-12-31")).toBe(false);
  });
  it("khoảng đóng: bao gồm cả hai đầu", () => {
    const d = dependentDto({ effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" });
    expect(isDependentEffectiveOn(d, "2026-01-01")).toBe(true);
    expect(isDependentEffectiveOn(d, "2026-06-30")).toBe(true);
    expect(isDependentEffectiveOn(d, "2026-07-01")).toBe(false);
  });
  it("todayIsoDate ra YYYY-MM-DD theo giờ máy", () => {
    expect(todayIsoDate(new Date(2026, 8, 5))).toBe("2026-09-05");
  });
});
