import { D, type Dec } from "./formula.decimal";
import { FormulaError } from "./formula.errors";
import type { StatutoryRef } from "./formula.vocabulary";

/**
 * S15-PAYROLL-BE-2 — giá trị luật định đi vào máy công thức (SPEC-11 §13.7) + kiểm bậc TNCN.
 *
 * CHECK `payroll_statutory_rates_brackets_check` chỉ ép HÌNH DẠNG (mảng 7 phần tử). Tính LIÊN TỤC ép ở ĐÂY,
 * gọi ở CẢ HAI thời điểm: lúc LƯU bản tỉ lệ (056/058) và lúc dựng `StatutoryValues` để tính (054 preview ·
 * BE-3 calculate) ⇒ 422 PAYROLL-ERR-022 `statutory-rate-incomplete`.
 */

export const PIT_BRACKET_COUNT = 7;

export interface StatutoryValues {
  /** `TL_*` là PHẦN TRĂM (8.00 = 8%) · `GT_*` là SỐ TIỀN — đúng đơn vị cột DB, không quy đổi. */
  readonly refs: Readonly<Record<StatutoryRef, Dec>>;
  /** Trần đóng lưu THÀNH TIỀN — KHÔNG nhân lại hệ số (§13.7 B). */
  readonly caps: { readonly BHXH: Dec; readonly BHYT: Dec; readonly BHTN: Dec };
  readonly pitBrackets: readonly { readonly upTo: Dec | null; readonly rate: Dec }[];
}

/** Hình dạng thô — từ hàng DB (`numeric` ⇒ chuỗi, `jsonb` ⇒ số) hoặc body preview (số). */
export interface StatutoryRateInput {
  readonly siEmployeePct: string | number;
  readonly hiEmployeePct: string | number;
  readonly uiEmployeePct: string | number;
  readonly siEmployerPct: string | number;
  readonly hiEmployerPct: string | number;
  readonly uiEmployerPct: string | number;
  readonly unionEmployerPct: string | number;
  readonly unionEmployeePct: string | number;
  readonly siCap: string | number;
  readonly hiCap: string | number;
  readonly uiCap: string | number;
  readonly personalDeduction: string | number;
  readonly dependentDeduction: string | number;
  readonly pitBrackets: unknown;
}

interface RawBracket {
  readonly upTo: unknown;
  readonly rate: unknown;
}

const incomplete = (reason: string, index?: number): FormulaError =>
  new FormulaError(
    "statutory-rate-incomplete",
    index === undefined
      ? `Bảng bậc thuế TNCN không hợp lệ (${reason}).`
      : `Bảng bậc thuế TNCN không hợp lệ ở bậc thứ ${index + 1} (${reason}).`,
    { reason, ...(index === undefined ? {} : { pos: index }) },
  );

/** Khuôn thập phân TĨNH (không `new RegExp` từ input) — chặn chuỗi rác trước khi `new D()` ném lỗi thư viện. */
const DECIMAL_STRING = /^-?\d{1,18}(\.\d{1,6})?$/;

const isNumeric = (v: unknown): v is string | number =>
  (typeof v === "number" && isFinite(v)) || (typeof v === "string" && DECIMAL_STRING.test(v));

/**
 * Đúng 7 bậc · `upTo` là số DƯƠNG tăng CHẶT · CHỈ bậc cuối `null` · `rate ∈ [0, 100]`.
 *
 * Với biểu diễn chỉ-cận-trên, «chồng» = `upTo` không tăng chặt (`not-increasing`); «hở» = một bậc giữa
 * `null` (`open-not-last` — mọi bậc sau nó không bao giờ đạt tới). Hai hình dạng hỏng còn lại của DB-13 §13.7:
 * bậc cuối có `upTo` (`last-not-open`) và số bậc ≠ 7 (`count`).
 */
export function assertBracketsContinuous(raw: unknown): { upTo: Dec | null; rate: Dec }[] {
  if (!Array.isArray(raw) || raw.length !== PIT_BRACKET_COUNT) throw incomplete("count");
  const out: { upTo: Dec | null; rate: Dec }[] = [];
  let previous: Dec | null = null;
  raw.forEach((item: RawBracket, index) => {
    if (typeof item !== "object" || item === null) throw incomplete("shape", index);
    if (!isNumeric(item.rate)) throw incomplete("shape", index);
    const rate = new D(item.rate);
    if (rate.lessThan(0) || rate.greaterThan(100)) throw incomplete("rate-range", index);
    const isLast = index === PIT_BRACKET_COUNT - 1;
    if (item.upTo === null) {
      if (!isLast) throw incomplete("open-not-last", index);
      out.push({ upTo: null, rate });
      return;
    }
    if (isLast) throw incomplete("last-not-open", index);
    if (!isNumeric(item.upTo)) throw incomplete("shape", index);
    const upTo = new D(item.upTo);
    if (upTo.lessThanOrEqualTo(0) || (previous !== null && upTo.lessThanOrEqualTo(previous))) {
      throw incomplete("not-increasing", index);
    }
    previous = upTo;
    out.push({ upTo, rate });
  });
  return out;
}

/** Dựng `StatutoryValues` — kiểm bậc LẦN NỮA (dữ liệu có thể đã bị ghi thẳng DB sau lúc lưu). */
export function toStatutoryValues(rate: StatutoryRateInput): StatutoryValues {
  const d = (v: string | number): Dec => new D(v);
  return {
    refs: {
      TL_BHXH_NV: d(rate.siEmployeePct),
      TL_BHYT_NV: d(rate.hiEmployeePct),
      TL_BHTN_NV: d(rate.uiEmployeePct),
      TL_BHXH_DN: d(rate.siEmployerPct),
      TL_BHYT_DN: d(rate.hiEmployerPct),
      TL_BHTN_DN: d(rate.uiEmployerPct),
      TL_KPCD: d(rate.unionEmployerPct),
      TL_DOAN_PHI: d(rate.unionEmployeePct),
      GT_BAN_THAN: d(rate.personalDeduction),
      GT_NPT: d(rate.dependentDeduction),
    },
    caps: { BHXH: d(rate.siCap), BHYT: d(rate.hiCap), BHTN: d(rate.uiCap) },
    pitBrackets: assertBracketsContinuous(rate.pitBrackets),
  };
}
