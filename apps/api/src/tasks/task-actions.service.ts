import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  AssignTaskRequest,
  ChangeTaskDeadlineRequest,
  ChangeTaskPriorityRequest,
  ChangeTaskStatusRequest,
  DataScope,
  TaskActionResponseDto,
  TaskActionWarning,
  TaskCoreResponseDto,
  TaskCoreStatusDto,
  TaskCorePriorityDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { SettingService } from "../foundation/settings/setting.service";
import { DataScopeService } from "../permission/data-scope.service";
import {
  TaskCoreRepository,
  type EmployeeForScope,
  type TaskCoreRow,
} from "./task-core.repository";
import { TaskActionsRepository, type ActionTaskRaw } from "./task-actions.repository";
import { TaskActivityService } from "./task-activity.service";
import { coalesceTaskStatus, deriveStatusTimestamps, evaluateTransition } from "./task-fsm";
import { isStateInGroupForStatus, pickTargetState } from "./task-state-sync";

interface RequestUser {
  id: string;
  companyId: string;
}

const WORKFLOW_TASK_TYPES = new Set<string>(["workflow_step", "production", "review", "revision"]);

/** Setting key checklist (BACKEND-08:1687 nguyên văn). found=false ⇒ coi như TẮT (mặc định). */
const CHECKLIST_SETTING_KEY = "require_checklist_done_before_task_done";

/** Mã lỗi slug (SPEC-06 §18a / API-06 §25) — fail-loud, KHÔNG nuốt lỗi. */
const ERR = {
  NOT_FOUND: "TASK-ERR-TASK-NOT-FOUND: không tìm thấy công việc.",
  WORKFLOW_LOCKED:
    "TASK-ERR-TASK-WORKFLOW: công việc thuộc workflow — thao tác qua workflow, không sửa tay.",
  CHECKLIST_REQUIRED:
    "TASK-ERR-CHECKLIST-REQUIRED: còn hạng mục checklist bắt buộc chưa hoàn thành — không thể chuyển Done.",
  INVALID_DATE_RANGE: "TASK-ERR-INVALID-DATE-RANGE: hạn chót không được sớm hơn ngày bắt đầu.",
  DUPLICATE_WATCHER: "TASK-ERR-DUPLICATE-WATCHER: bạn đã theo dõi công việc này.",
  WATCHER_NO_EMPLOYEE:
    "TASK-ERR-WATCHER-NO-EMPLOYEE: tài khoản chưa gắn hồ sơ nhân viên — không thể theo dõi.",
  ASSIGNEE_NOT_FOUND: "TASK-ERR-TASK-ASSIGNEE-NOT-FOUND: không tìm thấy nhân viên nhận việc.",
  ASSIGNEE_NOT_ACTIVE:
    "TASK-ERR-TASK-ASSIGNEE-INACTIVE: nhân viên nhận việc đã nghỉ/ngưng hoạt động.",
  ASSIGNEE_NO_ACCOUNT:
    "TASK-ERR-TASK-ASSIGNEE-NO-ACCOUNT: nhân viên nhận việc chưa có tài khoản người dùng.",
  ASSIGNEE_OUT_OF_SCOPE:
    "TASK-ERR-TASK-ASSIGNEE-OUT-OF-SCOPE: nhân viên nhận việc ngoài phạm vi giao việc của bạn.",
} as const;

/**
 * S4-TASK-BE-3 — TaskActionsService (crown FSM). 6 use-case dưới /tasks/:taskId. Business logic Ở SERVICE.
 *
 * BẤT BIẾN #1: mọi query trong db.withTenant(companyId) + repo AND company_id tường minh (RLS+FORCE 0478).
 * BẤT BIẾN #2: assignee/watcher gỡ = SOFT-remove; activity + audit + outbox ghi CÙNG tx nghiệp vụ.
 * BẤT BIẾN #3: payload outbox chỉ ID/enum/title/timestamp/taskCode + actorUserId — KHÔNG description/reason.
 * DOUBLE-GATE: PermissionGuard (controller, cặp seed 0485) + data-scope (service, ngoài scope → 404 nhất quán).
 */
