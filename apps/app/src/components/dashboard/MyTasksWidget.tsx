/**
 * MyTasksWidget — DASH-WIDGET-002 "Task của tôi hôm nay" (SPEC-07 §14.2). widget_code=MY_TASKS,
 * slug=my-tasks, module nguồn TASK. Data: apps/api dashboard-widget-handlers.service.ts fetchMyTasks()
 * → { items, summary:{ total } } (listResult).
 *
 * Gate: PermissionGate(read:task) — MIRROR đúng BE DASH_WIDGET_GATE_PAIR.MY_TASKS (defense-in-depth; server
 * GET /dashboard/widgets đã omit widget này khỏi catalog nếu thiếu quyền — đây KHÔNG phải cổng thật).
 */
import { useTranslation } from "react-i18next";
import { ListTodo } from "lucide-react";
import { PermissionGate } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import {
  TaskStatusBadge,
  TaskPriorityBadge,
  TaskOverdueBadge,
} from "@/routes/tasks/TaskStatusBadge";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { myTasksWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

interface MyTasksWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function MyTasksWidgetInner({ dashboardType }: MyTasksWidgetProps) {
  const { t } = useTranslation("dashboard");
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.MY_TASKS,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed = data && data.data !== null ? myTasksWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  return (
    <WidgetCard
      title={t("myTasks.title")}
      icon={ListTodo}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={emptyMsg.success ? emptyMsg.data.message : t("myTasks.empty.title")}
      errorTitle={data?.error_state?.message ?? t("widget.error.title")}
      errorDescription={t("widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {parsed?.success && (
        <ul className="space-y-2">
          {parsed.data.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{item.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.projectName ?? t("myTasks.noProject")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <TaskPriorityBadge priority={item.priority} />
                <TaskStatusBadge status={item.status} />
                <TaskOverdueBadge isOverdue={item.isOverdue} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

/** Gate ngoài (PermissionGate) — user thiếu read:task ⇒ KHÔNG render (KHÔNG fetch, KHÔNG hiện shell rỗng). */
export function MyTasksWidget(props: MyTasksWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.MY_TASKS;
  return (
    <PermissionGate action={pair.action} resourceType={pair.resourceType}>
      <MyTasksWidgetInner {...props} />
    </PermissionGate>
  );
}
