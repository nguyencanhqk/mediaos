import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { FileDown, RotateCcw } from "lucide-react";
import type {
  PayrollReportCatalogItemDto,
  PayrollReportCode,
  PayrollReportColumn,
} from "@mediaos/contracts";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import {
  Button,
  DataTable,
  DataToolbar,
  DetailPageHeader,
  EmptyState,
  TableFooter,
} from "@mediaos/ui";
import { triggerBlobDownload } from "@/lib/download-blob";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "./constants";
import { PAYROLL_NUMERIC_CELL_CLASS } from "./payroll-format";
import { parsePayrollError, payrollErrorText } from "./payroll-errors";
import { usePayrollPeople } from "./use-payroll-people";
import {
  REPORT_ENUM_COLUMNS,
  buildReportQuery,
  defaultReportFilters,
  formatReportCell,
  isNumericColumn,
  isPayrollReportCode,
  missingRequiredParams,
  reportColumnLabelKeys,
  reportParams,
  type ReportFilters,
} from "./report-view";
import { ReportFiltersBar } from "./components/reports/ReportFilters";

type Cell = string | number | null;
type ReportRow =
  | { readonly kind: "row"; readonly values: Readonly<Record<string, Cell>> }
  | { readonly kind: "total"; readonly values: Readonly<Record<string, number>> };

/**
 * PAY-SCREEN-016 — màn XEM một báo cáo (`/payroll/reports/$reportCode`, S15-PAYROLL-FE-4).
 *
 * - Mã lạ (URL gõ tay) hoặc báo cáo không có trong 080 của caller (thiếu cặp nguồn — owner O-2) ⇒ «không tìm
 *   thấy», KHÔNG gọi 081.
 * - 081 audit MỖI LƯỢT ⇒ chỉ gọi khi đủ tham số bắt buộc; bộ lọc dở dang không sinh hàng audit.
 * - Hàng tổng = `totals` của server (SUM trên CẢ bộ lọc, không phải trang); chỉ cột server trả trong `totals`.
 * - Xuất XLSX (082) chỉ khi mục 080 có `exportable` (caller giữ thêm `export:payroll`).
 */
export function PayrollReportViewPage({
  reportCode,
  onBack,
}: {
  reportCode: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("payroll");
  const P = PAYROLL_ENGINE_PAIRS;
  const canView = useCanExact(P.reportData.action, P.reportData.resourceType);
  const validCode = isPayrollReportCode(reportCode);

  const catalogQuery = useQuery({
    queryKey: payrollKeys.reports.catalog(),
    queryFn: () => payrollApi.listReports(),
    enabled: canView && validCode,
  });
  const item = validCode ? catalogQuery.data?.find((i) => i.code === reportCode) : undefined;

  const header = (
    <DetailPageHeader
      onBack={onBack}
      title={validCode ? t(`reports.names.${reportCode}`) : t("reports.title")}
      subtitle={validCode ? t(`reports.descriptions.${reportCode}`) : undefined}
    />
  );

  if (!canView || !validCode) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title={t("reports.view.notFound")} />
      </div>
    );
  }
  if (catalogQuery.isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="text-sm text-muted-foreground">{t("states.loading")}</div>
      </div>
    );
  }
  if (catalogQuery.isError) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void catalogQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  if (!item) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title={t("reports.view.notFound")} />
      </div>
    );
  }
  return <ReportViewBody key={item.code} item={item} onBack={onBack} />;
}

