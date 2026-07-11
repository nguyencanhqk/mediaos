import { useTranslation } from "react-i18next";
import { Badge, type BadgeProps } from "@mediaos/ui";
import type { TaskCoreStatusDto, TaskCorePriorityDto } from "@mediaos/contracts";

/**
 * Badge hiển thị trạng thái/ưu tiên/quá-hạn của task core — S4-FE-TASK-2 (SPEC-06 §13.5/§13.7/§13.8).
 * Dùng chung ở TaskListPage/MyTasksPage/TaskDetailPage — tránh trôi màu sắc giữa các màn.
 */
const STATUS_VARIANT: Record<TaskCoreStatusDto, NonNullable<BadgeProps["variant"]>> = {
  Todo: "muted",
  "In Progress": "brand",
  "In Review": "warning",
  Done: "success",
  Cancelled: "danger",
};

export function TaskStatusBadge({ status }: { status: TaskCoreStatusDto | null }) {
  const { t } = useTranslation("tasks");
  if (!status) return <span className="text-sm text-muted-foreground">—</span>;
  return <Badge variant={STATUS_VARIANT[status]}>{t(`tasks.status.${status}`)}</Badge>;
}

const PRIORITY_VARIANT: Record<TaskCorePriorityDto, NonNullable<BadgeProps["variant"]>> = {
  Low: "muted",
  Medium: "secondary",
  High: "warning",
  Urgent: "danger",
};

export function TaskPriorityBadge({ priority }: { priority: TaskCorePriorityDto | null }) {
  const { t } = useTranslation("tasks");
  if (!priority) return <span className="text-sm text-muted-foreground">—</span>;
  return <Badge variant={PRIORITY_VARIANT[priority]}>{t(`tasks.priority.${priority}`)}</Badge>;
}

export function TaskOverdueBadge({ isOverdue }: { isOverdue: boolean }) {
  const { t } = useTranslation("tasks");
  if (!isOverdue) return null;
  return <Badge variant="danger">{t("tasks.overdueBadge")}</Badge>;
}
