import type { SalaryComponentKind, SalaryComponentValueType } from "@mediaos/contracts";
import type { ParsedFormula } from "./formula.ast";
import { D, exceedsNumeric18_2, intermediate, toMoney, ZERO, type Dec } from "./formula.decimal";
import { FormulaError, isFormulaError } from "./formula.errors";
import { evaluate, type Budget } from "./formula.evaluator";
import { parseFormula } from "./formula.parser";
import type { StatutoryValues } from "./formula.statutory";
import {
  ENGINE_NODE_CODES,
  hasReservedPrefix,
  isStatutoryRef,
  isSysRef,
  type EngineNodeCode,
  type SysRef,
} from "./formula.vocabulary";

/**
 * S15-PAYROLL-BE-2 — đồ thị phụ thuộc thành phần lương (SPEC-11 §13.6 D · E).
 *
 * **BỐN nút aggregate là NODE THẬT** với cạnh NGẦM dựng từ `kind` (không phải biến tính sẵn ngoài lề) — nhờ
 * vậy vòng `earning → TONG_THU_NHAP` bị bắt. Cạnh ngầm dựng BẢO THỦ (không phụ thuộc `pitPayer`): vế `tax`
 * của `TONG_KHAU_TRU` luôn là cạnh, giá trị thì chỉ cộng khi `pitPayer = 'EMPLOYEE'`.
 *
 * Bốn công thức ở `engineValue` khớp TỪNG CHỮ §13.6 E / §13.7 E — lệch một vế là lệch tiền của mọi người mà
 * mọi bất biến SQL vẫn xanh.
 */

export interface GraphComponent {
  readonly code: string;
  readonly kind: SalaryComponentKind;
  readonly valueType: SalaryComponentValueType;
  /** Công thức HIỆU LỰC (ghi đè của mẫu ?? của catalog). `null` với `fixed`/`profile_item`/`engine`. */
  readonly formula: string | null;
  /** `numeric` từ driver ⇒ chuỗi. */
  readonly fixedAmount: string | null;
  readonly pitDeductible: boolean;
}

export interface CompiledComponent extends GraphComponent {
  readonly parsed: ParsedFormula | null;
}

export interface CompiledGraph {
  /** Thứ tự topo — node đứng sau mọi node nó phụ thuộc. */
  readonly order: readonly string[];
  readonly byCode: ReadonlyMap<string, CompiledComponent>;
  readonly deps: ReadonlyMap<string, readonly string[]>;
}

export interface CompileOptions {
  /** `true` cho MẪU (053 · 054 · BE-3): thiếu một trong 4 nút aggregate ⇒ 018 `template-missing-engine-nodes`. */
  readonly requireEngineNodes: boolean;
}

const ENGINE_SET: ReadonlySet<string> = new Set(ENGINE_NODE_CODES);

export function compileGraph(
  components: readonly GraphComponent[],
  opts: CompileOptions,
): CompiledGraph {
  const byCode = new Map<string, CompiledComponent>();
  for (const c of components) {
    byCode.set(c.code, { ...c, parsed: c.valueType === "formula" ? parseWithContext(c) : null });
  }

  if (opts.requireEngineNodes) {
    const missing = ENGINE_NODE_CODES.filter((code) => byCode.get(code)?.valueType !== "engine");
    if (missing.length > 0) {
      throw new FormulaError(
        "template-missing-engine-nodes",
        `Mẫu bảng lương thiếu thành phần tổng hợp bắt buộc: ${missing.join(", ")}.`,
        { missing },
      );
    }
  }

  const deps = new Map<string, readonly string[]>();
  for (const c of byCode.values()) deps.set(c.code, dependenciesOf(c, byCode));

  return { order: topoOrder(components, deps), byCode, deps };
}

function parseWithContext(c: GraphComponent): ParsedFormula {
  if (c.formula === null) {
    throw new FormulaError("formula-syntax", `Thành phần ${c.code} thiếu công thức.`, {
      component: c.code,
      reason: "formula-missing",
    });
  }
  try {
    return parseFormula(c.formula);
  } catch (err) {
    if (isFormulaError(err)) {
      throw new FormulaError(err.kind, `${c.code}: ${err.message}`, {
        ...err.details,
        component: c.code,
      });
    }
    throw err;
  }
}

function dependenciesOf(
  c: CompiledComponent,
  byCode: ReadonlyMap<string, CompiledComponent>,
): string[] {
  const out = new Set<string>();
  if (c.parsed) {
    for (const ref of c.parsed.refs) {
      if (isSysRef(ref) || isStatutoryRef(ref)) continue;
      if (hasReservedPrefix(ref) || !byCode.has(ref)) {
        throw new FormulaError(
          "formula-unknown-ref",
          `${c.code}: tham chiếu "${ref}" không phải biến hệ thống hợp lệ hay thành phần có trong phạm vi.`,
          { component: c.code, ref },
        );
      }
      out.add(ref);
    }
  }
  if (c.valueType === "engine") {
    for (const dep of engineDependencies(c.code as EngineNodeCode, byCode)) out.add(dep);
  }
  return [...out];
}

