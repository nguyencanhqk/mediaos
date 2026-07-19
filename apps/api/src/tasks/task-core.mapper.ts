import { InternalServerErrorException } from "@nestjs/common";
import type {
  ProjectStateGroupDto,
  TaskCorePriorityDto,
  TaskCoreResponseDto,
  TaskCoreStatusDto,
  TaskKanbanCardDto,
} from "@mediaos/contracts";
import type { TaskCoreRow } from "./task-core.repository";

/**
 * S4-TASK-BE-4 — projection dùng chung `TaskCoreRow → TaskCoreResponseDto` cho mọi READ mới (Kanban board).
 * Copy có kiểm soát của `TaskCoreService.toDto`/`TaskActionsService.toDto` (private, KHÔNG export) — tách
 * ra đây để BE-4 tái dùng mà không đụng 2 service crown hiện có (giảm bề mặt regression). Raw `tx.execute`
 * KHÔNG type-parse (drizzle không biết OID) ⇒ timestamptz về string, boolean về 't'/'f'|'true'/'false'.
 */

function toIso(v: string | Date | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function toBool(v: boolean | string): boolean {
  return v === true || v === "true" || v === "t";
}

export function toTaskCoreDto(row: TaskCoreRow): TaskCoreResponseDto {
  const createdAt = toIso(row.createdAt);
  const updatedAt = toIso(row.updatedAt);
  if (createdAt === null || updatedAt === null) {
    throw new InternalServerErrorException("Task thiếu timestamp bắt buộc (createdAt/updatedAt).");
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
    dueAt: toIso(row.dueAt),
    startAt: toIso(row.startAt),
    completedAt: toIso(row.completedAt),
    isOverdue: toBool(row.isOverdue),
    createdBy: row.createdBy,
    createdAt,
    updatedAt,
    // S5-TASK-PIPELINE-1 (lane be-read) — cột pipeline resolved (schema optional: hàng từ đường
    // chưa join state vẫn parse; server điền null tường minh thay vì bỏ key).
    stateId: row.stateId ?? null,
    stateName: row.stateName ?? null,
    stateColor: row.stateColor ?? null,
    stateGroup: (row.stateGroup as ProjectStateGroupDto | null | undefined) ?? null,
  };
}

/** Counts per-card cho Kanban (SPEC-06 §13.8) — aggregate GROUP BY task_id ở repo, KHÔNG N+1. */
export interface TaskKanbanCardCounts {
  commentCount: number;
  attachmentCount: number;
  checklistDone: number;
  checklistTotal: number;
}

/**
 * S5-TASK-BE-6 — `toTaskCoreDto` + counts per-card. Tách khỏi `toTaskCoreDto` (KHÔNG sửa base) vì counts CHỈ
 * cần cho Kanban board — list/detail/my-tasks vẫn dùng `taskCoreResponseSchema` nguyên vẹn.
 */
export function toTaskKanbanCardDto(
  row: TaskCoreRow,
  counts: TaskKanbanCardCounts,
): TaskKanbanCardDto {
  return { ...toTaskCoreDto(row), ...counts };
}
