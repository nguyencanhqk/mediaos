import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FilePlus2 } from "lucide-react";
import { ApiError, goalApi, goalInvalidation } from "@mediaos/web-core";
import type { GoalDetailResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { Button, toast } from "@mediaos/ui";
import { TaskFormDrawer } from "@/routes/tasks/TaskFormDrawer";
import { useTaskDrawer } from "@/routes/tasks/task-drawer-nav";

/**
 * S20-GOAL-LINKEDTASKS-1 (US-GOAL-QL-14) — «Thêm việc» ngay trong tab «Công việc gắn».
 *
 * Hai lời gọi, KHÔNG nguyên tử (owner chốt Q13 = A, không thêm đường ghi BE): `POST /tasks` (do
 * `TaskFormDrawer`) rồi `POST /goals/:id/tasks {taskIds:[id]}`. Bước 1 lỗi ⇒ drawer tự giữ dữ liệu, bước 2
 * KHÔNG được gọi (onSuccess chỉ chạy khi bước 1 xong). Bước 2 lỗi ⇒ việc ĐÃ có nhưng chưa gắn: báo thật,
 * kèm «Thử gắn lại» và link mở việc — không bao giờ báo thành công giả.
 */
interface LinkFailure {
  readonly task: TaskCoreResponseDto;
  readonly message: string | null;
}

export function useGoalAddTask(goal: GoalDetailResponseDto) {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();
  const { openTask } = useTaskDrawer();
  const [open, setOpen] = useState(false);
  // Mảng theo task.id: việc tạo lần hai KHÔNG được xoá banner «chưa gắn» của việc lần một.
  const [failures, setFailures] = useState<readonly LinkFailure[]>([]);

  const link = useMutation({
    mutationFn: (task: TaskCoreResponseDto) => goalApi.linkTasks(goal.id, { taskIds: [task.id] }),
    onSuccess: async (_result, task) => {
      setFailures((prev) => prev.filter((f) => f.task.id !== task.id));
      await Promise.all(
        goalInvalidation
          .linkTasks({ goalIds: [goal.id], taskId: task.id, projectId: task.projectId })
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      toast.success(t("addTask.linked"), {
        action: { label: t("addTask.open"), onClick: () => openTask(task.id) },
        key: `goal-add-task:${task.id}`,
      });
    },
    onError: (err, task) => {
      const message = err instanceof ApiError && err.message ? err.message : null;
      setFailures((prev) => [...prev.filter((f) => f.task.id !== task.id), { task, message }]);
      // Toast độc lập với việc tab còn mounted hay không (state có thể đã mất) — đối xứng nhánh thành công.
      toast.error(t("addTask.notLinked", { name: task.title }), {
        action: { label: t("addTask.open"), onClick: () => openTask(task.id) },
        key: `goal-add-task-fail:${task.id}`,
      });
    },
  });

  return {
    open,
    openForm: () => setOpen(true),
    closeForm: () => setOpen(false),
    failures,
    retryingId: link.isPending ? (link.variables?.id ?? null) : null,
    /** Gọi khi bước 1 (tạo việc) đã xong: đóng drawer rồi gắn. */
    onCreated: (task: TaskCoreResponseDto) => {
      setOpen(false);
      link.mutate(task);
    },
    retry: (task: TaskCoreResponseDto) => link.mutate(task),
    openFailedTask: (taskId: string) => openTask(taskId),
  };
}

export type GoalAddTaskState = ReturnType<typeof useGoalAddTask>;

export function GoalAddTaskButton({
  state,
  disabled,
}: {
  state: GoalAddTaskState;
  disabled: boolean;
}) {
  const { t } = useTranslation("goals");
  return (
    <Button
      size="sm"
      variant="outline"
      data-testid="goal-add-task-open"
      disabled={disabled}
      onClick={state.openForm}
    >
      <FilePlus2 className="mr-2 h-4 w-4" />
      {t("addTask.button")}
    </Button>
  );
}

export function GoalAddTaskDrawer({
  goal,
  state,
}: {
  goal: GoalDetailResponseDto;
  state: GoalAddTaskState;
}) {
  if (!state.open) return null;
  return (
    <TaskFormDrawer
      mode="create"
      onClose={state.closeForm}
      onSuccess={state.onCreated}
      initialValues={goal.projectId ? { projectId: goal.projectId } : undefined}
    />
  );
}

export function GoalAddTaskFailure({ state }: { state: GoalAddTaskState }) {
  const { t } = useTranslation("goals");
  if (state.failures.length === 0) return null;
  return (
    <>
      {state.failures.map(({ task, message }) => (
        <div
          key={task.id}
          role="alert"
          data-testid="goal-add-task-failure"
          className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-foreground"
        >
          <span>
            {t("addTask.notLinked", { name: task.title })}
            {message ? ` ${message}` : ""}
          </span>
          <Button
            size="sm"
            variant="outline"
            data-testid={`goal-add-task-retry-${task.id}`}
            disabled={state.retryingId === task.id}
            onClick={() => state.retry(task)}
          >
            {t("addTask.retry")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid={`goal-add-task-open-created-${task.id}`}
            onClick={() => state.openFailedTask(task.id)}
          >
            {t("addTask.open")}
          </Button>
        </div>
      ))}
    </>
  );
}
