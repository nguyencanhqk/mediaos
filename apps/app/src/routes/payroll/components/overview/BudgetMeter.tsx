import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, OctagonAlert } from "lucide-react";
import type { PayrollOverviewDto } from "@mediaos/contracts";
import { CHART_COLORS } from "@/components/charts/chart-theme";
import { formatPayrollMoney } from "../../payroll-format";
import { budgetLevel, meterFillPct, type BudgetLevel } from "../../overview-data";

type Budget = NonNullable<PayrollOverviewDto["budget"]>;

const FILL: Record<Exclude<BudgetLevel, "unplanned">, string> = {
  normal: CHART_COLORS.series1,
  warning: CHART_COLORS.warning,
  over: CHART_COLORS.danger,
};
const ICON = { normal: CheckCircle2, warning: AlertTriangle, over: OctagonAlert } as const;

/**
 * Khối 3 — «ngân sách gauge» vẽ bằng METER ngang (dataviz: một tỉ lệ so với một giới hạn ⇒ meter, không phải
 * biểu đồ tròn). Mức độ đi kèm BIỂU TƯỢNG + CHỮ, màu trạng thái không bao giờ đứng một mình.
 * `plannedAmount = null` (chưa lập kế hoạch) ⇒ không vẽ meter 0 % giả, chỉ nói chưa lập.
 */
export function BudgetMeter({ budget }: { budget: Budget }) {
  const { t } = useTranslation("payroll");
  const level = budgetLevel(budget.usagePct);

  return (
    <div className="flex h-full flex-col justify-center gap-4">
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t("overview.budget.actual")}</dt>
          <dd className="text-2xl font-semibold text-foreground">
            {formatPayrollMoney(budget.actualAmount)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("overview.budget.planned")}</dt>
          <dd className="text-2xl font-semibold text-foreground">
            {formatPayrollMoney(budget.plannedAmount)}
          </dd>
        </div>
      </dl>

      {level === "unplanned" ? (
        <p className="text-sm text-muted-foreground">{t("overview.budget.unplanned")}</p>
      ) : (
        <BudgetLevelBar level={level} usagePct={budget.usagePct ?? 0} />
      )}
    </div>
  );
}

function BudgetLevelBar({
  level,
  usagePct,
}: {
  level: Exclude<BudgetLevel, "unplanned">;
  usagePct: number;
}) {
  const { t } = useTranslation("payroll");
  const Icon = ICON[level];
  const pctText = `${usagePct.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} %`;
  return (
    <div className="space-y-2">
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meterFillPct(usagePct)}
        aria-valuetext={`${t("overview.budget.usage", { pct: pctText })} — ${t(`overview.budget.level.${level}`)}`}
        className="h-3 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: CHART_COLORS.meterTrack }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${meterFillPct(usagePct)}%`, backgroundColor: FILL[level] }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">
          {t("overview.budget.usage", { pct: pctText })}
        </span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Icon className="size-4" aria-hidden style={{ color: FILL[level] }} />
          {t(`overview.budget.level.${level}`)}
        </span>
      </div>
    </div>
  );
}
