import { CalendarDays, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskDto } from "@mediaos/contracts";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { OfficeTaskStatus } from "./office-task-status";
import {
  TASK_STATUS_BADGE_VARIANT,
  TASK_STATUS_LABELS,
  TASK_STATUS_PROGRESS,
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

/** Quá hạn = có dueDate và đã qua hôm nay và chưa hoàn thành/duyệt. */
function isOverdue(task: TaskDto): boolean {
  if (!task.dueDate) return false;
  if (task.status === "completed" || task.status === "approved") return false;
  return new Date(task.dueDate).getTime() < Date.now();
}

interface TaskBoardCardProps {
  task: TaskDto;
  /** Hiện control luồng rút gọn (chỉ khi caller cho phép — vd Kanban). Mặc định true. */
  showStatusControl?: boolean;
}

/**
 * Card task cho Board (PHASE 2 — MISA AMIS): tiêu đề + badge loại + ngữ cảnh + thanh tiến độ +
 * footer (assignee avatar · status badge · hạn). Task luồng rút gọn còn có control đổi status.
 *
 * BẤT BIẾN dữ liệu: TaskDto của board KHÔNG có tên/avatar người nhận, checklist count hay thumbnail
 * → chỉ hiển thị những gì server trả (avatar = initials từ assigneeUserId). KHÔNG bịa dữ liệu, KHÔNG
 * đổi hook/permission (mirror BE: FSM mới đổi status workflow — G7/ADR-0016).
 */
export function TaskBoardCard({ task, showStatusControl = true }: TaskBoardCardProps) {
  const { t } = useTranslation("tasks");
  const shortened = isShortenedFlowTask(task);
  const progress = TASK_STATUS_PROGRESS[task.status];
  const overdue = isOverdue(task);
  const context = task.contentTitle ?? task.projectName;

  return (
    <div
      data-testid={`task-card-${slug(task.title)}`}
      className="group space-y-2.5 rounded-xl border border-border bg-background p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      {/* Hàng đầu: loại + tiêu đề */}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">
          {task.title}
        </p>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {TASK_TYPE_LABELS[task.taskType]}
        </Badge>
      </div>

      {context && (
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <Layers className="h-3 w-3 shrink-0" strokeWidth={1.8} />
          <span className="truncate">{context}</span>
        </p>
      )}

      {/* Thanh tiến độ theo vòng đời (chỉ hiển thị — server vẫn là sự thật) */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("card.progressAriaLabel")}
      >
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Footer: assignee + status + hạn */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {task.assigneeUserId ? (
            <Avatar
              name={task.assigneeUserId.slice(0, 2).toUpperCase()}
              size="sm"
              title={t("card.assigneeAssigned")}
            />
          ) : (
            <span className="text-[10px] text-muted-foreground">{t("card.unassigned")}</span>
          )}
          <Badge variant={TASK_STATUS_BADGE_VARIANT[task.status]} className="text-[10px]">
            {TASK_STATUS_LABELS[task.status]}
          </Badge>
        </div>
        {task.dueDate && (
          <span
            className={`flex items-center gap-1 text-[10px] ${
              overdue ? "font-medium text-destructive" : "text-muted-foreground"
            }`}
          >
            <CalendarDays className="h-3 w-3" strokeWidth={1.8} />
            {new Date(task.dueDate).toLocaleDateString("vi-VN")}
          </span>
        )}
      </div>

      {showStatusControl && shortened && (
        <div className="border-t border-border/60 pt-2">
          <OfficeTaskStatus task={task} />
        </div>
      )}
    </div>
  );
}
