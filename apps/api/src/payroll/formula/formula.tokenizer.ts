import { FormulaError } from "./formula.errors";
import { isReservedWord } from "./formula.vocabulary";

/**
 * S15-PAYROLL-BE-2 — tokenizer của grammar công thức (SPEC-11 §13.6 A).
 *
 * Quét TỪNG KÝ TỰ bằng so sánh tĩnh — KHÔNG `new RegExp(input)`, KHÔNG `eval`. Mọi ký tự ngoài bảng chữ cái
 * của grammar (chữ thường · unicode · NUL · nháy · ngoặc vuông · `$` · `!` · `;` …) ⇒ `formula-syntax` kèm vị
 * trí. `pos` là chỉ số UTF-16 (đúng thứ `String.prototype` và editor FE dùng).
 */

export type TokenType = "num" | "ident" | "keyword" | "lparen" | "rparen" | "comma" | "op" | "eof";

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly pos: number;
}

/** `\d{1,15}` phần nguyên · `\.\d{1,6}` phần thập phân (§13.6 A). */
const NUMBER_INT_MAX_DIGITS = 15;
const NUMBER_FRAC_MAX_DIGITS = 6;
/** `[A-Z][A-Z0-9_]{0,31}` ⇒ tối đa 32 ký tự. */
const IDENT_MAX_LENGTH = 32;

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isUpper = (c: string): boolean => c >= "A" && c <= "Z";
const isIdentTail = (c: string): boolean => isUpper(c) || isDigit(c) || c === "_";
const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";

const syntax = (pos: number, reason: string): FormulaError =>
  new FormulaError("formula-syntax", `Công thức sai cú pháp tại vị trí ${pos + 1}.`, {
    pos,
    reason,
  });

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (isDigit(c)) {
      i = readNumber(src, i, out);
      continue;
    }
    if (isUpper(c)) {
      i = readIdent(src, i, out);
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ type: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "=" || c === "<" || c === ">") {
      out.push({ type: "op", value: c, pos: i });
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push({ type: c === "(" ? "lparen" : c === ")" ? "rparen" : "comma", value: c, pos: i });
      i++;
      continue;
    }
    throw syntax(i, "invalid-character");
  }
  out.push({ type: "eof", value: "", pos: src.length });
  return out;
}

function readNumber(src: string, start: number, out: Token[]): number {
  let i = start;
  while (i < src.length && isDigit(src[i])) i++;
  if (i - start > NUMBER_INT_MAX_DIGITS) throw syntax(start, "number-too-long");
  if (src[i] === ".") {
    const fracStart = i + 1;
    let j = fracStart;
    while (j < src.length && isDigit(src[j])) j++;
    if (j === fracStart) throw syntax(i, "number-missing-fraction");
    if (j - fracStart > NUMBER_FRAC_MAX_DIGITS) throw syntax(fracStart, "number-too-long");
    i = j;
  }
  // `12ABC` / `1.5.2` — số dính liền định danh hoặc dấu chấm thứ hai là sai cú pháp, không phải hai token.
  if (i < src.length && (isIdentTail(src[i]) || src[i] === "."))
    throw syntax(i, "number-malformed");
  out.push({ type: "num", value: src.slice(start, i), pos: start });
  return i;
}

function readIdent(src: string, start: number, out: Token[]): number {
  let i = start + 1;
  while (i < src.length && isIdentTail(src[i])) i++;
  if (i - start > IDENT_MAX_LENGTH) throw syntax(start, "identifier-too-long");
  const value = src.slice(start, i);
  out.push({ type: isReservedWord(value) ? "keyword" : "ident", value, pos: start });
  return i;
}