function engineDependencies(
  code: EngineNodeCode,
  byCode: ReadonlyMap<string, CompiledComponent>,
): string[] {
  const all = [...byCode.values()];
  const ofKinds = (kinds: readonly SalaryComponentKind[]) =>
    all.filter((c) => kinds.includes(c.kind) && !ENGINE_SET.has(c.code)).map((c) => c.code);
  const present = (codes: readonly string[]) => codes.filter((x) => byCode.has(x));
  switch (code) {
    case "TONG_THU_NHAP":
      return ofKinds(["earning", "tax_exempt"]);
    case "TONG_BH_NV":
      return all
        .filter((c) => c.kind === "statutory_employee" && c.pitDeductible)
        .map((c) => c.code);
    case "THU_NHAP_CHIU_THUE":
      return [...present(["TONG_THU_NHAP", "TONG_BH_NV"]), ...ofKinds(["tax_exempt"])];
    case "TONG_KHAU_TRU":
      return ofKinds(["deduction", "statutory_employee", "tax"]);
    default:
      throw new FormulaError("template-missing-engine-nodes", `Nút tổng hợp lạ: ${String(code)}.`, {
        component: String(code),
        reason: "unknown-engine-node",
      });
  }
}

/** Kahn — ổn định theo thứ tự đầu vào; còn node chưa xếp ⇒ trích MỘT chu trình đầy đủ ⇒ 019. */
function topoOrder(
  components: readonly GraphComponent[],
  deps: ReadonlyMap<string, readonly string[]>,
): string[] {
  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const c of components) {
    const ownDeps = deps.get(c.code) as readonly string[]; // compileGraph dựng deps cho MỌI thành phần
    remaining.set(c.code, ownDeps.length);
    for (const d of ownDeps) {
      const list = dependents.get(d) ?? [];
      list.push(c.code);
      dependents.set(d, list);
    }
  }
  const order: string[] = [];
  const ready = components.map((c) => c.code).filter((code) => remaining.get(code) === 0);
  while (ready.length > 0) {
    const code = ready.shift() as string;
    order.push(code);
    for (const dependent of dependents.get(code) ?? []) {
      const left = (remaining.get(dependent) as number) - 1;
      remaining.set(dependent, left);
      if (left === 0) ready.push(dependent);
    }
  }
  if (order.length === components.length) return order;
  const cycle = findCycle(
    components.map((c) => c.code).filter((code) => (remaining.get(code) as number) > 0),
    deps,
  );
  throw new FormulaError(
    "formula-cycle",
    `Vòng phụ thuộc giữa các thành phần lương: ${cycle.join(" → ")}.`,
    {
      cycle,
      component: cycle[0],
    },
  );
}

/**
 * Trích MỘT chu trình đầy đủ từ phần Kahn còn dư. Bất biến bảo đảm vòng lặp dừng: một nút còn dư có ≥ 1 phụ thuộc
 * CHƯA xếp, mà mọi nút chưa xếp đều nằm trong `candidates` ⇒ luôn đi tiếp được trong tập đó; tập hữu hạn ⇒ phải lặp
 * lại một nút ⇒ đoạn từ lần gặp đầu tới lần lặp là chu trình.
 */
function findCycle(
  candidates: readonly string[],
  deps: ReadonlyMap<string, readonly string[]>,
): string[] {
  const inCandidates = new Set(candidates);
  const path: string[] = [];
  const seenAt = new Map<string, number>();
  let code = candidates[0];
  while (!seenAt.has(code)) {
    seenAt.set(code, path.length);
    path.push(code);
    code = (deps.get(code) as readonly string[]).find((d) => inCandidates.has(d)) as string;
  }
  return [...path.slice(seenAt.get(code)), code];
}

export interface PassInputs {
  /** ĐỦ 15 biến `SYS_*` — người gọi quyết định giá trị mặc định (preview: 0; BE-3: đầu vào thật). */
  readonly sys: Readonly<Record<SysRef, Dec>>;
  /** Định mức theo hồ sơ cho thành phần `profile_item`; vắng ⇒ 0 (không có định mức = không có khoản đó). */
  readonly profileItems: Readonly<Record<string, Dec>>;
  readonly pitPayer: "EMPLOYEE" | "COMPANY";
  readonly statutory: StatutoryValues;
}

/**
 * MỘT lượt chạy đồ thị. Gọi `budget.beginPass()` ở đây — BE-3 gọi hàm này tối đa 31 lần trên cùng `Budget`.
 * Giá trị mỗi thành phần làm tròn về scale 2 NGAY khi ghi vào map (§13.6 F); thành phần sau đọc giá trị ĐÃ tròn.
 */
