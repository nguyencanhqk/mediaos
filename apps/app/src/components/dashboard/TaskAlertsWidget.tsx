/**
 * TaskAlertsWidget — DASH-WIDGET-003 "Task quá hạn/sắp đến hạn" (SPEC-07 §14.3). widget_code=TASK_ALERTS,
 * slug=task-alerts, module nguồn TASK. Data: apps/api dashboard-widget-handlers.service.ts
 * fetchTaskAlerts() → { items, summary:{ total, overdue, dueSoon } }.
 *
 * Gate: PermissionGate(read:task) — MIRROR đúng BE DASH_WIDGET_GATE_PAIR.TASK_ALERTS.
 */
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { PermissionGate } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import {
  TaskStatusBadge,
  TaskPriorityBadge,
  TaskOverdueBadge,
} from "@/routes/tasks/TaskStatusBadge";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { taskAlertsWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

interface TaskAlertsWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function TaskAlertsWidgetInner({ dashboardType }: TaskAlertsWidgetProps) {
  const { t } = useTranslation("dashboard");
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.TASK_ALERTS,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? taskAlertsWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  return (
    <WidgetCard
      title={t("taskAlerts.title")}
      icon={AlertTriangle}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={emptyMsg.success ? emptyMsg.data.message : t("taskAlerts.empty.title")}
      errorTitle={data?.error_state?.message ?? t("widget.error.title")}
      errorDescription={t("widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {parsed?.success && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("taskAlerts.summary", {
              overdue: parsed.data.summary.overdue,
              dueSoon: parsed.data.summary.dueSoon,
            })}
          </p>
          <ul className="space-y-2">
            {parsed.data.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                <p className="min-w-0 flex-1 truncate font-medium text-foreground">{item.title}</p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <TaskPriorityBadge priority={item.priority} />
                  <TaskStatusBadge status={item.status} />
                  <TaskOverdueBadge isOverdue={item.isOverdue} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

/** Gate ngoài (PermissionGate) — user thiếu read:task ⇒ KHÔNG render (KHÔNG fetch, KHÔNG hiện shell rỗng). */
export function TaskAlertsWidget(props: TaskAlertsWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.TASK_ALERTS;
  return (
    <PermissionGate action={pair.action} resourceType={pair.resourceType}>
      <TaskAlertsWidgetInner {...props} />
    </PermissionGate>
  );
}
