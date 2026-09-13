import { integerLiteralOf, type CmpOp, type FormulaNode, type ParsedFormula } from "./formula.ast";
import { FormulaError } from "./formula.errors";
import { FORMULA_MAX_DEPTH, FORMULA_MAX_LENGTH, FORMULA_MAX_NODES } from "./formula.limits";
import { tokenize, type Token } from "./formula.tokenizer";
import {
  FUNC_ARITY,
  isFormulaFunc,
  ROUND_DIGITS_MAX,
  ROUND_DIGITS_MIN,
  type FormulaFunc,
} from "./formula.vocabulary";

/**
 * S15-PAYROLL-BE-2 — parser recursive-descent (SPEC-11 §13.6 A · B).
 *
 * 🔴 Ràng buộc KIẾN TRÚC, không phải khuyến nghị: không `eval`, không `new Function`, không truy cập thuộc
 * tính, không gọi hàm ngoài `FORMULA_FUNCS`. Một `Function(...)` ở đây là RCE trong vùng crown.
 *
 * Thứ tự kiểm (đổi thứ tự = đổi `kind` trả về cho cùng một chuỗi — FE rẽ nhánh theo `kind`):
 *  1. `length > 500` ⇒ `formula-too-long` — TRƯỚC khi tokenize (O(1); chuỗi khổng lồ không vào vòng quét);
 *  2. tokenize ⇒ `formula-syntax` (ký tự lạ, số quá dài…);
 *  3. parse — trần node và độ sâu ép NGAY lúc dựng node, không dựng xong rồi mới đếm; mức LỒNG (ngoặc · lời
 *     gọi hàm · dấu âm) cũng tính vào độ sâu ⇒ ngoặc lồng 10.000 cấp dừng ở cấp 21, không tràn stack.
 */

interface Parsed {
  readonly node: FormulaNode;
  readonly depth: number;
}

const CMP_OPS: ReadonlySet<string> = new Set<CmpOp>(["=", "<>", "<", "<=", ">", ">="]);

const syntax = (pos: number, reason: string): FormulaError =>
  new FormulaError("formula-syntax", `Công thức sai cú pháp tại vị trí ${pos + 1}.`, {
    pos,
    reason,
  });

const tooDeep = (pos: number): FormulaError =>
  new FormulaError(
    "formula-too-deep",
    `Công thức lồng quá ${FORMULA_MAX_DEPTH} cấp (vị trí ${pos + 1}) — tách bớt thành thành phần trung gian.`,
    { pos },
  );

export function parseFormula(src: string): ParsedFormula {
  if (src.length > FORMULA_MAX_LENGTH) {
    throw new FormulaError("formula-too-long", `Công thức dài quá ${FORMULA_MAX_LENGTH} ký tự.`, {
      pos: FORMULA_MAX_LENGTH,
      reason: "max-length",
    });
  }
  const parser = new Parser(tokenize(src));
  const root = parser.parseExpr(1);
  parser.expectEnd();
  return { ast: root.node, refs: parser.refs, depth: root.depth, nodes: parser.nodes };
}

class Parser {
  nodes = 0;
  readonly refs: string[] = [];
  private readonly refSet = new Set<string>();
  private i = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parseExpr(nest: number): Parsed {
    if (nest > FORMULA_MAX_DEPTH) throw tooDeep(this.peek().pos);
    return this.parseLogic(nest, "or");
  }

  expectEnd(): void {
    const tok = this.peek();
    if (tok.type !== "eof") throw syntax(tok.pos, "unexpected-token");
  }

  private peek(): Token {
    return this.tokens[this.i];
  }

  private next(): Token {
    const tok = this.tokens[this.i];
    if (tok.type !== "eof") this.i++;
    return tok;
  }

  private mk(node: FormulaNode, depth: number): Parsed {
    this.nodes++;
    if (this.nodes > FORMULA_MAX_NODES) {
      throw new FormulaError(
        "formula-too-many-nodes",
        `Công thức có quá ${FORMULA_MAX_NODES} phần tử — tách bớt thành thành phần trung gian.`,
        { pos: node.pos },
      );
    }
    if (depth > FORMULA_MAX_DEPTH) throw tooDeep(node.pos);
    return { node, depth };
  }

  /** `orExpr := andExpr ("OR" andExpr)*` · `andExpr := cmpExpr ("AND" cmpExpr)*`. */
  private parseLogic(nest: number, kw: "or" | "and"): Parsed {
    const sub = (): Parsed => (kw === "or" ? this.parseLogic(nest, "and") : this.parseCmp(nest));
    const first = sub();
    const word = kw.toUpperCase();
    if (!(this.peek().type === "keyword" && this.peek().value === word)) return first;
    const args: FormulaNode[] = [first.node];
    let maxDepth = first.depth;
    while (this.peek().type === "keyword" && this.peek().value === word) {
      this.next();
      const rhs = sub();
      args.push(rhs.node);
      if (rhs.depth > maxDepth) maxDepth = rhs.depth;
    }
    return this.mk({ t: kw, pos: first.node.pos, args }, maxDepth + 1);
  }

