import { z } from "zod";

import { HR_EMPLOYMENT_TYPES, HR_SALARY_TYPES, HR_WORK_TYPES } from "./employee-write";

/**
 * S5-HR-IMPORT-BE-1 — bulk employee import contracts (SPEC-03 §7 "Import hàng loạt" / §8
 * HR.EMPLOYEE.IMPORT). Gate `import:employee` (isSensitive, mig 0496).
 *
 * A DELIBERATELY NEW schema set — NOT the media-era legacy `importEmployeeRowSchema`
 * (packages/contracts/src/employees.ts), which provisioned login accounts and used ad-hoc column names.
 *
 * LOCKED design decisions (contracts-import-dto lane; open to plan-reviewer only where noted):
 *  1. Reference fields carry NAMES (orgUnitName/positionName/jobLevelName/contractTypeName), NOT UUIDs.
 *     Rationale: the template is a human-filled spreadsheet — UUIDs are unusable there. The import
 *     service resolves each name → id via the existing HR lookups (same reference data as create).
 *  2. UNLINKED / never-provision: NO userId/password/fullName. Imported rows create employee profiles
 *     with user_id = NULL; linking a login account is a separate manual action (HR-FUNC-011). `email`
 *     is present for DUP-CHECK ONLY (warn if the address already belongs to a user) — it is never used
 *     to create an account.
 *  3. NO baseSalary / identity_* / PII. Salary needs the `update-salary` gate + audit; bulk import must
 *     never set it (mirrors the legacy note + the create/update write scope). `.strict()` blocks any
 *     such field from smuggling through the row.
 *
 * The structural enum values are reused from employee-write.ts (single source of truth) so this DTO
 * cannot drift from create/update (a spec cross-checks it).
 */

/** ISO date `YYYY-MM-DD` (matches Postgres `date` columns) — same shape as employee-write. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date YYYY-MM-DD");

/**
 * One parsed row of the import file. The parser (import service) normalises each cell (trim, blank →
 * undefined) keyed by {@link IMPORT_COLUMN_ORDER} before validating here, so every present key is a
 * deliberate value. `.strict()` is defence-in-depth against account/salary/PII smuggling.
 */
