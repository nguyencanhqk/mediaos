import { useState } from "react";
import { useTranslation } from "react-i18next";
import { taskCoreApi, useCan, ApiError } from "@mediaos/web-core";
import { Select, Input } from "@mediaos/ui";
import type {
  TaskCoreResponseDto,
  TaskCoreStatusDto,
  TaskCorePriorityDto,
} from "@mediaos/contracts";
import {
  TASK_CORE_ENGINE_PAIRS,
  TASK_CORE_STATUS_OPTIONS,
  TASK_CORE_PRIORITY_OPTIONS,
  localDatetimeToIso,
  isoToLocalDatetime,
} from "./constants";
import { TaskStatusBadge, TaskPriorityBadge } from "./TaskStatusBadge";
import { useTaskActionMutation } from "./hooks/use-task-action-mutation";

function mutationErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "tasks.statusSelect.errors.conflict";
    if (err.status === 400 || err.status === 422) return "tasks.statusSelect.errors.validation";
    if (err.status === 403) return "tasks.statusSelect.errors.forbidden";
    if (err.status >= 500) return "tasks.statusSelect.errors.server";
  }
  return "tasks.statusSelect.errors.generic";
}

/**
 * TaskStatusSelect — thao tác nhanh status/priority/deadline (S4-FE-TASK-2, SPEC-06 §13.7 Hành động
 * nhanh + §14 change-status/change-priority/change-deadline). Mỗi control gate RIÊNG bằng cặp permission
 * tương ứng (update-status/update-priority/update-deadline:task, non-sensitive → useCan wildcard OK) —
 * thiếu quyền → hiển thị badge/giá trị READ-ONLY (không render control đổi). Optimistic update CÓ rollback
 * qua useTaskActionMutation — lỗi API (409 FSM sai bảng / 403 / 500) tự phục hồi giá trị trước đó.
 */
export function TaskStatusSelect({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const canStatus = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.resourceType,
  );
  const canPriority = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_PRIORITY.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_PRIORITY.resourceType,
  );
  const canDeadline = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_DEADLINE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_DEADLINE.resourceType,
  );

  const [deadlineDraft, setDeadlineDraft] = useState(() => isoToLocalDatetime(task.dueAt));

  const statusMutation = useTaskActionMutation<TaskCoreStatusDto>({
    taskId: task.id,
    mutationFn: (status) => taskCoreApi.changeStatus(task.id, { status }),
    toPatch: (status) => ({ status }),
  });
  const priorityMutation = useTaskActionMutation<TaskCorePriorityDto>({
    taskId: task.id,
    mutationFn: (priority) => taskCoreApi.changePriority(task.id, { priority }),
    toPatch: (priority) => ({ priority }),
  });
  const deadlineMutation = useTaskActionMutation<string | null>({
    taskId: task.id,
    mutationFn: (dueAt) => taskCoreApi.changeDeadline(task.id, { dueAt }),
    toPatch: (dueAt) => ({ dueAt }),
  });

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="space-y-1.5">
        <label htmlFor="task-status-select" className="text-xs font-medium text-muted-foreground">
          {t("tasks.statusSelect.statusLabel")}
        </label>
        {canStatus ? (
          <Select
            id="task-status-select"
            value={task.status ?? ""}
            disabled={statusMutation.isPending}
            onChange={(e) => statusMutation.mutate(e.target.value as TaskCoreStatusDto)}
          >
            {TASK_CORE_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`tasks.status.${s}`)}
              </option>
            ))}
          </Select>
        ) : (
          <div>
            <TaskStatusBadge status={task.status} />
          </div>
        )}
        {statusMutation.isError && (
          <p role="alert" className="text-xs text-destructive">
            {t(mutationErrorKey(statusMutation.error))}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="task-priority-select" className="text-xs font-medium text-muted-foreground">
          {t("tasks.statusSelect.priorityLabel")}
        </label>
        {canPriority ? (
          <Select
            id="task-priority-select"
            value={task.priority ?? ""}
            disabled={priorityMutation.isPending}
            onChange={(e) => priorityMutation.mutate(e.target.value as TaskCorePriorityDto)}
          >
            {TASK_CORE_PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {t(`tasks.priority.${p}`)}
              </option>
            ))}
          </Select>
        ) : (
          <div>
            <TaskPriorityBadge priority={task.priority} />
          </div>
        )}
        {priorityMutation.isError && (
          <p role="alert" className="text-xs text-destructive">
            {t(mutationErrorKey(priorityMutation.error))}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="task-deadline-input" className="text-xs font-medium text-muted-foreground">
          {t("tasks.statusSelect.deadlineLabel")}
        </label>
        {canDeadline ? (
          <Input
            id="task-deadline-input"
            type="datetime-local"
            value={deadlineDraft}
            disabled={deadlineMutation.isPending}
            onChange={(e) => setDeadlineDraft(e.target.value)}
            onBlur={() => {
              const iso = localDatetimeToIso(deadlineDraft) ?? null;
              if (iso === task.dueAt) return;
              deadlineMutation.mutate(iso);
            }}
          />
        ) : (
          <p className="text-sm text-foreground">{task.dueAt ?? "—"}</p>
        )}
        {deadlineMutation.isError && (
          <p role="alert" className="text-xs text-destructive">
            {t(mutationErrorKey(deadlineMutation.error))}
          </p>
        )}
      </div>
    </div>
  );
}
