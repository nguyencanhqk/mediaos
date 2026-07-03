/**
 * LeaveReportsPage — /leave/reports (S3-FE-LEAVE-6, LEAVE-SCREEN-013, CO-S4-006).
 *
 * Bảng tổng hợp nghỉ ĐÃ duyệt per-employee theo kỳ [fromDate, toDate] INCLUSIVE (mặc định tháng hiện
 * tại). Cổng = cặp engine THẬT export:leave (mig 0455, Company-scope — CHỈ hr/company-admin; manager
 * KHÔNG có grant ⇒ KHÔNG dựng biến thể team/manager). Sensitive pair ⇒ useCanExact (KHÔNG wildcard
 * fallback) — mirror AttendanceReportsPage; enforcement thật vẫn ở server (403/404). company_id do
 * server resolve — client KHÔNG truyền.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { BarChart3, RefreshCw } from "lucide-react";
import type { LeaveReportRow } from "@mediaos/contracts";
import { useCanExact } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input } from "@mediaos/ui";
import { useLeaveReport } from "../hooks/useLeaveReports";
import {
  LEAVE_ENGINE_PAIRS,
  LEAVE_REPORT_PAGE_SIZE,
  monthToInclusiveRange,
  currentMonth,
} from "../constants";

function useColumns(
  t: ReturnType<typeof useTranslation<"leave">>["t"],
): ColumnDef<LeaveReportRow>[] {
  return [
    {
      accessorKey: "employeeCode",
      header: t("reports.columns.employeeCode"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.employeeCode ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "fullName",
      header: t("reports.columns.employee"),
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.fullName ?? "—"}</span>
      ),
    },
    {
      accessorKey: "orgUnitName",
      header: t("reports.columns.department"),
      cell: ({ row }) => <span className="text-sm">{row.original.orgUnitName ?? "—"}</span>,
    },
    {
      accessorKey: "totalRequests",
      header: t("reports.columns.totalRequests"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.totalRequests}</span>,
    },
    {
      accessorKey: "totalLeaveDays",
      header: t("reports.columns.totalLeaveDays"),
      cell: ({ row }) => (
        <span className="text-sm font-medium tabular-nums text-foreground">
          {row.original.totalLeaveDays}
        </span>
      ),
    },
  ];
}

export function LeaveReportsPage() {
  const { t } = useTranslation("leave");
  const { t: tc } = useTranslation("common");

  const canExport = useCanExact(
    LEAVE_ENGINE_PAIRS.EXPORT_LEAVE.action,
    LEAVE_ENGINE_PAIRS.EXPORT_LEAVE.resourceType,
  );

  const defaultRange = monthToInclusiveRange(currentMonth());
  const [fromDate, setFromDate] = useState(defaultRange.fromDate);
  const [toDate, setToDate] = useState(defaultRange.toDate);
  const [page, setPage] = useState(1);

  const query = { fromDate, toDate, page, pageSize: LEAVE_REPORT_PAGE_SIZE };
  const reportQuery = useLeaveReport(query, canExport);
  const columns = useColumns(t);

  if (!canExport) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("reports.forbidden.title")}
          description={t("reports.forbidden.description")}
        />
      </div>
    );
  }

  if (reportQuery.isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("reports.title")}
          description={t("reports.description")}
          icon={BarChart3}
        />
        <div className="mt-8">
          <EmptyState
            title={t("reports.error.title")}
            description={t("reports.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void reportQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const items = reportQuery.data?.items ?? [];
  const meta = reportQuery.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("reports.title")}
        description={t("reports.description")}
        icon={BarChart3}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            aria-label={t("reports.filters.fromDate")}
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            aria-label={t("reports.filters.toDate")}
          />
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={reportQuery.isLoading}
        emptyState={
          <EmptyState
            title={t("reports.empty.title")}
            description={t("reports.empty.description")}
          />
        }
        pageSize={LEAVE_REPORT_PAGE_SIZE}
      />

      {!reportQuery.isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
          <span>
            {page} / {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {tc("pagination.prev")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              {tc("pagination.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
