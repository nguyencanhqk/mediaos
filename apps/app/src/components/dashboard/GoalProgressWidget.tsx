/**
 * GoalProgressWidget — "Mục tiêu kỳ này" (SPEC-10 §7/§13, SPEC-07 DASH, S5-GOAL-DASH-1). widget_code=
 * GOAL_PROGRESS, slug=goal-progress, module nguồn GOAL. Data: apps/api dashboard-widget-handlers.service.ts
 * fetchGoalProgress() → { items: [{departmentId, departmentName, goalId, goalName, progressPercent,
 * status}], summary: { totalDepartments, avgProgressPercent } } — TÁI DÙNG GoalsService.getTree (MỘT
 * công thức, MỘT con số với GET /goals/tree — SPEC-10 §13, KHÔNG tính lại ở đây).
 *
 * Nội dung viên theo actor-scope (nhân viên chỉ thấy phòng mình, trưởng đơn vị/HR/Admin thấy rộng hơn) —
 * KHÔNG phải bug, đây là actor scope của GoalAccessService đi qua getTree (xem doc-block BE handler).
 *
 * Drill-down: bấm 1 dòng → điều hướng thẳng `/goals/$goalId` (trang chi tiết mục tiêu — KHÔNG tự vẽ lại
 * số liệu, chỉ điều hướng).
 *
 * Gate: PermissionGate(view:goal) — MIRROR đúng BE DASH_WIDGET_GATE_PAIR.GOAL_PROGRESS.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Target } from "lucide-react";
import { PermissionGate } from "@mediaos/web-core";
import { GoalProgressBar } from "@/routes/goals/components/GoalProgressBar";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { goalProgressWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

interface GoalProgressWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function GoalProgressWidgetInner({ dashboardType }: GoalProgressWidgetProps) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.GOAL_PROGRESS,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? goalProgressWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  return (
    <WidgetCard
      title={t("goalProgress.title")}
      icon={Target}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={emptyMsg.success ? emptyMsg.data.message : t("goalProgress.empty.title")}
      errorTitle={data?.error_state?.message ?? t("widget.error.title")}
      errorDescription={t("widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {parsed?.success && (
        <div className="space-y-3">
          {parsed.data.summary.avgProgressPercent !== null && (
            <p className="text-xs text-muted-foreground">
              {t("goalProgress.average", { percent: parsed.data.summary.avgProgressPercent })}
            </p>
          )}
          <ul className="space-y-2">
            {parsed.data.items.map((item) => (
              <li key={item.goalId}>
                <button
                  type="button"
                  onClick={() =>
                    void navigate({ to: "/goals/$goalId", params: { goalId: item.goalId } })
                  }
                  className="w-full space-y-1 rounded-md p-1 text-left transition-colors hover:bg-muted/50"
                >
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.departmentName ?? item.goalName}
                  </p>
                  <GoalProgressBar progressPercent={item.progressPercent} compact />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

/** Gate ngoài (PermissionGate) — user thiếu view:goal ⇒ KHÔNG render (KHÔNG fetch). */
export function GoalProgressWidget(props: GoalProgressWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.GOAL_PROGRESS;
  return (
    <PermissionGate action={pair.action} resourceType={pair.resourceType}>
      <GoalProgressWidgetInner {...props} />
    </PermissionGate>
  );
}
