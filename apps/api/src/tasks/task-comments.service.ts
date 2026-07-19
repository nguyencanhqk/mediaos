import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateTaskCommentRequest,
  DataScope,
  TaskCommentMentionDto,
  TaskCommentResponseDto,
  UpdateTaskCommentRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import { TaskCoreRepository, type TaskCoreRow, type TaskScopeMode } from "./task-core.repository";
import { TaskCommentsRepository, type TaskCommentRow } from "./task-comments.repository";
import { TaskActivityService } from "./task-activity.service";

interface RequestUser {
  id: string;
  companyId: string;
}

/** Mã lỗi TASK (SPEC-01 §9 MODULE-ERR-XXX) — fail-loud, KHÔNG nuốt nhánh lỗi. */
const ERR = {
  TASK_NOT_FOUND: "TASK-ERR-TASK-NOT-FOUND: không tìm thấy công việc.",
  COMMENT_NOT_FOUND: "TASK-ERR-COMMENT-NOT-FOUND: không tìm thấy bình luận.",
  NOT_AUTHOR: "TASK-ERR-COMMENT-NOT-AUTHOR: chỉ người tạo bình luận mới được sửa.",
  DELETE_FORBIDDEN:
    "TASK-ERR-COMMENT-DELETE-FORBIDDEN: chỉ người tạo hoặc người có quyền quản trị mới được xoá bình luận này.",
  MENTION_NOT_FOUND:
    "TASK-ERR-MENTION-NOT-FOUND: không tìm thấy nhân viên được nhắc hoặc đã ngưng hoạt động.",
  MENTION_OUT_OF_SCOPE:
    "TASK-ERR-MENTION-OUT-OF-SCOPE: người được nhắc không có quyền xem công việc này.",
} as const;

/**
 * S4-TASK-BE-4 — TaskCommentsService (SPEC-06 §14.14, API-06 §16 · TASK-API-301..304).
 *
 * BẤT BIẾN #1: mọi query đi qua db.withTenant(companyId) (RLS+FORCE) + repo AND company_id tường minh.
 * BẤT BIẾN #2: xoá = soft (deleted_at) — KHÔNG hard-delete.
 * BẤT BIẾN #3: outbox payload CHỈ ID/enum/title/taskId/actorUserId — KHÔNG nội dung comment (API-06 §16.2:4).
 *
 * "Chỉ người xem được task mới comment được" (SPEC-06 §14.14) ⇒ MỌI route (list/create/update/delete) guard
 * `assertTaskVisible` bằng CHÍNH data-scope đọc (Own/Team/Company) tái dùng `TaskCoreRepository` — task ngoài
 * scope ⇒ 404 (không lộ tồn tại). Mention: NGƯỜI ĐƯỢC MENTION phải tự có quyền xem task (kiểm scope của HỌ,
 * KHÔNG phải của actor) — ngoài scope ⇒ 403 BLOCK (KHÔNG chỉ warning, done_when "bị chặn").
 *
 * DEBT (ghi trong PR — schema lane): `task_comments` chưa có bảng `task_comment_mentions` (API-06 liệt kê
 * nhưng KHÔNG migration nào tạo) ⇒ mention KHÔNG lưu quan hệ truy vấn lại được; response `mentions[]` chỉ
 * phản chiếu request VỪA gọi (POST/PATCH), GET list trả rỗng. Lịch sử mention còn trong task_activity_logs
 * (new_values.mentionEmployeeIds, append-only) + outbox event TASK_MENTIONED (durable).
 */
@Injectable()
export class TaskCommentsService {
  private readonly logger = new Logger(TaskCommentsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskCommentsRepository,
    private readonly coreRepo: TaskCoreRepository,
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
    private readonly activity: TaskActivityService,
    private readonly outbox: OutboxService,
  ) {}

