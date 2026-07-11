/**
 * HR-PROFILE-UI-2 — pure CSV serializer for the scoped employee-directory export. No `this`, no DB, no
 * injected deps: it shapes the already-masked list projection (HrEmployeeListItem — PII cells already
 * BLANKED server-side per view-sensitive, BẤT BIẾN #3) into an RFC-4180 CSV string, hardened against
 * formula injection. Mirrors attendance-export.csv.ts (S3-ATT-EXPORT-1).
 *
 * TWO orthogonal defenses, applied in order per cell:
 *   1. Formula-injection neutralization (OWASP): a STRING cell whose first char is =,+,-,@,TAB or CR is
 *      prefixed with a single quote so spreadsheet apps treat it as text, not a formula. Numeric/boolean
 *      cells are server-computed and never neutralized (a legit -5 must stay -5, not '-5).
 *   2. RFC-4180 quoting: a cell containing a comma, double-quote or newline is wrapped in double-quotes
 *      with any inner double-quote doubled. Applied AFTER neutralization so "=1,2" → "'=1,2" → "\"'=1,2\"".
 *
 * A UTF-8 BOM is prefixed and CRLF line endings are used so Excel (VI locale) opens it correctly. Column
 * order + headers come from the shared contract HR_EMPLOYEE_EXPORT_COLUMNS — one source of truth for the
 * server serializer and any FE preview (baseSalary/salaryType deliberately absent — salary-class).
 */

import { HR_EMPLOYEE_EXPORT_COLUMNS, type HrEmployeeListItem } from "@mediaos/contracts";

const UTF8_BOM = "﻿";
const CRLF = "\r\n";

/** Leading chars that make a spreadsheet interpret a text cell as a formula (OWASP CSV injection). */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Prefix a formula-triggering string with a single quote (neutralize). Empty string is left as-is. */
function neutralizeFormula(value: string): string {
  if (value.length > 0 && FORMULA_TRIGGERS.has(value[0])) return `'${value}`;
  return value;
}

/** RFC-4180: wrap in double-quotes (inner quotes doubled) iff the field has a comma, quote or newline. */
function quoteField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * One cell. null/undefined → empty (a masked PII cell). Numbers/booleans are server-computed → rendered
 * verbatim (never neutralized). Strings (user-controllable, e.g. fullName) → neutralized THEN quoted.
 */
function toCell(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number" || typeof raw === "boolean") return quoteField(String(raw));
  return quoteField(neutralizeFormula(String(raw)));
}

/**
 * Serialize masked list items into an RFC-4180 CSV (BOM + CRLF). Column order + headers come from the
 * shared contract HR_EMPLOYEE_EXPORT_COLUMNS — one source of truth for server and any FE preview.
 */
export function serializeHrEmployeesCsv(items: readonly HrEmployeeListItem[]): string {
  const header = HR_EMPLOYEE_EXPORT_COLUMNS.map((c) => quoteField(c.header)).join(",");
  const rows = items.map((it) =>
    HR_EMPLOYEE_EXPORT_COLUMNS.map((c) => toCell(it[c.key])).join(","),
  );
  return UTF8_BOM + [header, ...rows].join(CRLF) + CRLF;
}
