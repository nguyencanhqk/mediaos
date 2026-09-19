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
  SalaryProfileDto,
  SalaryProfileItemInput,
  SalaryType,
  UpdateSalaryProfileRequest,
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
  | "salaryProfileForm.itemDuplicate"
  /** Chỉ chế độ SỬA — chưa đổi gì thì không gửi (thân rỗng vẫn sinh hàng audit ở BE). */
  | "salaryProfileForm.noChange"
  /** Chỉ chế độ SỬA — vượt trần 500 ký tự của `updateSalaryProfileSchema.note`. */
  | "salaryProfileForm.noteTooLong";

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

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// S15-PAYROLL-FE-5 — chế độ SỬA một phiên bản đã có (PAYROLL-API-022)
//
// 🔴 **Payload sửa là DIFF, không phải ảnh chụp form.** Lý do sống còn (đo ở
// `apps/api/src/payroll/salary-profiles.service.ts` §update): khoá `items` **VẮNG** ⇒ BE không chạm
// `salary_profile_items` VÀ không chạm cột `allowances`. Gửi nguyên form ⇒ một phiên bản «di sản» (v1:
// có `allowances`, 0 dòng `items`) sẽ prefill `items: []` và **xoá sạch phụ cấp trong im lặng** — kỳ
// lương sau trả thiếu tiền mà không lỗi nào phát ra.
//
// Ba hệ quả của cùng một luật, đừng "rút gọn" cái nào:
//   1. không đụng bảng phụ cấp ⇒ `items` vắng;
//   2. thiếu `view:salary-component` (không có catalog) ⇒ `items` **không bao giờ** được gửi;
//   3. không đổi gì ⇒ payload rỗng ⇒ chặn ở validate (thân rỗng vẫn sinh hàng audit `changedFields: []`).
//
// `userId` KHÔNG có trong `updateSalaryProfileSchema` — người của một phiên bản là bất biến.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** Trần `note` của `updateSalaryProfileSchema` — chặn ở client để lỗi có CHỮ, không rơi vào 400 chung. */
const NOTE_MAX_LENGTH = 500;

export interface SalaryProfileEditOpts {
  /** Giữ `view:salary-component` — thiếu ⇒ KHÔNG bao giờ gửi `items` (D3 luật 2). */
  catalogAvailable: boolean;
  /**
   * Hồ sơ di sản ⇒ khoá bảng phụ cấp (D3 luật 2b — xem `isLegacyAllowanceProfile`).
   *
   * 🔴 **BẮT BUỘC, không `?`.** Cổng chặn mất tiền mà để tuỳ chọn thì quên là **fail-OPEN**
   * (`!undefined === true` ⇒ gửi `items`) — đúng hình dạng lỗi mà D8 sinh ra để bịt. Bắt buộc ⇒
   * mọi call-site mới phải TỰ QUYẾT, trình biên dịch không cho đi vòng.
   */
  itemsLocked: boolean;
}

