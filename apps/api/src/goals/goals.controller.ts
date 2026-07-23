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
// S5-GOAL-BE-2 — vòng đo (check-in/chốt kỳ/gắn-tháo task) nằm ở service RIÊNG; controller chỉ định tuyến.
import { GoalCheckinService } from "./goal-checkin.service";
import { GoalTasksLinkService } from "./goal-tasks-link.service";
import {
  CheckinGoalDto,
  CreateGoalDto,
  FinalizeGoalDto,
  GoalTreeQueryDto,
  LinkGoalTasksDto,
  ListGoalUpdatesQueryDto,
  ListGoalsQueryDto,
  UpdateGoalDto,
} from "./goals.dto";

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
  constructor(
    private readonly goals: GoalsService,
    private readonly checkin: GoalCheckinService,
    private readonly links: GoalTasksLinkService,
  ) {}

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

  // ── S5-GOAL-BE-2 — vòng đo (GOAL-API-007..010) ────────────────────────────────
  // MỖI route khai ĐÚNG cặp quyền của nó, KHÔNG mượn cặp "gần đúng":
  //   check-in → ('checkin','goal') · chốt kỳ/mở lại → ('finalize','goal') · sổ → ('view','goal').
  // Gắn/tháo task dùng LẠI ('update','goal') — SPEC-10 §11 không định nghĩa cặp riêng và migration 0506
  // chỉ seed 7 cặp; bịa cặp mới ở code = cặp không có trong bảng `permissions` ⇒ 403 cho MỌI người.
  // Quyết định + lý do ghi ở docs/plans/S5-GOAL-BE-2.md.

  /** POST /goals/:id/check-in — GOAL-API-007. 422 GOAL-ERR-006 nếu status ≠ Active; 005 nếu đã chốt kỳ. */
  @Post(":id/check-in")
  @UseGuards(PermissionGuard)
  @RequirePermission("checkin", "goal")
  checkIn(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: CheckinGoalDto) {
    return this.checkin.checkIn(req.user, id, dto);
  }

  /** GET /goals/:id/updates — GOAL-API-008, sổ append-only (check-in/chốt kỳ/mở lại). */
  @Get(":id/updates")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "goal")
  updates(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query() query: ListGoalUpdatesQueryDto,
  ) {
    return this.checkin.listUpdates(req.user, id, query);
  }

  /** POST /goals/:id/finalize — GOAL-API-009. 422 GOAL-ERR-014 nếu status ∉ {Active, Completed}. */
  @Post(":id/finalize")
  @UseGuards(PermissionGuard)
  @RequirePermission("finalize", "goal")
  finalize(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: FinalizeGoalDto,
  ) {
    return this.checkin.finalize(req.user, id, dto);
  }

  /** POST /goals/:id/reopen — GOAL-API-009, CÙNG cặp quyền với chốt kỳ (SPEC-10 §12 GOAL-ERR-005). */
  @Post(":id/reopen")
  @UseGuards(PermissionGuard)
  @RequirePermission("finalize", "goal")
  reopen(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: FinalizeGoalDto) {
    return this.checkin.reopen(req.user, id, dto);
  }

  /** GET /goals/:id/tasks — GOAL-API-010. Hai cổng: view:goal (mục tiêu) + read:task (việc, ở service). */
  @Get(":id/tasks")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "goal")
  linkedTasks(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.links.listLinkedTasks(req.user, id);
  }

  /** POST /goals/:id/tasks — GOAL-API-010 gắn BULK; sai neo ⇒ 422 GOAL-ERR-008 (0 hàng ghi). */
  @Post(":id/tasks")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "goal")
  linkTasks(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: LinkGoalTasksDto,
  ) {
    return this.links.linkTasks(req.user, id, dto);
  }

  /** DELETE /goals/:id/tasks/:taskId — GOAL-API-010 tháo. Không gắn ĐÚNG mục tiêu này ⇒ 404. */
  @Delete(":id/tasks/:taskId")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "goal")
  unlinkTask(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("taskId") taskId: string,
  ) {
    return this.links.unlinkTask(req.user, id, taskId);
  }
}
