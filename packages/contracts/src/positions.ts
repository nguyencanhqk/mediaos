import { z } from "zod";
import { idSchema } from "./common/id";

const positionStatusEnum = z.enum(["active", "inactive"]);

/** DTO chức vụ — G5-4. */
export const positionSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  orgUnitId: idSchema.nullable().optional(),
  orgUnitName: z.string().nullable().optional(),
  name: z.string().min(1).max(200),
  code: z.string().nullable().optional(),
  level: z.number().int().nullable().optional(),
  description: z.string().nullable().optional(),
  defaultRoleId: idSchema.nullable().optional(),
  defaultRoleName: z.string().nullable().optional(),
  status: positionStatusEnum,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PositionDto = z.infer<typeof positionSchema>;

export const createPositionSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(50).optional(),
  orgUnitId: idSchema.optional(),
  level: z.number().int().min(1).max(99).optional(),
  description: z.string().optional(),
  defaultRoleId: idSchema.optional(),
});
export type CreatePositionRequest = z.infer<typeof createPositionSchema>;

export const updatePositionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().max(50).nullable().optional(),
  orgUnitId: idSchema.nullable().optional(),
  level: z.number().int().min(1).max(99).nullable().optional(),
  description: z.string().nullable().optional(),
  defaultRoleId: idSchema.nullable().optional(),
  status: positionStatusEnum.optional(),
});
export type UpdatePositionRequest = z.infer<typeof updatePositionSchema>;
