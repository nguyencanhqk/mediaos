import { useMemo, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Paperclip, ListChecks } from "lucide-react";
import {
  taskCollabApi,
  taskKeys,
  taskCollabInvalidation,
  taskCoreInvalidation,
  useCan,
  ApiError,
} from "@mediaos/web-core";
import { Card, Button, EmptyState, Avatar, Badge, cn } from "@mediaos/ui";
import type {
  TaskCoreStatusDto,
  TaskKanbanBoardDto,
  TaskKanbanCardDto,
  TaskKanbanStatusColumnDto,
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
 * S5-FE-TASK-5 — card giàu tín hiệu (benchmark UX TASK, xem memory task-ux-reference-benchmark): badge
 * comment/attachment/checklist (S5-TASK-BE-6 đã bổ sung counts vào `taskKanbanCardSchema`, field optional
 * NHƯNG server luôn điền số thật — chỉ render khi count > 0), avatar-initials thay text cho assignee, style
 * muted + gạch tiêu đề cho card Done/Cancelled. Lọc theo assignee/"Chưa giao" suy TỪ tập task của board hiện
 * có (KHÔNG gọi API member mới) — lọc client-side trong từng cột.
 */
const COMPLETED_STATUSES = new Set<TaskCoreStatusDto>(["Done", "Cancelled"]);
/** Sentinel lọc "Chưa giao" — KHÔNG phải id thật (mainAssigneeEmployeeId là UUID nên không đụng độ). */
const UNASSIGNED_FILTER_VALUE = "__unassigned__";

function moveErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "tasks.kanban.errors.conflict";
    if (err.status === 403) return "tasks.kanban.errors.forbidden";
    if (err.status === 404) return "tasks.kanban.errors.notFound";
    if (err.status >= 500) return "tasks.kanban.errors.server";
  }
  return "tasks.kanban.errors.generic";
}

function KanbanCardBadges({ task }: { task: TaskKanbanCardDto }) {
  const { t } = useTranslation("tasks");
  const commentCount = task.commentCount ?? 0;
  const attachmentCount = task.attachmentCount ?? 0;
  const checklistTotal = task.checklistTotal ?? 0;
  const checklistDone = task.checklistDone ?? 0;

  if (commentCount <= 0 && attachmentCount <= 0 && checklistTotal <= 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
      {commentCount > 0 && (
        <Badge
          variant="muted"
          title={t("tasks.kanban.badges.comments", { count: commentCount })}
          data-testid="kanban-card-badge-comments"
        >
          <MessageSquare className="h-3 w-3" aria-hidden="true" />
          {commentCount}
        </Badge>
      )}
      {attachmentCount > 0 && (
        <Badge
          variant="muted"
          title={t("tasks.kanban.badges.attachments", { count: attachmentCount })}
          data-testid="kanban-card-badge-attachments"
        >
          <Paperclip className="h-3 w-3" aria-hidden="true" />
          {attachmentCount}
        </Badge>
      )}
      {checklistTotal > 0 && (
        <Badge
          variant="muted"
          title={t("tasks.kanban.badges.checklist", {
            done: checklistDone,
            total: checklistTotal,
          })}
          data-testid="kanban-card-badge-checklist"
        >
          <ListChecks className="h-3 w-3" aria-hidden="true" />
          {checklistDone}/{checklistTotal}
        </Badge>
      )}
    </div>
  );
}

function KanbanCard({
  task,
  draggable,
  onDragStart,
}: {
  task: TaskKanbanCardDto;
  draggable: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation("tasks");
  const isCompleted = task.status != null && COMPLETED_STATUSES.has(task.status);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      data-testid={`kanban-card-${task.id}`}
      className={cn(
        "space-y-1.5 rounded-md border border-border bg-card p-2.5 text-sm shadow-sm",
        draggable && "cursor-grab active:cursor-grabbing",
        isCompleted && "border-border/60 bg-muted/40",
      )}
    >
      <p
        className={cn(
          "font-medium text-foreground",
          isCompleted && "text-muted-foreground line-through",
        )}
      >
        {task.title}
      </p>
      <div className="flex items-center justify-between gap-2">
        <Avatar
          size="sm"
          name={task.assigneeName}
          title={task.assigneeName ?? t("tasks.kanban.unassigned")}
        />
        <TaskPriorityBadge priority={task.priority} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {task.dueAt ? new Date(task.dueAt).toLocaleDateString("vi-VN") : "—"}
        </span>
        <TaskOverdueBadge isOverdue={task.isOverdue} />
      </div>
      <KanbanCardBadges task={task} />
    </div>
  );
}

