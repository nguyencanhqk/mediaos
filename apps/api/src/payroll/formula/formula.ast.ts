import type { FormulaFunc } from "./formula.vocabulary";

/**
 * S15-PAYROLL-BE-2 — AST của công thức (SPEC-11 §13.6 A). Mọi node BẤT BIẾN (`readonly`).
 *
 * Chuỗi `+ −` và `× ÷` là node **n-ngôi** (`add` · `mul`), KHÔNG phải cây nhị phân lệch trái: công thức
 * `A + B + … + Y` (25 số hạng) có độ sâu 2 chứ không phải 25 — trần độ sâu 20 (§13.6 B) nhắm vào LỒNG NHAU
 * làm tràn stack, không nhắm vào một phép cộng dài. Trần 200 node vẫn chặn chi phí.
 */

export type CmpOp = "=" | "<>" | "<" | "<=" | ">" | ">=";

export interface NumNode {
  readonly t: "num";
  readonly pos: number;
  /** Literal thập phân NGUYÊN VĂN — đi thẳng vào `new D(value)`, không qua số thực. */
  readonly value: string;
}

export interface RefNode {
  readonly t: "ref";
  readonly pos: number;
  readonly name: string;
}

export interface NegNode {
  readonly t: "neg";
  readonly pos: number;
  readonly arg: FormulaNode;
}

export interface AddNode {
  readonly t: "add";
  readonly pos: number;
  /** Số hạng đầu luôn mang dấu `+`. */
  readonly terms: readonly { readonly sign: "+" | "-"; readonly node: FormulaNode }[];
}

export interface MulNode {
  readonly t: "mul";
  readonly pos: number;
  /** Thừa số đầu luôn mang `*`; `pos` của thừa số = vị trí báo lỗi chia cho 0. */
  readonly factors: readonly {
    readonly op: "*" | "/";
    readonly node: FormulaNode;
    readonly pos: number;
  }[];
}

export interface CmpNode {
  readonly t: "cmp";
  readonly pos: number;
  readonly op: CmpOp;
  readonly left: FormulaNode;
  readonly right: FormulaNode;
}

export interface LogicNode {
  readonly t: "and" | "or";
  readonly pos: number;
  readonly args: readonly FormulaNode[];
}

export interface CallNode {
  readonly t: "call";
  readonly pos: number;
  readonly name: FormulaFunc;
  readonly args: readonly FormulaNode[];
}

export type FormulaNode =
  | NumNode
  | RefNode
  | NegNode
  | AddNode
  | MulNode
  | CmpNode
  | LogicNode
  | CallNode;

export interface ParsedFormula {
  readonly ast: FormulaNode;
  /** REF duy nhất theo thứ tự xuất hiện đầu tiên (chưa phân giải). */
  readonly refs: readonly string[];
  readonly depth: number;
  readonly nodes: number;
}

/**
 * Tham số `n` của `ROUND(x, n)` — LITERAL số nguyên, cho phép một dấu `-` đơn. Trả `null` nếu node không có
 * hình dạng đó. Không dùng `Number(...)`: so ký tự sau khi bỏ số 0 đứng đầu (miền hợp lệ chỉ `[-6, 6]`).
 */
export function integerLiteralOf(node: FormulaNode): number | null {
  const lit = node.t === "num" ? node : node.t === "neg" && node.arg.t === "num" ? node.arg : null;
  if (!lit || lit.value.includes(".")) return null;
  const stripped = lit.value.replace(/^0+/, "");
  if (stripped.length > 1) return null; // ≥ 10 — ngoài miền, người gọi báo lỗi
  const magnitude = stripped === "" ? 0 : stripped.charCodeAt(0) - "0".charCodeAt(0);
  return node.t === "neg" ? -magnitude : magnitude;
}
