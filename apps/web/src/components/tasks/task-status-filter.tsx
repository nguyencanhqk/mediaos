import { useTranslation } from "react-i18next";
import type { TaskDto } from "@mediaos/contracts";
import { KANBAN_STATUS_ORDER, TASK_STATUS_DOT, TASK_STATUS_LABELS } from "./task-status-constants";

/**
 * Filter theo trạng thái (PHASE 2). `null` = "Tất cả". Lọc PHÍA CLIENT trên danh sách đã fetch —
 * KHÔNG đổi query/permission (board vẫn fetch theo task_type ở server, status chỉ thu hẹp hiển thị).
 */
export type TaskStatusFilterValue = TaskDto["status"] | null;

interface TaskStatusFilterProps {
  value: TaskStatusFilterValue;
  onChange: (value: TaskStatusFilterValue) => void;
}

export function TaskStatusFilter({ value, onChange }: TaskStatusFilterProps) {
  const { t } = useTranslation("tasks");
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("statusFilter.ariaLabel")}>
      <StatusChip label={t("common:all")} active={value === null} onClick={() => onChange(null)} />
      {KANBAN_STATUS_ORDER.map((status) => (
        <StatusChip
          key={status}
          label={TASK_STATUS_LABELS[status]}
          dot={TASK_STATUS_DOT[status]}
          active={value === status}
          onClick={() => onChange(status)}
        />
      ))}
    </div>
  );
}

function StatusChip({
  label,
  dot,
  active,
  onClick,
}: {
  label: string;
  dot?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:bg-muted"
      }`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />}
      {label}
    </button>
  );
}
