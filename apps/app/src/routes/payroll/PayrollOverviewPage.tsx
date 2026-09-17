import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import {
  PAYROLL_OVERVIEW_DEFAULT_MONTHS,
  type PayrollInsuranceIssue,
  type PayrollOverviewDto,
} from "@mediaos/contracts";
import { payrollApi, payrollKeys, useCan, useCanExact } from "@mediaos/web-core";
import { Button, DataToolbar, EmptyState, PageHeader, Select } from "@mediaos/ui";
import { ChartCard, type ChartCardState } from "@/components/charts/ChartCard";
import { PAYROLL_ENGINE_PAIRS } from "./constants";
import { formatPayrollMoney } from "./payroll-format";
import {
  hasAnyHeadcount,
  salaryBandLabel,
  toOrgUnitRows,
  toStructureRows,
  toTrendPoints,
} from "./overview-data";
import { formatPeriodMonth } from "./report-view";
import {
  AverageIncomeChart,
  CostTrendChart,
  IncomeStructureChart,
  OrgUnitIncomeChart,
  SalaryDistributionChart,
  orgUnitChartHeight,
} from "./components/overview/OverviewCharts";
import { BudgetMeter } from "./components/overview/BudgetMeter";
import { RemindersPanel } from "./components/overview/RemindersPanel";

const MONTH_OPTIONS = [6, PAYROLL_OVERVIEW_DEFAULT_MONTHS, 24] as const;
const FISCAL_YEAR_SPAN = 3;

const pct = (v: number) => `${v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} %`;

export interface PayrollOverviewPageProps {
  onOpenPeriod: (periodId: string) => void;
  onOpenEmployees: (issue: PayrollInsuranceIssue) => void;
}

/**
 * PAY-SCREEN-015 «Tổng quan» (`/payroll`, S15-PAYROLL-FE-4) — 6 khối biểu đồ (078) + Lời nhắc (079).
 *
 * Cổng: `('view','payroll-report')` + sàn Company ở SERVER (DECISIONS-14 §6 (3) — thư viện vẽ không phải
 * cổng). FE gác bằng `useCanExact` (cặp SENSITIVE): thiếu cặp ⇒ KHÔNG gọi 078/079 (cả hai audit mỗi lượt).
 * Router đã chuyển hướng người thiếu cặp đi nơi khác (`payroll-root-redirect.ts`); nhánh «không quyền» ở đây
 * chỉ là lưới an toàn khi quyền đổi giữa phiên.
 *
 * 078 trả CẢ 6 khối trong một lượt ⇒ một query; mỗi khối tự quyết rỗng/đủ, lỗi dùng chung. Khối ngân sách
 * VẮNG khoá khi thiếu `view:payroll-budget` ⇒ nói «không có quyền», không vẽ 0.
 */
