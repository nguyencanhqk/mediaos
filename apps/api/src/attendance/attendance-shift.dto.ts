import { createZodDto } from "nestjs-zod";
import {
  createRuleSchema,
  createShiftAssignmentSchema,
  createShiftSchema,
  effectiveShiftRuleQuerySchema,
  updateRuleSchema,
  updateShiftSchema,
} from "@mediaos/contracts";

/** S3-ATT-BE-3 — shift/rule/assignment CRUD (minimum) + GET /attendance/rules/effective query. */
export class CreateShiftDto extends createZodDto(createShiftSchema) {}
export class UpdateShiftDto extends createZodDto(updateShiftSchema) {}
export class CreateRuleDto extends createZodDto(createRuleSchema) {}
export class UpdateRuleDto extends createZodDto(updateRuleSchema) {}
export class CreateShiftAssignmentDto extends createZodDto(createShiftAssignmentSchema) {}
export class EffectiveShiftRuleQueryDto extends createZodDto(effectiveShiftRuleQuerySchema) {}
