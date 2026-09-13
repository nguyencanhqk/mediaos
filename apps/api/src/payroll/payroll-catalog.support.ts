import type {
  FormulaIssue,
  PayrollTemplateComponentDto,
  PayrollTemplateDto,
  SalaryComponentDto,
  SalaryComponentKind,
  SalaryComponentValueType,
  StatutoryRateDto,
} from "@mediaos/contracts";
import type { PayrollStatutoryRate, PayrollTemplate, SalaryComponent } from "../db/schema/payroll";
import { isFormulaError, type FormulaError } from "./formula/formula.errors";
import { formulaSetFingerprint } from "./formula/formula.fingerprint";
import { compileGraph, type CompiledGraph, type GraphComponent } from "./formula/formula.graph";
import { FORMULA_FUNCS, hasReservedPrefix, RESERVED_WORDS } from "./formula/formula.vocabulary";
import { PAYROLL_SYSTEM_COMPONENT_CODES } from "./payroll-master-data.seeder";
import type { TemplateComponentRow } from "./payroll-templates.repository";
import { formulaErrorToHttp } from "./payroll.errors";

/**
 * S15-PAYROLL-BE-2 — phần dùng chung của ba service track B: dựng thành phần đồ thị từ hàng DB, fingerprint,
 * luật mã dành riêng, map DTO. KHÔNG truy cập DB, KHÔNG kiểm quyền (việc của service).
 *
 * `Number(...)` ở các mapper DTO là CHỦ Ý: contracts PAYROLL trả tiền dạng `number` sau khi DB đã làm tròn
 * `numeric(18,2)` — số học tiền KHÔNG diễn ra ở đây (nó ở máy công thức, nơi census cấm số thực).
 */

const RESERVED_EXACT: ReadonlySet<string> = new Set<string>([
  ...FORMULA_FUNCS,
  ...RESERVED_WORDS,
  ...PAYROLL_SYSTEM_COMPONENT_CODES,
]);

/**
 * Mã thành phần DÀNH RIÊNG (⇒ 409 024 `component-code-reserved`): tiền tố `SYS_`/`TL_`/`GT_` (mirror CHECK) ·
 * mọi mã thành phần hệ thống · 11 tên hàm · `AND`/`OR`. Tên hàm/từ khoá làm mã thì REF đó không bao giờ gọi được
 * đúng nghĩa (parser coi `MIN` đứng một mình là lỗi) — cấm từ lúc tạo thay vì để thành bẫy sau.
 */
export function isReservedComponentCode(code: string): boolean {
  return hasReservedPrefix(code) || RESERVED_EXACT.has(code);
}

/** CHECK `salary_components_value_pair_check` ở dạng TS — kiểm trên hàng SAU MERGE (MF — zod-refine-sees-payload). */
export function valuePairOk(v: {
  valueType: string;
  formula: string | null;
  fixedAmount: string | null;
}): boolean {
  switch (v.valueType) {
    case "formula":
      return v.formula !== null && v.fixedAmount === null;
    case "fixed":
      return v.fixedAmount !== null && v.formula === null;
    case "profile_item":
      return v.formula === null && v.fixedAmount === null;
    // 4 nút aggregate hệ thống — CHECK 0570 CÓ nhánh `engine`; thiếu nhánh này thì đổi TÊN/thứ tự TONG_* ra 422
    // `component-value-pair` cho thao tác trigger cho phép (silent-failure-hunter BE-2 MEDIUM-1).
    case "engine":
      return v.formula === null && v.fixedAmount === null;
    default:
      return false;
  }
}

/** Hàng catalog → thành phần đồ thị (ngữ cảnh CATALOG: công thức của chính catalog). */
export function catalogGraphComponent(row: SalaryComponent): GraphComponent {
  return {
    code: row.code,
    kind: row.kind as SalaryComponentKind,
    valueType: row.valueType as SalaryComponentValueType,
    formula: row.valueType === "formula" ? row.formula : null,
    fixedAmount: row.valueType === "fixed" ? row.fixedAmount : null,
    pitDeductible: row.pitDeductible,
  };
}

type TemplateGraphSource = Pick<
  TemplateComponentRow,
  "code" | "kind" | "valueType" | "catalogFormula" | "formulaOverride" | "fixedAmount" | "pitDeductible"
>;

/**
 * Hàng của mẫu → thành phần đồ thị (ngữ cảnh MẪU). Ghi đè công thức biến thành phần `fixed` thành `formula` trong
 * đồ thị; `engine`/`profile_item` KHÔNG nhận ghi đè (service chặn ⇒ 018 `formula-override-not-allowed`).
 */
