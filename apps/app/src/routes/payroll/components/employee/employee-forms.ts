/**
 * S15-PAYROLL-FE-1 — trạng thái form + builder payload cho hai tab GHI của chi tiết nhân sự:
 * thiết lập BH/công đoàn/TK ngân hàng (PAYROLL-API-039) và người phụ thuộc (041/042). Hàm THUẦN, có spec.
 *
 * ── LUẬT CỦA 039 (upsert MERGE từng phần) ────────────────────────────────────────────────────────
 * 1. **Ô số TK là WRITE-ONLY.** DTO 038 chỉ có `bankAccountLast4` (contracts luật 1) nên form không bao
 *    giờ được «điền sẵn» số cũ. Để trống ⇒ **KHÔNG gửi khoá** `bankAccountNumber` ⇒ server giữ nguyên số
 *    hiện có. Gửi `""` bị chính contracts chặn (`.min(1)`, security review BE-1 HIGH #2).
 * 2. **Xoá TK = gửi CẢ BỐN khoá `null` cùng lúc** — mirror CHECK `payroll_employee_settings_bank_pair_check`
 *    trên hàng SAU MERGE: xoá lẻ `bankName` mà số TK còn là 422 `bank-pair-incomplete`.
 * 3. Kiểm cặp (số TK ⇒ tên NH + chủ TK) ở client CHỈ trên payload — vế «hàng sau merge» là của service;
 *    client chỉ cảnh sớm khi biết chắc (đang có TK cũ và người dùng xoá tên NH/chủ TK).
 */
import type {
  CreatePayrollDependentRequest,
  DependentRelationship,
  PayrollDependentDto,
  PayrollEmployeeSettingsDto,
  PutPayrollEmployeeSettingsRequest,
  UpdatePayrollDependentRequest,
} from "@mediaos/contracts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. Thiết lập BH · công đoàn · TK ngân hàng (038 → form → 039)
// ════════════════════════════════════════════════════════════════════════════════════════════════

export interface EmployeeSettingsFormState {
  joinsSocialInsurance: boolean;
  socialInsuranceNo: string;
  joinsUnion: boolean;
  /** Luôn `""` lúc mở form (luật 1) — chỉ có giá trị khi người dùng gõ số MỚI. */
  bankAccountNumber: string;
  bankName: string;
  bankBranch: string;
  accountHolder: string;
  /** Ô «Xoá tài khoản ngân hàng» — gửi 4 khoá `null` (luật 2). */
  clearBank: boolean;
}

export function settingsFormFromDto(
  dto: PayrollEmployeeSettingsDto | null,
): EmployeeSettingsFormState {
  return {
    joinsSocialInsurance: dto?.joinsSocialInsurance ?? false,
    socialInsuranceNo: dto?.socialInsuranceNo ?? "",
    joinsUnion: dto?.joinsUnion ?? false,
    bankAccountNumber: "",
    bankName: dto?.bankName ?? "",
    bankBranch: dto?.bankBranch ?? "",
    accountHolder: dto?.accountHolder ?? "",
    clearBank: false,
  };
}

const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

export type EmployeeSettingsErrorKey = "insurance.bankPairError";

/**
 * `hasExistingBank` = DTO 038 có `bankAccountLast4` — tức server đang giữ một số TK. Khi đó xoá tên
 * NH/chủ TK mà không «xoá TK» là chắc chắn 422 ở server ⇒ chặn sớm.
 */
export function validateEmployeeSettings(
  state: EmployeeSettingsFormState,
  hasExistingBank: boolean,
): EmployeeSettingsErrorKey | null {
  if (state.clearBank) return null;
  const willHaveNumber = state.bankAccountNumber.trim() !== "" || hasExistingBank;
  const pairOk = orNull(state.bankName) !== null && orNull(state.accountHolder) !== null;
  return willHaveNumber && !pairOk ? "insurance.bankPairError" : null;
}

