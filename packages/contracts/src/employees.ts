import { z } from "zod";

const workTypeEnum = z.enum(["offline", "remote", "hybrid"]);
const employmentTypeEnum = z.enum(["full_time", "part_time", "freelancer", "intern", "probation"]);
const salaryTypeEnum = z.enum(["monthly", "hourly", "project"]);
const employeeStatusEnum = z.enum(["active", "inactive", "resigned", "terminated"]);

/** DTO employee profile — base_salary nullable: null = không có quyền xem. */
export const employeeProfileSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  employeeCode: z.string().nullable().optional(),
  orgUnitId: z.string().uuid().nullable().optional(),
  orgUnitName: z.string().nullable().optional(),
  positionId: z.string().uuid().nullable().optional(),
  positionName: z.string().nullable().optional(),
  directManagerId: z.string().uuid().nullable().optional(),
  directManagerName: z.string().nullable().optional(),
  workType: workTypeEnum,
  employmentType: employmentTypeEnum,
  startDate: z.string().date().nullable().optional(),
  endDate: z.string().date().nullable().optional(),
  contractType: z.string().nullable().optional(),
  baseSalary: z.number().nullable(),
  salaryType: salaryTypeEnum,
  phone: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: employeeStatusEnum,
  userFullName: z.string().nullable().optional(),
  userEmail: z.string().email().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EmployeeProfileDto = z.infer<typeof employeeProfileSchema>;

export const employeeListItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  employeeCode: z.string().nullable().optional(),
  userFullName: z.string().nullable().optional(),
  userEmail: z.string().email().optional(),
  orgUnitName: z.string().nullable().optional(),
  positionName: z.string().nullable().optional(),
  workType: workTypeEnum,
  employmentType: employmentTypeEnum,
  status: employeeStatusEnum,
  baseSalary: z.number().nullable(),
});
export type EmployeeListItemDto = z.infer<typeof employeeListItemSchema>;

export const createEmployeeProfileSchema = z.object({
  userId: z.string().uuid(),
  employeeCode: z.string().optional(),
  orgUnitId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
  directManagerId: z.string().uuid().optional(),
  workType: workTypeEnum.default("offline"),
  employmentType: employmentTypeEnum.default("full_time"),
  startDate: z.string().date().optional(),
  contractType: z.string().optional(),
  baseSalary: z.number().nonnegative().optional(),
  salaryType: salaryTypeEnum.default("monthly"),
  phone: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  notes: z.string().optional(),
});
export type CreateEmployeeProfileRequest = z.infer<typeof createEmployeeProfileSchema>;

export const updateEmployeeProfileSchema = z.object({
  employeeCode: z.string().optional(),
  orgUnitId: z.string().uuid().nullable().optional(),
  positionId: z.string().uuid().nullable().optional(),
  directManagerId: z.string().uuid().nullable().optional(),
  workType: workTypeEnum.optional(),
  employmentType: employmentTypeEnum.optional(),
  startDate: z.string().date().nullable().optional(),
  endDate: z.string().date().nullable().optional(),
  contractType: z.string().nullable().optional(),
  baseSalary: z.number().nonnegative().nullable().optional(),
  salaryType: salaryTypeEnum.optional(),
  phone: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: employeeStatusEnum.optional(),
});
export type UpdateEmployeeProfileRequest = z.infer<typeof updateEmployeeProfileSchema>;

/** Import CSV employee row schema. */
export const importEmployeeRowSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  employeeCode: z.string().optional(),
  orgUnitName: z.string().optional(),
  positionName: z.string().optional(),
  workType: workTypeEnum.optional(),
  employmentType: employmentTypeEnum.optional(),
  startDate: z.string().date().optional(),
});
export type ImportEmployeeRow = z.infer<typeof importEmployeeRowSchema>;

export const importEmployeePreviewSchema = z.object({
  valid: z.array(importEmployeeRowSchema),
  invalid: z.array(
    z.object({
      row: z.number().int(),
      errors: z.array(z.string()),
    }),
  ),
  sessionId: z.string(),
});
export type ImportEmployeePreviewDto = z.infer<typeof importEmployeePreviewSchema>;

export const importEmployeeConfirmSchema = z.object({
  sessionId: z.string().min(1),
});
export type ImportEmployeeConfirmRequest = z.infer<typeof importEmployeeConfirmSchema>;
