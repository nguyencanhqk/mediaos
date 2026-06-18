import { CalendarDays } from "lucide-react";
import type { BoardTaskDto } from "@mediaos/contracts";
import { Avatar } from "@mediaos/ui";
import { cn } from "@/lib/utils";
import { PriorityIcon } from "@/components/priority-icon";
import { LabelChip } from "@/components/label-chip";

/** Quá hạn = có dueDate và đã qua hôm nay, và state chưa thuộc nhóm hoàn thành/hủy. */
function isOverdue(task: BoardTaskDto): boolean {
  if (!task.dueDate) return false;
  if (task.stateGroup === "completed" || task.stateGroup === "cancelled") return false;
  return new Date(task.dueDate).getTime() < Date.now();
}

/** Slug ổn định cho data-testid (test định danh card theo displayId hoặc tiêu đề). */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface IssueCardProps {
  task: BoardTaskDto;
  /** Mở panel chi tiết. */
  onClick: (taskId: string) => void;
  /** Nhãn assignee (tên/email) — null nếu chưa gán hoặc không có quyền read:employee. */
  assigneeLabel?: string | null;
}

/**
 * Card work item kiểu Plane: displayId muted + tiêu đề; hàng dưới = icon ưu tiên · chip nhãn · assignee ·
 * hạn. Chỉ hiển thị dữ liệu server trả (BoardTaskDto) — KHÔNG bịa. Click mở panel chi tiết.
 */
export function IssueCard({ task, onClick, assigneeLabel }: IssueCardProps) {
  const overdue = isOverdue(task);
  const idForTest = task.displayId ?? task.title;

  return (
    <button
      type="button"
      data-testid={`issue-card-${slug(idForTest)}`}
      onClick={() => onClick(task.id)}
      className="group w-full space-y-2 rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <div className="flex items-center gap-2">
        <PriorityIcon priority={task.priority} />
        {task.displayId && (
          <span className="font-mono text-[11px] font-medium text-muted-foreground">
            {task.displayId}
          </span>
        )}
      </div>

      <p className="line-clamp-3 text-sm font-medium leading-snug text-foreground">{task.title}</p>

      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        {task.dueDate ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11px]",
              overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            <CalendarDays className="h-3 w-3" strokeWidth={1.8} />
            {new Date(task.dueDate).toLocaleDateString("vi-VN")}
          </span>
        ) : (
          <span />
        )}
        {task.assigneeUserId && (
          <Avatar name={assigneeLabel ?? task.assigneeUserId} size="sm" title={assigneeLabel ?? ""} />
        )}
      </div>
    </button>
  );
}
