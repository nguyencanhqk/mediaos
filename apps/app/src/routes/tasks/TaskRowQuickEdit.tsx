import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { taskCoreApi, useCan } from "@mediaos/web-core";
import type { TaskCoreResponseDto, TaskCoreStatusDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { BadgeSelect } from "./TaskInlineFields";
import { DeadlineQuickPicker } from "./DeadlineQuickPicker";
import { useTaskActionMutation } from "./hooks/use-task-action-mutation";
import { useAssigneeWarningToast } from "./AssigneeWarning";
import { statusMenuOptions } from "./task-status-transitions";
import {
  classifyTaskQuickEditError,
  taskQuickEditErrorKey,
  type TaskQuickEditField,
} from "./task-quick-edit-errors";
import { useTaskDrawer } from "./task-drawer-nav";

/**
 * S20-TASK-QUICKEDIT-1 (US-TASK-NV-03 + NV-08) — đổi trạng thái và hạn NGAY TRÊN DÒNG («Việc của
 * tôi», cột Danh sách, trang Quá hạn) mà không mở chi tiết.
 *
 * - Gate bằng ĐÚNG cặp của route sẽ gọi (`update-status:task` · `update-deadline:task`, đo qua useCan):
 *   thiếu cặp ⇒ badge / chữ tĩnh, không có nút.
 * - Lưu CHỈ qua route action sẵn có (change-status · change-deadline) bằng `useTaskActionMutation` —
 *   không qua PATCH /tasks/:id (PATCH đòi cặp chuyên trách khi trường đổi — S20-SEC-TASKPATCHGATE-1).
 * - Lạc quan: `rowPatch` vá dòng trong cache danh sách ⇒ badge đổi và việc đổi nhóm ngay; server từ
 *   chối ⇒ hoàn tác + thông điệp dưới dòng (checklist kèm link tab Checklist, mất mạng kèm «Thử lại»).
 * - Menu trạng thái chỉ có chuyển hợp lệ (`statusMenuOptions`); server vẫn là lưới.
 */
export type TaskQuickEditRow = Pick<TaskCoreResponseDto, "id" | "title" | "status" | "dueAt">;

function TaskQuickEditError({
  field,
  error,
  onRetry,
  onOpenChecklist,
}: {
  field: TaskQuickEditField;
  error: unknown;
  onRetry: () => void;
  onOpenChecklist?: () => void;
}) {
  const { t } = useTranslation("tasks");
  const kind = classifyTaskQuickEditError(error);
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
      <span>{t(taskQuickEditErrorKey(field, error))}</span>
      {kind === "checklistRequired" && onOpenChecklist && (
        <button
          type="button"
          onClick={onOpenChecklist}
          className="font-medium underline underline-offset-2"
        >
          {t("quickEdit.openChecklist")}
        </button>
      )}
      {kind === "network" && (
        <button
          type="button"
          onClick={onRetry}
          className="font-medium underline underline-offset-2"
        >
          {t("quickEdit.retry")}
        </button>
      )}
    </div>
  );
}

export function TaskRowStatusControl({ task }: { task: TaskQuickEditRow }) {
  const { t } = useTranslation("tasks");
  const { openTask } = useTaskDrawer();
  const canStatus = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.resourceType,
  );
  const mutation = useTaskActionMutation<TaskCoreStatusDto>({
    taskId: task.id,
    mutationFn: (status) => taskCoreApi.changeStatus(task.id, { status }),
    toPatch: (status) => ({ status }),
    rowPatch: (status) => ({ status }),
  });

  if (!canStatus) return <TaskStatusBadge status={task.status} />;

  const retry = () => {
    if (mutation.variables) mutation.mutate(mutation.variables);
  };
  return (
    <div className="flex flex-col items-end gap-0.5">
      <BadgeSelect
        id={`task-row-status-${task.id}`}
        ariaLabel={t("quickEdit.statusLabel", { title: task.title })}
        value={task.status ?? null}
        options={statusMenuOptions(task.status ?? null)}
        disabled={mutation.isPending}
        onSelect={(status) => mutation.mutate(status)}
        renderBadge={(s) => <TaskStatusBadge status={s} />}
      />
      {mutation.isError && (
        <TaskQuickEditError
          field="status"
          error={mutation.error}
          onRetry={retry}
          onOpenChecklist={() => openTask(task.id, { tab: "checklist" })}
        />
      )}
    </div>
  );
}

/**
 * `readOnly` = cách dòng hiện hạn khi KHÔNG có `update-deadline:task` (mỗi bề mặt một kiểu chữ).
 * Vá lạc quan đặt `isOverdue: false`: mốc nhanh luôn ở tương lai, «Xoá hạn» thì hết quá hạn; riêng hạn
 * «Tuỳ chỉnh» đã qua thì cờ quá hạn về đúng khi refetch (FE không tự suy cờ quá hạn).
 */
export function TaskRowDeadlineControl({
  task,
  readOnly,
}: {
  task: TaskQuickEditRow;
  readOnly: ReactNode;
}) {
  const { t } = useTranslation("tasks");
  const canDeadline = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_DEADLINE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_DEADLINE.resourceType,
  );
  const notifyAssigneeWarnings = useAssigneeWarningToast();
  const mutation = useTaskActionMutation<string | null>({
    taskId: task.id,
    mutationFn: (dueAt) => taskCoreApi.changeDeadline(task.id, { dueAt }),
    toPatch: (dueAt) => ({ dueAt }),
    rowPatch: (dueAt) => ({ dueAt, isOverdue: false }),
    onWarnings: (warnings, updated) =>
      notifyAssigneeWarnings({ taskId: task.id, warnings, assigneeName: updated?.assigneeName }),
  });

  if (!canDeadline) return <>{readOnly}</>;

  return (
    <div className="flex flex-col gap-0.5">
      <DeadlineQuickPicker
        id={`task-row-deadline-${task.id}`}
        variant="compact"
        ariaLabel={t("quickEdit.deadlineLabel", { title: task.title })}
        value={task.dueAt ?? null}
        disabled={mutation.isPending}
        onSelect={(dueAt) => mutation.mutate(dueAt)}
      />
      {mutation.isError && (
        <TaskQuickEditError
          field="deadline"
          error={mutation.error}
          onRetry={() => mutation.mutate(mutation.variables ?? null)}
        />
      )}
    </div>
  );
}
