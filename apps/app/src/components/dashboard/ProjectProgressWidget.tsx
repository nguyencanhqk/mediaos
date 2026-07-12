/**
 * ProjectProgressWidget — DASH-WIDGET-006 "Tiến độ dự án" (SPEC-07 §14.2, S4-FE-DASH-2 P1). widget_code=
 * PROJECT_PROGRESS, slug=project-progress, module nguồn TASK (Project). Data: apps/api
 * dashboard-widget-handlers.service.ts fetchProjectProgress() → { projectId, summary:{ total, done, percent },
 * byStatus } (TasksService.listByProject aggregate, sau khi ProjectsService.getProject authorize).
 *
 * KHÁC 6 widget kia: BE `gateProjectProgress` BẮT BUỘC `project_id` query (400 DASH-ERR-VALIDATION nếu
 * thiếu) — widget này KHÔNG có default dashboard_widget_configs (DASH_DEFAULT_CONFIG, dashboard-widget-
 * catalog.const.ts: "PROJECT_PROGRESS có trong catalog nhưng KHÔNG có default config") nên KHÔNG được
 * DashboardWidgetGrid tự động mount (grid không có projectId để truyền). Component này dùng để nhúng vào
 * NGỮ CẢNH ĐÃ BIẾT project (vd ProjectDetailPage) — `projectId` là prop bắt buộc.
 *
 * Gate: PermissionGate(read:project) — MIRROR đúng BE DASH_WIDGET_GATE_PAIR.PROJECT_PROGRESS.
 */
import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
import { PermissionGate } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { projectProgressWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

interface ProjectProgressWidgetProps {
  /** BẮT BUỘC — BE 400 nếu thiếu (widgetDataQuerySchema.project_id chỉ optional ở schema chung). */
  projectId: string;
  dashboardType?: DashboardTypeValue;
}

function ProjectProgressWidgetInner({ projectId, dashboardType }: ProjectProgressWidgetProps) {
  const { t } = useTranslation("dashboard");
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.PROJECT_PROGRESS,
    { dashboardType, projectId },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? projectProgressWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  return (
    <WidgetCard
      title={t("projectProgress.title")}
      icon={TrendingUp}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={emptyMsg.success ? emptyMsg.data.message : t("projectProgress.empty.title")}
      errorTitle={data?.error_state?.message ?? t("widget.error.title")}
      errorDescription={t("widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {parsed?.success && (
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">
                {t("projectProgress.summary", {
                  done: parsed.data.summary.done,
                  total: parsed.data.summary.total,
                })}
              </span>
              <span className="font-semibold text-foreground">{parsed.data.summary.percent}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={parsed.data.summary.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${parsed.data.summary.percent}%` }}
              />
            </div>
          </div>
          <ul className="space-y-1">
            {Object.entries(parsed.data.byStatus).map(([taskStatus, count]) => (
              <li
                key={taskStatus}
                className="flex items-center justify-between text-xs text-muted-foreground"
              >
                <span>{taskStatus}</span>
                <span className="font-medium text-foreground">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

/** Gate ngoài (PermissionGate) — user thiếu read:project ⇒ KHÔNG render (KHÔNG fetch). */
export function ProjectProgressWidget(props: ProjectProgressWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.PROJECT_PROGRESS;
  return (
    <PermissionGate action={pair.action} resourceType={pair.resourceType}>
      <ProjectProgressWidgetInner {...props} />
    </PermissionGate>
  );
}
