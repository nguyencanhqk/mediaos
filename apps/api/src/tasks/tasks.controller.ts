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
import { TasksService } from "./tasks.service";
import {
  CreateCommentDto,
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskStatusDto,
} from "./tasks.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * TasksController — Task Hub hợp nhất (BẤT BIẾN #4).
 * Global JwtAuthGuard + CompanyGuard chạy trước (auth + tenant). Mutation gated bởi PermissionGuard
 * (@RequirePermission) trên resource `task` (actions có sẵn ở seed 0005, is_sensitive=false → grant
 * công ty là đủ, không cần object_permissions). Audit ghi ở service trong cùng tx withTenant.
 * Read-only (My Tasks / comments) KHÔNG gate — user luôn xem được việc của mình (mirror /tasks G4-4).
 */
@Controller("tasks")
@UsePipes(ZodValidationPipe)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** GET /tasks — danh sách task được giao cho user hiện tại */
  @Get()
  getMyTasks(@Req() req: AuthenticatedRequest) {
    return this.tasks.getMyTasks(req.user.companyId, req.user.id);
  }

  /**
   * GET /tasks/board — Task Board tổng (G9-3). Đọc việc CỦA NGƯỜI KHÁC toàn tenant → READ NHẠY CẢM
   * hơn getMyTasks → PHẢI gate `read:task` (seed 0005, is_sensitive=false). User 0-quyền bị chặn 403.
   * Filter task_type/status/projectId/assigneeUserId + page{limit,offset} validate qua ListTasksQueryDto
   * (clamp ở biên). Mọi đọc đi qua db.withTenant → RLS là hàng rào thật, app-filter defense-in-depth.
   */
  @Get("board")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "task")
  getBoard(@Req() req: AuthenticatedRequest, @Query() query: ListTasksQueryDto) {
    const { limit, offset, ...filters } = query;
    const page = limit !== undefined || offset !== undefined ? { limit, offset } : undefined;
    return this.tasks.listBoard(req.user.companyId, filters, page);
  }

  /** POST /tasks — giao việc tay (office task ngoài workflow, G9-2 / TASK-001) */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "task")
  createTask(@Req() req: AuthenticatedRequest, @Body() dto: CreateTaskDto) {
    return this.tasks.createTask({ id: req.user.id, companyId: req.user.companyId }, dto);
  }

  /** PATCH /tasks/:taskId/status — luồng rút gọn cho task office (G9-3) */
  @Patch(":taskId/status")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "task")
  updateStatus(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.tasks.updateStatus(
      { id: req.user.id, companyId: req.user.companyId },
      taskId,
      dto.status,
    );
  }

  /** DELETE /tasks/:taskId — soft-delete task office (workflow task bị từ chối) */
  @Delete(":taskId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("delete", "task")
  async deleteTask(@Req() req: AuthenticatedRequest, @Param("taskId") taskId: string) {
    await this.tasks.deleteTask({ id: req.user.id, companyId: req.user.companyId }, taskId);
  }

  /** GET /tasks/:taskId/comments — thread bình luận của task */
  @Get(":taskId/comments")
  getComments(@Req() req: AuthenticatedRequest, @Param("taskId") taskId: string) {
    return this.tasks.getComments(req.user.companyId, taskId);
  }

  /**
   * POST /tasks/:taskId/comments — thêm bình luận.
   * Là WRITE → gate `comment:comment` (mọi system role cần bình luận đều có sẵn quyền này ở seed 0005,
   * gồm `employee`). KHÔNG để ngỏ như read — chặn user 0-quyền spam comment/audit (gate G9-2 H-1).
   */
  @Post(":taskId/comments")
  @UseGuards(PermissionGuard)
  @RequirePermission("comment", "comment")
  addComment(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.tasks.addComment(req.user.companyId, taskId, req.user.id, dto.body);
  }
}