export function buildEmployeeSettingsPayload(
  state: EmployeeSettingsFormState,
): PutPayrollEmployeeSettingsRequest {
  const base = {
    joinsSocialInsurance: state.joinsSocialInsurance,
    socialInsuranceNo: orNull(state.socialInsuranceNo),
    joinsUnion: state.joinsUnion,
  };
  if (state.clearBank) {
    return {
      ...base,
      bankAccountNumber: null,
      bankName: null,
      bankBranch: null,
      accountHolder: null,
    };
  }
  const number = state.bankAccountNumber.trim();
  return {
    ...base,
    // Luật 1: trống ⇒ VẮNG KHOÁ (giữ số cũ), không phải `null` (xoá) và không phải `""` (bị .min(1) chặn).
    ...(number !== "" ? { bankAccountNumber: number } : {}),
    bankName: orNull(state.bankName),
    bankBranch: orNull(state.bankBranch),
    accountHolder: orNull(state.accountHolder),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. Người phụ thuộc (040 → form → 041 tạo / 042 sửa · xoá mềm)
// ════════════════════════════════════════════════════════════════════════════════════════════════

export interface DependentFormState {
  fullName: string;
  relationship: DependentRelationship;
  dependentTaxCode: string;
  dateOfBirth: string;
  effectiveFrom: string;
  effectiveTo: string;
}

export const EMPTY_DEPENDENT_FORM: DependentFormState = {
  fullName: "",
  relationship: "Child",
  dependentTaxCode: "",
  dateOfBirth: "",
  effectiveFrom: "",
  effectiveTo: "",
};

export function dependentFormFromDto(dto: PayrollDependentDto): DependentFormState {
  return {
    fullName: dto.fullName,
    relationship: dto.relationship,
    dependentTaxCode: dto.dependentTaxCode ?? "",
    dateOfBirth: dto.dateOfBirth ?? "",
    effectiveFrom: dto.effectiveFrom,
    effectiveTo: dto.effectiveTo ?? "",
  };
}

export type DependentFormErrorKey =
  | "dependentForm.fullNameRequired"
  | "dependentForm.effectiveFromInvalid"
  | "dependentForm.dateInvalid"
  | "dependentForm.dateOrder";

/** Mirror CHECK `payroll_dependents_period_check` (`effectiveTo >= effectiveFrom`) + ngày hợp lệ. */
export function validateDependentForm(state: DependentFormState): DependentFormErrorKey | null {
  if (state.fullName.trim() === "") return "dependentForm.fullNameRequired";
  if (!DATE_RE.test(state.effectiveFrom)) return "dependentForm.effectiveFromInvalid";
  if (state.dateOfBirth !== "" && !DATE_RE.test(state.dateOfBirth))
    return "dependentForm.dateInvalid";
  if (state.effectiveTo !== "") {
    if (!DATE_RE.test(state.effectiveTo)) return "dependentForm.dateInvalid";
    if (state.effectiveTo < state.effectiveFrom) return "dependentForm.dateOrder";
  }
  return null;
}

export function buildCreateDependentPayload(
  state: DependentFormState,
): CreatePayrollDependentRequest {
  return {
    fullName: state.fullName.trim(),
    relationship: state.relationship,
    dependentTaxCode: orNull(state.dependentTaxCode),
    dateOfBirth: orNull(state.dateOfBirth),
    effectiveFrom: state.effectiveFrom,
    effectiveTo: orNull(state.effectiveTo),
  };
}

/**
 * 042 sửa: gửi ĐỦ các trường của form (không diff) — PATCH nhận từng vế nhưng người dùng đang nhìn cả
 * form, gửi đủ để «xoá ngày kết thúc» (`effectiveTo: null`) không bị coi là «không đổi».
 */
export function buildUpdateDependentPayload(
  state: DependentFormState,
): UpdatePayrollDependentRequest {
  return buildCreateDependentPayload(state);
}

/** 042 xoá mềm — không có route DELETE riêng (API-18 §5). */
export const DEPENDENT_DELETE_PAYLOAD: UpdatePayrollDependentRequest = { delete: true };

/** NPT «đang giảm trừ» tại ngày `isoDate` (`YYYY-MM-DD`) — so chuỗi ISO là so được, không cần Date. */
export function isDependentEffectiveOn(dep: PayrollDependentDto, isoDate: string): boolean {
  if (dep.effectiveFrom > isoDate) return false;
  return dep.effectiveTo === null || dep.effectiveTo >= isoDate;
}

/** Hôm nay theo giờ máy người dùng, dạng `YYYY-MM-DD` (đầu vào cho `isDependentEffectiveOn`). */
export function todayIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
