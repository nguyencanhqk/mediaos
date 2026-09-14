import { PAYROLL_SYS_REFS, type PayrollSysRef } from "@mediaos/contracts";

/**
 * S15-PAYROLL-BE-2 — TỪ VỰNG ĐÓNG của máy công thức lương (SPEC-11 §13.6 A · D · E).
 *
 * **NGUỒN DUY NHẤT.** Tokenizer, parser, evaluator, đồ thị, service (danh sách mã reserved) và seeder
 * (`PAYROLL_FORMULA_VOCABULARY` — census E11 của `s15-payroll-db1-seed.int-spec.ts`) đều đọc TỪ ĐÂY. Chép
 * lại ở nơi khác là hai danh sách sẽ trôi, và một REF lọt khỏi một bản là lỗ shadowing
 * (`check-can-guard-wrong-namespace`).
 *
 * Grammar KHÔNG có chuỗi ký tự, KHÔNG truy cập thuộc tính, KHÔNG gọi hàm tuỳ ý: mọi tên gọi được nằm
 * trong `FORMULA_FUNCS` dưới đây. Thêm một hàm = sửa SPEC-11 §13.6 A trước.
 */

/**
 * `SYS_*` — ĐẦU VÀO ĐÓNG BĂNG của dòng lương, chỉ đọc (§13.6 D).
 *
 * 🔁 Ba biến cuối THÊM ở `S15-PAYROLL-BE-2` (nợ DB-1): giá trị của `THUONG` · `PHAT` · `TAM_UNG` là đầu vào
 * THEO DÒNG mà 12 biến gốc không biểu diễn được. Seed ba thành phần đó bằng REF trần (`BONUS_AMOUNT`) là tự
 * tạo lỗ shadowing — theo grammar, REF không mang tiền tố `SYS_`/`TL_`/`GT_` là MÃ THÀNH PHẦN, và
 * `salary_components_code_shape_check` cho phép tenant tạo hàng cùng tên.
 */
export const SYS_REFS = PAYROLL_SYS_REFS;
export type SysRef = PayrollSysRef;

/** `TL_*` · `GT_*` — hằng luật định hiệu lực tại ngày cuối kỳ, chỉ đọc (§13.6 D · §13.7). */
export const STATUTORY_REFS = [
  "TL_BHXH_NV",
  "TL_BHYT_NV",
  "TL_BHTN_NV",
  "TL_BHXH_DN",
  "TL_BHYT_DN",
  "TL_BHTN_DN",
  "TL_KPCD",
  "TL_DOAN_PHI",
  "GT_BAN_THAN",
  "GT_NPT",
] as const;
export type StatutoryRef = (typeof STATUTORY_REFS)[number];

/** `FUNC` — danh sách ĐÓNG (§13.6 A). */
export const FORMULA_FUNCS = [
  "IF",
  "MIN",
  "MAX",
  "ROUND",
  "ABS",
  "CEIL",
  "FLOOR",
  "TNCN_LUY_TIEN",
  "BH_TRAN_BHXH",
  "BH_TRAN_BHYT",
  "BH_TRAN_BHTN",
] as const;
export type FormulaFunc = (typeof FORMULA_FUNCS)[number];

/**
 * Bảng arity ĐÓNG (SPEC-11 §13.6 A — chốt diễn giải của BE-2). `max: null` = không trần trên (vẫn bị trần
 * 200 node chặn). `ROUND` nhận tham số thứ hai là LITERAL số nguyên trong `[ROUND_DIGITS_MIN, ROUND_DIGITS_MAX]`
 * — kiểm ở parser, không ở lúc tính, để editor báo lỗi ngay khi LƯU.
 */
export const FUNC_ARITY: Readonly<Record<FormulaFunc, { min: number; max: number | null }>> = {
  IF: { min: 3, max: 3 },
  MIN: { min: 2, max: null },
  MAX: { min: 2, max: null },
  ROUND: { min: 1, max: 2 },
  ABS: { min: 1, max: 1 },
  CEIL: { min: 1, max: 1 },
  FLOOR: { min: 1, max: 1 },
  TNCN_LUY_TIEN: { min: 1, max: 1 },
  BH_TRAN_BHXH: { min: 1, max: 1 },
  BH_TRAN_BHYT: { min: 1, max: 1 },
  BH_TRAN_BHTN: { min: 1, max: 1 },
};

/** `ROUND(x, -3)` = làm tròn tới nghìn đồng; `ROUND(x, 6)` = scale trung gian hợp lý lớn nhất có nghĩa. */
export const ROUND_DIGITS_MIN = -6;
export const ROUND_DIGITS_MAX = 6;

/** Từ khoá — KHÔNG BAO GIỜ là REF, kể cả khi đứng một mình. */
export const RESERVED_WORDS = ["AND", "OR"] as const;

/**
 * BỐN nút tổng hợp do ENGINE cộng (§13.6 E) — `kind = 'aggregate'` ⇔ `value_type = 'engine'`.
 * Là NODE THẬT của đồ thị (không phải biến tính sẵn ngoài lề), để vòng `earning → TONG_THU_NHAP` bị bắt.
 */
export const ENGINE_NODE_CODES = [
  "TONG_THU_NHAP",
  "TONG_BH_NV",
  "THU_NHAP_CHIU_THUE",
  "TONG_KHAU_TRU",
] as const;
export type EngineNodeCode = (typeof ENGINE_NODE_CODES)[number];

/** Tiền tố dành riêng cho hai họ biến hệ thống — mirror `salary_components_code_shape_check`. */
export const RESERVED_CODE_PREFIXES = ["SYS_", "TL_", "GT_"] as const;

const SYS_SET: ReadonlySet<string> = new Set(SYS_REFS);
const STATUTORY_SET: ReadonlySet<string> = new Set(STATUTORY_REFS);
const FUNC_SET: ReadonlySet<string> = new Set(FORMULA_FUNCS);
const RESERVED_SET: ReadonlySet<string> = new Set(RESERVED_WORDS);

export const isSysRef = (name: string): name is SysRef => SYS_SET.has(name);
export const isStatutoryRef = (name: string): name is StatutoryRef => STATUTORY_SET.has(name);
export const isFormulaFunc = (name: string): name is FormulaFunc => FUNC_SET.has(name);
export const isReservedWord = (name: string): boolean => RESERVED_SET.has(name);

/** REF mang tiền tố hệ thống (dù có nằm trong danh sách đóng hay không). */
export const hasReservedPrefix = (name: string): boolean =>
  RESERVED_CODE_PREFIXES.some((p) => name.startsWith(p));
