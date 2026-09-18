/**
 * PayrollBudgetWidget — «Ngân sách lương năm» (SPEC-11 §10.1b PAYROLL-WIDGET-002, S15-PAYROLL-DASH-1).
 * widget_code=PAYROLL_BUDGET, slug=payroll-budget, module nguồn PAYROLL, mig 0576.
 *
 * Data: apps/api dashboard-widget-payroll.handlers.ts `fetchPayrollBudget()` → { fiscalYear,
 * plannedAmount, actualAmount, variance, usagePct } của NĂM HIỆN TẠI — TÁI DÙNG
 * `PayrollBudgetsService.yearTotals` (cùng câu SQL với khối ngân sách của Tổng quan `PAYROLL-API-078`
 * và hàng tổng báo cáo `budget-status`). FE KHÔNG trừ lại `planned − actual`: mọi phép tính tiền do SQL
 * làm (`clamp-must-be-sql-not-js`), nếu không widget và Tổng quan sẽ lệch nhau ở ca làm tròn.
 *
 * AI THẤY WIDGET: BE ép SÀN scope 'Company' (DASH_WIDGET_MIN_DATA_SCOPE — yearTotalsTx cộng toàn công
 * ty) ⇒ ai không có `view:payroll-budget@Company` KHÔNG nhận widget trong GET /dashboard/me ⇒ Grid
 * không mount ⇒ KHÔNG gọi API. Gate ở component chỉ kiểm được CẶP (capabilities không mang scope) nên
 * là gate PHỤ, KHÔNG phải cổng thật.
 *
 * ⚠️ `useCanExact`, KHÔNG <PermissionGate> — ('view','payroll-budget') là cặp NHẠY CẢM (mig 0571) và
 * `PermissionGate` gọi `useCan`, vốn cho wildcard '*:*' lọt trong khi BE KHÔNG cho wildcard kế thừa cặp
 * sensitive ⇒ dùng nhầm là hiện shell widget cho vai server chắc chắn 403 (khuôn PayrollCostWidget).
 *
 * ⚠️ TIỀN: `plannedAmount`/`variance` có thể `null` — nghĩa là **CHƯA LẬP kế hoạch**, KHÔNG phải 0 đồng.
 * Render qua `formatPayrollMoney` để ra `—`; tuyệt đối không `?? 0`.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { PiggyBank } from "lucide-react";
import { useCanExact } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { formatPayrollMoney, formatPayrollSignedMoney } from "@/routes/payroll/payroll-format";
import { payrollBudgetWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

/** Đích drill-down — cast `as "/"` như PayrollCostWidget (xem ghi chú ở đó). Cùng cặp gate với widget. */
const PAYROLL_BUDGETS_PATH = "/payroll/budgets" as "/";

interface PayrollBudgetWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function PayrollBudgetWidgetInner({ dashboardType }: PayrollBudgetWidgetProps) {
  const { t } = useTranslation(["dashboard"]);
  const navigate = useNavigate();
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.PAYROLL_BUDGET,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? payrollBudgetWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  // Thanh tiến độ chỉ vẽ khi CÓ kế hoạch; > 100% kẹp về 100 để thanh không tràn (con số thật vẫn in ở
  // nhãn bên cạnh — kẹp là chuyện TRÌNH BÀY, không phải chuyện số liệu).
  const usagePct = parsed?.success ? parsed.data.usagePct : null;
  const barPct = usagePct === null || usagePct === undefined ? null : Math.min(usagePct, 100);
  const overBudget = usagePct !== null && usagePct !== undefined && usagePct > 100;

  return (
    <WidgetCard
      title={t("dashboard:payrollBudget.title")}
      icon={PiggyBank}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={
        emptyMsg.success ? emptyMsg.data.message : t("dashboard:payrollBudget.empty.title")
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
          onClick={() => void navigate({ to: PAYROLL_BUDGETS_PATH })}
          className="w-full space-y-3 rounded-md p-1 text-left transition-colors hover:bg-muted/50"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t("dashboard:payrollBudget.fiscalYear", { year: parsed.data.fiscalYear })}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                overBudget ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
              }`}
            >
              {usagePct === null || usagePct === undefined
                ? t("dashboard:payrollBudget.usageUnknown")
                : overBudget
                  ? t("dashboard:payrollBudget.overBudget")
                  : t("dashboard:payrollBudget.usageLabel", { pct: usagePct })}
            </span>
          </div>

          <p className="tabular-nums text-2xl font-semibold text-foreground">
            {formatPayrollMoney(parsed.data.actualAmount)}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {t("dashboard:payrollBudget.actualLabel")}
            </span>
          </p>

          {barPct !== null && (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="presentation"
              data-testid="payroll-budget-bar"
            >
              <div
                className={`h-full rounded-full ${overBudget ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${barPct}%` }}
              />
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">{t("dashboard:payrollBudget.plannedLabel")}</dt>
              <dd className="tabular-nums font-medium text-foreground">
                {formatPayrollMoney(parsed.data.plannedAmount)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">
                {t("dashboard:payrollBudget.varianceLabel")}
              </dt>
              <dd
                className={`tabular-nums font-medium ${
                  overBudget ? "text-destructive" : "text-foreground"
                }`}
              >
                {formatPayrollSignedMoney(parsed.data.variance)}
              </dd>
            </div>
          </dl>
        </button>
      )}
    </WidgetCard>
  );
}

/**
 * Gate ngoài — thiếu `view:payroll-budget` ⇒ KHÔNG render (KHÔNG fetch). `useCanExact` chứ KHÔNG
 * <PermissionGate>: cặp NHẠY CẢM, wildcard không được lọt (xem doc-block đầu file). Gate PHỤ — cổng
 * THẬT (sàn scope 'Company') nằm ở BE.
 */
export function PayrollBudgetWidget(props: PayrollBudgetWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.PAYROLL_BUDGET;
  const allowed = useCanExact(pair.action, pair.resourceType);
  if (!allowed) return null;
  return <PayrollBudgetWidgetInner {...props} />;
}
