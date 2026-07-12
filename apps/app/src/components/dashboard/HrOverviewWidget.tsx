/**
 * HrOverviewWidget — DASH-WIDGET-004 "Tổng quan nhân sự" (SPEC-07 §14.2, S4-FE-DASH-2 P1). widget_code=
 * HR_OVERVIEW, slug=hr-overview, module nguồn HR. Data: apps/api dashboard-widget-handlers.service.ts
 * fetchHrOverview() → { summary:{ headcount }, byStatus, byOrgUnit } (HrReadService.listHrEmployees, CHỈ
 * đếm — KHÔNG baseSalary/salaryType/PII, xem doc-block handler).
 *
 * Gate: PermissionGate(read:employee) — MIRROR đúng BE DASH_WIDGET_GATE_PAIR.HR_OVERVIEW.
 */
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { PermissionGate } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { hrOverviewWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

interface HrOverviewWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function HrOverviewWidgetInner({ dashboardType }: HrOverviewWidgetProps) {
  const { t } = useTranslation("dashboard");
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.HR_OVERVIEW,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? hrOverviewWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  return (
    <WidgetCard
      title={t("hrOverview.title")}
      icon={Users}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={emptyMsg.success ? emptyMsg.data.message : t("hrOverview.empty.title")}
      errorTitle={data?.error_state?.message ?? t("widget.error.title")}
      errorDescription={t("widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {parsed?.success && (
        <div className="space-y-3">
          <p className="text-2xl font-semibold text-foreground">
            {parsed.data.summary.headcount}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {t("hrOverview.headcountUnit")}
            </span>
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(parsed.data.byStatus).map(([empStatus, count]) => (
              <div
                key={empStatus}
                className="flex items-center justify-between text-xs text-muted-foreground"
              >
                <span className="truncate">{empStatus}</span>
                <span className="font-medium text-foreground">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

/** Gate ngoài (PermissionGate) — user thiếu read:employee ⇒ KHÔNG render (KHÔNG fetch). */
export function HrOverviewWidget(props: HrOverviewWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.HR_OVERVIEW;
  return (
    <PermissionGate action={pair.action} resourceType={pair.resourceType}>
      <HrOverviewWidgetInner {...props} />
    </PermissionGate>
  );
}
