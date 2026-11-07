import { useTranslation } from "react-i18next";
import { Unlink } from "lucide-react";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { TaskOverdueBadge, TaskStatusBadge } from "@/routes/tasks/TaskStatusBadge";
import { formatLinkedTaskDue } from "../goal-linked-tasks-view";
import { SimpleTable } from "./GoalTabPrimitives";

export interface GoalLinkedTaskTableProps {
  tasks: readonly TaskCoreResponseDto[];
  canOpenTask: boolean;
  canEditLinks: boolean;
  /** Mục tiêu đã chốt kỳ ⇒ mọi control ghi disabled (GOAL-ERR-005). */
  locked: boolean;
  onOpen: (taskId: string) => void;
  onUnlink: (task: TaskCoreResponseDto) => void;
}

/** Bảng việc gắn — dùng cho cả danh sách phẳng lẫn từng nhóm theo người. Việc quá hạn tô đỏ + nhãn. */
export function GoalLinkedTaskTable({
  tasks,
  canOpenTask,
  canEditLinks,
  locked,
  onOpen,
  onUnlink,
}: GoalLinkedTaskTableProps) {
  const { t } = useTranslation("goals");
  return (
    <SimpleTable
      head={[
        t("detail.linkedTasks.columns.title"),
        t("detail.linkedTasks.columns.status"),
        t("detail.linkedTasks.columns.assignee"),
        t("detail.linkedTasks.columns.project"),
        t("detail.linkedTasks.columns.due"),
        ...(canEditLinks ? [""] : []),
      ]}
    >
      {tasks.map((task) => (
        <tr
          key={task.id}
          data-testid={`goal-linked-row-${task.id}`}
          data-overdue={task.isOverdue ? "true" : undefined}
          className={`border-t border-border ${task.isOverdue ? "bg-destructive/10" : ""}`}
        >
          <td className="px-3 py-2 text-sm">
            {canOpenTask ? (
              <button
                type="button"
                className="text-left font-medium text-foreground underline-offset-2 hover:underline"
                data-testid={`goal-linked-task-open-${task.id}`}
                onClick={() => onOpen(task.id)}
              >
                {task.title}
              </button>
            ) : (
              <span className="text-foreground">{task.title}</span>
            )}
          </td>
          {/* TaskStatusBadge (dùng chung tasks/) — nhãn ĐÃ i18n theo enum, KHÔNG in enum thô. */}
          <td className="px-3 py-2">
            <TaskStatusBadge status={task.status} />
          </td>
          <td className="px-3 py-2 text-sm text-muted-foreground">{task.assigneeName ?? "—"}</td>
          <td className="px-3 py-2 text-sm text-muted-foreground">{task.projectName ?? "—"}</td>
          <td
            className={`whitespace-nowrap px-3 py-2 text-sm ${task.isOverdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
          >
            <span className="mr-2">{formatLinkedTaskDue(task.dueAt)}</span>
            <TaskOverdueBadge isOverdue={task.isOverdue} />
          </td>
          {canEditLinks && (
            <td className="px-3 py-2 text-right">
              <Button
                size="sm"
                variant="ghost"
                data-testid={`goal-unlink-task-${task.id}`}
                disabled={locked}
                onClick={() => onUnlink(task)}
              >
                <Unlink className="mr-1.5 h-3.5 w-3.5" />
                {t("linkedTasksActions.unlink")}
              </Button>
            </td>
          )}
        </tr>
      ))}
    </SimpleTable>
  );
}
