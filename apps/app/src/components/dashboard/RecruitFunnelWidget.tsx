/**
 * RecruitFunnelWidget — «Phễu tuyển dụng» (SPEC-12 §5.1 RC-10 · §10 RECRUIT-FUNC-013 · RECRUIT-WIDGET-001,
 * S12-RECRUIT-DASH-1). widget_code=RECRUIT_FUNNEL, slug=recruit-funnel, module nguồn RECRUIT. Data: apps/api
 * dashboard-widget-recruit.handlers.ts fetchRecruitFunnel() → { byStage, summary: { totalCandidates,
 * openJobOpenings } } — TÁI DÙNG CandidatesService.summary (MỘT công thức, MỘT con số với
 * GET /candidates/summary), KHÔNG cộng lại số ở FE.
 *
 * `byStage` từ BE chỉ chứa stage CÓ hồ sơ — zero-fill 6 cột cố định theo RECRUIT_STAGE_COLUMNS ở đây
 * (phễu phải hiện đủ 6 bậc kể cả bậc rỗng); nhãn tra `recruit:stage.*` (khoá enum = giá trị server).
 *
 * AI THẤY WIDGET: BE ép SÀN scope 'Company' (DASH_WIDGET_MIN_DATA_SCOPE — summaryTx đếm TOÀN company) ⇒
 * ai không có view:candidate@Company KHÔNG nhận widget trong GET /dashboard/me ⇒ Grid không mount ⇒ KHÔNG
 * gọi API (SPEC-12 §20.11). PermissionGate dưới đây chỉ kiểm được CẶP (capabilities không mang scope) nên
 * là gate PHỤ — KHÔNG phải cổng thật.
 *
 * Drill-down: bấm 1 bậc phễu → điều hướng `/recruit/pipeline` (kanban ứng viên).
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Filter } from "lucide-react";
import { PermissionGate } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { RECRUIT_STAGE_COLUMNS } from "@/routes/recruit/constants";
import { recruitFunnelWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

/** Đích drill-down — cast `as "/"` như AssetSummaryWidget/RoomTodayWidget (xem ghi chú ở đó). */
const RECRUIT_PIPELINE_PATH = "/recruit/pipeline" as "/";

interface RecruitFunnelWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function RecruitFunnelWidgetInner({ dashboardType }: RecruitFunnelWidgetProps) {
  const { t } = useTranslation(["dashboard", "recruit"]);
  const navigate = useNavigate();
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.RECRUIT_FUNNEL,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? recruitFunnelWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  const byStage = parsed?.success ? parsed.data.byStage : {};
  const maxCount = Math.max(1, ...RECRUIT_STAGE_COLUMNS.map((s) => byStage[s] ?? 0));

  return (
    <WidgetCard
      title={t("dashboard:recruitFunnel.title")}
      icon={Filter}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={
        emptyMsg.success ? emptyMsg.data.message : t("dashboard:recruitFunnel.empty.title")
      }
      errorTitle={data?.error_state?.message ?? t("dashboard:widget.error.title")}
      errorDescription={t("dashboard:widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {parsed?.success && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="text-2xl font-semibold text-foreground">
              {parsed.data.summary.totalCandidates}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {t("dashboard:recruitFunnel.totalUnit")}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {t("dashboard:recruitFunnel.openJobOpenings", {
                count: parsed.data.summary.openJobOpenings,
              })}
            </p>
          </div>
          <ul className="space-y-1">
            {RECRUIT_STAGE_COLUMNS.map((stage) => {
              const count = byStage[stage] ?? 0;
              return (
                <li key={stage}>
                  <button
                    type="button"
                    onClick={() => void navigate({ to: RECRUIT_PIPELINE_PATH })}
                    className="flex w-full items-center gap-2 rounded-md p-1 text-left text-xs transition-colors hover:bg-muted/50"
                  >
                    <span className="w-20 shrink-0 truncate text-muted-foreground">
                      {t(`recruit:stage.${stage}`)}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary/70"
                        style={{ width: `${Math.round((count / maxCount) * 100)}%` }}
                      />
                    </span>
                    <span className="w-6 shrink-0 text-right font-medium text-foreground">
                      {count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

/** Gate ngoài (PermissionGate) — user thiếu view:candidate ⇒ KHÔNG render (KHÔNG fetch). Gate PHỤ: cổng
 *  THẬT (sàn scope 'Company') nằm ở BE — xem doc-block đầu file. */
export function RecruitFunnelWidget(props: RecruitFunnelWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.RECRUIT_FUNNEL;
  return (
    <PermissionGate action={pair.action} resourceType={pair.resourceType}>
      <RecruitFunnelWidgetInner {...props} />
    </PermissionGate>
  );
}