function ReportViewBody({
  item,
  onBack,
}: {
  item: PayrollReportCatalogItemDto;
  onBack: () => void;
}) {
  const { t } = useTranslation("payroll");
  const people = usePayrollPeople();
  const [filters, setFilters] = useState<ReportFilters>(() => defaultReportFilters(new Date()));
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState<string | null>(null);

  const params = useMemo(() => reportParams(item), [item]);
  const missing = missingRequiredParams(item, filters);
  const filterQuery = useMemo(() => buildReportQuery(item, filters), [item, filters]);
  const pageQuery = useMemo(
    () => ({ ...filterQuery, page, per_page: PAYROLL_PAGE_SIZE }),
    [filterQuery, page],
  );

  const dataQuery = useQuery({
    queryKey: payrollKeys.reports.data(item.code, pageQuery),
    queryFn: () => payrollApi.getReport(item.code, pageQuery),
    enabled: missing.length === 0,
  });

  const exportMutation = useMutation({
    mutationFn: () => payrollApi.exportReport(item.code, filterQuery),
    onMutate: () => setExportError(null),
    onSuccess: (res) => triggerBlobDownload(res.blob, res.filename ?? `${item.code}.xlsx`),
    onError: (error) => setExportError(payrollErrorText(t, parsePayrollError(error))),
  });

  const changeFilters = (next: ReportFilters) => {
    setFilters(next);
    setPage(1);
  };

  const report = dataQuery.data?.data;
  const columns = useMemo(
    () => buildColumns(t, item.code, report?.columns ?? item.columns),
    [t, item.code, report?.columns, item.columns],
  );
  const rows = useMemo<ReportRow[]>(() => {
    if (!report || report.rows.length === 0) return [];
    const body: ReportRow[] = report.rows.map((values) => ({ kind: "row", values }));
    return Object.keys(report.totals).length > 0
      ? [...body, { kind: "total", values: report.totals }]
      : body;
  }, [report]);

  const missingText = missing.map((p) => t(`reports.params.${p}`)).join(", ");

  return (
    <div className="space-y-6">
      <DetailPageHeader
        onBack={onBack}
        title={t(`reports.names.${item.code}`)}
        subtitle={t(`reports.descriptions.${item.code}`)}
        actions={
          item.exportable ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportMutation.mutate()}
              disabled={missing.length > 0 || exportMutation.isPending}
            >
              <FileDown className="mr-2 size-4" aria-hidden />
              {exportMutation.isPending ? t("reports.view.exporting") : t("reports.view.export")}
            </Button>
          ) : undefined
        }
      />

      <DataToolbar
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => changeFilters(defaultReportFilters(new Date()))}
          >
            <RotateCcw className="mr-2 size-4" aria-hidden />
            {t("reports.view.reset")}
          </Button>
        }
      >
        <ReportFiltersBar
          params={params}
          required={item.requiredParams}
          filters={filters}
          people={people}
          onChange={changeFilters}
        />
      </DataToolbar>

      {exportError && (
        <p role="alert" className="text-sm text-danger">
          {exportError}
        </p>
      )}

      {missing.length > 0 ? (
        <EmptyState title={t("reports.view.missingParams", { params: missingText })} />
      ) : dataQuery.isError ? (
        <EmptyState
          title={payrollErrorText(t, parsePayrollError(dataQuery.error))}
          action={
            <Button variant="outline" onClick={() => void dataQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={dataQuery.isLoading}
          pageSize={PAYROLL_PAGE_SIZE + 1}
          pinFirstColumn
          emptyState={<EmptyState title={t("reports.view.empty")} />}
          footer={
            <TableFooter
              page={page}
              pageSize={PAYROLL_PAGE_SIZE}
              total={dataQuery.data?.pagination?.total}
              disabled={dataQuery.isFetching}
              onPageChange={setPage}
            />
          }
        />
      )}
    </div>
  );
}

type Translate = (key: string, opts?: Record<string, unknown>) => string;

function buildColumns(
  t: Translate,
  code: PayrollReportCode,
  cols: readonly PayrollReportColumn[],
): ColumnDef<ReportRow>[] {
  return cols.map((col, index) => {
    const [overrideKey, genericKey] = reportColumnLabelKeys(code, col.key);
    const header = t(overrideKey, { defaultValue: t(genericKey, { defaultValue: col.key }) });
    const enumPrefix = REPORT_ENUM_COLUMNS[col.key];
    const translateEnum = enumPrefix
      ? (v: string) => t(`${enumPrefix}.${v}`, { defaultValue: v })
      : undefined;
    const numeric = isNumericColumn(col.type);
    return {
      id: col.key,
      header,
      cell: ({ row }) => {
        const r = row.original;
        if (r.kind === "total") {
          if (index === 0) return <span className="font-semibold">{t("reports.view.total")}</span>;
          const v = r.values[col.key];
          if (v === undefined) return null;
          return (
            <span className={`${PAYROLL_NUMERIC_CELL_CLASS} font-semibold`}>
              {formatReportCell(col.type, v)}
            </span>
          );
        }
        const text = formatReportCell(col.type, r.values[col.key], translateEnum);
        return numeric ? <span className={PAYROLL_NUMERIC_CELL_CLASS}>{text}</span> : text;
      },
    };
  });
}
