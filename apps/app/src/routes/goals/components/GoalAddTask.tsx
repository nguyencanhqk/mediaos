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
  const [failure, setFailure] = useState<LinkFailure | null>(null);

  const link = useMutation({
    mutationFn: (task: TaskCoreResponseDto) => goalApi.linkTasks(goal.id, { taskIds: [task.id] }),
    onSuccess: async (_result, task) => {
      setFailure(null);
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
      setFailure({ task, message: err instanceof ApiError && err.message ? err.message : null });
    },
  });

  return {
    open,
    openForm: () => setOpen(true),
    closeForm: () => setOpen(false),
    failure,
    retrying: link.isPending,
    /** Gọi khi bước 1 (tạo việc) đã xong: đóng drawer rồi gắn. */
    onCreated: (task: TaskCoreResponseDto) => {
      setOpen(false);
      setFailure(null);
      link.mutate(task);
    },
    retry: () => {
      if (failure) link.mutate(failure.task);
    },
    openFailedTask: () => {
      if (failure) openTask(failure.task.id);
    },
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
  const { failure } = state;
  if (!failure) return null;
  return (
    <div
      role="alert"
      data-testid="goal-add-task-failure"
      className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-foreground"
    >
      <span>
        {t("addTask.notLinked", { name: failure.task.title })}
        {failure.message ? ` ${failure.message}` : ""}
      </span>
      <Button
        size="sm"
        variant="outline"
        data-testid="goal-add-task-retry"
        disabled={state.retrying}
        onClick={state.retry}
      >
        {t("addTask.retry")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-testid="goal-add-task-open-created"
        onClick={state.openFailedTask}
      >
        {t("addTask.open")}
      </Button>
    </div>
  );
}
