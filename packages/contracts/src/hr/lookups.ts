import { z } from "zod";

/**
 * S2-HR-BE-1 — HR lookup DTOs (department / position / job-level / contract-type) + employee-code
 * preview. Lookups are non-sensitive reference data; they NEVER carry salary/PII.
 */

/** org_units → department lookup item. */
export const hrDepartmentLookupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
});
export type HrDepartmentLookup = z.infer<typeof hrDepartmentLookupSchema>;

export const hrPositionLookupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
});
export type HrPositionLookup = z.infer<typeof hrPositionLookupSchema>;

export const hrJobLevelLookupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  rankOrder: z.number().int().nullable(),
});
export type HrJobLevelLookup = z.infer<typeof hrJobLevelLookupSchema>;

export const hrContractTypeLookupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  requiresEndDate: z.boolean(),
});
export type HrContractTypeLookup = z.infer<typeof hrContractTypeLookupSchema>;

/**
 * Default zero-pad width for the numeric part of an employee code when no active config exists
 * (the preview fallback). Mirrors the employee_code_configs.number_length default.
 */
export const DEFAULT_EMPLOYEE_CODE_NUMBER_LENGTH = 4;

/**
 * GET /hr/lookups/employee-code/preview — the next employee code the active config WOULD produce.
 * PREVIEW ONLY: it reads employee_code_configs and does NOT allocate a sequence number (allocation
 * runs in the create path via sequence_counters). `available` is false when no active config exists.
 */
export const hrEmployeeCodePreviewSchema = z.object({
  available: z.boolean(),
  prefix: z.string().nullable(),
  pattern: z.string().nullable(),
  numberLength: z.number().int().positive(),
  /** A formatted sample (prefix + zero-padded next-ish number) — illustrative, not reserved. */
  sample: z.string().nullable(),
});
export type HrEmployeeCodePreview = z.infer<typeof hrEmployeeCodePreviewSchema>;