function KanbanColumn({
  status,
  tasks,
  totalCount,
  canDrag,
  onDragStartTask,
  onDrop,
}: {
  status: TaskCoreStatusDto;
  tasks: TaskKanbanCardDto[];
  /** Tổng số task GỐC của cột (SPEC-06 §13.8) — header cột không đổi theo bộ lọc assignee. */
  totalCount: number;
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
        <span
          className="text-xs text-muted-foreground"
          data-testid={`kanban-column-count-${status}`}
        >
          {totalCount}
        </span>
      </div>
      {/* Cột dài tự cuộn TRONG cột (header cột đứng yên) thay vì kéo giãn cả trang;
          drop handler ở div cột cha nên kéo-thả không đổi. calc ≈ topbar + header
          project + tabs; min-h giữ vùng thả khi cột rỗng. */}
      <div className="flex min-h-24 max-h-[calc(100dvh-21rem)] flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
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

interface AssigneeOption {
  id: string;
  name: string | null;
}

/** Suy dải assignee lọc TỪ tập task hiện có của board — KHÔNG gọi API member mới. */
function useBoardAssigneeOptions(board: TaskKanbanBoardDto | undefined) {
  return useMemo(() => {
    const map = new Map<string, string | null>();
    let hasUnassigned = false;
    for (const col of board?.columns ?? []) {
      for (const task of col.tasks) {
        if (task.mainAssigneeEmployeeId) {
          if (!map.has(task.mainAssigneeEmployeeId)) {
            map.set(task.mainAssigneeEmployeeId, task.assigneeName);
          }
        } else {
          hasUnassigned = true;
        }
      }
    }
    const employees: AssigneeOption[] = Array.from(map.entries()).map(([id, name]) => ({
      id,
      name,
    }));
    return { employees, hasUnassigned };
  }, [board]);
}

function AssigneeFilterRail({
  employees,
  hasUnassigned,
  selected,
  onSelect,
}: {
  employees: AssigneeOption[];
  hasUnassigned: boolean;
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  const { t } = useTranslation("tasks");
  if (employees.length === 0 && !hasUnassigned) return null;

  const chipClass = (active: boolean) =>
    cn(
      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
      active
        ? "border-brand bg-brand-muted text-brand"
        : "border-border text-muted-foreground hover:bg-muted",
    );

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={t("tasks.kanban.filters.label")}
    >
      <span className="text-xs font-medium text-muted-foreground">
        {t("tasks.kanban.filters.label")}
      </span>
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        data-testid="kanban-filter-all"
        className={chipClass(selected === null)}
      >
        {t("tasks.kanban.filters.all")}
      </button>
      {employees.map((emp) => (
        <button
          key={emp.id}
          type="button"
          onClick={() => onSelect(emp.id)}
          aria-pressed={selected === emp.id}
          data-testid={`kanban-filter-assignee-${emp.id}`}
          title={emp.name ?? undefined}
          className={chipClass(selected === emp.id)}
        >
          <Avatar size="sm" name={emp.name} className="h-5 w-5 text-[10px]" />
          <span className="max-w-[8rem] truncate">{emp.name ?? t("tasks.kanban.unassigned")}</span>
        </button>
      ))}
      {hasUnassigned && (
        <button
          type="button"
          onClick={() => onSelect(UNASSIGNED_FILTER_VALUE)}
          aria-pressed={selected === UNASSIGNED_FILTER_VALUE}
          data-testid="kanban-filter-unassigned"
          className={chipClass(selected === UNASSIGNED_FILTER_VALUE)}
        >
          {t("tasks.kanban.filters.unassigned")}
        </button>
      )}
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
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const queryKey = taskKeys.kanban(projectId);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => taskCollabApi.getKanbanBoard(projectId),
    enabled: canView,
    staleTime: 15_000,
  });

  const { employees: assigneeOptions, hasUnassigned } = useBoardAssigneeOptions(data);

  const moveMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskCoreStatusDto }) =>
      taskCollabApi.moveTask(taskId, { status }),
    onMutate: async ({ taskId, status }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TaskKanbanBoardDto>(queryKey);
      if (previous) {
        let moved: TaskKanbanCardDto | undefined;
        const withoutMoved = previous.columns.map((col) => {
          const found = col.tasks.find((tk) => tk.id === taskId);
          if (found) moved = found;
          return { ...col, tasks: col.tasks.filter((tk) => tk.id !== taskId) };
        });
        if (moved) {
          const patched = { ...moved, status };
          // Narrow theo columnMode (union S5-TASK-PIPELINE-1) — optimistic chỉ áp cột status;
          // board state-mode (kéo theo CỘT pipeline qua move-state) thuộc lane pipeline-fe.
          const nextColumns = withoutMoved.map((col) =>
            col.columnMode === "status" && col.status === status
              ? { ...col, tasks: [patched, ...col.tasks] }
              : col,
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

  const columns = (data?.columns ?? []).filter(
    (col): col is TaskKanbanStatusColumnDto => col.columnMode === "status",
  );
  const totalTasks = columns.reduce((sum, col) => sum + col.tasks.length, 0);

  if (totalTasks === 0) {
    return (
      <EmptyState
        title={t("tasks.kanban.empty.title")}
        description={t("tasks.kanban.empty.description")}
      />
    );
  }

  const matchesAssigneeFilter = (task: TaskKanbanCardDto): boolean => {
    if (assigneeFilter === null) return true;
    if (assigneeFilter === UNASSIGNED_FILTER_VALUE) return task.mainAssigneeEmployeeId === null;
    return task.mainAssigneeEmployeeId === assigneeFilter;
  };

  return (
    <div className="space-y-3">
      {!canDrag && (
        <p className="text-xs text-muted-foreground">{t("tasks.kanban.readOnlyHint")}</p>
      )}
      <AssigneeFilterRail
        employees={assigneeOptions}
        hasUnassigned={hasUnassigned}
        selected={assigneeFilter}
        onSelect={setAssigneeFilter}
      />
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
              tasks={col.tasks.filter(matchesAssigneeFilter)}
              totalCount={col.tasks.length}
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