export const hrEmployeeImportRowSchema = z
  .object({
    // Optional — omit to auto-generate via SequenceService; provide to set manually (allow_manual_override).
    employeeCode: z.string().trim().min(1).max(50).optional(),
    // DUP-CHECK ONLY — never provisions a user; validated as an address only when present.
    email: z.string().trim().email().max(255).optional(),
    // Reference data BY NAME — resolved to ids server-side via HR lookups.
    orgUnitName: z.string().trim().min(1).max(200).optional(),
    positionName: z.string().trim().min(1).max(200).optional(),
    jobLevelName: z.string().trim().min(1).max(200).optional(),
    contractTypeName: z.string().trim().min(1).max(200).optional(),
    // Structural enums — same accepted values + defaults as createHrEmployeeSchema.
    workType: z.enum(HR_WORK_TYPES).default("offline"),
    employmentType: z.enum(HR_EMPLOYMENT_TYPES).default("full_time"),
    salaryType: z.enum(HR_SALARY_TYPES).default("monthly"),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .strict();
export type HrEmployeeImportRow = z.infer<typeof hrEmployeeImportRowSchema>;

/**
 * The ordered column set for the import file — the SINGLE source of truth shared by the file parser
 * (maps header/position → row key) and the downloadable template (GET /hr/employees/import/template).
 * `key` is a real field of {@link HrEmployeeImportRow}; `header` is the Vietnamese column label;
 * `example` seeds the template's sample row. Keeping both consumers on this one list stops the parser
 * and the template from drifting apart.
 */
export const IMPORT_COLUMN_ORDER: ReadonlyArray<{
  readonly key: keyof HrEmployeeImportRow;
  readonly header: string;
  readonly example: string;
}> = [
  { key: "employeeCode", header: "Mã nhân viên (bỏ trống = tự sinh)", example: "NV0001" },
  { key: "email", header: "Email (chỉ để kiểm tra trùng)", example: "an.nguyen@congty.vn" },
  { key: "orgUnitName", header: "Phòng ban / Đơn vị", example: "Phòng Kỹ thuật" },
  { key: "positionName", header: "Chức danh", example: "Kỹ sư" },
  { key: "jobLevelName", header: "Cấp bậc", example: "Senior" },
  { key: "contractTypeName", header: "Loại hợp đồng", example: "Chính thức" },
  { key: "workType", header: "Hình thức làm việc (offline/remote/hybrid)", example: "offline" },
  {
    key: "employmentType",
    header: "Loại nhân sự (full_time/part_time/freelancer/intern/probation)",
    example: "full_time",
  },
  { key: "salaryType", header: "Hình thức lương (monthly/hourly/project)", example: "monthly" },
  { key: "startDate", header: "Ngày vào làm (YYYY-MM-DD)", example: "2026-01-15" },
  { key: "endDate", header: "Ngày kết thúc (YYYY-MM-DD)", example: "" },
];

/** One failed/skipped row in a report: 1-based data-row number + the human-readable error messages. */
export const hrImportRowErrorSchema = z.object({
  row: z.number().int().positive(),
  errors: z.array(z.string()).min(1),
});
export type HrImportRowError = z.infer<typeof hrImportRowErrorSchema>;

/** Roll-up counts for an import run. `ok` = rows that passed (or were created); `fail` = rows rejected. */
export const hrImportCountsSchema = z.object({
  ok: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
});
export type HrImportCounts = z.infer<typeof hrImportCountsSchema>;

/**
 * Dry-run PREVIEW response (dryRun=true, the safe default). Validates the whole file WITHOUT writing:
 * no inserts, no sequence allocation, no audit. `errors` lists only the rows that failed validation or
 * dup-check; passing rows are reflected in `counts.ok`.
 */
export const hrImportReportSchema = z.object({
  dryRun: z.literal(true),
  fileName: z.string(),
  counts: hrImportCountsSchema,
  errors: z.array(hrImportRowErrorSchema),
});
export type HrImportReport = z.infer<typeof hrImportReportSchema>;

/** One successfully-created row in an apply result. `employeeCode` may be null if not yet allocated. */
export const hrImportCreatedRowSchema = z.object({
  row: z.number().int().positive(),
  employeeId: z.string().uuid(),
  employeeCode: z.string().nullable(),
});
export type HrImportCreatedRow = z.infer<typeof hrImportCreatedRowSchema>;

/**
 * APPLY response (dryRun=false). Partial-success: each valid row is created in its own tx (a bad row is
 * skipped + reported, it does NOT roll back the others). `sessionAuditId` is the id of the single
 * append-only `employee_import` audit row summarising the session ({fileName, ok, fail}).
 */
export const hrImportResultSchema = z.object({
  dryRun: z.literal(false),
  fileName: z.string(),
  counts: hrImportCountsSchema,
  created: z.array(hrImportCreatedRowSchema),
  skipped: z.array(hrImportRowErrorSchema),
  sessionAuditId: z.string().uuid(),
});
export type HrImportResult = z.infer<typeof hrImportResultSchema>;

/** Discriminated union of the two import responses — FE/controller branches on `dryRun`. */
export const hrImportResponseSchema = z.discriminatedUnion("dryRun", [
  hrImportReportSchema,
  hrImportResultSchema,
]);
export type HrImportResponse = z.infer<typeof hrImportResponseSchema>;

/**
 * Idempotent boolean coercion for query flags. `nestjs-zod`'s ZodValidationPipe can run twice, so the
 * preprocess must accept an already-coerced boolean unchanged (see memory
 * zod-query-param-double-pipe-idempotent).
 */
const booleanFromQuery = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return v;
}, z.boolean());

/**
 * POST /hr/employees/import query — `dryRun` defaults to TRUE so the preview (no-write) is the safe
 * default; the caller must explicitly pass `dryRun=false` to apply.
 */
export const hrEmployeeImportQuerySchema = z.object({
  dryRun: booleanFromQuery.default(true),
});
export type HrEmployeeImportQuery = z.infer<typeof hrEmployeeImportQuerySchema>;
