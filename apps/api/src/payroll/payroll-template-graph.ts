import type { SalaryComponentKind, SalaryComponentValueType } from "@mediaos/contracts";
import type { GraphComponent } from "./formula/formula.graph";
import type { TemplateComponentRow } from "./payroll-templates.repository";

/**
 * S15-PAYROLL-DB-1B (plan §3.8 M-2) — module LÁ: hàng của mẫu → thành phần đồ thị.
 *
 * Tách khỏi `payroll-catalog.support.ts` vì assert (5) của seeder phải dựng đồ thị GIỐNG HỆT 053 · 054 · BE-3, mà
 * support import seeder (vòng import). Chỉ import KIỂU — không kéo seeder, service hay DB vào. Support re-export
 * hàm này nên mọi call site cũ giữ nguyên.
 */
export type TemplateGraphSource = Pick<
  TemplateComponentRow,
  | "code"
  | "kind"
  | "valueType"
  | "catalogFormula"
  | "formulaOverride"
  | "fixedAmount"
  | "pitDeductible"
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
