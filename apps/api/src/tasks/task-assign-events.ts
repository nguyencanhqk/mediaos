import { Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import type { TaskActionWarning } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { TaskActivityService } from "./task-activity.service";
import { TaskActionsRepository } from "./task-actions.repository";
import { TaskCoreRepository, type TaskRawRow } from "./task-core.repository";
import type { TaskPatchGatedField } from "./task-patch-field-gate";

/**
 * S20-TASK-ASSIGNNOTI-1 — MỘT nguồn phát sự kiện giao việc / đổi hạn / đổi ưu tiên cho MỌI đường ghi việc:
 * route chuyên trách (`/assign` · `/change-deadline` · `/change-priority`, TaskActionsService), form Tạo
 * (`POST /tasks` + phân rã mục tiêu, `createTaskInTx`) và form Sửa (`PATCH /tasks/:id`, `updateTask`).
 *
 * BẤT BIẾN:
 *   • Mọi hàm nhận `tx` của caller và KHÔNG tự mở `withTenant` ⇒ outbox + activity + audit commit/rollback
 *     CÙNG hàng việc (lỗi giữa chừng ⇒ 0 outbox).
 *   • Payload chỉ ID/enum/tiêu đề/mốc thời gian/mã việc + actor — KHÔNG `description`, KHÔNG `reason`.
 *   • Người nhận do bridge NOTI đọc audience HIỆN TẠI (`task-noti-bridge.registrar.ts`); engine tự loại actor.
 *   • Tạo việc tự giao cho chính mình / không người phụ trách ⇒ không phát `task.assigned`.
 * Chỉ ghi; KHÔNG kiểm quyền — caller đã qua cổng của mình (route guard + data-scope / `TaskPatchFieldGate`).
 */

/** Việc trong payload outbox. */
export interface TaskEventSubject {
  id: string;
  title: string;
  taskCode: string | null;
  projectId: string | null;
}

export interface TaskEventActor {
  id: string;
  companyId: string;
}

export interface TaskAssigneeRef {
  employeeId: string;
  userId: string;
}

interface EmitBase {
  task: TaskEventSubject;
  actor: TaskEventActor;
  actorEmployeeId: string | null;
}

/** Bảng loại sự kiện giao việc — chưa có người phụ trách ⇒ «được giao», đã có ⇒ «đổi người». */
export function assignKind(oldMainAssigneeEmployeeId: string | null) {
  return oldMainAssigneeEmployeeId === null
    ? ({ code: "TASK_ASSIGNED", auditAction: "TaskAssigned", eventType: "task.assigned" } as const)
    : ({
        code: "TASK_ASSIGNEE_CHANGED",
        auditAction: "TaskAssigneeChanged",
        eventType: "task.assignee_changed",
      } as const);
}

/** Payload chung (non-sensitive) của mọi sự kiện `task.*`. */
export function commonTaskPayload(
  eventCode: string,
  task: TaskEventSubject,
  actorUserId: string,
  actorEmployeeId: string | null,
): Record<string, unknown> {
  return {
    eventCode,
    taskId: task.id,
    taskTitle: task.title,
    taskCode: task.taskCode,
    projectId: task.projectId,
    actorUserId,
    actorEmployeeId,
  };
}

function toIso(v: string | Date | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

const WARN_ON_LEAVE: TaskActionWarning = {
  code: "TASK-WARN-ASSIGNEE-ON-LEAVE",
  message: "Người nhận việc có đơn nghỉ phép đã duyệt trùng với mốc thời gian.",
};
const WARN_NOT_MEMBER: TaskActionWarning = {
  code: "TASK-WARN-ASSIGNEE-NOT-MEMBER",
  message: "Người nhận việc không thuộc thành viên dự án của công việc.",
};
const ERR_ASSIGNEE_WITHOUT_USER =
  "TASK-ERR-ASSIGNEE-WITHOUT-USER: người phụ trách sau cập nhật không gắn tài khoản — không phát được sự kiện giao việc.";

@Injectable()
export class TaskAssignEvents {
  constructor(
    private readonly outbox: OutboxService,
    private readonly actionsRepo: TaskActionsRepository,
    private readonly coreRepo: TaskCoreRepository,
    private readonly audit: AuditService,
    private readonly activity: TaskActivityService,
  ) {}

  // ── Phát sự kiện (khuôn payload của route chuyên trách) ─────────────────────────────────────────

  async enqueueAssigneeTx(
    tx: TenantTx,
    e: EmitBase & { oldAssigneeEmployeeId: string | null; assignee: TaskAssigneeRef },
  ): Promise<void> {
    const kind = assignKind(e.oldAssigneeEmployeeId);
    await this.outbox.enqueue(tx, {
      eventType: kind.eventType,
      payload: {
        ...commonTaskPayload(kind.code, e.task, e.actor.id, e.actorEmployeeId),
        oldAssigneeEmployeeId: e.oldAssigneeEmployeeId,
        assigneeEmployeeId: e.assignee.employeeId,
        assigneeUserId: e.assignee.userId,
      },
    });
  }

  async enqueueDueDateTx(
    tx: TenantTx,
    e: EmitBase & {
      oldDueAt: string | null;
      newDueAt: string | null;
      assigneeUserId: string | null;
    },
  ): Promise<void> {
    await this.outbox.enqueue(tx, {
      eventType: "task.due_date_changed",
      payload: {
        ...commonTaskPayload("TASK_DUE_DATE_CHANGED", e.task, e.actor.id, e.actorEmployeeId),
        oldDueAt: e.oldDueAt,
        newDueAt: e.newDueAt,
        assigneeUserId: e.assigneeUserId,
      },
    });
  }

  async enqueuePriorityTx(
    tx: TenantTx,
    e: EmitBase & {
      oldPriority: string | null;
      newPriority: string | null;
      assigneeUserId: string | null;
    },
  ): Promise<void> {
    await this.outbox.enqueue(tx, {
      eventType: "task.priority_changed",
      payload: {
        ...commonTaskPayload("TASK_PRIORITY_CHANGED", e.task, e.actor.id, e.actorEmployeeId),
        oldPriority: e.oldPriority,
        newPriority: e.newPriority,
        assigneeUserId: e.assigneeUserId,
      },
    });
  }

  // ── Cảnh báo (dùng chung `/assign` · `/change-deadline` · form Tạo) ─────────────────────────────

  /** Người được giao nghỉ phép đúng ngày hạn (ngày UTC của `dueAt`) · không là thành viên dự án. */
  async buildAssignWarningsTx(
    tx: TenantTx,
    companyId: string,
    task: { dueAt: string | Date | null; projectId: string | null },
    assignee: TaskAssigneeRef,
  ): Promise<TaskActionWarning[]> {
    const warnings: TaskActionWarning[] = [];
    const dueIso = toIso(task.dueAt);
    if (dueIso) {
      const onLeave = await this.actionsRepo.hasApprovedLeaveOnDateTx(
        tx,
        companyId,
        dueIso.slice(0, 10),
        assignee.userId,
        assignee.employeeId,
      );
      if (onLeave) warnings.push(WARN_ON_LEAVE);
    }
    if (task.projectId) {
      const isMember = await this.actionsRepo.isEmployeeProjectMemberTx(
        tx,
        companyId,
        task.projectId,
        assignee.employeeId,
      );
      if (!isMember) warnings.push(WARN_NOT_MEMBER);
    }
    return warnings;
  }

  async buildDeadlineWarningsTx(
    tx: TenantTx,
    companyId: string,
    task: { mainAssigneeEmployeeId: string | null; assigneeUserId: string | null },
    newDue: string | null,
  ): Promise<TaskActionWarning[]> {
    if (!newDue || !task.mainAssigneeEmployeeId) return [];
    const onLeave = await this.actionsRepo.hasApprovedLeaveOnDateTx(
      tx,
      companyId,
      newDue.slice(0, 10),
      task.assigneeUserId,
      task.mainAssigneeEmployeeId,
    );
    return onLeave ? [WARN_ON_LEAVE] : [];
  }

  /** Cảnh báo của việc VỪA TẠO (đọc lại hàng trong cùng tx) — chỉ đường HTTP tạo việc gọi. */
  async createdWarningsTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
  ): Promise<TaskActionWarning[]> {
    const row = await this.loadTx(tx, companyId, taskId);
    if (!row.mainAssigneeEmployeeId || !row.assigneeUserId) return [];
    return this.buildAssignWarningsTx(tx, companyId, row, {
      employeeId: row.mainAssigneeEmployeeId,
      userId: row.assigneeUserId,
    });
  }

  // ── Form Tạo / form Sửa ─────────────────────────────────────────────────────────────────────────

  /**
   * Nhật ký `TASK_CREATED` (activity + audit, chuyển nguyên văn từ `createTaskInTx`) rồi — giao cho NGƯỜI
   * KHÁC người tạo — `task.assigned` (NOTI-EVENT-002). Caller gọi TRƯỚC recompute mục tiêu.
   */
  async recordCreatedTx(
    tx: TenantTx,
    e: EmitBase & { snapshot: Record<string, unknown>; assignee: TaskAssigneeRef | null },
  ): Promise<void> {
    await this.activity.record(tx, {
      action: "TASK_CREATED",
      targetType: "Task",
      targetId: e.task.id,
      taskId: e.task.id,
      projectId: e.task.projectId,
      actorUserId: e.actor.id,
      actorEmployeeId: e.actorEmployeeId,
      newValues: { ...e.snapshot },
      message: `Tạo công việc ${e.task.title}`,
    });
    await this.audit.record(tx, {
      action: "TaskCreated",
      objectType: "task",
      objectId: e.task.id,
      actorUserId: e.actor.id,
      after: { ...e.snapshot },
    });
    if (e.assignee && e.assignee.userId !== e.actor.id) {
      await this.enqueueAssigneeTx(tx, { ...e, oldAssigneeEmployeeId: null, assignee: e.assignee });
    }
  }

  /**
   * Nhật ký `TASK_UPDATED` (chuyển nguyên văn từ `updateTask`; rỗng ⇒ không ghi gì) rồi sự kiện của từng
   * trường có cổng THỰC SỰ đổi (`fieldChanges` = `computeChanged`, tính TRƯỚC cổng). Payload theo hàng SAU
   * patch (tiêu đề · dự án · người phụ trách), giá trị cũ theo `before`. Gỡ người phụ trách ⇒ không phát
   * (route `/assign` không có ca này). Caller gọi TRƯỚC recompute mục tiêu.
   */
  async recordPatchedTx(
    tx: TenantTx,
    e: {
      actor: TaskEventActor;
      taskId: string;
      before: Pick<
        TaskRawRow,
        | "projectId"
        | "parentTaskId"
        | "stateId"
        | "mainAssigneeEmployeeId"
        | "dueAt"
        | "taskPriority"
      >;
      auditedChanges: Record<string, unknown>;
      parentChanged: boolean;
      newParentTaskId: string | null;
      fieldChanges: ReadonlySet<TaskPatchGatedField>;
    },
  ): Promise<void> {
    const { actor, taskId, before, auditedChanges, parentChanged } = e;
    if (Object.keys(auditedChanges).length === 0) return;
    const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, actor.companyId, actor.id);
    const actorEmployeeId = actorEmp?.id ?? null;
    await this.activity.record(tx, {
      action: "TASK_UPDATED",
      targetType: "Task",
      targetId: taskId,
      taskId,
      projectId: before.projectId,
      actorUserId: actor.id,
      actorEmployeeId,
      // S5-TASK-SUBTASK-1 — CHỐNG "THẺ BIẾN MẤT CÂM": gán cha làm thẻ rời board, đó là thay đổi
      // người dùng NHÌN THẤY nên phải có dòng lịch sử. Ghi oldValues CHỈ cho parentTaskId/stateId
      // (không đổi hình dạng bản ghi cho mọi field — spec timeline #245 đang pin `newValues`);
      // TaskActivityTimeline dựng dòng cũ→mới từ cặp này.
      ...(parentChanged
        ? {
            oldValues: { parentTaskId: before.parentTaskId, stateId: before.stateId },
            message: e.newParentTaskId
              ? "Chuyển thành việc con"
              : "Tách khỏi việc cha thành việc độc lập",
          }
        : { message: "Cập nhật công việc" }),
      newValues: parentChanged
        ? { ...auditedChanges, parentTaskId: e.newParentTaskId, stateId: null }
        : auditedChanges,
    });
    await this.audit.record(tx, {
      action: "TaskUpdated",
      objectType: "task",
      objectId: taskId,
      actorUserId: actor.id,
      before: parentChanged
        ? { changed: Object.keys(auditedChanges), parentTaskId: before.parentTaskId }
        : { changed: Object.keys(auditedChanges) },
      after: auditedChanges,
    });
    await this.emitPatchedTx(tx, e, actorEmployeeId);
  }

  private async emitPatchedTx(
    tx: TenantTx,
    e: Parameters<TaskAssignEvents["recordPatchedTx"]>[1],
    actorEmployeeId: string | null,
  ): Promise<void> {
    if (e.fieldChanges.size === 0) return;
    const after = await this.loadTx(tx, e.actor.companyId, e.taskId);
    const base: EmitBase = { task: after, actor: e.actor, actorEmployeeId };
    const assigneeUserId = after.assigneeUserId;
    if (e.fieldChanges.has("assigneeEmployeeId") && after.mainAssigneeEmployeeId) {
      // resolveAssignee đã đòi tài khoản (400) TRƯỚC khi ghi ⇒ vắng ở đây = hàng lệch: nổ to (rollback cả
      // PATCH) thay vì bỏ sự kiện giao việc không tiếng động.
      if (!assigneeUserId) throw new InternalServerErrorException(ERR_ASSIGNEE_WITHOUT_USER);
      await this.enqueueAssigneeTx(tx, {
        ...base,
        oldAssigneeEmployeeId: e.before.mainAssigneeEmployeeId,
        assignee: { employeeId: after.mainAssigneeEmployeeId, userId: assigneeUserId },
      });
    }
    if (e.fieldChanges.has("dueAt")) {
      const [oldDueAt, newDueAt] = [toIso(e.before.dueAt), toIso(after.dueAt)];
      await this.enqueueDueDateTx(tx, { ...base, oldDueAt, newDueAt, assigneeUserId });
    }
    if (e.fieldChanges.has("priority")) {
      const [oldPriority, newPriority] = [e.before.taskPriority, after.taskPriority];
      await this.enqueuePriorityTx(tx, { ...base, oldPriority, newPriority, assigneeUserId });
    }
  }

  /** Hàng việc hiện tại trong tx (vừa ghi xong ⇒ phải có; vắng = lỗi, nổ to thay vì bỏ qua sự kiện). */
  private async loadTx(tx: TenantTx, companyId: string, taskId: string) {
    const row = await this.actionsRepo.findActionRawTx(tx, companyId, taskId);
    if (!row) throw new NotFoundException("TASK-ERR-TASK-NOT-FOUND: không tìm thấy công việc.");
    return row;
  }
}
