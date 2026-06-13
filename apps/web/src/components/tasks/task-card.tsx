import type { TaskDto } from "@mediaos/contracts";
import { OfficeTaskStatus } from "./office-task-status";
import {
  TASK_STATUS_COLORS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  isShortenedFlowTask,
} from "./task-status-constants";

/** Slug ổn định cho data-testid (test định danh card theo tiêu đề). */
function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface TaskBoardCardProps {
  task: TaskDto;
  /** Hiện control luồng rút gọn (chỉ khi caller cho phép — vd Kanban). Mặc định true. */
  showStatusControl?: boolean;
}

/**
 * Card task cho Board — badge loại + status + (nếu là task luồng rút gọn) control đổi status.
 * Workflow-task (stepId != null hoặc taskType ∈ FSM) KHÔNG render control đổi-status-tay
 * (mirror BE: FSM mới được đổi status — G7/ADR-0016).
 */
export function TaskBoardCard({ task, showStatusControl = true }: TaskBoardCardProps) {
  const shortened = isShortenedFlowTask(task);

  return (
    <div
      data-testid={`task-card-${slug(task.title)}`}
      className="space-y-2 rounded-lg border border-border bg-background px-3 py-2.5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</p>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {TASK_TYPE_LABELS[task.taskType]}
        </span>
      </div>

      {(task.contentTitle || task.projectName) && (
        <p className="truncate text-xs text-muted-foreground">
          {task.contentTitle ?? task.projectName}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TASK_STATUS_COLORS[task.status]}`}
        >
          {TASK_STATUS_LABELS[task.status]}
        </span>
        {task.dueDate && (
          <span className="text-[10px] text-muted-foreground">
            {new Date(task.dueDate).toLocaleDateString("vi-VN")}
          </span>
        )}
      </div>

      {showStatusControl && shortened && <OfficeTaskStatus task={task} />}
    </div>
  );
}