@Injectable()
export class TaskActionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskActionsRepository,
    private readonly coreRepo: TaskCoreRepository,
    private readonly dataScope: DataScopeService,
    private readonly setting: SettingService,
    private readonly audit: AuditService,
    private readonly activity: TaskActivityService,
    private readonly outbox: OutboxService,
  ) {}

  // ══════════════════════ ASSIGN ══════════════════════

  async assign(
    user: RequestUser,
    taskId: string,
    dto: AssignTaskRequest,
  ): Promise<TaskActionResponseDto> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "assign", "task");
    return this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.loadMutable(tx, user, taskId, scope);
      const assignee = await this.resolveAssignee(tx, user, scope, dto.assigneeEmployeeId);
      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);

      // No-op: gán lại CHÍNH người đang là Main → 200, KHÔNG event/log trùng (open q #6).
      if (raw.mainAssigneeEmployeeId === assignee.employeeId) {
        return this.respond(tx, user.companyId, taskId, []);
      }

      const isFirst = raw.mainAssigneeEmployeeId === null;
      // swap-Main tolerant (Risk #7: BE-2 chưa ghi task_assignees ⇒ soft-remove có thể 0 hàng).
      await this.repo.softRemoveMainAssigneesTx(tx, user.companyId, taskId, user.id);
      await this.repo.insertMainAssigneeTx(
        tx,
        user.companyId,
        taskId,
        assignee.employeeId,
        user.id,
      );
      await this.repo.updateMainAssigneeTx(
        tx,
        user.companyId,
        taskId,
        assignee.employeeId,
        assignee.userId,
        user.id,
      );

      const warnings = await this.buildAssignWarnings(tx, user.companyId, raw, assignee);

      const action = isFirst ? "TASK_ASSIGNED" : "TASK_ASSIGNEE_CHANGED";
      const eventType = isFirst ? "task.assigned" : "task.assignee_changed";
      const eventCode = isFirst ? "TASK_ASSIGNED" : "TASK_ASSIGNEE_CHANGED";
      await this.activity.record(tx, {
        action,
        targetType: "Assignee",
        targetId: assignee.employeeId,
        taskId,
        projectId: raw.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        oldValues: { assigneeEmployeeId: raw.mainAssigneeEmployeeId },
        newValues: { assigneeEmployeeId: assignee.employeeId },
        message: dto.reason ?? null,
      });
      await this.audit.record(tx, {
        action: isFirst ? "TaskAssigned" : "TaskAssigneeChanged",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        before: { assigneeEmployeeId: raw.mainAssigneeEmployeeId },
        after: { assigneeEmployeeId: assignee.employeeId },
      });
      await this.outbox.enqueue(tx, {
        eventType,
        payload: {
          ...this.commonPayload(eventCode, raw, user, actorEmp?.id ?? null),
          oldAssigneeEmployeeId: raw.mainAssigneeEmployeeId,
          assigneeEmployeeId: assignee.employeeId,
          assigneeUserId: assignee.userId,
        },
      });

      return this.respond(tx, user.companyId, taskId, warnings);
    });
  }

  // ══════════════════════ CHANGE STATUS ══════════════════════

  /**
   * Wrapper MỎNG: resolve scope + đọc setting checklist TRƯỚC khi mở tx (SettingService.resolveSetting
   * tự mở withTenant — gọi bên trong tx nghiệp vụ = connection THỨ HAI, cạn pool dưới tải; plan 5b),
   * rồi mở tx và uỷ quyền cho changeStatusTx. Khuôn HrTasksService — lõi nhận TenantTx.
   */
  async changeStatus(
    user: RequestUser,
    taskId: string,
    dto: ChangeTaskStatusRequest,
  ): Promise<TaskActionResponseDto> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "update-status",
      "task",
    );
    const checklistGateEnabled =
      dto.status === "Done" ? await this.isChecklistGateEnabled(user.companyId) : false;
    return this.db.withTenant(user.companyId, (tx) =>
      this.changeStatusTx(tx, user, taskId, dto, scope, checklistGateEnabled),
    );
  }

  /**
   * LÕI đổi status — chạy TRONG tx caller đưa vào (KHÔNG tự mở tx: gọi wrapper changeStatus trong tx
   * sẵn có = 2 connection tranh cùng row lock ⇒ TỰ DEADLOCK, bẫy M1). Đường move-state (lane be-write)
   * gọi THẲNG method này trong cùng tx với thao tác đổi cột ⇒ atomic thật.
   *
   * TIỀN ĐIỀU KIỆN CỦA CALLER NGOÀI changeStatus (ép bằng review — không ép được bằng type):
   * (1) PHẢI tự resolveAndAssert đúng pair `update-status:task` và truyền scope ĐÓ vào — không mượn
   *     scope của pair khác (scope confusion, B1).
   * (2) PHẢI gọi `isChecklistGateEnabled(companyId)` TRƯỚC khi mở tx và truyền kết quả vào
   *     `checklistGateEnabled` khi đích là Done — TUYỆT ĐỐI không truyền false mù (bypass câm cổng
   *     checklist ĐK-3) và không đọc setting bên trong tx (bẫy 5b cạn pool).
   */
  async changeStatusTx(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    dto: ChangeTaskStatusRequest,
    scope: DataScope,
    checklistGateEnabled: boolean,
  ): Promise<TaskActionResponseDto> {
    // allowCancelled: FSM §6.10.1 quyết định (Cancelled khôi phục được) — 3 action kia vẫn chặn 422.
    const raw = await this.loadMutable(tx, user, taskId, scope, { allowCancelled: true });

    const t = evaluateTransition(raw.taskStatus, dto.status);
    if (!t.ok) {
      // Sau nới §6.10.1 FSM chỉ từ chối bằng 409 (thực tế: Cancelled → In Review/Done);
      // 422 TASK-CLOSED sống ở loadMutable cho 3 action ngoài changeStatus.
      throw new ConflictException(this.msg("TASK-ERR-WORKFLOW-INVALID", t.code));
    }
    if (t.noop) return this.respond(tx, user.companyId, taskId, []);

    // Done + setting bật + còn item bắt buộc chưa xong (ĐK-3) → 400. Setting đã đọc TRƯỚC tx.
    if (dto.status === "Done" && checklistGateEnabled) {
      const pending = await this.repo.countRequiredPendingItemsTx(tx, user.companyId, taskId);
      if (pending > 0) {
        throw new BadRequestException(
          this.msg("TASK-ERR-CHECKLIST-REQUIRED", ERR.CHECKLIST_REQUIRED),
        );
      }
    }

    const updated = await this.repo.updateStatusTx(tx, user.companyId, taskId, {
      status: dto.status,
      // D-19: vào Done/Cancelled set mốc; RỜI Done/Cancelled clear mốc + *_by (lead-time đúng).
      ...deriveStatusTimestamps(t.from, t.to),
      actorUserId: user.id,
    });
    if (!updated) throw new NotFoundException(ERR.NOT_FOUND);

    // D-21: status đổi ngoài board ⇒ thẻ PHẢI theo cột nhóm tương ứng, CÙNG tx (không lệch pha ngược).
    await this.syncStateWithStatusTx(tx, user, taskId, raw.projectId, t.to);

    const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
    await this.activity.record(tx, {
      action: "TASK_STATUS_CHANGED",
      targetType: "Task",
      targetId: taskId,
      taskId,
      projectId: raw.projectId,
      actorUserId: user.id,
      actorEmployeeId: actorEmp?.id ?? null,
      oldValues: { status: t.from },
      newValues: { status: t.to },
      message: dto.reason ?? null,
    });
    await this.audit.record(tx, {
      action: "TaskStatusChanged",
      objectType: "task",
      objectId: taskId,
      actorUserId: user.id,
      before: { status: t.from },
      after: { status: t.to },
    });
    await this.outbox.enqueue(tx, {
      eventType: "task.status_changed",
      payload: {
        ...this.commonPayload("TASK_STATUS_CHANGED", raw, user, actorEmp?.id ?? null),
        fromStatus: t.from,
        toStatus: t.to,
        assigneeUserId: raw.assigneeUserId,
        creatorUserId: raw.creatorUserId,
      },
    });

    return this.respond(tx, user.companyId, taskId, []);
  }

  // ══════════════════════ CHANGE PRIORITY ══════════════════════

  async changePriority(
    user: RequestUser,
    taskId: string,
    dto: ChangeTaskPriorityRequest,
  ): Promise<TaskActionResponseDto> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "update-priority",
      "task",
    );
    return this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.loadMutable(tx, user, taskId, scope);
      if (raw.taskPriority === dto.priority) {
        return this.respond(tx, user.companyId, taskId, []); // no-op (W2)
      }

      const updated = await this.repo.updatePriorityTx(
        tx,
        user.companyId,
        taskId,
        dto.priority,
        user.id,
      );
      if (!updated) throw new NotFoundException(ERR.NOT_FOUND);

      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      await this.activity.record(tx, {
        action: "TASK_PRIORITY_CHANGED",
        targetType: "Task",
        targetId: taskId,
        taskId,
        projectId: raw.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        oldValues: { priority: raw.taskPriority },
        newValues: { priority: dto.priority },
        message: dto.reason ?? null,
      });
      await this.audit.record(tx, {
        action: "TaskPriorityChanged",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        before: { priority: raw.taskPriority },
        after: { priority: dto.priority },
      });
      await this.outbox.enqueue(tx, {
        eventType: "task.priority_changed",
        payload: {
          ...this.commonPayload("TASK_PRIORITY_CHANGED", raw, user, actorEmp?.id ?? null),
          oldPriority: raw.taskPriority,
          newPriority: dto.priority,
          assigneeUserId: raw.assigneeUserId,
        },
      });

      return this.respond(tx, user.companyId, taskId, []);
    });
  }

  // ══════════════════════ CHANGE DEADLINE ══════════════════════

  async changeDeadline(
    user: RequestUser,
    taskId: string,
    dto: ChangeTaskDeadlineRequest,
  ): Promise<TaskActionResponseDto> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "update-deadline",
      "task",
    );
    return this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.loadMutable(tx, user, taskId, scope);

      const newDue = dto.dueAt;
      const startMs = this.toMs(raw.startAt);
      if (newDue !== null && startMs !== null && Date.parse(newDue) < startMs) {
        throw new BadRequestException(
          this.msg("TASK-ERR-INVALID-DATE-RANGE", ERR.INVALID_DATE_RANGE),
        );
      }
      const oldDueMs = this.toMs(raw.dueAt);
      const newDueMs = newDue === null ? null : Date.parse(newDue);
      if (oldDueMs === newDueMs) {
        return this.respond(tx, user.companyId, taskId, []); // no-op (W2)
      }

      const updated = await this.repo.updateDueTx(tx, user.companyId, taskId, newDue, user.id);
      if (!updated) throw new NotFoundException(ERR.NOT_FOUND);

      const warnings = await this.buildDeadlineWarnings(tx, user.companyId, raw, newDue);
      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      await this.activity.record(tx, {
        action: "TASK_DUE_DATE_CHANGED",
        targetType: "Task",
        targetId: taskId,
        taskId,
        projectId: raw.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        oldValues: { dueAt: this.toIso(raw.dueAt) },
        newValues: { dueAt: newDue },
        message: dto.reason ?? null,
      });
      await this.audit.record(tx, {
        action: "TaskDueDateChanged",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        before: { dueAt: this.toIso(raw.dueAt) },
        after: { dueAt: newDue },
      });
      await this.outbox.enqueue(tx, {
        eventType: "task.due_date_changed",
        payload: {
          ...this.commonPayload("TASK_DUE_DATE_CHANGED", raw, user, actorEmp?.id ?? null),
          oldDueAt: this.toIso(raw.dueAt),
          newDueAt: newDue,
          assigneeUserId: raw.assigneeUserId,
        },
      });

      return this.respond(tx, user.companyId, taskId, warnings);
    });
  }

  // ══════════════════════ WATCHERS (self-only) ══════════════════════

  async addWatcher(user: RequestUser, taskId: string): Promise<TaskActionResponseDto> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "watch", "task");
    return this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.loadWatchable(tx, user, taskId, scope);
      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      // Fail-loud: task_watchers.employee_id NOT NULL ⇒ actor KHÔNG có hồ sơ nhân viên → 400 (không chèn mù).
      if (!actorEmp) {
        throw new BadRequestException(
          this.msg("TASK-ERR-WATCHER-NO-EMPLOYEE", ERR.WATCHER_NO_EMPLOYEE),
        );
      }
      const existing = await this.repo.findActiveWatcherTx(tx, user.companyId, taskId, actorEmp.id);
      if (existing) {
        throw new ConflictException(this.msg("TASK-ERR-DUPLICATE-WATCHER", ERR.DUPLICATE_WATCHER));
      }
      try {
        await this.repo.insertWatcherTx(tx, user.companyId, taskId, actorEmp.id, user.id);
      } catch (err: unknown) {
        // Hàng rào cuối: unique index 0478:112-114 (đua) → 23505 → 409 (KHÔNG nuốt).
        if (this.isUniqueViolation(err)) {
          throw new ConflictException(
            this.msg("TASK-ERR-DUPLICATE-WATCHER", ERR.DUPLICATE_WATCHER),
          );
        }
        throw err;
      }
      await this.activity.record(tx, {
        action: "TASK_WATCHER_ADDED",
        targetType: "Watcher",
        targetId: actorEmp.id,
        taskId,
        projectId: raw.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp.id,
        message: "Theo dõi công việc",
      });
      await this.audit.record(tx, {
        action: "TaskWatcherAdded",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        after: { watcherEmployeeId: actorEmp.id },
      });
      // KHÔNG outbox: registry §9.5 không có TASK_WATCHER_* (Producer §9.4 chỉ phát mã có trong registry).
      return this.respond(tx, user.companyId, taskId, []);
    });
  }

  async removeWatcher(user: RequestUser, taskId: string, watcherId: string): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "watch", "task");
    await this.db.withTenant(user.companyId, async (tx) => {
      await this.loadWatchable(tx, user, taskId, scope);
      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      const w = await this.repo.findWatcherByIdTx(tx, user.companyId, taskId, watcherId);
      if (!w || w.deletedAt !== null) throw new NotFoundException(ERR.NOT_FOUND);
      // SELF-ONLY MVP: chỉ gỡ watcher CỦA CHÍNH MÌNH (watcher.employee_id === actorEmp). Khác → 404 (không lộ).
      if (!actorEmp || w.employeeId !== actorEmp.id) throw new NotFoundException(ERR.NOT_FOUND);
      const removed = await this.repo.softRemoveWatcherTx(tx, user.companyId, watcherId, user.id);
      if (!removed) throw new NotFoundException(ERR.NOT_FOUND);
      await this.activity.record(tx, {
        action: "TASK_WATCHER_REMOVED",
        targetType: "Watcher",
        targetId: watcherId,
        taskId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        message: "Bỏ theo dõi công việc",
      });
      await this.audit.record(tx, {
        action: "TaskWatcherRemoved",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        before: { watcherId },
      });
    });
  }

  // ══════════════════════ Guards / helpers ══════════════════════

  /**
   * load (404) → guard workflow (400) → guard Cancelled (422) → data-scope write (404). Cho 4 action mutate.
   * allowCancelled: CHỈ đường changeStatus (khôi phục qua FSM §6.10.1) — assign/change-priority/
   * change-deadline giữ nguyên 422, KHÔNG mở quyền sửa task đã huỷ (SPEC-06 §6.10.1, bẫy M4).
   */
  private async loadMutable(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    scope: DataScope,
    opts: { allowCancelled?: boolean } = {},
  ): Promise<ActionTaskRaw> {
    const raw = await this.loadWorkflowChecked(tx, user, taskId);
    if (!opts.allowCancelled && coalesceTaskStatus(raw.taskStatus) === "Cancelled") {
      throw new UnprocessableEntityException(
        this.msg(
          "TASK-ERR-TASK-CLOSED",
          "task đã huỷ — chỉ đường đổi trạng thái được mở để khôi phục.",
        ),
      );
    }
    await this.assertInScopeForWrite(tx, user, taskId, scope);
    return raw;
  }

  /** Watch: load (404) → workflow ALLOW (watch không mutate vòng đời) → data-scope (404). KHÔNG guard Cancelled. */
  private async loadWatchable(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    scope: DataScope,
  ): Promise<ActionTaskRaw> {
    const raw = await this.repo.findActionRawTx(tx, user.companyId, taskId);
    if (!raw) throw new NotFoundException(ERR.NOT_FOUND);
    await this.assertInScopeForWrite(tx, user, taskId, scope);
    return raw;
  }

  private async loadWorkflowChecked(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
  ): Promise<ActionTaskRaw> {
    const raw = await this.repo.findActionRawTx(tx, user.companyId, taskId);
    if (!raw) throw new NotFoundException(ERR.NOT_FOUND);
    if (raw.workflowStepId !== null || WORKFLOW_TASK_TYPES.has(raw.taskType)) {
      throw new BadRequestException(this.msg("TASK-ERR-TASK-WORKFLOW", ERR.WORKFLOW_LOCKED));
    }
    return raw;
  }

  /** scope < Company ⇒ task phải nằm trong phạm vi ghi (assignee-scope OR membership) ⇒ else 404. */
  private async assertInScopeForWrite(
    tx: TenantTx,
    user: RequestUser,
    id: string,
    scope: DataScope,
  ): Promise<void> {
    if (scope === "Company" || scope === "System") return;
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
    const scopeExists = this.coreRepo.buildReadScopeExists(
      user.companyId,
      scopeCond,
      actorEmp?.id ?? null,
      user.id,
    );
    const scoped = await this.coreRepo.findScopedByIdTx(tx, user.companyId, id, scopeExists);
    if (!scoped) throw new NotFoundException(ERR.NOT_FOUND);
  }

  private async resolveAssignee(
    tx: TenantTx,
    user: RequestUser,
    scope: DataScope,
    employeeId: string,
  ): Promise<{ employeeId: string; userId: string }> {
    const emp = await this.coreRepo.findEmployeeForScopeTx(tx, user.companyId, employeeId);
    if (!emp || emp.deletedAt !== null) throw new BadRequestException(ERR.ASSIGNEE_NOT_FOUND);
    if (emp.status !== "active") throw new BadRequestException(ERR.ASSIGNEE_NOT_ACTIVE);
    if (!emp.userId) throw new BadRequestException(ERR.ASSIGNEE_NO_ACCOUNT);
    await this.assertAssigneeInScope(user, scope, emp);
    return { employeeId: emp.id, userId: emp.userId };
  }

  /** Giao NGOÀI phạm vi người giao → 403 (fail-closed, mirror TaskCoreService.assertAssigneeInScope). */
  private async assertAssigneeInScope(
    user: RequestUser,
    scope: DataScope,
    emp: EmployeeForScope,
  ): Promise<void> {
    if (scope === "Company" || scope === "System") return;
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const inScope = this.dataScope.isEmployeeInScope(scope, ctx, {
      userId: emp.userId,
      companyId: user.companyId,
      orgUnitId: emp.orgUnitId,
      directManagerUserId: emp.directManagerUserId,
    });
    if (!inScope) throw new ForbiddenException(ERR.ASSIGNEE_OUT_OF_SCOPE);
  }

  private async buildAssignWarnings(
    tx: TenantTx,
    companyId: string,
    raw: ActionTaskRaw,
    assignee: { employeeId: string; userId: string },
  ): Promise<TaskActionWarning[]> {
    const warnings: TaskActionWarning[] = [];
    const dueIso = this.toIso(raw.dueAt);
    if (dueIso) {
      const onLeave = await this.repo.hasApprovedLeaveOnDateTx(
        tx,
        companyId,
        dueIso.slice(0, 10),
        assignee.userId,
        assignee.employeeId,
      );
      if (onLeave) warnings.push(this.warnOnLeave());
    }
    if (raw.projectId) {
      const isMember = await this.repo.isEmployeeProjectMemberTx(
        tx,
        companyId,
        raw.projectId,
        assignee.employeeId,
      );
      if (!isMember) warnings.push(this.warnNotMember());
    }
    return warnings;
  }

  private async buildDeadlineWarnings(
    tx: TenantTx,
    companyId: string,
    raw: ActionTaskRaw,
    newDue: string | null,
  ): Promise<TaskActionWarning[]> {
    if (!newDue || !raw.mainAssigneeEmployeeId) return [];
    const onLeave = await this.repo.hasApprovedLeaveOnDateTx(
      tx,
      companyId,
      newDue.slice(0, 10),
      raw.assigneeUserId,
      raw.mainAssigneeEmployeeId,
    );
    return onLeave ? [this.warnOnLeave()] : [];
  }

  private warnOnLeave(): TaskActionWarning {
    return {
      code: "TASK-WARN-ASSIGNEE-ON-LEAVE",
      message: "Người nhận việc có đơn nghỉ phép đã duyệt trùng với mốc thời gian.",
    };
  }
  private warnNotMember(): TaskActionWarning {
    return {
      code: "TASK-WARN-ASSIGNEE-NOT-MEMBER",
      message: "Người nhận việc không thuộc thành viên dự án của công việc.",
    };
  }

  /**
   * Setting checklist (ĐK-3) — GỌI TRƯỚC KHI MỞ TX: SettingService.resolveSetting tự mở withTenant
   * riêng; gọi trong tx nghiệp vụ là connection thứ hai — không deadlock (khác bảng) nhưng cạn pool
   * dưới tải thì inner chờ mãi trong khi outer không nhả (plan 5b — sửa theo cấu trúc, test 1 request
   * trên pool rảnh KHÔNG bắt được).
   * PUBLIC cho caller của changeStatusTx ở service khác (lane be-write: move-state) dùng CHUNG —
   * không tự chế đường đọc setting thứ hai, không truyền false mù.
   */
  async isChecklistGateEnabled(companyId: string): Promise<boolean> {
    const resolved = await this.setting.resolveSetting(companyId, CHECKLIST_SETTING_KEY);
    return resolved.found && this.isTruthy(resolved.value);
  }

  /**
   * D-21 (DECISIONS-03) — đồng bộ NGƯỢC status → cột pipeline, trong CÙNG tx với updateStatusTx:
   * (2) thẻ ĐÃ ở cột đúng nhóm ⇒ KHÔNG chuyển (phanh bảo đảm dừng D-21.3b — không giật cột);
   * (3) chọn cột đích theo bậc thang D-20 (nhóm đích → is_default → sort_order nhỏ nhất, tie-break
   *     ORDER BY sort_order, created_at, id);
   * (3c) đọc state hiện tại SAU khi ghi status, cùng tx — không dùng bản chụp trước lúc ghi.
   * Task ngoài dự án / dự án 0 state ⇒ giữ nguyên (state_id NULL hợp lệ). KHÔNG activity/audit riêng
   * ở đây: đây là hệ quả cơ học của TaskStatusChanged (đã audit); lịch sử "Chuyển đến cột" của đường
   * kéo-thả thuộc lane be-write (TASK_STATE_CHANGED).
   */
  private async syncStateWithStatusTx(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    projectId: string | null,
    toStatus: ChangeTaskStatusRequest["status"],
  ): Promise<void> {
    if (!projectId) return;
    const current = await this.repo.findStateSyncRowTx(tx, user.companyId, taskId);
    if (!current) return; // task biến mất giữa tx (không thể sau updateStatusTx thành công) — fail-safe
    if (isStateInGroupForStatus(current.stateGroup, toStatus)) return;
    const states = await this.repo.listActiveStatesOrderedTx(tx, user.companyId, projectId);
    const target = pickTargetState(states, toStatus);
    if (!target || target.id === current.stateId) return;
    await this.repo.updateStateIdTx(tx, user.companyId, taskId, target.id, user.id);
  }

  private isTruthy(v: unknown): boolean {
    return v === true || v === "true" || v === 1 || v === "1";
  }

  /** Payload chung (non-sensitive): eventCode/taskId/taskTitle/taskCode/projectId/actorUserId/actorEmployeeId. */
  private commonPayload(
    eventCode: string,
    raw: ActionTaskRaw,
    user: RequestUser,
    actorEmployeeId: string | null,
  ): Record<string, unknown> {
    return {
      eventCode,
      taskId: raw.id,
      taskTitle: raw.title,
      taskCode: raw.taskCode,
      projectId: raw.projectId,
      actorUserId: user.id,
      actorEmployeeId,
    };
  }

  private async respond(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    warnings: TaskActionWarning[],
  ): Promise<TaskActionResponseDto> {
    const row = await this.coreRepo.findScopedByIdTx(tx, companyId, taskId);
    if (!row) throw new InternalServerErrorException("Không tải lại được công việc vừa ghi.");
    return { task: this.toDto(row), warnings };
  }

  private isUniqueViolation(err: unknown): boolean {
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
  }

  private msg(code: string, detail: string): string {
    return detail.startsWith(code) ? detail : `${code}: ${detail}`;
  }

  // ── Projection normalize (mirror TaskCoreService.toDto — copy có kiểm soát, W4) ─────
  private toMs(v: string | Date | null): number | null {
    if (v == null) return null;
    return v instanceof Date ? v.getTime() : Date.parse(v);
  }
  private toIso(v: string | Date | null): string | null {
    if (v == null) return null;
    return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  }
  private toBool(v: boolean | string): boolean {
    return v === true || v === "true" || v === "t";
  }
  private toDto(row: TaskCoreRow): TaskCoreResponseDto {
    const createdAt = this.toIso(row.createdAt);
    const updatedAt = this.toIso(row.updatedAt);
    if (createdAt === null || updatedAt === null) {
      throw new InternalServerErrorException("Task thiếu timestamp bắt buộc.");
    }
    return {
      id: row.id,
      companyId: row.companyId,
      title: row.title,
      description: row.description,
      taskType: row.taskType,
      status: (row.taskStatus as TaskCoreStatusDto | null) ?? null,
      priority: (row.taskPriority as TaskCorePriorityDto | null) ?? null,
      projectId: row.projectId,
      projectName: row.projectName,
      mainAssigneeEmployeeId: row.mainAssigneeEmployeeId,
      assigneeName: row.assigneeName,
      creatorUserId: row.creatorUserId,
      creatorName: row.creatorName,
      reporterEmployeeId: row.reporterEmployeeId,
      departmentId: row.departmentId,
      dueAt: this.toIso(row.dueAt),
      startAt: this.toIso(row.startAt),
      completedAt: this.toIso(row.completedAt),
      isOverdue: this.toBool(row.isOverdue),
      createdBy: row.createdBy,
      createdAt,
      updatedAt,
    };
  }
}
