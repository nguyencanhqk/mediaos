import { createZodDto } from "nestjs-zod";
import {
  createGoalSchema,
  goalTreeQuerySchema,
  listGoalsQuerySchema,
  meGoalsQuerySchema,
  updateGoalSchema,
} from "@mediaos/contracts";

/**
 * S5-GOAL-BE-1 — DTO biên module GOAL. Nguồn sự thật = Zod ở `@mediaos/contracts/goal`
 * (createZodDto → validate qua ZodValidationPipe ở controller).
 */

/** POST /goals (create:goal). */
export class CreateGoalDto extends createZodDto(createGoalSchema) {}

/** PATCH /goals/:id (update:goal) — partial, service re-validate toàn bộ sau merge. */
export class UpdateGoalDto extends createZodDto(updateGoalSchema) {}

/** GET /goals (view:goal) — filter + phân trang. */
export class ListGoalsQueryDto extends createZodDto(listGoalsQuerySchema) {}

/** GET /goals/tree (view:goal) — cây theo kỳ/phòng, không phân trang. */
export class GoalTreeQueryDto extends createZodDto(goalTreeQuerySchema) {}

/**
 * GET /me/goals (view:goal) — schema RIÊNG, CỐ Ý KHÔNG có `employeeId`: chủ thể lấy từ token
 * (SPEC-09 §14.4). Dùng chung `ListGoalsQueryDto` ở đây là mở lại đúng cửa IDOR vừa đóng.
 */
export class MeGoalsQueryDto extends createZodDto(meGoalsQuerySchema) {}
