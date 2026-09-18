/**
 * PayrollAdvancePendingWidget — «Tạm ứng chờ duyệt» (SPEC-11 §10.1b PAYROLL-WIDGET-003,
 * S15-PAYROLL-DASH-1). widget_code=PAYROLL_ADVANCE_PENDING, slug=payroll-advance-pending, mig 0576.
 *
 * Data: apps/api dashboard-widget-payroll.handlers.ts `fetchPayrollAdvancePending()` → `{ total }` —
 * ĐẾM tạm ứng `Pending` toàn công ty (`PayrollAdvancesService.countPending`, cùng cổng với
 * `PAYROLL-API-059`). KHÔNG tên người, KHÔNG số tiền: đếm là dữ liệu ít nhạy cảm nhất vẫn trả lời được
 * câu «có việc cần duyệt không» (SPEC-11 §10.1b). `total === 0` ⇒ BE trả `Empty` — widget vẫn hiện, với
 * chữ «không có tạm ứng chờ duyệt» (trạng thái ĐẸP, không phải lỗi).
 *
 * AI THẤY WIDGET: BE ép SÀN scope 'Company' (DASH_WIDGET_MIN_DATA_SCOPE — countTx đếm toàn công ty) ⇒
 * ai không có `view:payroll-advance@Company` KHÔNG nhận widget trong GET /dashboard/me ⇒ Grid không
 * mount ⇒ KHÔNG gọi API. Gate ở component chỉ kiểm được CẶP ⇒ gate PHỤ.
 *
 * ⚠️ `useCanExact`, KHÔNG <PermissionGate> — ('view','payroll-advance') là cặp NHẠY CẢM (mig 0571);
 * `PermissionGate` gọi `useCan` vốn cho wildcard '*:*' lọt, mà BE không cho wildcard kế thừa cặp
 * sensitive ⇒ dùng nhầm là hiện shell cho vai server chắc chắn 403 (khuôn PayrollCostWidget).
 *
 * Cặp gate là `view` chứ không phải `approve` (mig 0571 §4.7 đã ép approve ⇒ view): người chỉ được XEM
 * vẫn thấy con số, và nút drill-down dẫn tới danh sách tạm ứng — nơi quyền duyệt mới được kiểm lại.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { HandCoins } from "lucide-react";
import { useCanExact } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { payrollAdvancePendingWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

/** Đích drill-down — cast `as "/"` như PayrollCostWidget (xem ghi chú ở đó). */
const PAYROLL_ADVANCES_PATH = "/payroll/advances" as "/";

interface PayrollAdvancePendingWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function PayrollAdvancePendingWidgetInner({ dashboardType }: PayrollAdvancePendingWidgetProps) {
  const { t } = useTranslation(["dashboard"]);
  const navigate = useNavigate();
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.PAYROLL_ADVANCE_PENDING,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? payrollAdvancePendingWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  return (
    <WidgetCard
      title={t("dashboard:payrollAdvancePending.title")}
      icon={HandCoins}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={
        emptyMsg.success ? emptyMsg.data.message : t("dashboard:payrollAdvancePending.empty.title")
      }
      errorTitle={data?.error_state?.message ?? t("dashboard:widget.error.title")}
      errorDescription={t("dashboard:widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {parsed?.success && (
        <button
          type="button"
          onClick={() => void navigate({ to: PAYROLL_ADVANCES_PATH })}
          className="w-full space-y-1 rounded-md p-1 text-left transition-colors hover:bg-muted/50"
        >
          <p className="tabular-nums text-3xl font-semibold text-foreground">
            <span data-testid="payroll-advance-pending-total">{parsed.data.total}</span>
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {t("dashboard:payrollAdvancePending.countLabel", { count: parsed.data.total })}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {t("dashboard:payrollAdvancePending.cta")}
          </p>
        </button>
      )}
    </WidgetCard>
  );
}

/**
 * Gate ngoài — thiếu `view:payroll-advance` ⇒ KHÔNG render (KHÔNG fetch). `useCanExact` chứ KHÔNG
 * <PermissionGate> (xem doc-block đầu file). Gate PHỤ — cổng THẬT (sàn scope 'Company') ở BE.
 */
export function PayrollAdvancePendingWidget(props: PayrollAdvancePendingWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.PAYROLL_ADVANCE_PENDING;
  const allowed = useCanExact(pair.action, pair.resourceType);
  if (!allowed) return null;
  return <PayrollAdvancePendingWidgetInner {...props} />;
}
