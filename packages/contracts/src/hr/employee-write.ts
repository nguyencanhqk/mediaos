import { z } from "zod";
import { hrPersonalExtraSchema } from "./employee-read";

/**
 * S2-HR-BE-2 — HR write-core DTOs (API-03 §11.2/§11.5/§11.6/§11.7/§11.8).
 *
 * SCOPE gốc: STRUCTURAL fields. baseSalary + identity_number/bank vẫn DELIBERATELY EXCLUDED
 * (salary cần gate update-salary; identity/bank chờ HR-IDENTITY-READ-1). Schemas `.strict()` chặn
 * smuggling qua write endpoint.
 *
 * HR-PROFILE-UI-1b (owner 2026-07-11): PATCH mở thêm 2 nhóm:
 *   - DIRECTORY (officialDate/probationEndDate/workLocation) — audit giá trị bình thường.
 *   - PERSONAL/PII (gender…taxCode/personalExtra) — service GATE fail-closed: body chạm nhóm này đòi
 *     caller có `view-sensitive:employee` per-row (không thấy thì không được sửa), và audit_logs CHỈ
 *     ghi TÊN field — giá trị mask "[masked]" (BẤT BIẾN #3, audit append-only nên rò là vĩnh viễn).
 *   - personalExtra = FULL-REPLACE: key hiện diện ⇒ thay nguyên blob ({}/null ⇒ xóa blob).
 *
 * Status values = the 4 DB CHECK values (active/inactive/resigned/terminated). API-03's 6-value
 * `employment_status` is not adopted (would need a DB migration + break the shipped read core).
 */

export const HR_EMPLOYEE_STATUSES = ["active", "inactive", "resigned", "terminated"] as const;
export type HrEmployeeStatus = (typeof HR_EMPLOYEE_STATUSES)[number];

/**
 * Structural enum value tuples — the SINGLE source of truth reused by the create/update DTOs here and
 * by the bulk-import row DTO (employee-import.ts). Exporting the arrays (not just the z.enum) lets the
 * import schema reuse the exact accepted values without re-declaring literals (drift-guarded by spec).
 */
export const HR_WORK_TYPES = ["offline", "remote", "hybrid"] as const;
export const HR_EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "freelancer",
  "intern",
  "probation",
] as const;
export const HR_SALARY_TYPES = ["monthly", "hourly", "project"] as const;

const workTypeEnum = z.enum(HR_WORK_TYPES);
const employmentTypeEnum = z.enum(HR_EMPLOYMENT_TYPES);
const salaryTypeEnum = z.enum(HR_SALARY_TYPES);

/** ISO date `YYYY-MM-DD` (matches Postgres `date` columns). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date YYYY-MM-DD");

// ── Create ───────────────────────────────────────────────────────────────────────
/**
 * POST /hr/employees. A user is always resolved: pass an existing `userId`, OR `email` (+ optional
 * `fullName`/`password`) to provision a login account. `employeeCode` is optional — omit to auto-generate
 * via SequenceService; provide to set manually (subject to `allow_manual_override`).
 */
export const createHrEmployeeSchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().email().optional(),
    fullName: z.string().min(1).max(200).optional(),
    password: z.string().min(8).max(200).optional(),
    employeeCode: z.string().min(1).max(50).optional(),
    orgUnitId: z.string().uuid().optional(),
    positionId: z.string().uuid().optional(),
    jobLevelId: z.string().uuid().optional(),
    contractTypeId: z.string().uuid().optional(),
    directManagerId: z.string().uuid().optional(),
    workType: workTypeEnum.default("offline"),
    employmentType: employmentTypeEnum.default("full_time"),
    salaryType: salaryTypeEnum.default("monthly"),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.userId) || Boolean(v.email), {
    message: "Provide userId, or email (+ fullName) to create a login account",
    path: ["userId"],
  });
export type CreateHrEmployeeRequest = z.infer<typeof createHrEmployeeSchema>;

// ── Update ───────────────────────────────────────────────────────────────────────
/**
 * PATCH /hr/employees/:id. Structural fields only — NOT status (use change-status) and NOT user link
 * (use link/unlink). All optional; every present key is an intentional change.
 */
