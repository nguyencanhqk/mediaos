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
import { TaskCoreService } from "./task-core.service";
import {
  CreateCommentDto,
  CreateTaskCoreDto,
  ListTaskCoreQueryDto,
  ListTasksQueryDto,
  PageQueryDto,
  UpdateTaskCoreDto,
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
  constructor(
    private readonly tasks: TasksService,
    // S4-TASK-BE-2 — Task core CRUD/my/list (data-scope + gate read/create/update/delete:task seed 0485).
    private readonly taskCore: TaskCoreService,
  ) {}

  /**
   * GET /tasks — danh sách task tổng quát (S4-TASK-BE-2, TASK-API-201). Data-scope theo grant thật
   * (employee @Own · manager @Team · hr/admin @Company) + membership project; filter status/priority/
   * assignee/project/due-range/overdue + pagination. Gate read:task (KHÁC hành vi cũ = getMyTasks mở).
   * ⚠️ BREAKING: FE web-core tasks-api.ts phải chuyển sang GET /tasks/my (WO FE nối tiếp — xem PR desc).
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "task")
  listTasks(@Req() req: AuthenticatedRequest, @Query() query: ListTaskCoreQueryDto) {
    return this.taskCore.listTasks(req.user, query);
  }

  /**
   * GET /tasks/my — task của CHÍNH user (S4-TASK-BE-2, TASK-API-210): gộp 3 nguồn assigned+created+watched,
   * sort quá-hạn-lên-đầu. Gate read:task. PHẢI khai TRƯỚC @Get(":taskId") (route tĩnh trước route tham số).
   */
  @Get("my")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "task")
  getMyTasks(@Req() req: AuthenticatedRequest) {
    return this.taskCore.getMyTasks(req.user);
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

  /**
   * GET /tasks/by-project/:projectId — Project Tasks (G9-4).
   * Gated read:task (đọc task của tenant, không chỉ của bản thân → nhạy cảm hơn getMyTasks).
   * SEC-1: service guard projectExistsTx trước khi list (chặn chéo tenant qua path param).
   * Phân trang tường minh qua PageQueryDto (limit/offset trong query string).
   */
  @Get("by-project/:projectId")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "task")
  getProjectTasks(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Query() query: PageQueryDto,
  ) {
    const page =
      query.limit !== undefined || query.offset !== undefined
        ? { limit: query.limit, offset: query.offset }
        : undefined;
    return this.tasks.listByProject(req.user.companyId, projectId, page);
  }

  /**
   * GET /tasks/by-team/:teamId — Team Tasks (G9-4).
   * Gated read:task (đọc task của thành viên team → toàn tenant scope → nhạy cảm).
   * SEC-1: service guard teamExistsTx trước khi list (chặn chéo tenant qua path param).
   * Phân trang tường minh qua PageQueryDto (limit/offset trong query string).
   */
  @Get("by-team/:teamId")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "task")
  getTeamTasks(
    @Req() req: AuthenticatedRequest,
    @Param("teamId") teamId: string,
    @Query() query: PageQueryDto,
  ) {
    const page =
      query.limit !== undefined || query.offset !== undefined
        ? { limit: query.limit, offset: query.offset }
        : undefined;
    return this.tasks.listByTeam(req.user.companyId, teamId, page);
  }

  /**
   * GET /tasks/:taskId — chi tiết 1 task core (S4-TASK-BE-2, TASK-API-203). Gate read:task, cùng data-scope
   * với list (out-of-scope → 404 nhất quán). Đặt SAU 'board'/'by-project'/'by-team'/'my' (route tĩnh trước).
   */
  @Get(":taskId")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "task")
  getTask(@Req() req: AuthenticatedRequest, @Param("taskId") taskId: string) {
    return this.taskCore.getTask(req.user, taskId);
  }

  /**
   * POST /tasks — tạo task core (S4-TASK-BE-2, TASK-API-202). title bắt buộc, project optional (task cá nhân
   * MVP). Gate create:task (emp/mgr HOÃN ở TASK_DEFERRED_GRANTS 0485 ⇒ chỉ hr/company-admin @Company gọi được).
   */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "task")
  createTask(@Req() req: AuthenticatedRequest, @Body() dto: CreateTaskCoreDto) {
    return this.taskCore.createTask(req.user, dto);
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

  /**
   * PATCH /tasks/:taskId — cập nhật field task core (S4-TASK-BE-2, TASK-API-204): title/description/priority/
   * assignee/project/department/due/start. Gate update:task + data-scope; KHÔNG đổi status (action riêng).
   * Task workflow-driven bị service từ chối 400 (FSM giữ nguyên — regression, không phá luồng chính).
   */
  @Patch(":taskId")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "task")
  updateTask(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: UpdateTaskCoreDto,
  ) {
    return this.taskCore.updateTask(req.user, taskId, dto);
  }

  /**
   * DELETE /tasks/:taskId — soft-delete task core (S4-TASK-BE-2, TASK-API-205). Gate delete:task (sensitive,
   * seed 0485) + data-scope. Workflow task bị từ chối 400. BẤT BIẾN #2: chỉ set deleted_at/by (không hard-delete).
   */
  @Delete(":taskId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("delete", "task", { isSensitive: true })
  async deleteTask(@Req() req: AuthenticatedRequest, @Param("taskId") taskId: string) {
    await this.taskCore.deleteTask(req.user, taskId);
  }

  /** POST /tasks/:taskId/labels/:labelId — gán nhãn cho work item (idempotent). Gate `update:task`. */
  @Post(":taskId/labels/:labelId")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "task")
  async addLabel(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("labelId") labelId: string,
  ) {
    await this.tasks.addLabelToTask(
      { id: req.user.id, companyId: req.user.companyId },
      taskId,
      labelId,
    );
  }

  /** DELETE /tasks/:taskId/labels/:labelId — gỡ nhãn khỏi work item (hard-delete link). Gate `update:task`. */
  @Delete(":taskId/labels/:labelId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "task")
  async removeLabel(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("labelId") labelId: string,
  ) {
    await this.tasks.removeLabelFromTask(
      { id: req.user.id, companyId: req.user.companyId },
      taskId,
      labelId,
    );
  }

  /** GET /tasks/:taskId/comments — thread bình luận của task */
  @Get(":taskId/comments")
  getComments(@Req() req: AuthenticatedRequest, @Param("taskId") taskId: string) {
    return this.tasks.getComments(req.user.companyId, taskId);
  }

  /**
   * POST /tasks/:taskId/comments — thêm bình luận.
   * Là WRITE → gate `comment:task` (recon S4-TASK-RECON canonical hoá về resource `task`; quyền được cấp
   * cho role cần bình luận, gồm `employee`). KHÔNG để ngỏ như read — chặn user 0-quyền spam comment/audit (gate G9-2 H-1).
   */
  @Post(":taskId/comments")
  @UseGuards(PermissionGuard)
  @RequirePermission("comment", "task")
  addComment(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.tasks.addComment(req.user.companyId, taskId, req.user.id, dto.body);
  }
}
