import type { MouseEvent, PointerEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, cn } from "@mediaos/ui";

/**
 * TaskGoalChip — S20-TASK-MYTASKSLOAD-1 (US-GOAL-NV-07). Chip «mã — tên mục tiêu» trên dòng việc/thẻ board;
 * bấm ⇒ `/tasks?goalId=<id>` (danh sách lọc theo mục tiêu đó).
 *
 * Masking là việc của SERVER: `goalId`/`goalCode` null (không xem được mục tiêu, kể cả khi `hasGoal`) ⇒ KHÔNG
 * vẽ gì — không đoán, không lộ. Cắt gọn bằng `truncate` + `max-w` (không vỡ ở 375px), `title` giữ chữ đầy đủ.
 * Chặn nổi bọt click/pointer để bấm chip không mở drawer; `draggable={false}` để kéo từ chip không kéo link.
 */
export interface TaskGoalChipProps {
  goalId?: string | null;
  goalCode?: string | null;
  goalName?: string | null;
  className?: string;
}

export function TaskGoalChip({ goalId, goalCode, goalName, className }: TaskGoalChipProps) {
  if (!goalId || !goalCode) return null;
  const label = goalName ? `${goalCode} — ${goalName}` : goalCode;
  const stop = (e: MouseEvent | PointerEvent) => e.stopPropagation();
  return (
    <Link
      to="/tasks"
      search={{ goalId }}
      draggable={false}
      title={label}
      data-testid="task-goal-chip"
      onClick={stop}
      onPointerDown={stop}
      className={cn(
        "inline-flex min-w-0 max-w-[12rem] items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground",
        className,
      )}
    >
      <Target className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * Nhãn «Đang lọc theo mục tiêu …» + nút bỏ lọc — hiện trên `/tasks?goalId=`. Mã/tên lấy từ dòng đầu của
 * danh sách (không gọi API mục tiêu); danh sách rỗng ⇒ nhãn trung tính (không lộ tên mục tiêu đã bị che).
 */
export function TaskGoalFilterNotice({
  label,
  onClear,
}: {
  label: string | null;
  onClear: () => void;
}) {
  const { t } = useTranslation("tasks");
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
      data-testid="task-goal-filter-notice"
    >
      <Target className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate">
        {label ? t("goalChip.filtering", { label }) : t("goalChip.filteringUnknown")}
      </span>
      <Button variant="outline" size="sm" onClick={onClear} data-testid="task-goal-filter-clear">
        {t("goalChip.clear")}
      </Button>
    </div>
  );
}
