import type { TenantTx } from "../db/db.service";
import type { PayrollTemplate } from "../db/schema/payroll";
import type { CompiledGraph } from "./formula/formula.graph";
import { compileOrThrow, templateGraphComponent } from "./payroll-catalog.support";
import { systemRowDrift } from "./payroll-master-data.integrity";
import {
  PAYROLL_SEED_EXPECTATIONS,
  PAYROLL_TEMPLATE_REQUIRED_INPUT_CODES,
} from "./payroll-master-data.seeder";
import type {
  PayrollTemplatesRepository,
  TemplateComponentRow,
} from "./payroll-templates.repository";
import {
  payrollConflict,
  payrollDetails,
  payrollNotFound,
  payrollUnprocessable,
  PAYROLL_ERR,
} from "./payroll.errors";

/** Mẫu đã qua đủ cổng — kèm hàng + đồ thị biên dịch để `calculate` không đọc/biên dịch lại. */
export interface UsableTemplate {
  readonly template: PayrollTemplate;
  readonly rows: readonly TemplateComponentRow[];
  readonly graph: CompiledGraph;
}

/**
 * S15-PAYROLL-BE-3 (plan §4.2 · §4.3 bước 7–8 · §0b B1) — cổng DÙNG CHUNG cho «mẫu này dùng được cho kỳ lương không»:
 * lúc GẮN (002/004, `mode = 'bind'`) và lúc TÍNH (007, `mode = 'calculate'`). Một định nghĩa — hai bản là hai luật.
 *
 * Người gọi PHẢI giữ `payrollCatalogSharedLockTx` (catalog/mẫu đứng yên tới hết tx). Thứ tự cổng CỐ ĐỊNH, ca int ghim:
 *  1. mẫu sống — không có: 002/004 ⇒ 404 010 sentinel (không oracle tenant khác); 007 ⇒ 409 023 `template-missing`
 *     `reason = template-deleted` (kỳ trỏ tới mẫu đã xoá mềm);
 *  2. `!isActive` ⇒ 409 023 `template-inactive` · `scope ≠ company` ⇒ 409 023 `template-scope-unsupported` (kỳ tính cho
 *     CẢ công ty — áp mẫu của một đơn vị cho mọi người là sai tiền im lặng, plan §3.10);
 *  3. thành phần ngưng dùng/xoá mềm ⇒ 422 018 `template-component-unknown` (khuôn 054);
 *  4. nội dung hàng `is_system` lệch hằng seeder ⇒ 422 018 `system-component-drift` (assert (7) của seeder chỉ log);
 *  5. thiếu/ghi đè một trong 4 thành phần mang đầu vào ⇒ 422 018 `template-input-missing`;
 *  6. `compileGraph(requireEngineNodes)` ⇒ 422 018 / 019 — kiểm vòng LẦN HAI (ghi thẳng DB không qua khoá catalog).
 *
 * `details` chỉ mang MÃ thành phần — không chuỗi công thức, không tiền.
 */
export async function assertUsableTemplateTx(
  tx: TenantTx,
  repo: PayrollTemplatesRepository,
  companyId: string,
  templateId: string,
  mode: "bind" | "calculate",
): Promise<UsableTemplate> {
  const template = await repo.findTx(tx, companyId, templateId);
  if (!template) {
    if (mode === "bind") throw payrollNotFound();
    throw payrollConflict(
      "TEMPLATE_CONFLICT",
      PAYROLL_ERR.TEMPLATE_MISSING,
      payrollDetails("template-missing", { reason: "template-deleted" }),
    );
  }
  if (!template.isActive) {
    throw payrollConflict(
      "TEMPLATE_CONFLICT",
      PAYROLL_ERR.TEMPLATE_INACTIVE,
      payrollDetails("template-inactive"),
    );
  }
  if (template.scope !== "company") {
    throw payrollConflict(
      "TEMPLATE_CONFLICT",
      PAYROLL_ERR.TEMPLATE_SCOPE_UNSUPPORTED,
      payrollDetails("template-scope-unsupported"),
    );
  }

  const rows = await repo.componentsTx(tx, companyId, templateId);
  assertTemplateRowsUsable(rows);
  const graph = compileOrThrow(rows.map(templateGraphComponent), true, { template: template.code });
  return { template, rows, graph };
}

/** Cổng 3–5 trên hàng đã đọc — tách để unit-test không cần DB. */
export function assertTemplateRowsUsable(rows: readonly TemplateComponentRow[]): void {
  if (rows.some((r) => !r.componentActive || r.componentDeletedAt !== null)) {
    throw payrollUnprocessable(
      "FORMULA_INVALID",
      PAYROLL_ERR.TEMPLATE_COMPONENT_UNKNOWN,
      payrollDetails("template-component-unknown"),
    );
  }

  const drifted = [
    ...new Set(
      systemRowDrift(
        rows
          .filter((r) => r.isSystem)
          .map((r) => ({
            code: r.code,
            kind: r.kind,
            valueType: r.valueType,
            formula: r.catalogFormula,
            fixedAmount: r.fixedAmount,
            pitDeductible: r.pitDeductible,
            isActive: r.componentActive,
          })),
        PAYROLL_SEED_EXPECTATIONS,
      ).map((d) => d.code),
    ),
  ].sort();
  if (drifted.length > 0) {
    const codes = drifted.join(",");
    throw payrollUnprocessable(
      "FORMULA_INVALID",
      PAYROLL_ERR.SYSTEM_COMPONENT_DRIFT(drifted.join(", ")),
      payrollDetails("system-component-drift", { components: codes }),
    );
  }

  const missing = PAYROLL_TEMPLATE_REQUIRED_INPUT_CODES.filter(
    (code) => !rows.some((r) => r.code === code && r.isSystem && r.formulaOverride === null),
  );
  if (missing.length > 0) {
    throw payrollUnprocessable(
      "FORMULA_INVALID",
      PAYROLL_ERR.TEMPLATE_INPUT_MISSING(missing.join(", ")),
      payrollDetails("template-input-missing", { components: missing.join(",") }),
    );
  }
}
