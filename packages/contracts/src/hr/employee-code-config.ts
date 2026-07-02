import { z } from "zod";

/**
 * S2-HR-BE-7 — Employee-code CONFIG admin contracts (API-03 §10.10 HR-API-901/902/903).
 *
 * `employee_code_configs` holds ONLY the FORMAT of the employee code (prefix/pattern/number_length/
 * allow_manual_override/status) — DB-03 §4.8. The running counter (padding/reset_policy/current_value)
 * lives in `sequence_counters` (S1-FND-SEQ-1); this surface NEVER exposes or mutates the counter value.
 *
 * Source of truth for the DTO shape = this Zod schema (packages/contracts). Validation runs at the HTTP
 * boundary (ZodValidationPipe) → a bad number_length / status is rejected with 422 before the service.
 */

/** Config status enum — mirrors the DB CHECK `status IN ('active','inactive')` (hr-master schema). */
const employeeCodeConfigStatusEnum = z.enum(["active", "inactive"]);

/** number_length is app-bounded (the DB has no CHECK on it) — reject out-of-range with 422. */
export const EMPLOYEE_CODE_NUMBER_LENGTH_MIN = 1;
export const EMPLOYEE_CODE_NUMBER_LENGTH_MAX = 12;

/**
 * GET /hr/employee-code-config response (HR-API-901). `id`/`createdAt`/`updatedAt` are nullable because a
 * tenant may not have persisted a config row yet → the server returns the effective defaults, never 404.
 */
export const employeeCodeConfigSchema = z.object({
  id: z.string().uuid().nullable(),
  companyId: z.string().uuid(),
  prefix: z.string().nullable(),
  pattern: z.string().nullable(),
  numberLength: z.number().int(),
  allowManualOverride: z.boolean(),
  status: employeeCodeConfigStatusEnum,
  createdAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date().nullable(),
});
export type EmployeeCodeConfigDto = z.infer<typeof employeeCodeConfigSchema>;

/**
 * PATCH /hr/employee-code-config body (HR-API-902). Every field optional (partial update) but at least
 * one must be present. `prefix`/`pattern` are nullable (clearable). value_type is enforced here:
 * number_length must be an int within bounds; status must be the active/inactive enum.
 */
export const updateEmployeeCodeConfigSchema = z
  .object({
    prefix: z.string().max(20).nullable().optional(),
    pattern: z.string().max(100).nullable().optional(),
    numberLength: z
      .number()
      .int()
      .min(EMPLOYEE_CODE_NUMBER_LENGTH_MIN)
      .max(EMPLOYEE_CODE_NUMBER_LENGTH_MAX)
      .optional(),
    allowManualOverride: z.boolean().optional(),
    status: employeeCodeConfigStatusEnum.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateEmployeeCodeConfigRequest = z.infer<typeof updateEmployeeCodeConfigSchema>;

/**
 * POST /hr/employee-code/preview response (HR-API-903). Mirror of SequenceService.previewNextCode result
 * (NextCodeResult) — the NEXT code WITHOUT mutating the counter.
 */
export const employeeCodePreviewResponseSchema = z.object({
  sequenceKey: z.string(),
  value: z.number().int(),
  code: z.string(),
});
export type EmployeeCodePreviewResponse = z.infer<typeof employeeCodePreviewResponseSchema>;
