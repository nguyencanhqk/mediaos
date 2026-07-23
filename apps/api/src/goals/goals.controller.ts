import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { GoalsService } from "./goals.service";
import { CreateGoalDto, GoalTreeQueryDto, ListGoalsQueryDto, UpdateGoalDto } from "./goals.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-GOAL-BE-1 — GoalsController (SPEC-10 §15: GOAL-API-001..006). Prefix /goals.
 *
 * Pipeline toàn cục JwtAuthGuard → CompanyGuard chạy TRƯỚC. MỖI route @UseGuards(PermissionGuard) +
 * @RequirePermission ĐÚNG cặp đã seed ở migration 0506 (`view/create/update/delete` × `goal`,
 * is_sensitive=false — data_scope §11 mới là lớp chặn thật). Business logic + data-scope + audit nằm ở
 * GoalsService (KHÔNG ở controller). DTO validate tại biên qua ZodValidationPipe.
 *
 * ⚠️ THỨ TỰ ROUTE: `GET /goals/tree` PHẢI khai báo TRƯỚC `GET /goals/:id`, nếu không Nest nuốt 'tree'
 * thành tham số `:id` (404/400 sai chỗ, rất dễ lọt review nhanh).
 */
@Controller("goals")
@UsePipes(ZodValidationPipe)
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  /** GET /goals — danh sách (GOAL-API-001). Scope: nhân viên/trưởng đơn vị @Department · admin @Company. */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "goal")
  list(@Req() req: AuthenticatedRequest, @Query() query: ListGoalsQueryDto) {
    return this.goals.listGoals(req.user, query);
  }

  /** GET /goals/tree — cây ≤3 tầng kèm tiến độ từng nút (GOAL-API-006). KHAI TRƯỚC ':id'. */
  @Get("tree")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "goal")
  tree(@Req() req: AuthenticatedRequest, @Query() query: GoalTreeQueryDto) {
    return this.goals.getTree(req.user, query);
  }

  /** POST /goals — tạo (GOAL-API-002). Mã `goal_code` do SequenceService cấp (counter seed 0506). */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "goal")
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateGoalDto) {
    return this.goals.createGoal(req.user, dto);
  }

  /** GET /goals/:id — chi tiết + breadcrumb cha + đếm con (GOAL-API-003). */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "goal")
  getOne(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.goals.getGoal(req.user, id);
  }

  /** PATCH /goals/:id — cập nhật (GOAL-API-004); service re-validate toàn bộ trạng thái sau merge. */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "goal")
  update(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: UpdateGoalDto) {
    return this.goals.updateGoal(req.user, id, dto);
  }

  /** DELETE /goals/:id — xoá MỀM (GOAL-API-005); còn con ⇒ 422 GOAL-ERR-007. */
  @Delete(":id")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("delete", "goal")
  async remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    await this.goals.deleteGoal(req.user, id);
  }
}
