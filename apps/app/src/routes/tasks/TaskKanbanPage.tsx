import { useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  taskCollabApi,
  taskKeys,
  taskCollabInvalidation,
  taskCoreInvalidation,
  useCan,
  ApiError,
} from "@mediaos/web-core";
import { Card, Button, EmptyState } from "@mediaos/ui";
import type {
  TaskCoreResponseDto,
  TaskCoreStatusDto,
  TaskKanbanBoardDto,
} from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { TaskPriorityBadge, TaskOverdueBadge } from "./TaskStatusBadge";

/**
 * TaskKanbanPage — board task theo cột trạng thái, kéo-thả đổi status (S4-FE-TASK-3, SPEC-06 §13.8/§14.13,
 * TASK-API-212 + move). Mount như tab "Kanban" trong ProjectDetailPage (route `/tasks/projects/:projectId`
 * ĐÃ có sẵn từ S4-FE-TASK-1 — KHÔNG thêm route mới, tránh đụng router.tsx ngoài phạm vi lane).
 *
 * Kéo-thả CHỈ bật khi có `update-status:task` (mirror BE SPEC-06 §14.13 "Người không có quyền update status
 * chỉ xem, không kéo thả") — card không draggable khi thiếu quyền. Optimistic move (dời card sang cột đích
 * ngay trong cache) CÓ rollback khi API lỗi (409 FSM sai bảng / 403 / 500) qua onError khôi phục snapshot.
 *
 * Card hiển thị field THẬT có trong TaskCoreResponseDto (title/assignee/priority/deadline/overdue) —
 * comment-count/attachment-count/checklist-progress ở SPEC-06 §13.8 CHƯA có trong response Kanban (BE debt,
 * KHÔNG tự chế field không tồn tại).
 */
function moveErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "tasks.kanban.errors.conflict";
    if (err.status === 403) return "tasks.kanban.errors.forbidden";
    if (err.status === 404) return "tasks.kanban.errors.notFound";
    if (err.status >= 500) return "tasks.kanban.errors.server";
  }
  return "tasks.kanban.errors.generic";
}

function KanbanCard({
  task,
  draggable,
  onDragStart,
}: {
  task: TaskCoreResponseDto;
  draggable: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`space-y-1.5 rounded-md border border-border bg-card p-2.5 text-sm shadow-sm ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <p className="font-medium text-foreground">{task.title}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{task.assigneeName ?? "—"}</span>
        <TaskPriorityBadge priority={task.priority} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {task.dueAt ? new Date(task.dueAt).toLocaleDateString("vi-VN") : "—"}
        </span>
        <TaskOverdueBadge isOverdue={task.isOverdue} />
      </div>
    </div>
  );
}

function KanbanColumn({
  status,
  tasks,
  canDrag,
  onDragStartTask,
  onDrop,
}: {
  status: TaskCoreStatusDto;
  tasks: TaskCoreResponseDto[];
  canDrag: boolean;
  onDragStartTask: (taskId: string) => (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (status: TaskCoreStatusDto) => (e: DragEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation("tasks");
  return (
    <div
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
      onDragOver={(e) => canDrag && e.preventDefault()}
      onDrop={onDrop(status)}
      data-testid={`kanban-column-${status}`}
    >
      <div className="flex items-center justify-between px-1">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          {t(`tasks.status.${status}`)}
        </h4>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {tasks.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("tasks.kanban.columnEmpty")}</p>
        ) : (
          tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              draggable={canDrag}
              onDragStart={onDragStartTask(task.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function TaskKanbanPage({ projectId }: { projectId: string }) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.VIEW_KANBAN.action,
    TASK_CORE_ENGINE_PAIRS.VIEW_KANBAN.resourceType,
  );
  const canDrag = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.resourceType,
  );
  const [dragErrorKey, setDragErrorKey] = useState<string | null>(null);
  const queryKey = taskKeys.kanban(projectId);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => taskCollabApi.getKanbanBoard(projectId),
    enabled: canView,
    staleTime: 15_000,
  });

  const moveMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskCoreStatusDto }) =>
      taskCollabApi.moveTask(taskId, { status }),
    onMutate: async ({ taskId, status }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TaskKanbanBoardDto>(queryKey);
      if (previous) {
        let moved: TaskCoreResponseDto | undefined;
        const withoutMoved = previous.columns.map((col) => {
          const found = col.tasks.find((tk) => tk.id === taskId);
          if (found) moved = found;
          return { ...col, tasks: col.tasks.filter((tk) => tk.id !== taskId) };
        });
        if (moved) {
          const patched = { ...moved, status };
          const nextColumns = withoutMoved.map((col) =>
            col.status === status ? { ...col, tasks: [patched, ...col.tasks] } : col,
          );
          queryClient.setQueryData<TaskKanbanBoardDto>(queryKey, {
            ...previous,
            columns: nextColumns,
          });
        }
      }
      setDragErrorKey(null);
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      setDragErrorKey(moveErrorKey(err));
    },
    onSettled: (_data, _error, variables) => {
      for (const key of taskCollabInvalidation.kanban(projectId, variables.taskId))
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.list())
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.my())
        void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const onDragStartTask = (taskId: string) => (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDrop = (status: TaskCoreStatusDto) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!canDrag) return;
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    const current = data?.columns.flatMap((c) => c.tasks).find((tk) => tk.id === taskId);
    if (!current || current.status === status) return;
    moveMutation.mutate({ taskId, status });
  };

  if (!canView) {
    return (
      <EmptyState
        title={t("tasks.kanban.forbidden.title")}
        description={t("tasks.kanban.forbidden.description")}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 w-72 shrink-0 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        title={t("tasks.kanban.error.title")}
        description={t("tasks.kanban.error.description")}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t("actions.retry", { ns: "common" })}
          </Button>
        }
      />
    );
  }

  const columns = data?.columns ?? [];
  const totalTasks = columns.reduce((sum, col) => sum + col.tasks.length, 0);

  if (totalTasks === 0) {
    return (
      <EmptyState
        title={t("tasks.kanban.empty.title")}
        description={t("tasks.kanban.empty.description")}
      />
    );
  }

  return (
    <div className="space-y-3">
      {!canDrag && (
        <p className="text-xs text-muted-foreground">{t("tasks.kanban.readOnlyHint")}</p>
      )}
      {dragErrorKey && (
        <p role="alert" className="text-sm text-destructive">
          {t(dragErrorKey)}
        </p>
      )}
      <Card className="overflow-x-auto p-3">
        <div className="flex gap-3">
          {columns.map((col) => (
            <KanbanColumn
              key={col.status}
              status={col.status}
              tasks={col.tasks}
              canDrag={canDrag}
              onDragStartTask={onDragStartTask}
              onDrop={onDrop}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
