import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { PAYROLL_REPORT_CODES } from "@mediaos/contracts";
import { PAYROLL_REPORTS } from "../../src/payroll/payroll-reports.registry";
import { PAYROLL_ROUTE_PAIRS } from "../../src/payroll/payroll-route-pairs.const";

/**
 * S15-PAYROLL-BE-5 (plan §0b B7) — CENSUS cặp NGUỒN của 7 báo cáo (owner O-2, 17/09/2026).
 *
 * Census 2 tầng (`payroll-two-layer-guard-census`) chỉ bắt `resolveActor(x, "<literal>")`; cặp nguồn đi qua
 * `resolveActor(user, def.sourceRouteKey)` — BIẾN ⇒ nó mù. Ca này bịt hai lỗ đó:
 *  (1) bảng `code → sourceRouteKey` ghim bằng ĐẲNG THỨC (đổi một ô = đổi quyền, phải qua review);
 *  (2) mỗi cặp nguồn là cặp ĐỌC sensitive có sàn Company;
 *  (3) AST: site 081 (`PayrollReportsService#data`) VÀ 082 (`PayrollReportExportService#export`) THỰC SỰ gọi
 *      `resolveActor(…, <x>.sourceRouteKey)` — gỡ lời gọi thì bảng (1) vẫn đúng mà cổng đã mất.
 */

const SRC = path.join(__dirname, "..", "..", "src", "payroll");

function sourceRouteKeyCalls(file: string): string[] {
  const text = fs.readFileSync(path.join(SRC, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const sites: string[] = [];
  const visit = (node: ts.Node, cls: string, method: string): void => {
    let c = cls;
    let m = method;
    if (ts.isClassDeclaration(node) && node.name) c = node.name.text;
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) m = node.name.text;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "resolveActor" &&
      node.arguments.length === 2 &&
      ts.isPropertyAccessExpression(node.arguments[1]) &&
      node.arguments[1].name.text === "sourceRouteKey"
    ) {
      sites.push(`${c}#${m}`);
    }
    ts.forEachChild(node, (child) => visit(child, c, m));
  };
  visit(sf, "?", "?");
  return sites;
}

describe("PAYROLL báo cáo — cặp NGUỒN (owner O-2)", () => {
  it("(1) bảng code → sourceRouteKey ĐẲNG THỨC, đủ 7 mã", () => {
    expect(Object.keys(PAYROLL_REPORTS).sort()).toEqual([...PAYROLL_REPORT_CODES].sort());
    const actual = Object.fromEntries(
      PAYROLL_REPORT_CODES.map((c) => [c, PAYROLL_REPORTS[c].sourceRouteKey]),
    );
    expect(actual).toEqual({
      "employee-income": "payslipList",
      "salary-by-period": null,
      "income-structure": null,
      "cost-by-org-unit": null,
      "salary-history": "salaryProfileList",
      "payment-summary": "batchList",
      "budget-status": "budgetList",
    });
  });

  it("(2) mỗi cặp nguồn là cặp ĐỌC sensitive có sàn Company", () => {
    for (const code of PAYROLL_REPORT_CODES) {
      const key = PAYROLL_REPORTS[code].sourceRouteKey;
      if (key === null) continue;
      const p = PAYROLL_ROUTE_PAIRS[key];
      expect(p.action, `${code} → ${key}`).toMatch(/^view/);
      expect(p.isSensitive, `${code} → ${key}`).toBe(true);
      expect(p.companyFloor, `${code} → ${key}`).toBe(true);
    }
  });

  it("(3) 081 + 082 gọi `resolveActor(…, def.sourceRouteKey)` — đúng hai site, mỗi site một lần", () => {
    expect(sourceRouteKeyCalls("payroll-reports.service.ts")).toEqual([
      "PayrollReportsService#data",
    ]);
    expect(sourceRouteKeyCalls("payroll-report-export.service.ts")).toEqual([
      "PayrollReportExportService#export",
    ]);
  });
});
