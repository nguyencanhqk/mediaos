/**
 * S15-PAYROLL-FE-1 — trạng thái form + builder payload hồ sơ lương v2 (PAYROLL-API-020). Hàm THUẦN, không
 * React — `salary-profile-form.spec.ts` neo toàn bộ luật mà không dựng DOM.
 *
 * ── LUẬT ─────────────────────────────────────────────────────────────────────────────────────────
 * 1. **Trống ≠ 0.** `insuranceSalary`/`probationSalary` để trống ⇒ `null` (DB-13 §12.1: NULL = «dùng
 *    `baseSalary`» / «không có»). Gửi `0` là một SỐ THẬT và máy tính lương sẽ đóng BH trên 0 đồng.
 * 2. **Mirror CHECK, đúng bằng:** `baseSalary > 0` · `insuranceSalary`/`probationSalary >= 0` ·
 *    `payRatioPct ∈ (0, 100]` · `items[].amount >= 0` · mỗi `componentCode` một dòng (409 014
 *    `profile-item-duplicate` ở server — chặn sớm ở đây để người dùng thấy dòng nào trùng).
 * 3. **Không có catalog thì KHÔNG có khoá `items`.** Thiếu `view:salary-component` ⇒ form không hiện bảng
 *    phụ cấp ⇒ payload VẮNG `items` (contracts `.default([])`), thay vì gửi `items: []` giả vờ là người
 *    dùng đã quyết «không phụ cấp».
 * 4. Mặc định = default của DB: `salaryType = GROSS` · `pitPayer = EMPLOYEE` · `payRatioPct = 100`.
 */
import type {
  CreateSalaryProfileRequest,
  PitPayer,
  SalaryProfileItemInput,
  SalaryType,
} from "@mediaos/contracts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SalaryProfileItemDraft {
  componentCode: string;
  amount: string;
  isActive: boolean;
  note: string;
}

export interface SalaryProfileFormState {
  userId: string;
  effectiveDate: string;
  baseSalary: string;
  salaryType: SalaryType;
  pitPayer: PitPayer;
  insuranceSalary: string;
  probationSalary: string;
  payRatioPct: string;
  note: string;
  items: SalaryProfileItemDraft[];
}

export const EMPTY_SALARY_PROFILE_FORM: SalaryProfileFormState = {
  userId: "",
  effectiveDate: "",
  baseSalary: "",
  salaryType: "GROSS",
  pitPayer: "EMPLOYEE",
  insuranceSalary: "",
  probationSalary: "",
  payRatioPct: "100",
  note: "",
  items: [],
};

export const EMPTY_SALARY_PROFILE_ITEM: SalaryProfileItemDraft = {
  componentCode: "",
  amount: "",
  isActive: true,
  note: "",
};

