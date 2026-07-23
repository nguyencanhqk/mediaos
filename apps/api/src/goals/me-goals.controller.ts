import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { GoalsService } from "./goals.service";
import { MeGoalsQueryDto } from "./goals.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-GOAL-BE-1 — GET /me/goals (GOAL-API-013 · SPEC-10 §9 GOAL-SCREEN-005).
 *
 * Controller RIÊNG (không nhồi vào GoalsController) để route own-scope KHÔNG lẫn với CRUD: ở đây
 * chủ thể LUÔN là actor resolve từ token — không có tham số nào chỉ định người khác (SPEC-09 §14.4).
 * `MeGoalsQueryDto` không khai `employeeId` ⇒ zod strip; service cũng không đọc field đó.
 */
@Controller()
@UsePipes(ZodValidationPipe)
export class MeGoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get("me/goals")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "goal")
  myGoals(@Req() req: AuthenticatedRequest, @Query() query: MeGoalsQueryDto) {
    return this.goals.getMyGoals(req.user, query);
  }
}
