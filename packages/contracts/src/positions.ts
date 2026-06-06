import { z } from "zod";

const positionStatusEnum = z.enum(["active", "inactive"]);

/** DTO chức vụ — G5-4. */
export const positionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  orgUnitId: z.string().uuid().nullable().optional(),
  orgUnitName: z.string().nullable().optional(),
  name: z.string().min(1).max(200),
  code: z.string().nullable().optional(),
  level: z.number().int().nullable().optional(),
  description: z.string().nullable().optional(),
  defaultRoleId: z.string().uuid().nullable().optional(),
  defaultRoleName: z.string().nullable().optional(),
  status: positionStatusEnum,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PositionDto = z.infer<typeof positionSchema>;

export const createPositionSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(50).optional(),
  orgUnitId: z.string().uuid().optional(),
  level: z.number().int().min(1).max(99).optional(),
  description: z.string().optional(),
  defaultRoleId: z.string().uuid().optional(),
});
export type CreatePositionRequest = z.infer<typeof createPositionSchema>;

export const updatePositionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().max(50).nullable().optional(),
  orgUnitId: z.string().uuid().nullable().optional(),
  level: z.number().int().min(1).max(99).nullable().optional(),
  description: z.string().nullable().optional(),
  defaultRoleId: z.string().uuid().nullable().optional(),
  status: positionStatusEnum.optional(),
});
export type UpdatePositionRequest = z.infer<typeof updatePositionSchema>;