/** Chuỗi số tiền → số; `""` ⇒ `null`; không phải số ⇒ `NaN` (để caller báo lỗi, không nuốt). */
export function parseMoneyInput(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

export type SalaryProfileFormErrorKey =
  | "salaryProfileForm.employeeRequired"
  | "salaryProfileForm.effectiveDateInvalid"
  | "salaryProfileForm.baseSalaryInvalid"
  | "salaryProfileForm.moneyInvalid"
  | "salaryProfileForm.payRatioInvalid"
  | "salaryProfileForm.itemIncomplete"
  | "salaryProfileForm.itemDuplicate";

export interface SalaryProfileValidation {
  errors: readonly SalaryProfileFormErrorKey[];
  /** Chỉ số dòng `items` lỗi (trùng mã / thiếu mã / số tiền sai) — để tô đúng dòng. */
  badItemIndexes: readonly number[];
}

/**
 * Kiểm toàn form. `catalogAvailable = false` ⇒ bỏ qua `items` hoàn toàn (không hiện bảng thì không có
 * gì để kiểm — luật 3).
 */
export function validateSalaryProfileForm(
  state: SalaryProfileFormState,
  opts: { catalogAvailable: boolean },
): SalaryProfileValidation {
  const errors: SalaryProfileFormErrorKey[] = [];
  const badItemIndexes: number[] = [];

  if (state.userId === "") errors.push("salaryProfileForm.employeeRequired");
  if (!DATE_RE.test(state.effectiveDate)) errors.push("salaryProfileForm.effectiveDateInvalid");

  const base = parseMoneyInput(state.baseSalary);
  if (base === null || Number.isNaN(base) || base <= 0) {
    errors.push("salaryProfileForm.baseSalaryInvalid");
  }

  for (const raw of [state.insuranceSalary, state.probationSalary]) {
    const v = parseMoneyInput(raw);
    if (v !== null && (Number.isNaN(v) || v < 0)) {
      errors.push("salaryProfileForm.moneyInvalid");
      break;
    }
  }

  const ratio = parseMoneyInput(state.payRatioPct);
  if (ratio === null || Number.isNaN(ratio) || ratio <= 0 || ratio > 100) {
    errors.push("salaryProfileForm.payRatioInvalid");
  }

  if (opts.catalogAvailable) {
    const seen = new Set<string>();
    let incomplete = false;
    let duplicate = false;
    state.items.forEach((item, i) => {
      const amount = parseMoneyInput(item.amount);
      if (item.componentCode === "" || amount === null || Number.isNaN(amount) || amount < 0) {
        incomplete = true;
        badItemIndexes.push(i);
        return;
      }
      if (seen.has(item.componentCode)) {
        duplicate = true;
        badItemIndexes.push(i);
        return;
      }
      seen.add(item.componentCode);
    });
    if (incomplete) errors.push("salaryProfileForm.itemIncomplete");
    if (duplicate) errors.push("salaryProfileForm.itemDuplicate");
  }

  return { errors, badItemIndexes };
}

/**
 * Dựng payload 020 từ form ĐÃ qua `validateSalaryProfileForm` (caller kiểm trước; ở đây không ném).
 * Khoá tuỳ chọn chỉ có mặt khi người dùng nhập — `.strict()` của contracts không cấm khoá undefined nhưng
 * gửi `note: ""` là ghi chuỗi rỗng vào DB.
 */
export function buildSalaryProfilePayload(
  state: SalaryProfileFormState,
  opts: { catalogAvailable: boolean },
): CreateSalaryProfileRequest {
  const insurance = parseMoneyInput(state.insuranceSalary);
  const probation = parseMoneyInput(state.probationSalary);
  const note = state.note.trim();

  const payload: CreateSalaryProfileRequest = {
    userId: state.userId,
    effectiveDate: state.effectiveDate,
    baseSalary: parseMoneyInput(state.baseSalary) ?? 0,
    salaryType: state.salaryType,
    pitPayer: state.pitPayer,
    insuranceSalary: insurance,
    probationSalary: probation,
    payRatioPct: parseMoneyInput(state.payRatioPct) ?? 100,
    // `items` là khoá BẮT BUỘC của kiểu (`.default([])` ⇒ output type non-optional) — gán ở dưới theo
    // luật 3 để KHÔNG gửi mảng rỗng giả vờ khi không có catalog.
    items: [],
    ...(note ? { note } : {}),
  };

  if (!opts.catalogAvailable) {
    // Xoá khoá thay vì để `[]`: server `.default([])` tự điền, và audit payload không ghi «0 khoản» do FE bịa.
    delete (payload as Partial<CreateSalaryProfileRequest>).items;
    return payload;
  }

  payload.items = state.items.map((item): SalaryProfileItemInput => {
    const itemNote = item.note.trim();
    return {
      componentCode: item.componentCode,
      amount: parseMoneyInput(item.amount) ?? 0,
      isActive: item.isActive,
      ...(itemNote ? { note: itemNote } : {}),
    };
  });
  return payload;
}
