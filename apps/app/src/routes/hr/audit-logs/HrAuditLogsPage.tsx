/**
 * HR-SCREEN-AUDIT-LOGS (S2-FE-HR-6) — /hr/audit-logs. Lịch sử thay đổi HR, CHỈ ĐỌC.
 *
 * Nguồn: GET /foundation/audit-logs?moduleCode=HR (TÁI DÙNG endpoint chung — KHÔNG dựng endpoint
 * mới). Gate: HR_ENGINE_PAIRS.AUDIT_LOG_VIEW (= view:audit-log, cặp seed THẬT mig 0340,
 * is_sensitive=true) → dùng useCanExact (KHÔNG wildcard fallback, mirror BE fail-closed cho cặp
 * sensitive — cùng kỹ thuật attendance VIEW_TEAM/VIEW_COMPANY).
 *
 * BẤT BIẾN #3 (masking do server): before/after/oldValues/newValues trong AuditLogDto ĐÃ redact ở
 * server cho object_type nhạy cảm — client CHỈ render field DTO trả về, KHÔNG tự suy field bị ẩn.
 *
 * States: loading · error · empty · forbidden. Phân trang server-side offset/limit (dùng total từ
 * meta — khác login-logs/file-access-logs vốn không có total).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { History, RefreshCw } from "lucide-react";
import type { AuditLogDto } from "@mediaos/contracts";
import { hrAuditApi, hrKeys, useCanExact } from "@mediaos/web-core";
import { Button, DataTable, EmptyState, PageHeader } from "@mediaos/ui";
import { DateField, FilterShell, TextField } from "@/routes/system/auth-logs/AuthLogControls";
import { HR_ENGINE_PAIRS } from "../constants";
import { HR_AUDIT_LOG_PAGE_SIZE } from "./constants";

type HrAuditLogFilters = {
  action: string;
  objectType: string;
  dateFrom: string;
  dateTo: string;
};

const INITIAL_FILTERS: HrAuditLogFilters = {
  action: "",
  objectType: "",
  dateFrom: "",
  dateTo: "",
};

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function useHrAuditLogColumns(
  t: ReturnType<typeof useTranslation<"hr">>["t"],
): ColumnDef<AuditLogDto>[] {
  return [
    {
      accessorKey: "createdAt",
      header: t("auditLogs.columns.createdAt"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {new Date(row.original.createdAt).toLocaleString("vi-VN")}
        </span>
      ),
    },
    { accessorKey: "action", header: t("auditLogs.columns.action") },
    {
      accessorKey: "entityType",
      header: t("auditLogs.columns.entityType"),
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.entityType ?? row.original.objectType}
        </span>
      ),
    },
    {
      accessorKey: "actorUserId",
      header: t("auditLogs.columns.actor"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.actorUserId ? row.original.actorUserId.slice(0, 8) : "—"}
        </span>
      ),
    },
    {
      accessorKey: "changedFields",
      header: t("auditLogs.columns.changedFields"),
      cell: ({ row }) => {
        const fields = row.original.changedFields;
        if (!fields || fields.length === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="max-w-xs truncate text-xs text-muted-foreground">
            {fields.join(", ")}
          </span>
        );
      },
    },
  ];
}

export function HrAuditLogsPage() {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const canView = useCanExact(
    HR_ENGINE_PAIRS.AUDIT_LOG_VIEW.action,
    HR_ENGINE_PAIRS.AUDIT_LOG_VIEW.resourceType,
  );

  const [draft, setDraft] = useState(INITIAL_FILTERS);
  const [applied, setApplied] = useState(INITIAL_FILTERS);
  const [offset, setOffset] = useState(0);

  const queryArgs = {
    limit: HR_AUDIT_LOG_PAGE_SIZE,
    offset,
    action: emptyToUndefined(applied.action),
    objectType: emptyToUndefined(applied.objectType),
    dateFrom: applied.dateFrom ? new Date(applied.dateFrom).toISOString() : undefined,
    dateTo: applied.dateTo ? new Date(applied.dateTo).toISOString() : undefined,
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: hrKeys.auditLogs.list(queryArgs),
    queryFn: () => hrAuditApi.listHrAuditLogs(queryArgs),
    enabled: canView,
    staleTime: 30_000,
  });

  const columns = useHrAuditLogColumns(t);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          icon={History}
          title={t("auditLogs.forbidden.title")}
          description={t("auditLogs.forbidden.description")}
          data-testid="hr-audit-logs-forbidden"
        />
      </div>
    );
  }

  const items = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = offset + items.length;

  function applyFilter() {
    setOffset(0);
    setApplied(draft);
  }
  function resetFilter() {
    setOffset(0);
    setDraft(INITIAL_FILTERS);
    setApplied(INITIAL_FILTERS);
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("auditLogs.title")}
          description={t("auditLogs.description")}
          icon={History}
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

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("auditLogs.title")}
        description={t("auditLogs.description")}
        icon={History}
      />

      <FilterShell onApply={applyFilter} onReset={resetFilter}>
        <TextField
          label={t("auditLogs.filters.action")}
          value={draft.action}
          placeholder={t("auditLogs.filters.actionPlaceholder")}
          onChange={(v) => setDraft({ ...draft, action: v })}
        />
        <TextField
          label={t("auditLogs.filters.entityType")}
          value={draft.objectType}
          placeholder={t("auditLogs.filters.entityTypePlaceholder")}
          onChange={(v) => setDraft({ ...draft, objectType: v })}
        />
        <DateField
          label={t("auditLogs.filters.dateFrom")}
          value={draft.dateFrom}
          onChange={(v) => setDraft({ ...draft, dateFrom: v })}
        />
        <DateField
          label={t("auditLogs.filters.dateTo")}
          value={draft.dateTo}
          onChange={(v) => setDraft({ ...draft, dateTo: v })}
        />
      </FilterShell>

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
        pageSize={HR_AUDIT_LOG_PAGE_SIZE}
      />

      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("auditLogs.pagination.summary", { from, to, total })}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - HR_AUDIT_LOG_PAGE_SIZE))}
            >
              {tc("pagination.prev")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={to >= total}
              onClick={() => setOffset(offset + HR_AUDIT_LOG_PAGE_SIZE)}
            >
              {tc("pagination.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
