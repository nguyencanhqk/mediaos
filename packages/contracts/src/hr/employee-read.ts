import { z } from "zod";

/**
 * S2-HR-BE-1 — HR read-core DTOs (SPEC-03 / API-10).
 *
 * Sensitive projection contract (BẤT BIẾN #3): baseSalary + PII (phone/notes/contractType) are
 * SERVER-masked. A caller without `view-salary:employee` gets `baseSalary: null`; a caller without
 * `view-sensitive:employee` gets the PII fields `null`. Both are NULLABLE here so the same DTO carries
 * the masked and the revealed shape — masking is enforced server-side, never trusted to the client.
 */

/** Sortable list columns (allowlist — repository maps to a fixed ORDER BY; blocks SQL injection). */
export const HR_EMPLOYEE_SORT_FIELDS = ["fullName", "employeeCode", "status", "createdAt"] as const;
export type HrEmployeeSortField = (typeof HR_EMPLOYEE_SORT_FIELDS)[number];

export const HR_EMPLOYEE_PAGE_SIZE_MAX = 100;
export const HR_EMPLOYEE_PAGE_SIZE_DEFAULT = 20;

/**
 * GET /hr/employees query — pagination + search + filter + sort. Query params arrive as strings, so
 * page/pageSize are coerced; pageSize is clamped to a max to bound the result set.
 */
export const hrEmployeeListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(HR_EMPLOYEE_PAGE_SIZE_MAX)
    .default(HR_EMPLOYEE_PAGE_SIZE_DEFAULT),
  search: z.string().trim().min(1).optional(),
  orgUnitId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
  status: z.enum(["active", "inactive", "resigned", "terminated"]).optional(),
  sort: z.enum(HR_EMPLOYEE_SORT_FIELDS).default("fullName"),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type HrEmployeeListQuery = z.infer<typeof hrEmployeeListQuerySchema>;

/** One row in GET /hr/employees. baseSalary is null unless the caller holds view-salary:employee. */
export const hrEmployeeListItemSchema = z.object({
  id: z.string().uuid(),
  // S2-HR-BE-2: nullable — an employee can exist without a linked user (unlink-user). fullName/email
  // come from the users LEFT JOIN, so they are null for an unlinked (nameless) employee.
  userId: z.string().uuid().nullable(),
  employeeCode: z.string().nullable(),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  orgUnitId: z.string().uuid().nullable(),
  orgUnitName: z.string().nullable(),
  positionId: z.string().uuid().nullable(),
  positionName: z.string().nullable(),
  workType: z.string().nullable(),
  employmentType: z.string().nullable(),
  status: z.string(),
  /** SENSITIVE (view-salary) — null when unauthorized. */
  baseSalary: z.number().nullable(),
});
export type HrEmployeeListItem = z.infer<typeof hrEmployeeListItemSchema>;

/** GET /hr/employees/:id detail. Sensitive fields null/omitted unless authorized. */
export const hrEmployeeDetailSchema = z.object({
  id: z.string().uuid(),
  // S2-HR-BE-2: nullable for an unlinked employee (see list-item note).
  userId: z.string().uuid().nullable(),
  employeeCode: z.string().nullable(),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  orgUnitId: z.string().uuid().nullable(),
  orgUnitName: z.string().nullable(),
  positionId: z.string().uuid().nullable(),
  positionName: z.string().nullable(),
  directManagerId: z.string().uuid().nullable(),
  workType: z.string().nullable(),
  employmentType: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: z.string(),
  /** SENSITIVE (view-salary) — null when unauthorized. */
  baseSalary: z.number().nullable(),
  salaryType: z.string().nullable(),
  /** PII (view-sensitive) — null when unauthorized. */
  phone: z.string().nullable(),
  contractType: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type HrEmployeeDetail = z.infer<typeof hrEmployeeDetailSchema>;

/** GET /hr/me/profile — the caller's own linked profile (same shape as detail). */
export const hrMeProfileSchema = hrEmployeeDetailSchema;
export type HrMeProfile = z.infer<typeof hrMeProfileSchema>;

/** Paginated envelope meta for HR list responses (mirrors paginationSchema field set). */
export const hrPageMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});
export type HrPageMeta = z.infer<typeof hrPageMetaSchema>;

export const hrEmployeeListResponseSchema = z.object({
  items: z.array(hrEmployeeListItemSchema),
  meta: hrPageMetaSchema,
});
export type HrEmployeeListResponse = z.infer<typeof hrEmployeeListResponseSchema>;