  /** `cmpExpr := addExpr (CMP addExpr)?` — KHÔNG xâu chuỗi (`A < B < C` là sai cú pháp). */
  private parseCmp(nest: number): Parsed {
    const left = this.parseAdd(nest);
    const tok = this.peek();
    if (tok.type !== "op" || !CMP_OPS.has(tok.value)) return left;
    this.next();
    const right = this.parseAdd(nest);
    const depth = (left.depth > right.depth ? left.depth : right.depth) + 1;
    return this.mk(
      { t: "cmp", pos: tok.pos, op: tok.value as CmpOp, left: left.node, right: right.node },
      depth,
    );
  }

  private parseAdd(nest: number): Parsed {
    const first = this.parseMul(nest);
    const terms: { sign: "+" | "-"; node: FormulaNode }[] = [{ sign: "+", node: first.node }];
    let maxDepth = first.depth;
    for (
      let tok = this.peek();
      tok.type === "op" && (tok.value === "+" || tok.value === "-");
      tok = this.peek()
    ) {
      this.next();
      const rhs = this.parseMul(nest);
      terms.push({ sign: tok.value, node: rhs.node });
      if (rhs.depth > maxDepth) maxDepth = rhs.depth;
    }
    if (terms.length === 1) return first;
    return this.mk({ t: "add", pos: first.node.pos, terms }, maxDepth + 1);
  }

  private parseMul(nest: number): Parsed {
    const first = this.parseUnary(nest);
    const factors: { op: "*" | "/"; node: FormulaNode; pos: number }[] = [
      { op: "*", node: first.node, pos: first.node.pos },
    ];
    let maxDepth = first.depth;
    for (
      let tok = this.peek();
      tok.type === "op" && (tok.value === "*" || tok.value === "/");
      tok = this.peek()
    ) {
      this.next();
      const rhs = this.parseUnary(nest);
      factors.push({ op: tok.value, node: rhs.node, pos: rhs.node.pos });
      if (rhs.depth > maxDepth) maxDepth = rhs.depth;
    }
    if (factors.length === 1) return first;
    return this.mk({ t: "mul", pos: first.node.pos, factors }, maxDepth + 1);
  }

  /** `unary := "-" unary | primary` — mỗi dấu âm là một mức lồng (chặn `- - - … 1` tràn stack). */
  private parseUnary(nest: number): Parsed {
    const tok = this.peek();
    if (tok.type !== "op" || tok.value !== "-") return this.parsePrimary(nest);
    this.next();
    if (nest + 1 > FORMULA_MAX_DEPTH) throw tooDeep(tok.pos);
    const arg = this.parseUnary(nest + 1);
    return this.mk({ t: "neg", pos: tok.pos, arg: arg.node }, arg.depth + 1);
  }

  private parsePrimary(nest: number): Parsed {
    const tok = this.next();
    switch (tok.type) {
      case "num":
        return this.mk({ t: "num", pos: tok.pos, value: tok.value }, 1);
      case "ident": {
        if (this.peek().type === "lparen") return this.parseCall(tok, nest);
        if (isFormulaFunc(tok.value)) throw syntax(tok.pos, "function-without-call");
        if (!this.refSet.has(tok.value)) {
          this.refSet.add(tok.value);
          this.refs.push(tok.value);
        }
        return this.mk({ t: "ref", pos: tok.pos, name: tok.value }, 1);
      }
      case "lparen": {
        const inner = this.parseExpr(nest + 1);
        if (this.peek().type !== "rparen") throw syntax(this.peek().pos, "missing-close-paren");
        this.next();
        return inner;
      }
      case "eof":
        throw syntax(tok.pos, "unexpected-end");
      default:
        throw syntax(tok.pos, tok.type === "keyword" ? "unexpected-keyword" : "unexpected-token");
    }
  }

  private parseCall(nameTok: Token, nest: number): Parsed {
    const name = nameTok.value;
    if (!isFormulaFunc(name)) {
      throw new FormulaError(
        "formula-unknown-function",
        `Hàm "${name}" không có trong danh sách hàm được phép.`,
        { pos: nameTok.pos, func: name },
      );
    }
    this.next(); // "("
    const args: FormulaNode[] = [];
    let maxDepth = 0;
    if (this.peek().type !== "rparen") {
      for (;;) {
        const arg = this.parseExpr(nest + 1);
        args.push(arg.node);
        if (arg.depth > maxDepth) maxDepth = arg.depth;
        if (this.peek().type !== "comma") break;
        this.next();
      }
    }
    if (this.peek().type !== "rparen") throw syntax(this.peek().pos, "missing-close-paren");
    this.next();
    assertArity(name, args, nameTok.pos);
    return this.mk({ t: "call", pos: nameTok.pos, name, args }, maxDepth + 1);
  }
}

function assertArity(name: FormulaFunc, args: readonly FormulaNode[], pos: number): void {
  const { min, max } = FUNC_ARITY[name];
  if (args.length < min || (max !== null && args.length > max)) {
    throw new FormulaError("formula-arity", `Hàm ${name} nhận sai số tham số (${args.length}).`, {
      pos,
      func: name,
      reason: "argument-count",
    });
  }
  if (name === "ROUND" && args.length === 2) {
    const digits = integerLiteralOf(args[1]);
    if (digits === null || digits < ROUND_DIGITS_MIN || digits > ROUND_DIGITS_MAX) {
      throw new FormulaError(
        "formula-arity",
        `Tham số thứ hai của ROUND phải là số nguyên từ ${ROUND_DIGITS_MIN} đến ${ROUND_DIGITS_MAX}.`,
        { pos: args[1].pos, func: name, reason: "round-digits" },
      );
    }
  }
}
