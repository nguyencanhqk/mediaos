/**
 * S15-PAYROLL-FE-2 — tách token công thức lương ĐỂ TÔ MÀU và GỢI Ý (PAY-SCREEN-009/010).
 *
 * ⚠️ **KHÔNG phải parser.** Cú pháp đúng/sai, vòng, độ sâu, hàm hợp lệ… do server nói (048 khi gõ, 422 khi
 * lưu) — nguồn sự thật là `apps/api/src/payroll/formula/`. Ở đây chỉ chia chuỗi thành đoạn để người đọc
 * thấy mã nào là thành phần của catalog, mã nào là biến hệ thống, mã nào KHÔNG TỒN TẠI. Tokenizer FE sai thì
 * chỉ tô màu sai, không bao giờ chặn/cho qua một công thức.
 *
 * Phân loại mã (SPEC-11 §13.6 D): `SYS_*` = đầu vào dòng lương · `TL_*`/`GT_*` = hằng luật định · mã đứng
 * trước `(` = hàm · còn lại = mã thành phần (có trong catalog ⇒ `component`, không ⇒ `unknown`).
 */

export type FormulaTokenKind =
  | "component"
  | "system"
  | "statutory"
  | "function"
  | "unknown"
  | "number"
  | "operator"
  | "space";

export interface FormulaToken {
  readonly kind: FormulaTokenKind;
  readonly text: string;
  /** Vị trí bắt đầu (chỉ số UTF-16, từ 0) — cùng hệ với `pos` của server. */
  readonly start: number;
}

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER_RE = /\d+(?:\.\d+)?/y;
const SPACE_RE = /\s+/y;
/** Từ khoá của grammar — không phải REF (`AND`/`OR`). */
const KEYWORDS: ReadonlySet<string> = new Set(["AND", "OR"]);

function classifyIdent(
  ident: string,
  nextChar: string | undefined,
  knownCodes: ReadonlySet<string>,
): FormulaTokenKind {
  if (nextChar === "(") return "function";
  if (KEYWORDS.has(ident)) return "operator";
  if (ident.startsWith("SYS_")) return "system";
  if (ident.startsWith("TL_") || ident.startsWith("GT_")) return "statutory";
  return knownCodes.has(ident) ? "component" : "unknown";
}

/** Chia công thức thành token. Ký tự lạ rơi vào `operator` (một ký tự một token) — không ném. */
export function tokenizeFormula(formula: string, knownCodes: ReadonlySet<string>): FormulaToken[] {
  const out: FormulaToken[] = [];
  let i = 0;
  while (i < formula.length) {
    const match = (re: RegExp) => {
      re.lastIndex = i;
      return re.exec(formula)?.[0] ?? null;
    };
    const space = match(SPACE_RE);
    if (space) {
      out.push({ kind: "space", text: space, start: i });
      i += space.length;
      continue;
    }
    const ident = match(IDENT_RE);
    if (ident) {
      const after = formula.slice(i + ident.length).match(/^\s*(.)/)?.[1];
      out.push({ kind: classifyIdent(ident, after, knownCodes), text: ident, start: i });
      i += ident.length;
      continue;
    }
    const num = match(NUMBER_RE);
    if (num) {
      out.push({ kind: "number", text: num, start: i });
      i += num.length;
      continue;
    }
    out.push({ kind: "operator", text: formula[i] ?? "", start: i });
    i += 1;
  }
  return out;
}

/**
 * Từ (mã) đang gõ ngay trước con trỏ — nguồn cho danh sách gợi ý. Rỗng ⇒ không gợi ý.
 * Trả `start` để thay đúng đoạn đó khi người dùng chọn một gợi ý.
 */
export function wordAtCaret(formula: string, caret: number): { word: string; start: number } {
  const before = formula.slice(0, Math.max(0, Math.min(caret, formula.length)));
  const m = before.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  if (!m) return { word: "", start: caret };
  return { word: m[0], start: caret - m[0].length };
}

/** Thay từ đang gõ bằng `code`; trả chuỗi mới + vị trí con trỏ sau mã vừa chèn. */
export function insertSuggestion(
  formula: string,
  caret: number,
  code: string,
): { formula: string; caret: number } {
  const { start } = wordAtCaret(formula, caret);
  const end = Math.max(start, Math.min(caret, formula.length));
  const next = formula.slice(0, start) + code + formula.slice(end);
  return { formula: next, caret: start + code.length };
}

/** Lọc gợi ý theo tiền tố (không phân biệt hoa/thường), tối đa `limit` mục, giữ thứ tự nguồn. */
export function filterSuggestions(
  candidates: readonly string[],
  word: string,
  limit = 8,
): string[] {
  if (word.length === 0) return [];
  const upper = word.toUpperCase();
  return candidates.filter((c) => c.startsWith(upper) && c !== upper).slice(0, limit);
}