  async list(user: RequestUser, taskId: string): Promise<TaskCommentResponseDto[]> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "read", "task");
    return this.db.withTenant(user.companyId, async (tx) => {
      await this.assertTaskVisible(tx, user, taskId, scope, "read");
      const rows = await this.repo.listByTaskTx(tx, user.companyId, taskId);
      return rows.map((r) => this.toDto(r, []));
    });
  }

  async create(
    user: RequestUser,
    taskId: string,
    dto: CreateTaskCommentRequest,
  ): Promise<TaskCommentResponseDto> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "comment", "task");
    return this.db.withTenant(user.companyId, async (tx) => {
      const task = await this.assertTaskVisible(tx, user, taskId, scope, "collab");
      const mentions = await this.resolveMentions(
        tx,
        user.companyId,
        taskId,
        dto.mentionEmployeeIds,
      );

      const created = await this.repo.insertTx(tx, user.companyId, {
        taskId,
        userId: user.id,
        body: dto.content,
      });
      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      // Đọc lại row NGAY (thay vì cuối hàm) để lấy `userName` (users.full_name của actor = tác giả
      // comment) dùng cho payload outbox actor_name — additive, KHÔNG cần repo/query mới.
      const row = await this.repo.findByIdTx(tx, user.companyId, taskId, created.id);
      if (!row) throw new InternalServerErrorException("Không tải lại được bình luận vừa tạo.");
      // FULL-gate fix HIGH-2 (S5-NOTI-FIX-2): full_name nullable ⇒ coalesce sang email (NOT NULL, định danh
      // đăng nhập, KHÔNG thuộc SENSITIVE_PAYLOAD_KEYS) — actor_name không bao giờ null, renderer không còn
      // đường giữ '{actor_name}' trần (silent failure cùng lớp với bug QA2-CRIT-002 đang vá).
      const actorDisplayName = row.userName ?? row.userEmail ?? null;

      await this.activity.record(tx, {
        action: "COMMENT_CREATED",
        targetType: "Comment",
        targetId: created.id,
        taskId,
        projectId: task.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        newValues: { mentionEmployeeIds: mentions.map((m) => m.employeeId) },
      });
      await this.audit.record(tx, {
        action: "TaskCommentCreated",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        after: { commentId: created.id },
      });
      await this.outbox.enqueue(tx, {
        eventType: "task.comment_created",
        payload: this.commentPayload(
          "TASK_COMMENT_CREATED",
          task,
          user,
          actorEmp?.id ?? null,
          created.id,
          actorDisplayName,
        ),
      });
      if (mentions.length > 0) {
        await this.outbox.enqueue(tx, {
          eventType: "task.mentioned",
          payload: {
            ...this.commentPayload(
              "TASK_MENTIONED",
              task,
              user,
              actorEmp?.id ?? null,
              created.id,
              actorDisplayName,
            ),
            mentionedEmployeeIds: mentions.map((m) => m.employeeId),
            mentionedUserIds: mentions.map((m) => m.userId),
          },
        });
      }

      return this.toDto(row, mentions);
    });
  }

  async update(
    user: RequestUser,
    taskId: string,
    commentId: string,
    dto: UpdateTaskCommentRequest,
  ): Promise<TaskCommentResponseDto> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "comment", "task");
    return this.db.withTenant(user.companyId, async (tx) => {
      const task = await this.assertTaskVisible(tx, user, taskId, scope, "collab");
      const existing = await this.repo.findByIdTx(tx, user.companyId, taskId, commentId);
      if (!existing || existing.deletedAt !== null)
        throw new NotFoundException(ERR.COMMENT_NOT_FOUND);
      // Self-only MVP (API-06 §16.3:2 "MVP không hỗ trợ [sửa của người khác] thì chặn").
      if (existing.userId !== user.id) throw new ForbiddenException(ERR.NOT_AUTHOR);

      const mentions = await this.resolveMentions(
        tx,
        user.companyId,
        taskId,
        dto.mentionEmployeeIds,
      );
      const updated = await this.repo.updateBodyTx(tx, user.companyId, commentId, dto.content);
      if (!updated) throw new NotFoundException(ERR.COMMENT_NOT_FOUND);

      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      await this.activity.record(tx, {
        action: "COMMENT_UPDATED",
        targetType: "Comment",
        targetId: commentId,
        taskId,
        projectId: task.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        newValues: { mentionEmployeeIds: mentions.map((m) => m.employeeId) },
      });
      await this.audit.record(tx, {
        action: "TaskCommentUpdated",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        after: { commentId },
      });

      const row = await this.repo.findByIdTx(tx, user.companyId, taskId, commentId);
      if (!row) throw new InternalServerErrorException("Không tải lại được bình luận vừa sửa.");
      return this.toDto(row, mentions);
    });
  }

  async remove(user: RequestUser, taskId: string, commentId: string): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "comment", "task");
    await this.db.withTenant(user.companyId, async (tx) => {
      const task = await this.assertTaskVisible(tx, user, taskId, scope, "collab");
      const existing = await this.repo.findByIdTx(tx, user.companyId, taskId, commentId);
      if (!existing || existing.deletedAt !== null)
        throw new NotFoundException(ERR.COMMENT_NOT_FOUND);

      // Author luôn xoá được của MÌNH; "người khác nếu có quyền" (SPEC-06 §14.14) = actor giữ scope
      // Company/System trên `comment:task` (MVP không có permission "moderate-comment" riêng).
      if (existing.userId !== user.id && scope !== "Company" && scope !== "System") {
        throw new ForbiddenException(ERR.DELETE_FORBIDDEN);
      }

      const removed = await this.repo.softDeleteTx(tx, user.companyId, commentId, user.id);
      if (!removed) throw new NotFoundException(ERR.COMMENT_NOT_FOUND);

      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      await this.activity.record(tx, {
        action: "COMMENT_DELETED",
        targetType: "Comment",
        targetId: commentId,
        taskId,
        projectId: task.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
      });
      await this.audit.record(tx, {
        action: "TaskCommentDeleted",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        before: { commentId },
      });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Task PHẢI tồn tại + nằm trong scope của actor theo `mode` (else 404 — không lộ tồn tại/cross-tenant).
   * S5-TASK-PROJROLE-1 (BLOCKING #1 plan-reviewer): helper này phục vụ CẢ list (đọc) LẪN create/update/
   * remove (viết) ⇒ mode PHẢI thread từ caller — list → 'read' (Viewer đọc được comment), mutate →
   * 'collab' (D-24: viết comment đòi role ≥ Member; Viewer bị chặn). KHÔNG gán cứng một mode.
   */
  private async assertTaskVisible(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    scope: DataScope,
    mode: TaskScopeMode,
  ): Promise<TaskCoreRow> {
    const scopeExists = await this.scopeExistsFor(tx, user.id, user.companyId, scope, mode);
    const row = await this.coreRepo.findScopedByIdTx(tx, user.companyId, taskId, scopeExists);
    if (!row) throw new NotFoundException(ERR.TASK_NOT_FOUND);
    return row;
  }

  private async scopeExistsFor(
    tx: TenantTx,
    userId: string,
    companyId: string,
    scope: DataScope,
    mode: TaskScopeMode,
  ) {
    if (scope === "Company" || scope === "System") return undefined;
    const ctx = await this.dataScope.resolveContext(userId, companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, companyId, userId);
    return this.coreRepo.buildReadScopeExists(
      companyId,
      scopeCond,
      actorEmp?.id ?? null,
      userId,
      mode,
    );
  }

  /**
   * Validate + resolve mentionEmployeeIds → {employeeId,userId,name}[]. FAIL-CLOSED: nhân viên
   * không tồn tại/inactive/chưa-có-account → 400; nhân viên KHÔNG TỰ xem được task này → 403 BLOCK
   * (done_when "ngoài quyền bị chặn" — KHÔNG chỉ cảnh báo).
   */
  private async resolveMentions(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    mentionEmployeeIds: string[],
  ): Promise<TaskCommentMentionDto[]> {
    const out: TaskCommentMentionDto[] = [];
    for (const employeeId of mentionEmployeeIds) {
      const emp = await this.coreRepo.findEmployeeForScopeTx(tx, companyId, employeeId);
      if (!emp || emp.deletedAt !== null || emp.status !== "active" || !emp.userId) {
        throw new BadRequestException(ERR.MENTION_NOT_FOUND);
      }
      const canView = await this.canEmployeeViewTask(tx, companyId, taskId, emp.userId, emp.id);
      if (!canView) throw new ForbiddenException(ERR.MENTION_OUT_OF_SCOPE);
      out.push({ employeeId: emp.id, userId: emp.userId, name: null });
    }
    return out;
  }

  /** scope của NGƯỜI ĐƯỢC MENTION cho read:task (KHÔNG phải actor) — tái dùng đúng infra data-scope. */
  private async canEmployeeViewTask(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    employeeUserId: string,
    employeeId: string,
  ): Promise<boolean> {
    const scope = await this.permission.resolveStrongestScope(
      employeeUserId,
      companyId,
      "read",
      "task",
    );
    if (!scope) return false;
    if (scope === "Company" || scope === "System") return true;
    const ctx = await this.dataScope.resolveContext(employeeUserId, companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    const scopeExists = this.coreRepo.buildReadScopeExists(
      companyId,
      scopeCond,
      employeeId,
      employeeUserId,
    );
    const row = await this.coreRepo.findScopedByIdTx(tx, companyId, taskId, scopeExists);
    return !!row;
  }

  /**
   * S5-NOTI-FIX-2 (lane noti-fix2-comment) — additive: `task_code`/`actor_name` (snake_case) thêm
   * KHỚP CHÍNH XÁC placeholder template global 0481 (`{task_code}`/`{actor_name}` — seed
   * TASK_COMMENT_CREATED/TASK_MENTIONED). 8 key camelCase cũ GIỮ NGUYÊN tên (consumer cũ không vỡ).
   * Non-sensitive: task_code (mã công khai) + actor_name (tên người bình luận) — không thuộc
   * SENSITIVE_PAYLOAD_KEYS (BẤT BIẾN #3, notification-engine.errors.ts assertPayloadSafe).
   *
   * FULL-gate fix HIGH-1: `task_code` coalesce sang `title` khi NULL — comment/mention lên task
   * KHÔNG được rớt lại '{task_code}' trần (đúng lời hứa QA2-CRIT-002). Body khi fallback:
   * "… trong task <title>." — đọc tự nhiên.
   *
   * S5-TASK-HRCODE-1: đường HR (attendance-adjustment) ĐÃ cut-over ⇒ task_code thật, không còn chạm
   * fallback. Nhưng nguồn NULL vẫn CÒN SỐNG: workflow.repository.createTask (task_type='workflow_step',
   * WorkflowModule đăng ký ở app.module) không cấp mã. Vì fallback trông y hệt thành công, blind spot này
   * sẽ KHÔNG BAO GIỜ tự lộ ⇒ log WARN khi rơi nhánh fallback để nó phát hiện được (không đổi hành vi,
   * không ném — comment vẫn gửi bình thường).
   */
  private commentPayload(
    eventCode: string,
    task: TaskCoreRow,
    user: RequestUser,
    actorEmployeeId: string | null,
    commentId: string,
    actorName: string | null,
  ): Record<string, unknown> {
    if (!task.taskCode) {
      // Không ném: comment vẫn phải gửi. Chỉ làm blind spot NHÌN THẤY ĐƯỢC — task_code=NULL nghĩa là
      // còn nguồn tạo task chưa cut-over code-gen (workflow_step), người dùng sẽ thấy tiêu đề thay vì mã.
      this.logger.warn(
        `task_code NULL → fallback sang title cho task ${task.id} (event ${eventCode}). Nguồn tạo task này chưa cut-over code-gen counter 'task'.`,
      );
    }
    return {
      eventCode,
      taskId: task.id,
      taskTitle: task.title,
      projectId: task.projectId,
      commentId,
      actorUserId: user.id,
      actorEmployeeId,
      assigneeEmployeeId: task.mainAssigneeEmployeeId,
      creatorUserId: task.creatorUserId,
      task_code: task.taskCode ?? task.title,
      actor_name: actorName,
    };
  }

  private toIso(v: string | Date): string {
    return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  }

  private toDto(row: TaskCommentRow, mentions: TaskCommentMentionDto[]): TaskCommentResponseDto {
    return {
      id: row.id,
      taskId: row.taskId,
      userId: row.userId,
      userName: row.userName,
      content: row.body,
      mentions,
      createdAt: this.toIso(row.createdAt),
      // task_comments KHÔNG có updated_at (debt db-migration — xem class doc) ⇒ luôn null.
      updatedAt: null,
    };
  }
}