export const updateHrEmployeeSchema = z
  .object({
    employeeCode: z.string().min(1).max(50).optional(),
    orgUnitId: z.string().uuid().nullable().optional(),
    positionId: z.string().uuid().nullable().optional(),
    jobLevelId: z.string().uuid().nullable().optional(),
    contractTypeId: z.string().uuid().nullable().optional(),
    directManagerId: z.string().uuid().nullable().optional(),
    workType: workTypeEnum.optional(),
    employmentType: employmentTypeEnum.optional(),
    salaryType: salaryTypeEnum.optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    // HR-PROFILE-UI-1b — DIRECTORY (audit giá trị bình thường).
    officialDate: isoDate.nullable().optional(),
    probationEndDate: isoDate.nullable().optional(),
    workLocation: z.string().min(1).max(255).nullable().optional(),
    // HR-PROFILE-UI-1b — PERSONAL/PII (service gate view-sensitive per-row; audit mask giá trị).
    gender: z.enum(["Male", "Female", "Other"]).nullable().optional(),
    dateOfBirth: isoDate.nullable().optional(),
    maritalStatus: z.enum(["single", "married", "other"]).nullable().optional(),
    personalEmail: z.string().email().max(255).nullable().optional(),
    phone: z.string().min(1).max(50).nullable().optional(),
    currentAddress: z.string().min(1).max(1000).nullable().optional(),
    permanentAddress: z.string().min(1).max(1000).nullable().optional(),
    emergencyContactName: z.string().min(1).max(255).nullable().optional(),
    emergencyContactPhone: z.string().min(1).max(50).nullable().optional(),
    taxCode: z.string().min(1).max(100).nullable().optional(),
    personalExtra: hrPersonalExtraSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateHrEmployeeRequest = z.infer<typeof updateHrEmployeeSchema>;

/**
 * HR-PROFILE-UI-1b — nhóm key PII của PATCH (một nguồn sự thật BE↔FE): body chạm bất kỳ key nào dưới
 * đây ⇒ HrWriteService đòi view-sensitive:employee (fail-closed) + audit mask giá trị.
 */
export const HR_EMPLOYEE_PII_WRITE_FIELDS = [
  "gender",
  "dateOfBirth",
  "maritalStatus",
  "personalEmail",
  "phone",
  "currentAddress",
  "permanentAddress",
  "emergencyContactName",
  "emergencyContactPhone",
  "taxCode",
  "personalExtra",
] as const satisfies readonly (keyof UpdateHrEmployeeRequest)[];
export type HrEmployeePiiWriteField = (typeof HR_EMPLOYEE_PII_WRITE_FIELDS)[number];

// ── Write responses ────────────────────────────────────────────────────────────────
/** POST /hr/employees response — the new id + allocated code + resolved login user. */
export const createHrEmployeeResponseSchema = z.object({
  id: z.string().uuid(),
  employeeCode: z.string().nullable(),
  userId: z.string().uuid().nullable(),
});
export type CreateHrEmployeeResponse = z.infer<typeof createHrEmployeeResponseSchema>;

/** PATCH /hr/employees/:id response — the id + the list of fields actually changed. */
export const updateHrEmployeeResponseSchema = z.object({
  id: z.string().uuid(),
  changedFields: z.array(z.string()),
});
export type UpdateHrEmployeeResponse = z.infer<typeof updateHrEmployeeResponseSchema>;

// ── Change status ──────────────────────────────────────────────────────────────────
/** POST /hr/employees/:id/change-status. `lockUser` only takes effect for resigned/terminated. */
export const changeEmployeeStatusSchema = z
  .object({
    newStatus: z.enum(HR_EMPLOYEE_STATUSES),
    reason: z.string().max(500).optional(),
    /** Lock the linked user (status=inactive) when moving to resigned/terminated. */
    lockUser: z.boolean().default(false),
  })
  .strict();
export type ChangeEmployeeStatusRequest = z.infer<typeof changeEmployeeStatusSchema>;

// ── Link / unlink user ───────────────────────────────────────────────────────────
/** POST /hr/employees/:id/link-user — link an existing user account to an employee. */
export const linkUserSchema = z.object({ userId: z.string().uuid() }).strict();
export type LinkUserRequest = z.infer<typeof linkUserSchema>;

/** DELETE /hr/employees/:id/link-user — detach the user; optionally lock the detached account. */
export const unlinkUserSchema = z
  .object({
    lockUser: z.boolean().default(false),
    reason: z.string().max(500).optional(),
  })
  .strict();
export type UnlinkUserRequest = z.infer<typeof unlinkUserSchema>;
