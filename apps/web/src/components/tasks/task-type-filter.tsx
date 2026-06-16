import { useTranslation } from "react-i18next";
import type { TaskDto } from "@mediaos/contracts";
import { TASK_TYPE_LABELS } from "./task-status-constants";

/**
 * Filter theo task_type (G9-3). `null` = "Tất cả" (mọi loại). 7 nguồn spec + workflow_step back-compat.
 * Đổi filter → caller refetch board với taskType tương ứng (server lọc — mirror BE listAll filter).
 */
export type TaskTypeFilterValue = TaskDto["taskType"] | null;

/** Thứ tự hiển thị: 7 nguồn nghiệp vụ trước, workflow_step (back-compat) cuối. */
const FILTER_TYPES: ReadonlyArray<TaskDto["taskType"]> = [
  "office",
  "production",
  "review",
  "revision",
  "meeting_action",
  "finance",
  "hr",
  "workflow_step",
];

interface TaskTypeFilterProps {
  value: TaskTypeFilterValue;
  onChange: (value: TaskTypeFilterValue) => void;
}

export function TaskTypeFilter({ value, onChange }: TaskTypeFilterProps) {
  const { t } = useTranslation("tasks");
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("typeFilter.ariaLabel")}>
      <FilterChip label={t("common:all")} active={value === null} onClick={() => onChange(null)} />
      {FILTER_TYPES.map((type) => (
        <FilterChip
          key={type}
          label={TASK_TYPE_LABELS[type]}
          active={value === type}
          onClick={() => onChange(type)}
        />
      ))}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}
