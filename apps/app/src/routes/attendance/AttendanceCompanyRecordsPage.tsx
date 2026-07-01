/**
 * AttendanceCompanyRecordsPage — bảng công toàn công ty (UI-02 §9.6 `/attendance/records`, S3-FE-ATT-5).
 *
 * Gate: useCanExact('view-company','attendance') — fail-closed (cặp is_sensitive riêng, KHÔNG kế thừa
 * từ view-team). Thiếu quyền → forbidden EmptyState + KHÔNG gọi listRecords (enabled=false).
 * Cùng shell với Team/My records (filter tháng/khoảng ngày/trạng thái + pagination); masking là việc
 * của server (danh sách company KHÔNG trả location/gps/ip/device — xem attendanceRecordListItemSchema).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Building2, RefreshCw } from "lucide-react";
import type { AttendanceRecordListItem } from "@mediaos/contracts";
import { useCanExact, formatDateTime } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Select } from "@mediaos/ui";
import { AttendanceStatusBadge } from "./AttendanceStatusBadge";
import { useCompanyAttendanceRecords } from "./hooks/useAttendanceRecords";
import {
  ATT_ENGINE_PAIRS,
  ATT_STATUS,
  ATT_PATHS,
  ATT_RECORDS_PAGE_SIZE,
  monthToDateRange,
  currentMonth,
} from "./constants";

// ── Helpers ───────────────────────────────────────────────────────────────────

function minutesToHM(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}p`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}p`;
}

// ── Column definitions ────────────────────────────────────────────────────────

function useColumns(
  t: ReturnType<typeof useTranslation<"attendance">>["t"],
  onView: (id: string) => void,
): ColumnDef<AttendanceRecordListItem>[] {
  return [
    {
      accessorKey: "workDate",
      header: t("records.columns.date"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.workDate}</span>,
    },
    {
      accessorKey: "fullName",
      header: "Nhân viên",
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.fullName ?? "—"}</span>
      ),
    },
    {
      accessorKey: "orgUnitName",
      header: "Phòng ban",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.orgUnitName ?? "—"}</span>
      ),
    },
    {
      accessorKey: "checkInAt",
      header: t("records.columns.checkIn"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.checkInAt ? formatDateTime(row.original.checkInAt) : "—"}
        </span>
      ),
    },
    {
      accessorKey: "checkOutAt",
      header: t("records.columns.checkOut"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.checkOutAt ? formatDateTime(row.original.checkOutAt) : "—"}
        </span>
      ),
    },
    {
      accessorKey: "workingMinutes",
      header: t("records.columns.totalHours"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{minutesToHM(row.original.workingMinutes)}</span>
      ),
    },
    {
      accessorKey: "attendanceStatus",
      header: t("records.columns.status"),
      cell: ({ row }) => <AttendanceStatusBadge status={row.original.attendanceStatus} />,
    },
    {
      id: "actions",
      header: t("records.columns.actions"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onView(row.original.id)}
          aria-label={t("records.columns.actions")}
        >
          {t("records.columns.actions")}
        </Button>
      ),
    },
  ];
}

// ── Status filter options ─────────────────────────────────────────────────────

const STATUS_OPTIONS = Object.values(ATT_STATUS);

// ── Main component ────────────────────────────────────────────────────────────

export function AttendanceCompanyRecordsPage() {
  const { t } = useTranslation("attendance");
  const navigate = useNavigate();

  // NHẠY CẢM: useCanExact — KHÔNG wildcard fallback (view-company:attendance is_sensitive).
  const canView = useCanExact(
    ATT_ENGINE_PAIRS.VIEW_COMPANY.action,
    ATT_ENGINE_PAIRS.VIEW_COMPANY.resourceType,
  );

  const [page, setPage] = useState(1);
  const [month, setMonth] = useState(currentMonth);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [attendanceStatus, setAttendanceStatus] = useState("");

  const dateRange = fromDate || toDate ? { fromDate, toDate } : monthToDateRange(month);
  const queryParams = {
    page,
    pageSize: ATT_RECORDS_PAGE_SIZE,
    ...dateRange,
    ...(attendanceStatus ? { attendanceStatus } : {}),
  };

  // enabled=canView — thiếu quyền: KHÔNG gọi API (avoid unnecessary 403 round-trip).
  const { data, isLoading, isError, refetch } = useCompanyAttendanceRecords(queryParams, canView);

  const columns = useColumns(t, (id) => void navigate({ to: ATT_PATHS.RECORD_DETAIL(id) as "/" }));

  // ── Forbidden (page-level) ─────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("company.forbidden.title")}
          description={t("company.forbidden.description")}
          data-testid="company-forbidden"
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("company.error.title")}
          description={t("company.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      </div>
    );
  }

  const items = data?.items ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("company.title")}
        description={t("company.description")}
        icon={Building2}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setFromDate("");
              setToDate("");
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("records.filters.month")}
            data-testid="filter-month"
          />
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("records.filters.fromDate")}
            data-testid="filter-from-date"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("records.filters.toDate")}
            data-testid="filter-to-date"
          />
          <Select
            value={attendanceStatus}
            onChange={(e) => {
              setAttendanceStatus(e.target.value);
              setPage(1);
            }}
            className="w-48"
            aria-label={t("records.filters.allStatuses")}
            data-testid="filter-status"
          >
            <option value="">{t("records.filters.allStatuses")}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`, { defaultValue: s })}
              </option>
            ))}
          </Select>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("company.empty.title")}
            description={t("company.empty.description")}
          />
        }
        pageSize={ATT_RECORDS_PAGE_SIZE}
      />

      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
          <span>
            {meta
              ? `${(page - 1) * meta.pageSize + 1}–${Math.min(page * meta.pageSize, meta.total)} / ${meta.total}`
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("pagination.prev", { ns: "common" })}
            </Button>
            <span>
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("pagination.next", { ns: "common" })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
