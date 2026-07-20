import { z } from "zod";

/**
 * S2-HR-BE-3 — HR master data CRUD contracts: job_levels + contract_types.
 * Permission: manage:master-data (HR.MASTER_DATA.MANAGE).
 * Source of truth: SPEC-03 §13.12b / §13.12c / §15.4 / §15.5.
 */

const masterDataStatusEnum = z.enum(["active", "inactive"]);

// ── Job Levels ───────────────────────────────────────────────────────────────

export const jobLevelSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().nullable(),
  name: z.string(),
  rankOrder: z.number().int().nullable(),
  status: masterDataStatusEnum,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type JobLevelDto = z.infer<typeof jobLevelSchema>;

export const createJobLevelSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  rankOrder: z.number().int().min(0).optional(),
});
export type CreateJobLevelRequest = z.infer<typeof createJobLevelSchema>;

export const updateJobLevelSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(200).optional(),
  rankOrder: z.number().int().min(0).nullable().optional(),
  status: masterDataStatusEnum.optional(),
});
export type UpdateJobLevelRequest = z.infer<typeof updateJobLevelSchema>;

// ── Contract Types ───────────────────────────────────────────────────────────

export const contractTypeSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().nullable(),
  name: z.string(),
  requiresEndDate: z.boolean(),
  status: masterDataStatusEnum,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ContractTypeDto = z.infer<typeof contractTypeSchema>;

export const createContractTypeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  requiresEndDate: z.boolean().default(false),
});
export type CreateContractTypeRequest = z.infer<typeof createContractTypeSchema>;

export const updateContractTypeSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(200).optional(),
  requiresEndDate: z.boolean().optional(),
  status: masterDataStatusEnum.optional(),
});
export type UpdateContractTypeRequest = z.infer<typeof updateContractTypeSchema>;

// ── Department CRUD contracts (HR.DEPARTMENT.*) ──────────────────────────────

export const departmentStatusEnum = z.enum(["active", "inactive"]);

export const createDepartmentSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50).optional(),
  parentId: z.string().uuid().nullable().optional(),
  /**
   * Trưởng phòng = EMPLOYEE id (DB-03 §15: FK employees, "employee active cùng company").
   * BE validate rồi resolve user liên kết để ghi vào cột legacy org_units.head_user_id (FK users) —
   * employee chưa liên kết tài khoản → 400 (ràng buộc hiện thực hoá, xem erd-current Phụ lục A).
   */
  managerEmployeeId: z.string().uuid().nullable().optional(),
  description: z.string().optional(),
  status: departmentStatusEnum.optional().default("active"),
});
/** Input type (status optional, defaults to "active" at runtime). */
export type CreateDepartmentRequest = z.input<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(50).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  /** Trưởng phòng = EMPLOYEE id (xem createDepartmentSchema); null = GỠ trưởng phòng. */
  managerEmployeeId: z.string().uuid().nullable().optional(),
  description: z.string().nullable().optional(),
  status: departmentStatusEnum.optional(),
});
export type UpdateDepartmentRequest = z.infer<typeof updateDepartmentSchema>;
