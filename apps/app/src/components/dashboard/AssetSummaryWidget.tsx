/**
 * AssetSummaryWidget — «Thống kê tài sản» theo trạng thái/loại (SPEC-13 §116 AS-10 · §244 ASSET-FUNC-014,
 * S11-OFFICE-DASH-1). widget_code=ASSET_SUMMARY, slug=asset-summary, module nguồn ASSET. Data: apps/api
 * dashboard-widget-office.handlers.ts fetchAssetSummary() → { summary: { total, maintenanceDueSoon },
 * byStatus, byCategory: [{categoryId, code, name, total, assigned}] } — TÁI DÙNG AssetsService.summary
 * (MỘT công thức, MỘT con số với GET /assets/summary), KHÔNG cộng lại số ở FE.
 *
 * Số hiển thị nằm trong data_scope của NGƯỜI XEM (Asset Manager/HR/Admin thấy toàn công ty, trưởng đơn vị
 * thấy phòng mình) — KHÔNG phải bug, đó là actor scope của AssetAccessService đi qua summary().
 *
 * AI THẤY WIDGET: BE ép SÀN scope 'Department' (DASH_WIDGET_MIN_DATA_SCOPE) ⇒ nhân viên thường
 * (view:asset@Own) KHÔNG nhận widget trong GET /dashboard/me ⇒ Grid không mount ⇒ KHÔNG gọi API
 * (SPEC-13 §482). PermissionGate dưới đây chỉ kiểm được CẶP (capabilities không mang scope) nên là gate
 * PHỤ — KHÔNG phải cổng thật.
 *
 * Drill-down: bấm 1 dòng loại → điều hướng `/assets` (danh sách tài sản).
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { PermissionGate } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { assetSummaryWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

/** Đích drill-down — cast `as "/"` như RoomTodayWidget/NOTI_PATHS (xem ghi chú ở đó). */
const ASSET_LIST_PATH = "/assets" as "/";

interface AssetSummaryWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function AssetSummaryWidgetInner({ dashboardType }: AssetSummaryWidgetProps) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.ASSET_SUMMARY,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? assetSummaryWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  return (
    <WidgetCard
      title={t("assetSummary.title")}
      icon={Package}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={emptyMsg.success ? emptyMsg.data.message : t("assetSummary.empty.title")}
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
            {parsed.data.summary.total}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {t("assetSummary.totalUnit")}
            </span>
          </p>
          {parsed.data.summary.maintenanceDueSoon > 0 && (
            <p className="text-xs font-medium text-warning">
              {t("assetSummary.maintenanceDueSoon", {
                count: parsed.data.summary.maintenanceDueSoon,
              })}
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(parsed.data.byStatus).map(([assetStatus, count]) => (
              <div
                key={assetStatus}
                className="flex items-center justify-between text-xs text-muted-foreground"
              >
                <span className="truncate">{assetStatus}</span>
                <span className="font-medium text-foreground">{count}</span>
              </div>
            ))}
          </div>
          {parsed.data.byCategory.length > 0 && (
            <ul className="space-y-1 border-t border-border pt-2">
              {parsed.data.byCategory.map((row) => (
                <li key={row.categoryId}>
                  <button
                    type="button"
                    onClick={() => void navigate({ to: ASSET_LIST_PATH })}
                    className="flex w-full items-center justify-between rounded-md p-1 text-left text-xs transition-colors hover:bg-muted/50"
                  >
                    <span className="truncate text-muted-foreground">{row.name}</span>
                    <span className="shrink-0 font-medium text-foreground">
                      {t("assetSummary.categoryCount", {
                        total: row.total,
                        assigned: row.assigned,
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

/** Gate ngoài (PermissionGate) — user thiếu view:asset ⇒ KHÔNG render (KHÔNG fetch). Gate PHỤ: cổng THẬT
 *  (sàn scope 'Department') nằm ở BE — xem doc-block đầu file. */
export function AssetSummaryWidget(props: AssetSummaryWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.ASSET_SUMMARY;
  return (
    <PermissionGate action={pair.action} resourceType={pair.resourceType}>
      <AssetSummaryWidgetInner {...props} />
    </PermissionGate>
  );
}
