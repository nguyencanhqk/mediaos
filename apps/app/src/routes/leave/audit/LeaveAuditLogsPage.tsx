/**
 * LeaveAuditLogsPage — /leave/audit-logs (S3-FE-LEAVE-6, LEAVE-SCREEN-014A, CO-S4-006).
 *
 * Viewer audit RIÊNG của LEAVE (KHÔNG dùng chung route/guard với /system/audit-logs — cặp
 * view:leave-audit-log RIÊNG, server bound thêm vào object-type allowlist của LEAVE). Cổng = cặp
 * engine THẬT (mig 0455, Company-scope hr/company-admin) — sensitive ⇒ useCanExact (KHÔNG wildcard
 * fallback). Field before/after/oldValues/newValues ĐÃ redact ở server (AuditMaskerService, bất biến
 * #3) — client CHỈ render field top-level (createdAt/action/objectType/objectId/actor); KHÔNG render/
 * khôi phục khối JSON đã mask. Mirror AttendanceAuditLogsPage.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { FileClock, RefreshCw, ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import type { AuditLogDto } from "@mediaos/contracts";
import { useCanExact, formatDateTime } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input } from "@mediaos/ui";
import { useLeaveAuditLogs } from "../hooks/useLeaveReports";
import { LEAVE_ENGINE_PAIRS, LEAVE_AUDIT_PAGE_LIMIT } from "../constants";

function useColumns(t: ReturnType<typeof useTranslation<"leave">>["t"]): ColumnDef<AuditLogDto>[] {
  return [
    {
      accessorKey: "createdAt",
      header: t("auditLogs.columns.createdAt"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: "action",
      header: t("auditLogs.columns.action"),
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.action}</span>,
    },
    {
      accessorKey: "objectType",
      header: t("auditLogs.columns.objectType"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.objectType}</span>
      ),
    },
    {
      accessorKey: "objectId",
      header: t("auditLogs.columns.objectId"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.objectId ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "actorUserId",
      header: t("auditLogs.columns.actor"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.actorUserId ?? "—"}
        </span>
      ),
    },
  ];
}

function toIsoStart(date: string): string | undefined {
  return date ? `${date}T00:00:00.000Z` : undefined;
}
function toIsoEnd(date: string): string | undefined {
  return date ? `${date}T23:59:59.999Z` : undefined;
}

export function LeaveAuditLogsPage() {
  const { t } = useTranslation("leave");
  const { t: tc } = useTranslation("common");
  const canView = useCanExact(
    LEAVE_ENGINE_PAIRS.VIEW_AUDIT_LOG.action,
    LEAVE_ENGINE_PAIRS.VIEW_AUDIT_LOG.resourceType,
  );

  const [offset, setOffset] = useState(0);
  const [draftAction, setDraftAction] = useState("");
  const [draftObjectType, setDraftObjectType] = useState("");
  const [draftFromDate, setDraftFromDate] = useState("");
  const [draftToDate, setDraftToDate] = useState("");
  const [applied, setApplied] = useState({
    action: "",
    objectType: "",
    fromDate: "",
    toDate: "",
  });

  const queryParams = {
    limit: LEAVE_AUDIT_PAGE_LIMIT,
    offset,
    action: applied.action || undefined,
    objectType: applied.objectType || undefined,
    dateFrom: toIsoStart(applied.fromDate),
    dateTo: toIsoEnd(applied.toDate),
  };

  const { data, isLoading, isError, refetch } = useLeaveAuditLogs(queryParams, canView);
  const columns = useColumns(t);

  function applyFilters() {
    setApplied({
      action: draftAction,
      objectType: draftObjectType,
      fromDate: draftFromDate,
      toDate: draftToDate,
    });
    setOffset(0);
  }

  function resetFilters() {
    setDraftAction("");
    setDraftObjectType("");
    setDraftFromDate("");
    setDraftToDate("");
    setApplied({ action: "", objectType: "", fromDate: "", toDate: "" });
    setOffset(0);
  }

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("auditLogs.forbidden.title")}
          description={t("auditLogs.forbidden.description")}
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("auditLogs.title")}
          description={t("auditLogs.description")}
          icon={FileClock}
        />
        <div className="mt-8">
          <EmptyState
            title={t("auditLogs.error.title")}
            description={t("auditLogs.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const items = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const limit = data?.meta.limit ?? LEAVE_AUDIT_PAGE_LIMIT;
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("auditLogs.title")}
        description={t("auditLogs.description")}
        icon={FileClock}
      />

      <form
        className="rounded-xl border border-border bg-card p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("auditLogs.filters.action")}
            </span>
            <Input value={draftAction} onChange={(e) => setDraftAction(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("auditLogs.filters.objectType")}
            </span>
            <Input value={draftObjectType} onChange={(e) => setDraftObjectType(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("auditLogs.filters.fromDate")}
            </span>
            <Input
              type="date"
              value={draftFromDate}
              onChange={(e) => setDraftFromDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("auditLogs.filters.toDate")}
            </span>
            <Input
              type="date"
              value={draftToDate}
              onChange={(e) => setDraftToDate(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button type="submit" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            {t("auditLogs.filters.apply")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
            <X className="mr-2 h-4 w-4" />
            {t("auditLogs.filters.reset")}
          </Button>
        </div>
      </form>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("auditLogs.empty.title")}
            description={t("auditLogs.empty.description")}
          />
        }
        pageSize={limit}
      />

      {!isLoading && (hasPrev || hasNext) && (
        <div className="flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
          <span>{items.length > 0 ? `${offset + 1}–${offset + items.length} / ${total}` : ""}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              aria-label={tc("pagination.prev")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => setOffset((o) => o + limit)}
              aria-label={tc("pagination.next")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
