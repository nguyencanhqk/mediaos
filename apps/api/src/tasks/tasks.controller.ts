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
import { TaskActionsService } from "./task-actions.service";
// S4-TASK-BE-4 (additive) — comment/mention · checklist/items · activity feed (Kanban move tái dùng
// CHÍNH TaskActionsService.changeStatus ở trên, KHÔNG service riêng).
import { TaskCommentsService } from "./task-comments.service";
import { TaskChecklistsService } from "./task-checklists.service";
import { TaskActivityFeedService } from "./task-activity-feed.service";
import {
  AddWatcherDto,
  AssignTaskDto,
  ChangeTaskDeadlineDto,
  ChangeTaskPriorityDto,
  ChangeTaskStatusDto,
  CreateTaskChecklistDto,
  CreateTaskChecklistItemDto,
  CreateTaskCommentDto,
  CreateTaskCoreDto,
  ListTaskActivityQueryDto,
  ListTaskCoreQueryDto,
  ListTasksQueryDto,
  MoveTaskStateDto,
  PageQueryDto,
  UpdateTaskChecklistDto,
  UpdateTaskChecklistItemDto,
  UpdateTaskCommentDto,
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
 * Read-only (My Tasks) KHÔNG gate — user luôn xem được việc của mình (mirror /tasks G4-4). Comments
 * (S4-TASK-BE-4) ĐỔI khỏi ungated legacy — GIỜ gate read/comment:task + data-scope (xem TaskCommentsService).
 */
@Controller("tasks")
@UsePipes(ZodValidationPipe)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    // S4-TASK-BE-2 — Task core CRUD/my/list (data-scope + gate read/create/update/delete:task seed 0485).
    private readonly taskCore: TaskCoreService,
    // S4-TASK-BE-3 — Task actions crown-FSM (assign/change-status/priority/deadline/watch).
    private readonly taskActions: TaskActionsService,
    // S4-TASK-BE-4 — comment/mention · checklist/items · activity feed.
    private readonly taskComments: TaskCommentsService,
    private readonly taskChecklists: TaskChecklistsService,
    private readonly taskActivityFeed: TaskActivityFeedService,
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

  /**
   * PATCH /tasks/:taskId/status — luồng rút gọn cho task office (G9-3).
   * @deprecated S4-TASK-BE-3: ghi cột LEGACY `status` lowercase (not_started/in_progress/completed) — KHÁC
   * cột `task_status` TitleCase của FSM mới (POST /tasks/:id/change-status). GIỮ song song (board legacy G9-3
   * đọc `status`); hợp nhất ở WO dọn sau. KHÔNG dùng cho luồng task core mới.
   * KHAI TỬ (DECISIONS-03 D-21.4, expand-contract đợt 1/2 — S5-TASK-PIPELINE-1): đợt này đánh dấu
   * ngừng dùng + FE chuyển route mới; đợt sau mới gỡ. KHÔNG nối thêm caller.
   */
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

  // ═══════════════════ S4-TASK-BE-4 — Comment/mention (TASK-API-301..304) ═══════════════════
  // ĐỔI khỏi legacy ungated (TasksService.getComments/addComment, task_comments append-only cũ):
  // GIỜ gate read/comment:task + data-scope "chỉ người xem được task" (SPEC-06 §14.14) qua
  // TaskCommentsService — soft-delete PATCH/DELETE MỚI thêm (legacy append-only KHÔNG hỗ trợ sửa/xoá).

  /** GET /tasks/:taskId/comments (TASK-API-301) — gate read:task, chỉ khi task trong scope đọc. */
  @Get(":taskId/comments")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "task")
  getComments(@Req() req: AuthenticatedRequest, @Param("taskId") taskId: string) {
    return this.taskComments.list(req.user, taskId);
  }

  /**
   * POST /tasks/:taskId/comments (TASK-API-302) — gate `comment:task`. content bắt buộc không rỗng +
   * mentionEmployeeIds validate ngoài-scope → 403 BLOCK (KHÔNG chỉ warning).
   */
  @Post(":taskId/comments")
  @UseGuards(PermissionGuard)
  @RequirePermission("comment", "task")
  addComment(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: CreateTaskCommentDto,
  ) {
    return this.taskComments.create(req.user, taskId, dto);
  }

  /** PATCH /tasks/:taskId/comments/:commentId (TASK-API-303) — self-only MVP (403 nếu không phải tác giả). */
  @Patch(":taskId/comments/:commentId")
  @UseGuards(PermissionGuard)
  @RequirePermission("comment", "task")
  updateComment(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("commentId") commentId: string,
    @Body() dto: UpdateTaskCommentDto,
  ) {
    return this.taskComments.update(req.user, taskId, commentId, dto);
  }

  /** DELETE /tasks/:taskId/comments/:commentId (TASK-API-304) — soft-delete (BẤT BIẾN #2). */
  @Delete(":taskId/comments/:commentId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("comment", "task")
  async deleteComment(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("commentId") commentId: string,
  ) {
    await this.taskComments.remove(req.user, taskId, commentId);
  }

  // ═══════════════════ S4-TASK-BE-3 — Task actions crown-FSM (append-only) ═══════════════════
  // 6 route `:taskId/<static>` — KHÔNG va @Get(":taskId") (khác method + path dài hơn). Verb canonical
  // SPEC-06 §16.3 TK-4 (change-status/change-priority/change-deadline). Double-gate: PermissionGuard (cặp
  // seed 0485) + data-scope trong service (ngoài scope → 404 nhất quán). employee 403 assign/priority/
  // deadline là ĐÚNG THIẾT KẾ seed (không cấp). Legacy PATCH /status GIỮ NGUYÊN.

  /** POST /tasks/:taskId/assign (TASK-API-206) — giao việc Main. Gate assign:task. */
  @Post(":taskId/assign")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("assign", "task")
  assignTask(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: AssignTaskDto,
  ) {
    return this.taskActions.assign(req.user, taskId, dto);
  }

  /** POST /tasks/:taskId/change-status (TASK-API-207) — FSM. Gate update-status:task. */
  @Post(":taskId/change-status")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("update-status", "task")
  changeTaskStatus(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: ChangeTaskStatusDto,
  ) {
    return this.taskActions.changeStatus(req.user, taskId, dto);
  }

  /**
   * POST /tasks/:taskId/move (S4-TASK-BE-4, Kanban drag/drop) — route sugar cho FE Board: gọi ĐÍCH
   * XÁC CÙNG `TaskActionsService.changeStatus` như change-status (KHÔNG lách FSM, KHÔNG service riêng,
   * KHÔNG activity/outbox trùng — 1 lời gọi = 1 lần ghi). Gate update-status:task (mirror change-status
   * — kéo task sang cột mà không có quyền đổi trạng thái ⇒ 403, SPEC-06 §14.13 "Người không có quyền
   * update status chỉ xem, không kéo thả").
   * @deprecated KHAI TỬ (DECISIONS-03 D-21.4, expand-contract đợt 1/2 — S5-TASK-PIPELINE-1): board mới
   * kéo thả theo CỘT PIPELINE qua POST /tasks/:id/move-state (gate update-state:task, lane be-write) —
   * route /move này gate CHỈ update-status nên là CỬA VÒNG QUA cổng update-state chừng nào còn sống.
   * Đợt này đánh dấu ngừng dùng + FE chuyển route mới; đợt sau mới gỡ. KHÔNG nối thêm caller.
   */
  @Post(":taskId/move")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("update-status", "task")
  moveTask(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: ChangeTaskStatusDto,
  ) {
    return this.taskActions.changeStatus(req.user, taskId, dto);
  }

  /**
   * POST /tasks/:taskId/move-state (TASK-API-213, S5-TASK-PIPELINE-1) — kéo thẻ sang CỘT PIPELINE
   * (API-06 §15.2, DECISIONS-03 D-17). Gate update-state:task; đổi cột KHÁC nhóm đòi THÊM
   * update-status:task Ở ĐÚNG SCOPE của pair đó (service — không mượn scope update-state). Auto-map
   * nhóm→status qua changeStatusTx CÙNG tx (atomic — FSM/quyền/checklist từ chối ⇒ cột không đổi).
   * Route sugar: gọi THẲNG TaskCoreService.moveState — method dùng chung với PATCH stateId, KHÔNG
   * guard thứ hai ở route.
   */
  @Post(":taskId/move-state")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("update-state", "task")
  moveTaskState(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: MoveTaskStateDto,
  ) {
    return this.taskCore.moveState(req.user, taskId, dto);
  }

  /** POST /tasks/:taskId/change-priority (TASK-API-208). Gate update-priority:task. */
  @Post(":taskId/change-priority")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("update-priority", "task")
  changeTaskPriority(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: ChangeTaskPriorityDto,
  ) {
    return this.taskActions.changePriority(req.user, taskId, dto);
  }

  /** POST /tasks/:taskId/change-deadline (TASK-API-209). Gate update-deadline:task. */
  @Post(":taskId/change-deadline")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("update-deadline", "task")
  changeTaskDeadline(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: ChangeTaskDeadlineDto,
  ) {
    return this.taskActions.changeDeadline(req.user, taskId, dto);
  }

  /** POST /tasks/:taskId/watchers — tự theo dõi (self-only MVP). Gate watch:task. */
  @Post(":taskId/watchers")
  @UseGuards(PermissionGuard)
  @RequirePermission("watch", "task")
  addWatcher(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() _dto: AddWatcherDto,
  ) {
    void _dto;
    return this.taskActions.addWatcher(req.user, taskId);
  }

  /** DELETE /tasks/:taskId/watchers/:watcherId — bỏ theo dõi (soft-remove). Gate watch:task. */
  @Delete(":taskId/watchers/:watcherId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("watch", "task")
  async removeWatcher(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("watcherId") watcherId: string,
  ) {
    await this.taskActions.removeWatcher(req.user, taskId, watcherId);
  }

  // ═══════════════════ S4-TASK-BE-4 — Checklist/items (API-06 §17 · TASK-API-501..504) ═══════════════
  // Gate `update:task` cho MỌI mutate (checklist LẪN item) — OWNER CHỐT seed 0485 "KHÔNG cặp 'checklist'
  // riêng, gate bằng update:task" + API-06 §17 "TK-10". GET dùng `read:task`.

  /** GET /tasks/:taskId/checklists (API-06 §17.1). Gate read:task. */
  @Get(":taskId/checklists")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "task")
  listChecklists(@Req() req: AuthenticatedRequest, @Param("taskId") taskId: string) {
    return this.taskChecklists.list(req.user, taskId);
  }

  /** POST /tasks/:taskId/checklists (TASK-API-502) — title + items[] khởi tạo (optional). Gate update:task. */
  @Post(":taskId/checklists")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "task")
  createChecklist(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: CreateTaskChecklistDto,
  ) {
    return this.taskChecklists.create(req.user, taskId, dto);
  }

  /** PATCH /tasks/:taskId/checklists/:checklistId (TASK-API-503). Gate update:task. */
  @Patch(":taskId/checklists/:checklistId")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "task")
  updateChecklist(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("checklistId") checklistId: string,
    @Body() dto: UpdateTaskChecklistDto,
  ) {
    return this.taskChecklists.update(req.user, taskId, checklistId, dto);
  }

  /** DELETE /tasks/:taskId/checklists/:checklistId (TASK-API-504) — soft cascade xuống item. Gate update:task. */
  @Delete(":taskId/checklists/:checklistId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "task")
  async deleteChecklist(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("checklistId") checklistId: string,
  ) {
    await this.taskChecklists.remove(req.user, taskId, checklistId);
  }

  /** POST /tasks/:taskId/checklists/:checklistId/items (API-06 §17.5). Gate update:task. */
  @Post(":taskId/checklists/:checklistId/items")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "task")
  addChecklistItem(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("checklistId") checklistId: string,
    @Body() dto: CreateTaskChecklistItemDto,
  ) {
    return this.taskChecklists.addItem(req.user, taskId, checklistId, dto);
  }

  /** PATCH .../items/:itemId — tick is_done (API-06 §17.6). Gate update:task. */
  @Patch(":taskId/checklists/:checklistId/items/:itemId")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "task")
  updateChecklistItem(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("checklistId") checklistId: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateTaskChecklistItemDto,
  ) {
    return this.taskChecklists.updateItem(req.user, taskId, checklistId, itemId, dto);
  }

  /** DELETE .../items/:itemId (API-06 §17.7) — soft-delete. Gate update:task. */
  @Delete(":taskId/checklists/:checklistId/items/:itemId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "task")
  async deleteChecklistItem(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("checklistId") checklistId: string,
    @Param("itemId") itemId: string,
  ) {
    await this.taskChecklists.removeItem(req.user, taskId, checklistId, itemId);
  }

  // ═══════════════════ S4-TASK-BE-4 — Activity feed (API-06 §16.7 · TASK-API-602) ═══════════════

  /**
   * GET /tasks/:taskId/activity — lịch sử hoạt động task (task_activity_logs, append-only). Gate
   * `view:task-audit-log` (sensitive=true, seed 0485 CHỈ hr/company-admin @Company — employee/manager
   * 403 ĐÚNG THIẾT KẾ, SPEC-06 TASK-ERR-042).
   */
  @Get(":taskId/activity")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "task-audit-log", { isSensitive: true })
  listActivity(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Query() query: ListTaskActivityQueryDto,
  ) {
    return this.taskActivityFeed.list(req.user, taskId, query);
  }
}