export function evaluatePass(
  graph: CompiledGraph,
  inputs: PassInputs,
  budget: Budget,
): Map<string, Dec> {
  budget.beginPass();
  const values = new Map<string, Dec>();
  for (const code of graph.order) {
    const c = graph.byCode.get(code) as CompiledComponent;
    const raw = componentValue(c, graph, values, inputs, budget);
    const money = toMoney(raw);
    if (exceedsNumeric18_2(money)) {
      throw new FormulaError("numeric-overflow", `Giá trị của ${code} vượt giới hạn lưu trữ.`, {
        component: code,
      });
    }
    values.set(code, money);
  }
  return values;
}

function componentValue(
  c: CompiledComponent,
  graph: CompiledGraph,
  values: ReadonlyMap<string, Dec>,
  inputs: PassInputs,
  budget: Budget,
): Dec {
  switch (c.valueType) {
    case "formula":
      return evaluate((c.parsed as ParsedFormula).ast, {
        component: c.code,
        budget,
        statutory: inputs.statutory,
        resolveRef: (name) => {
          if (isSysRef(name)) return inputs.sys[name];
          if (isStatutoryRef(name)) return inputs.statutory.refs[name];
          return values.get(name) as Dec; // topo đảm bảo đã có
        },
      });
    case "fixed":
      budget.visit(1, c.code);
      // CHECK `salary_components_value_pair_check` ép `fixed` ⇒ CÓ số tiền. NULL ở đây là dữ liệu hỏng ⇒ ném (fail loud),
      // KHÔNG coi là 0 — một khoản cố định biến thành 0 là đúng hình dạng fail-open im lặng.
      return new D(c.fixedAmount as string);
    case "profile_item":
      budget.visit(1, c.code);
      return inputs.profileItems[c.code] ?? ZERO;
    case "engine":
      return engineValue(c.code as EngineNodeCode, graph, values, inputs, budget);
    // KHÔNG `default`: exhaustive trên `value_type` (4 giá trị) — nhánh thiếu là LỖI KIỂU, không phải số 0 (DB-13 §13.4).
  }
}

function engineValue(
  code: EngineNodeCode,
  graph: CompiledGraph,
  values: ReadonlyMap<string, Dec>,
  inputs: PassInputs,
  budget: Budget,
): Dec {
  const deps = graph.deps.get(code) as readonly string[];
  budget.visit(1 + deps.length, code);
  const sumWhere = (pred: (c: CompiledComponent) => boolean): Dec =>
    [...graph.byCode.values()]
      .filter((c) => !ENGINE_SET.has(c.code) && pred(c))
      // Mọi số hạng đều là DEPENDENCY của nút ⇒ topo đảm bảo đã tính. Thiếu là BUG ⇒ ném, KHÔNG cộng 0.
      .reduce((acc, c) => intermediate(acc.plus(values.get(c.code) as Dec)), ZERO);
  const need = (x: EngineNodeCode): Dec => {
    const v = values.get(x);
    if (!v) {
      throw new FormulaError("template-missing-engine-nodes", `Thiếu ${x} khi tính ${code}.`, {
        component: code,
        missing: [x],
      });
    }
    return v;
  };

  switch (code) {
    // Σ kind ∈ {earning, tax_exempt} — `tax_exempt` là tiền NV NHẬN ⇒ PHẢI vào tổng thu nhập (§13.6 E sửa 1).
    case "TONG_THU_NHAP":
      return sumWhere((c) => c.kind === "earning" || c.kind === "tax_exempt");
    // Σ statutory_employee CÓ pit_deductible — đoàn phí (pit_deductible=false) KHÔNG vào (§13.6 E sửa 2).
    case "TONG_BH_NV":
      return sumWhere((c) => c.kind === "statutory_employee" && c.pitDeductible);
    // MAX(TONG_THU_NHAP − TONG_BH_NV − GT_BAN_THAN − GT_NPT × SYS_DEPENDENTS − Σ tax_exempt, 0)
    case "THU_NHAP_CHIU_THUE": {
      const taxable = intermediate(
        need("TONG_THU_NHAP")
          .minus(need("TONG_BH_NV"))
          .minus(inputs.statutory.refs.GT_BAN_THAN)
          .minus(intermediate(inputs.statutory.refs.GT_NPT.times(inputs.sys.SYS_DEPENDENTS)))
          .minus(sumWhere((c) => c.kind === "tax_exempt")),
      );
      return taxable.lessThan(ZERO) ? ZERO : taxable;
    }
    // Σ {deduction, statutory_employee} + (Σ tax CHỈ KHI pit_payer = EMPLOYEE) — statutory_employer KHÔNG vào (§13.6 E sửa 3).
    case "TONG_KHAU_TRU": {
      const base = sumWhere((c) => c.kind === "deduction" || c.kind === "statutory_employee");
      if (inputs.pitPayer !== "EMPLOYEE") return base;
      return intermediate(base.plus(sumWhere((c) => c.kind === "tax")));
    }
  }
}
