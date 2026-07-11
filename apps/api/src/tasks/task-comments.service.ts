import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
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
import { TaskCoreRepository, type TaskCoreRow } from "./task-core.repository";
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
      await this.assertTaskVisible(tx, user, taskId, scope);
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
      const task = await this.assertTaskVisible(tx, user, taskId, scope);
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
        ),
      });
      if (mentions.length > 0) {
        await this.outbox.enqueue(tx, {
          eventType: "task.mentioned",
          payload: {
            ...this.commentPayload("TASK_MENTIONED", task, user, actorEmp?.id ?? null, created.id),
            mentionedEmployeeIds: mentions.map((m) => m.employeeId),
            mentionedUserIds: mentions.map((m) => m.userId),
          },
        });
      }

      const row = await this.repo.findByIdTx(tx, user.companyId, taskId, created.id);
      if (!row) throw new InternalServerErrorException("Không tải lại được bình luận vừa tạo.");
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
      const task = await this.assertTaskVisible(tx, user, taskId, scope);
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
      const task = await this.assertTaskVisible(tx, user, taskId, scope);
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

  /** Task PHẢI tồn tại + nằm trong scope đọc của actor (else 404 — không lộ tồn tại/cross-tenant). */
  private async assertTaskVisible(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    scope: DataScope,
  ): Promise<TaskCoreRow> {
    const scopeExists = await this.scopeExistsFor(tx, user.id, user.companyId, scope);
    const row = await this.coreRepo.findScopedByIdTx(tx, user.companyId, taskId, scopeExists);
    if (!row) throw new NotFoundException(ERR.TASK_NOT_FOUND);
    return row;
  }

  private async scopeExistsFor(tx: TenantTx, userId: string, companyId: string, scope: DataScope) {
    if (scope === "Company" || scope === "System") return undefined;
    const ctx = await this.dataScope.resolveContext(userId, companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, companyId, userId);
    return this.coreRepo.buildReadScopeExists(companyId, scopeCond, actorEmp?.id ?? null, userId);
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

  private commentPayload(
    eventCode: string,
    task: TaskCoreRow,
    user: RequestUser,
    actorEmployeeId: string | null,
    commentId: string,
  ): Record<string, unknown> {
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
