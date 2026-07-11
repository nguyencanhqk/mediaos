import { z } from "zod";

import { HR_EMPLOYEE_SORT_FIELDS } from "./employee-read";
import type { HrEmployeeListItem } from "./employee-read";

/**
 * HR-PROFILE-UI-2 (HR.EMPLOYEE.EXPORT, SPEC-03 / API-10) — CSV export of the scoped employee
 * directory. Gate `export:employee` (mig 0491, isSensitive:true — fail-closed, wildcard-only grants
 * do NOT satisfy it). The SAME data-scope contract as the employee list (Own/Team/Company via
 * resolveAndAssert + buildEmployeeScope Condition) bounds the rows SERVER-side before serialize.
 *
 * Mirrors packages/contracts/src/attendance.ts's ATTENDANCE_EXPORT_* pattern (S3-ATT-EXPORT-1).
 */

/** Hard cap on exported rows — a result exceeding it returns 422 (never a silently-truncated file). */
export const HR_EMPLOYEE_EXPORT_MAX_ROWS = 10_000;

/**
 * GET /hr/employees/export query — mirrors hrEmployeeListQuerySchema's FILTER fields (parity with the
 * company list: search/orgUnitId/positionId/status) plus OPTIONAL sort/order, but carries NO
 * page/pageSize: the export is a single capped pull, not a page.
 */
export const hrEmployeeExportQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  orgUnitId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
  status: z.enum(["active", "inactive", "resigned", "terminated"]).optional(),
  sort: z.enum(HR_EMPLOYEE_SORT_FIELDS).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});
export type HrEmployeeExportQuery = z.infer<typeof hrEmployeeExportQuerySchema>;

/**
 * Ordered CSV column set for the employee directory export. `key` is a field of HrEmployeeListItem
 * (the same masked list projection the company list serves) — this list is the SINGLE source of
 * truth for both the column order and the header row, so the server serializer and any FE preview
 * stay in lockstep.
 *
 * `pii: true` marks columns gated behind `view-sensitive:employee` (server blanks the cell per-row
 * when the caller lacks the grant — masking is enforced server-side, never trusted to the client).
 * Deliberately excludes baseSalary/salaryType (view-salary class, SPEC-03 §18.8) — owner decision:
 * avoid a per-row salary reveal via export (see WO acceptance notes).
 */
export const HR_EMPLOYEE_EXPORT_COLUMNS: ReadonlyArray<{
  readonly key: keyof HrEmployeeListItem;
  readonly header: string;
  readonly pii?: boolean;
}> = [
  { key: "employeeCode", header: "Mã nhân viên" },
  { key: "fullName", header: "Họ tên" },
  { key: "email", header: "Email" },
  { key: "orgUnitName", header: "Đơn vị" },
  { key: "positionName", header: "Chức danh" },
  { key: "workType", header: "Hình thức làm việc" },
  { key: "employmentType", header: "Loại hợp đồng" },
  { key: "status", header: "Trạng thái" },
  { key: "startDate", header: "Ngày vào làm" },
  { key: "officialDate", header: "Ngày chính thức" },
  { key: "workLocation", header: "Nơi làm việc" },
  { key: "gender", header: "Giới tính", pii: true },
  { key: "dateOfBirth", header: "Ngày sinh", pii: true },
  { key: "phone", header: "Điện thoại", pii: true },
  { key: "contractType", header: "Loại hợp đồng lao động", pii: true },
] as const;
