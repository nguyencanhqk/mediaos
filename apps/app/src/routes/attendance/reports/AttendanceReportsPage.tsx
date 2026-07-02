/**
 * AttendanceReportsPage — /attendance/reports (S3-FE-ATT-6, ATT-SCREEN-018, CO-S4-006).
 * Bảng tổng hợp công theo scope Team/Company (mỗi scope-level là 1 cặp RIÊNG — pair-as-gate, KHÔNG
 * suy quyền từ scope khác). Filter khoảng thời gian [fromDate, toDate) — mặc định tháng hiện tại.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { BarChart3, RefreshCw } from "lucide-react";
import type { AttendanceReportRow } from "@mediaos/contracts";
import { useCanExact } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input } from "@mediaos/ui";
import { useTeamAttendanceReport, useCompanyAttendanceReport } from "../hooks/useAttendanceReports";
import {
  ATT_ENGINE_PAIRS,
  ATT_RECORDS_PAGE_SIZE,
  monthToDateRange,
  currentMonth,
} from "../constants";

type Scope = "team" | "company";

function useColumns(
  t: ReturnType<typeof useTranslation<"attendance">>["t"],
): ColumnDef<AttendanceReportRow>[] {
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
      accessorKey: "totalDays",
      header: t("reports.columns.totalDays"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.totalDays}</span>,
    },
    {
      accessorKey: "presentDays",
      header: t("reports.columns.presentDays"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.presentDays}</span>,
    },
    {
      accessorKey: "lateDays",
      header: t("reports.columns.lateDays"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.lateDays}</span>,
    },
    {
      accessorKey: "missingDays",
      header: t("reports.columns.missingDays"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.missingDays}</span>,
    },
    {
      accessorKey: "leaveDays",
      header: t("reports.columns.leaveDays"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.leaveDays}</span>,
    },
  ];
}

export function AttendanceReportsPage() {
  const { t } = useTranslation("attendance");
  const { t: tc } = useTranslation("common");

  const canViewTeam = useCanExact(
    ATT_ENGINE_PAIRS.VIEW_TEAM.action,
    ATT_ENGINE_PAIRS.VIEW_TEAM.resourceType,
  );
  const canViewCompany = useCanExact(
    ATT_ENGINE_PAIRS.VIEW_COMPANY.action,
    ATT_ENGINE_PAIRS.VIEW_COMPANY.resourceType,
  );
  const defaultScope: Scope | null = canViewCompany ? "company" : canViewTeam ? "team" : null;
  const [scope, setScope] = useState<Scope | null>(defaultScope);

  const defaultRange = monthToDateRange(currentMonth());
  const [fromDate, setFromDate] = useState(defaultRange.fromDate);
  const [toDate, setToDate] = useState(defaultRange.toDate);
  const [page, setPage] = useState(1);

  const queryParams = { fromDate, toDate, page, pageSize: ATT_RECORDS_PAGE_SIZE };
  const teamQuery = useTeamAttendanceReport(queryParams, scope === "team");
  const companyQuery = useCompanyAttendanceReport(queryParams, scope === "company");
  const activeQuery = scope === "team" ? teamQuery : companyQuery;
  const columns = useColumns(t);

  if (!scope) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("reports.forbidden.title")}
          description={t("reports.forbidden.description")}
        />
      </div>
    );
  }

  if (activeQuery.isError) {
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
              <Button variant="outline" size="sm" onClick={() => void activeQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const items = activeQuery.data?.items ?? [];
  const meta = activeQuery.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("reports.title")}
        description={t("reports.description")}
        icon={BarChart3}
      >
        <div className="flex flex-wrap items-center gap-3">
          {canViewTeam && canViewCompany && (
            <div className="flex gap-1 rounded-md border border-border p-0.5">
              <ScopeTabButton active={scope === "team"} onClick={() => setScope("team")}>
                {t("reports.scopeTabs.team")}
              </ScopeTabButton>
              <ScopeTabButton active={scope === "company"} onClick={() => setScope("company")}>
                {t("reports.scopeTabs.company")}
              </ScopeTabButton>
            </div>
          )}
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
        isLoading={activeQuery.isLoading}
        emptyState={
          <EmptyState
            title={t("reports.empty.title")}
            description={t("reports.empty.description")}
          />
        }
        pageSize={ATT_RECORDS_PAGE_SIZE}
      />

      {!activeQuery.isLoading && totalPages > 1 && (
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

function ScopeTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded px-3 py-1 text-sm font-medium transition-colors",
        active
          ? "bg-brand-muted font-semibold text-brand"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
