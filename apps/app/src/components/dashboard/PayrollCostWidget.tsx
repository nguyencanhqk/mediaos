/**
 * PayrollCostWidget — «Chi phí lương kỳ» (SPEC-11 §10 PAYROLL-FUNC-014 · §10.1 PAYROLL-WIDGET-001 ·
 * PAY-DEC-010, S13-PAYROLL-DASH-1). widget_code=PAYROLL_COST, slug=payroll-cost, module nguồn PAYROLL.
 * Data: apps/api dashboard-widget-payroll.handlers.ts fetchPayrollCost() → { period: { payrollPeriodId,
 * periodMonth, status }, summary: { headcount, totalGross, totalNet } } — TÁI DÙNG
 * PayrollCalcService.summary (MỘT công thức, MỘT con số với GET /payroll-periods/summary,
 * PAYROLL-API-018), KHÔNG cộng lại tiền ở FE (`clamp-must-be-sql-not-js` — mọi tổng do SQL tính).
 *
 * AI THẤY WIDGET: BE ép SÀN scope 'Company' (DASH_WIDGET_MIN_DATA_SCOPE — latestSummaryTx SUM toàn
 * company) ⇒ ai không có view-line:payroll-period@Company KHÔNG nhận widget trong GET /dashboard/me ⇒
 * Grid không mount ⇒ KHÔNG gọi API (SPEC-11 §23 mục 13). Gate ở component chỉ kiểm được CẶP
 * (capabilities không mang scope) nên là gate PHỤ — KHÔNG phải cổng thật.
 *
 * ⚠️ GATE Ở ĐÂY DÙNG `useCanExact`, KHÔNG dùng <PermissionGate> — khác 3 widget wave trước (ASSET/
 * ROOM/RECRUIT). Lý do: `PermissionGate` gọi `useCan`, vốn chấp nhận wildcard '*:*'; mà
 * ('view-line','payroll-period') là cặp NHẠY CẢM (mig 0565) và wildcard KHÔNG kế thừa cặp sensitive ở
 * BE. Dùng `useCan` ở đây là hiện shell widget cho một vai mà server sẽ 403 — đúng cái bẫy
 * `capability-allowlist-hides-admin-screens` soi từ chiều ngược lại. Cả 13 cặp PAYROLL đã nằm trong
 * SENSITIVE_CAPABILITY_ALLOWLIST của BE nên `useCanExact` đọc được chúng từ /auth/me.
 *
 * ⚠️ TIỀN: `totalGross`/`totalNet` có thể về `null` (mask = VẮNG KHOÁ, SPEC-11 §18) — render qua
 * `formatPayrollMoney` để ra `—`, TUYỆT ĐỐI không `?? 0` (biến «không có quyền xem» thành «0 đồng»).
 *
 * Drill-down: bấm số → điều hướng `/payroll/periods` (danh sách kỳ lương; mirror AssetSummaryWidget →
 * `/assets`). KHÔNG deep-link thẳng vào `/payroll/periods/$periodId`: route chi tiết gate bằng CẶP KHÁC
 * (`view:payroll-period`, xem router.tsx) nên một người có `view-line` mà thiếu `view` sẽ rơi vào màn
 * 403 ngay sau cú bấm.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { useCanExact } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { formatPayrollMoney } from "@/routes/payroll/payroll-format";
import { payrollCostWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

/** Đích drill-down — cast `as "/"` như AssetSummaryWidget/RecruitFunnelWidget (xem ghi chú ở đó). */
const PAYROLL_PERIODS_PATH = "/payroll/periods" as "/";

interface PayrollCostWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function PayrollCostWidgetInner({ dashboardType }: PayrollCostWidgetProps) {
  const { t } = useTranslation(["dashboard", "payroll"]);
  const navigate = useNavigate();
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.PAYROLL_COST,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? payrollCostWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  return (
    <WidgetCard
      title={t("dashboard:payrollCost.title")}
      icon={Wallet}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={emptyMsg.success ? emptyMsg.data.message : t("dashboard:payrollCost.empty.title")}
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
          onClick={() => void navigate({ to: PAYROLL_PERIODS_PATH })}
          className="w-full space-y-3 rounded-md p-1 text-left transition-colors hover:bg-muted/50"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t("dashboard:payrollCost.periodMonth", { month: parsed.data.period.periodMonth })}
            </span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {t(`payroll:periodStatus.${parsed.data.period.status}`)}
            </span>
          </div>
          <p className="tabular-nums text-2xl font-semibold text-foreground">
            {formatPayrollMoney(parsed.data.summary.totalNet)}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {t("dashboard:payrollCost.netLabel")}
            </span>
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">{t("dashboard:payrollCost.grossLabel")}</dt>
              <dd className="tabular-nums font-medium text-foreground">
                {formatPayrollMoney(parsed.data.summary.totalGross)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">{t("dashboard:payrollCost.headcountLabel")}</dt>
              <dd className="tabular-nums font-medium text-foreground">
                {parsed.data.summary.headcount}
              </dd>
            </div>
          </dl>
        </button>
      )}
    </WidgetCard>
  );
}

/**
 * Gate ngoài — user thiếu `view-line:payroll-period` ⇒ KHÔNG render (KHÔNG fetch). `useCanExact` chứ
 * KHÔNG <PermissionGate>: cặp NHẠY CẢM, wildcard không được lọt (xem doc-block đầu file). Gate PHỤ —
 * cổng THẬT (sàn scope 'Company') nằm ở BE.
 */
export function PayrollCostWidget(props: PayrollCostWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.PAYROLL_COST;
  const allowed = useCanExact(pair.action, pair.resourceType);
  if (!allowed) return null;
  return <PayrollCostWidgetInner {...props} />;
}