export function PayrollOverviewPage({ onOpenPeriod, onOpenEmployees }: PayrollOverviewPageProps) {
  const { t } = useTranslation("payroll");
  const P = PAYROLL_ENGINE_PAIRS;
  const canView = useCanExact(P.overview.action, P.overview.resourceType);
  const canOpenPeriods = useCan(P.periodList.action, P.periodList.resourceType);
  const canOpenEmployees = useCanExact(P.employeeList.action, P.employeeList.resourceType);

  const currentYear = new Date().getFullYear();
  const [months, setMonths] = useState<number>(PAYROLL_OVERVIEW_DEFAULT_MONTHS);
  const [fiscalYear, setFiscalYear] = useState<number>(currentYear);
  const params = useMemo(() => ({ months, fiscalYear }), [months, fiscalYear]);

  const overviewQuery = useQuery({
    queryKey: payrollKeys.overview.blocks(params),
    queryFn: () => payrollApi.getOverview(params),
    enabled: canView,
    placeholderData: (prev) => prev,
  });
  const remindersQuery = useQuery({
    queryKey: payrollKeys.overview.reminders(),
    queryFn: () => payrollApi.getOverviewReminders(),
    enabled: canView,
  });

  if (!canView) return <EmptyState title={t("overview.noPermission")} />;

  const data = overviewQuery.data;
  const refetchAll = () => {
    void overviewQuery.refetch();
    void remindersQuery.refetch();
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("overview.title")} description={t("overview.description")} />

      <DataToolbar
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={refetchAll}
            disabled={overviewQuery.isFetching || remindersQuery.isFetching}
          >
            <RefreshCw className="mr-2 size-4" aria-hidden />
            {t("overview.refresh")}
          </Button>
        }
      >
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("overview.months")}</span>
          <Select
            aria-label={t("overview.months")}
            value={String(months)}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="w-44"
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {t("overview.monthsOption", { count: m })}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("overview.fiscalYear")}</span>
          <Select
            aria-label={t("overview.fiscalYear")}
            value={String(fiscalYear)}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            className="w-28"
          >
            {Array.from({ length: FISCAL_YEAR_SPAN }, (_, i) => currentYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </label>
      </DataToolbar>

      {data && data.latestPeriod === null && (
        <div
          role="status"
          className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm"
        >
          {t("overview.noPublished")}
        </div>
      )}
      {data?.latestPeriod && (
        <p className="text-sm text-muted-foreground">
          {t("overview.anchor", { month: formatPeriodMonth(data.latestPeriod.periodMonth) })}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <OverviewBlocks
            data={data}
            isLoading={overviewQuery.isLoading}
            isError={overviewQuery.isError && !data}
            refreshing={overviewQuery.isFetching && !overviewQuery.isLoading}
            onRetry={() => void overviewQuery.refetch()}
            fiscalYear={fiscalYear}
          />
        </div>
        <RemindersPanel
          data={remindersQuery.data}
          state={remindersQuery.isLoading ? "loading" : remindersQuery.isError ? "error" : "ready"}
          onRetry={() => void remindersQuery.refetch()}
          onOpenPeriod={canOpenPeriods ? onOpenPeriod : undefined}
          onOpenEmployees={canOpenEmployees ? onOpenEmployees : undefined}
        />
      </div>
    </div>
  );
}

function OverviewBlocks({
  data,
  isLoading,
  isError,
  refreshing,
  onRetry,
  fiscalYear,
}: {
  data: PayrollOverviewDto | undefined;
  isLoading: boolean;
  isError: boolean;
  refreshing: boolean;
  onRetry: () => void;
  fiscalYear: number;
}) {
  const { t } = useTranslation("payroll");
  const month = data?.latestPeriod ? formatPeriodMonth(data.latestPeriod.periodMonth) : "—";

  const stateOf = (hasData: boolean): ChartCardState =>
    isLoading ? "loading" : isError || !data ? "error" : hasData ? "ready" : "empty";

  const distribution = (data?.salaryDistribution ?? []).map((r) => ({
    label: salaryBandLabel(r.bandFrom, r.bandTo),
    headcount: r.headcount,
  }));
  const structure = toStructureRows(data?.incomeStructure ?? []);
  const trend = toTrendPoints(data?.byPeriod ?? []);
  const orgUnits = toOrgUnitRows(data?.byOrgUnit ?? [], t("overview.orgUnit.unassigned"));
  const otherLabel = t("overview.structure.other");

  const common = { onRetry, refreshing, emptyText: t("overview.empty") };
  const budgetState: ChartCardState = isLoading
    ? "loading"
    : isError || !data
      ? "error"
      : data.budget
        ? "ready"
        : "denied";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        {...common}
        testId="overview-distribution"
        title={t("overview.distribution.title")}
        description={t("overview.distribution.description", { month })}
        state={stateOf(hasAnyHeadcount(distribution))}
        table={{
          columns: [t("overview.distribution.band"), t("overview.distribution.headcount")],
          rows: distribution.map((r) => [r.label, String(r.headcount)]),
        }}
      >
        <SalaryDistributionChart rows={distribution} />
      </ChartCard>

      <ChartCard
        {...common}
        testId="overview-structure"
        title={t("overview.structure.title")}
        description={t("overview.structure.description", { month })}
        state={stateOf(structure.length > 0)}
        table={{
          columns: [
            t("overview.structure.item"),
            t("overview.structure.amount"),
            t("overview.structure.share"),
          ],
          rows: structure.map((r) => [
            r.isOther ? otherLabel : r.label,
            formatPayrollMoney(r.amount),
            pct(r.sharePct),
          ]),
        }}
      >
        <IncomeStructureChart rows={structure} otherLabel={otherLabel} />
      </ChartCard>

      <ChartCard
        {...common}
        testId="overview-budget"
        title={t("overview.budget.title", { year: data?.budget?.fiscalYear ?? fiscalYear })}
        description={t("overview.budget.description")}
        state={budgetState}
        deniedText={t("overview.budget.noPermission")}
      >
        {data?.budget && <BudgetMeter budget={data.budget} />}
      </ChartCard>

      <ChartCard
        {...common}
        testId="overview-cost"
        title={t("overview.cost.title")}
        description={t("overview.cost.description")}
        state={stateOf(trend.length > 0)}
        table={{
          columns: [
            t("overview.cost.period"),
            t("overview.cost.totalCost"),
            t("overview.cost.gross"),
            t("overview.cost.employer"),
          ],
          rows: trend.map((p) => [
            p.label,
            formatPayrollMoney(p.totalCost),
            formatPayrollMoney(p.totalGross),
            formatPayrollMoney(p.employerStatutory),
          ]),
        }}
      >
        <CostTrendChart points={trend} />
      </ChartCard>

      <ChartCard
        {...common}
        testId="overview-average"
        title={t("overview.average.title")}
        description={t("overview.average.description")}
        state={stateOf(trend.length > 0)}
        table={{
          columns: [
            t("overview.average.period"),
            t("overview.average.avgGross"),
            t("overview.average.avgNet"),
          ],
          rows: trend.map((p) => [
            p.label,
            formatPayrollMoney(p.avgGross),
            formatPayrollMoney(p.avgNet),
          ]),
        }}
      >
        <AverageIncomeChart points={trend} />
      </ChartCard>

      <ChartCard
        {...common}
        testId="overview-org-unit"
        title={t("overview.orgUnit.title")}
        description={t("overview.orgUnit.description", { month })}
        state={stateOf(orgUnits.length > 0)}
        height={orgUnitChartHeight(orgUnits.length)}
        table={{
          columns: [
            t("overview.orgUnit.unit"),
            t("overview.orgUnit.avgGross"),
            t("overview.orgUnit.minGross"),
            t("overview.orgUnit.maxGross"),
            t("overview.orgUnit.headcount"),
          ],
          rows: orgUnits.map((r) => [
            r.label,
            formatPayrollMoney(r.avgGross),
            formatPayrollMoney(r.minGross),
            formatPayrollMoney(r.maxGross),
            String(r.headcount),
          ]),
        }}
      >
        <OrgUnitIncomeChart rows={orgUnits} />
      </ChartCard>
    </div>
  );
}