/** Số tiền → chuỗi cho ô nhập. `undefined` (server mask) và `null` (= «không áp dụng») ĐỀU ra ô trống. */
function moneyToInput(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

/**
 * DTO 021 → state form. Dùng cho prefill hộp sửa **và** làm mốc so sánh của diff — cùng một hàm để
 * "không đổi gì" thật sự ra payload rỗng, thay vì lệch vì hai đường dựng state khác nhau.
 */
export function salaryProfileFormFromDto(dto: SalaryProfileDto): SalaryProfileFormState {
  return {
    userId: dto.userId,
    effectiveDate: dto.effectiveDate,
    baseSalary: moneyToInput(dto.baseSalary),
    salaryType: dto.salaryType ?? "GROSS",
    pitPayer: dto.pitPayer ?? "EMPLOYEE",
    insuranceSalary: moneyToInput(dto.insuranceSalary),
    probationSalary: moneyToInput(dto.probationSalary),
    payRatioPct: moneyToInput(dto.payRatioPct),
    note: dto.note ?? "",
    items: (dto.items ?? []).map((item) => ({
      componentCode: item.componentCode,
      amount: moneyToInput(item.amount),
      isActive: item.isActive,
      note: item.note ?? "",
    })),
  };
}

/**
 * 🔴 Hồ sơ «DI SẢN»: có cột `allowances` mà **0 dòng `items`** — trạng thái được chính hợp đồng thừa
 * nhận (`packages/contracts/src/payroll.ts` §`allowances`: "hồ sơ CHƯA qua đường ghi v2 có thể có
 * `allowances` mà 0 `items`"), và `SalaryProfileVersionCard` đã có băng cảnh báo cho nó.
 *
 * **Vì sao phải KHOÁ bảng phụ cấp khi sửa hồ sơ như thế.** Prefill đọc `dto.items` ⇒ bảng ra RỖNG,
 * phụ cấp di sản KHÔNG hiện ra để mà diff. Người dùng thêm một dòng mới ⇒ `items` khác rỗng ⇒ BE
 * `resolveItems` dựng `allowances` **CHỈ từ mảng vừa gửi** rồi GHI ĐÈ cả cột
 * (`salary-profiles.service.ts` §update: `allowances: mirror.allowances` + `replaceItemsTx`) ⇒ phụ cấp
 * di sản **bốc hơi cùng một mã 200**, kỳ lương sau trả thiếu tiền.
 *
 * Luật DIFF của D3 chỉ bịt nhánh "KHÔNG đụng bảng"; nhánh "CÓ đụng" phải bịt ở đây, fail-closed: hồ sơ
 * di sản thì không sửa phụ cấp tại chỗ — tạo phiên bản mới qua danh mục (đúng lời băng cảnh báo).
 *
 * Dữ liệu hôm nay KHÔNG có hồ sơ nào như vậy (migration `0570` §6c đã backfill `items` từ `allowances`
 * cho MỌI hồ sơ chưa xoá, và hai đường ghi còn lại luôn giữ hai nguồn đồng bộ). Giữ nhánh này vì import
 * ngoài luồng hoặc một hồ sơ sót lại là đủ để mất tiền thật.
 */
export function isLegacyAllowanceProfile(dto: SalaryProfileDto): boolean {
  return (dto.allowances?.length ?? 0) > 0 && (dto.items?.length ?? 0) === 0;
}

/** Hai danh sách khoản có KHÁC nhau không — so trên bản nháp đã chuẩn hoá, giữ thứ tự (thứ tự là dữ liệu). */
function itemsDiffer(
  a: readonly SalaryProfileItemDraft[],
  b: readonly SalaryProfileItemDraft[],
): boolean {
  if (a.length !== b.length) return true;
  return a.some((x, i) => {
    const y = b[i];
    if (!y) return true;
    return (
      x.componentCode !== y.componentCode ||
      x.amount.trim() !== y.amount.trim() ||
      x.isActive !== y.isActive ||
      x.note.trim() !== y.note.trim()
    );
  });
}

/** Ô tiền → giá trị gửi đi: trống ⇒ `null` (xoá, = «dùng lương cơ bản» / «không áp dụng»), khác ⇒ số. */
function moneyToPatch(raw: string): number | null {
  return parseMoneyInput(raw);
}

/**
 * Payload 022 = **chỉ những trường người dùng thật sự đổi**. Caller kiểm bằng
 * `validateSalaryProfileEdit` trước; ở đây không ném.
 *
 * `{}` (rỗng) là kết quả hợp lệ và có nghĩa: "không có gì để gửi" — caller KHÔNG được gọi API với nó.
 *
 * ⚠️ **HỢP ĐỒNG VỚI CALLER:** các `?? 0` / `?? 100` dưới đây chỉ an toàn vì
 * `validateSalaryProfileEdit` ĐÃ chặn ô trống/rác cho đúng những trường ấy. Gọi thẳng hàm này mà
 * không validate trước là đường ghi `0`/`100` vào lương thật.
 */
export function buildSalaryProfileUpdatePayload(
  initial: SalaryProfileFormState,
  current: SalaryProfileFormState,
  opts: SalaryProfileEditOpts,
): UpdateSalaryProfileRequest {
  const payload: UpdateSalaryProfileRequest = {};

  if (current.effectiveDate !== initial.effectiveDate)
    payload.effectiveDate = current.effectiveDate;
  if (current.baseSalary.trim() !== initial.baseSalary.trim()) {
    // `baseSalary` KHÔNG nullable ở 022 (mirror CHECK `> 0`) — ô trống không phải là "xoá", nên
    // `validateSalaryProfileEdit` chặn trước và nhánh này chỉ chạy với số thật.
    payload.baseSalary = moneyToPatch(current.baseSalary) ?? 0;
  }
  if (current.salaryType !== initial.salaryType) payload.salaryType = current.salaryType;
  if (current.pitPayer !== initial.pitPayer) payload.pitPayer = current.pitPayer;
  if (current.insuranceSalary.trim() !== initial.insuranceSalary.trim()) {
    payload.insuranceSalary = moneyToPatch(current.insuranceSalary);
  }
  if (current.probationSalary.trim() !== initial.probationSalary.trim()) {
    payload.probationSalary = moneyToPatch(current.probationSalary);
  }
  if (current.payRatioPct.trim() !== initial.payRatioPct.trim()) {
    payload.payRatioPct = moneyToPatch(current.payRatioPct) ?? 100;
  }
  if (current.note.trim() !== initial.note.trim()) {
    // Trống ⇒ `null` (xoá ghi chú). Gửi `""` là ghi chuỗi rỗng vào DB — khác nghĩa.
    payload.note = current.note.trim() === "" ? null : current.note.trim();
  }

  // 🔴 Luật 2: không có catalog thì KHÔNG có khoá `items`, dù state có lệch thế nào.
  // 🔴 Luật 2b: hồ sơ DI SẢN cũng vậy — gửi `items` ở đó là ghi đè mất phụ cấp không nhìn thấy
  //    (xem `isLegacyAllowanceProfile`). Hai cờ ĐỘC LẬP, cùng fail-closed.
  if (opts.catalogAvailable && !opts.itemsLocked && itemsDiffer(initial.items, current.items)) {
    payload.items = current.items.map((item): SalaryProfileItemInput => {
      const itemNote = item.note.trim();
      return {
        componentCode: item.componentCode,
        amount: parseMoneyInput(item.amount) ?? 0,
        isActive: item.isActive,
        ...(itemNote ? { note: itemNote } : {}),
      };
    });
  }

  return payload;
}

/**
 * Kiểm form SỬA — **chỉ trên trường đã đổi**. Khác `validateSalaryProfileForm` ở chỗ không đòi ô nào
 * phải có giá trị: một ô trống vì server mask tiền (`baseSalary` vắng khoá) mà người dùng không đụng
 * tới thì hoàn toàn hợp lệ — ép gõ lại là ép đoán số.
 */
export function validateSalaryProfileEdit(
  initial: SalaryProfileFormState,
  current: SalaryProfileFormState,
  opts: SalaryProfileEditOpts,
): SalaryProfileValidation {
  const patch = buildSalaryProfileUpdatePayload(initial, current, opts);
  const errors: SalaryProfileFormErrorKey[] = [];
  const badItemIndexes: number[] = [];

  if (Object.keys(patch).length === 0)
    return { errors: ["salaryProfileForm.noChange"], badItemIndexes };

  if (patch.effectiveDate !== undefined && !DATE_RE.test(patch.effectiveDate)) {
    errors.push("salaryProfileForm.effectiveDateInvalid");
  }
  if (patch.baseSalary !== undefined) {
    const base = parseMoneyInput(current.baseSalary);
    if (base === null || Number.isNaN(base) || base <= 0) {
      errors.push("salaryProfileForm.baseSalaryInvalid");
    }
  }
  for (const raw of [current.insuranceSalary, current.probationSalary]) {
    const v = parseMoneyInput(raw);
    if (v !== null && (Number.isNaN(v) || v < 0)) {
      errors.push("salaryProfileForm.moneyInvalid");
      break;
    }
  }
  if (patch.payRatioPct !== undefined) {
    const ratio = parseMoneyInput(current.payRatioPct);
    if (ratio === null || Number.isNaN(ratio) || ratio <= 0 || ratio > 100) {
      errors.push("salaryProfileForm.payRatioInvalid");
    }
  }
  // Sửa ghi chú là đường dùng THƯỜNG nhất của hộp này ⇒ vượt trần phải có chữ riêng, không phải 400 chung.
  if (typeof patch.note === "string" && patch.note.length > NOTE_MAX_LENGTH) {
    errors.push("salaryProfileForm.noteTooLong");
  }

  if (patch.items !== undefined) {
    const seen = new Set<string>();
    let incomplete = false;
    let duplicate = false;
    current.items.forEach((item, i) => {
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
