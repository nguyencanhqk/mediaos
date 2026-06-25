import { z } from "zod";

/**
 * S2-HR-BE-2 — HR write-core DTOs (API-03 §11.2/§11.5/§11.6/§11.7/§11.8).
 *
 * SCOPE: STRUCTURAL employee fields only. baseSalary + identity/PII (phone, notes, identity number,
 * bank account, addresses, date-of-birth, …) are DELIBERATELY EXCLUDED — salary is a sensitive write that needs the
 * `update-salary` gate (legacy salary path), and PII must never land in the append-only audit trail
 * whose masker does NOT cover those fields (BẤT BIẾN #3). Schemas are `.strict()` so a client cannot
 * smuggle `baseSalary`/PII through the write endpoints.
 *
 * Status values = the 4 DB CHECK values (active/inactive/resigned/terminated). API-03's 6-value
 * `employment_status` is not adopted (would need a DB migration + break the shipped read core).
 */

export const HR_EMPLOYEE_STATUSES = ["active", "inactive", "resigned", "terminated"] as const;
export type HrEmployeeStatus = (typeof HR_EMPLOYEE_STATUSES)[number];

const workTypeEnum = z.enum(["offline", "remote", "hybrid"]);
const employmentTypeEnum = z.enum(["full_time", "part_time", "freelancer", "intern", "probation"]);
const salaryTypeEnum = z.enum(["monthly", "hourly", "project"]);

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
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateHrEmployeeRequest = z.infer<typeof updateHrEmployeeSchema>;

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