export function templateGraphComponent(row: TemplateGraphSource): GraphComponent {
  const overridden = row.formulaOverride !== null;
  return {
    code: row.code,
    kind: row.kind as SalaryComponentKind,
    valueType: (overridden ? "formula" : row.valueType) as SalaryComponentValueType,
    formula: overridden
      ? row.formulaOverride
      : row.valueType === "formula"
        ? row.catalogFormula
        : null,
    fixedAmount: overridden || row.valueType !== "fixed" ? null : row.fixedAmount,
    pitDeductible: row.pitDeductible,
  };
}

/** Fingerprint tập công thức hiệu lực của MỘT mẫu (SPEC-11 §13.6 G tầng 1). */
export function fingerprintOf(rows: readonly TemplateComponentRow[]): string {
  return formulaSetFingerprint(
    rows.map((r) => {
      const g = templateGraphComponent(r);
      return {
        code: r.code,
        kind: r.kind,
        valueType: g.valueType,
        formula: g.formula,
        fixedAmount: g.fixedAmount,
        pitDeductible: r.pitDeductible,
        isVisible: r.isVisible,
        sortOrder: r.sortOrder,
      };
    }),
  );
}

/** Biên dịch đồ thị; lỗi engine ⇒ 422 PAYROLL-ERR có mã (không bao giờ để `FormulaError` rơi thành 500). */
export function compileOrThrow(
  components: readonly GraphComponent[],
  requireEngineNodes: boolean,
  extra: Record<string, string> = {},
): CompiledGraph {
  try {
    return compileGraph(components, { requireEngineNodes });
  } catch (err) {
    if (isFormulaError(err)) throw formulaErrorToHttp(err, extra);
    throw err;
  }
}

/** Một lỗi engine ở dạng DTO của 048 (luôn 200 — `valid:false` là kết quả hợp lệ của một lượt kiểm). */
export function formulaIssueOf(err: FormulaError): FormulaIssue {
  const d = err.details;
  return {
    code: err.code,
    kind: err.kind,
    message: err.message,
    ...(d.pos !== undefined ? { pos: d.pos } : {}),
    ...(d.ref !== undefined ? { ref: d.ref } : {}),
    ...(d.func !== undefined ? { func: d.func } : {}),
    ...(d.cycle !== undefined ? { cycle: [...d.cycle] } : {}),
  };
}

/** Số tiền nhập (đã qua Zod `multipleOf(0.01)`) → chuỗi `numeric(18,2)`. */
export const moneyInput = (n: number): string => n.toFixed(2);

export function toSalaryComponentDto(r: SalaryComponent): SalaryComponentDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind as SalaryComponentKind,
    valueType: r.valueType as SalaryComponentValueType,
    formula: r.formula ?? null,
    fixedAmount: r.fixedAmount === null ? null : Number(r.fixedAmount),
    pitDeductible: r.pitDeductible,
    isSystem: r.isSystem,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toTemplateDto(r: PayrollTemplate): PayrollTemplateDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    scope: r.scope as PayrollTemplateDto["scope"],
    orgUnitId: r.orgUnitId ?? null,
    isActive: r.isActive,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** DTO thành phần của mẫu — CỐ Ý không có `fixedAmount` (051 nằm trong `MONEY_FREE_ROUTES`). */
export function toTemplateComponentDto(r: TemplateComponentRow): PayrollTemplateComponentDto {
  return {
    componentId: r.componentId,
    code: r.code,
    name: r.name,
    kind: r.kind as SalaryComponentKind,
    valueType: r.valueType as SalaryComponentValueType,
    columnLabel: r.columnLabel,
    catalogFormula: r.catalogFormula,
    formulaOverride: r.formulaOverride,
    isVisible: r.isVisible,
    sortOrder: r.sortOrder,
  };
}

export function toStatutoryRateDto(r: PayrollStatutoryRate, inUse: boolean): StatutoryRateDto {
  const n = (v: string): number => Number(v);
  return {
    id: r.id,
    effectiveFrom: String(r.effectiveFrom),
    siEmployeePct: n(r.siEmployeePct),
    hiEmployeePct: n(r.hiEmployeePct),
    uiEmployeePct: n(r.uiEmployeePct),
    siEmployerPct: n(r.siEmployerPct),
    hiEmployerPct: n(r.hiEmployerPct),
    uiEmployerPct: n(r.uiEmployerPct),
    unionEmployerPct: n(r.unionEmployerPct),
    unionEmployeePct: n(r.unionEmployeePct),
    siCap: n(r.siCap),
    hiCap: n(r.hiCap),
    uiCap: n(r.uiCap),
    baseWage: n(r.baseWage),
    minRegionWage: n(r.minRegionWage),
    personalDeduction: n(r.personalDeduction),
    dependentDeduction: n(r.dependentDeduction),
    pitBrackets: Array.isArray(r.pitBrackets)
      ? (r.pitBrackets as Array<{ upTo: number | null; rate: number }>)
      : [],
    note: r.note ?? null,
    inUse,
    updatedAt: r.updatedAt.toISOString(),
  };
}
