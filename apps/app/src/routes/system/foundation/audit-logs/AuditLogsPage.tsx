/**
 * SYSTEM-SCREEN-AUDIT-LOGS (S2-FE-FND-2) — viewer Audit log (Company scope, chỉ đọc).
 *
 * Nguồn: API-09 FOUNDATION GET /foundation/audit-logs (audit_logs — append-only, RLS+FORCE).
 * Cổng quyền: useCan('view','audit-log') — cặp ENGINE THỰC (seed mig 0340, grant company-admin).
 * KHÔNG hard-code role. before/after/oldValues/newValues/metadata/deviceInfo ĐÃ redact phía server
 * (object_type nhạy cảm → null/{redacted:true}) — client CHỈ render cái server trả.
 *
 * States: loading · error · empty · forbidden. Bộ lọc: module/action/actor/entity/from-to.
 * Phân trang server-side (limit/offset) — cùng heuristic prev/next như system/login-logs
 * (page đầy = còn trang sau) vì apiFetch/unwrapEnvelope chỉ giữ `data`, bỏ block `pagination` đỉnh.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { FileClock, RefreshCw } from "lucide-react";
import { z } from "zod";
import { type AuditLogDto, auditLogDtoSchema } from "@mediaos/contracts";
import { apiFetch, buildQueryString, useCan } from "@mediaos/web-core";
import { Badge, Button, DataTable, EmptyState, PageHeader } from "@mediaos/ui";
import {
  AUDIT_LOG_PAGE_SIZE,
  AUDIT_LOG_VIEW,
  AUDIT_LOGS_API,
  AUDIT_LOGS_QUERY_KEY,
  auditLogDetailPath,
} from "./constants";
import { AuditLogPagination, DateField, FilterShell, TextField } from "./AuditLogControls";
import {
  type AuditLogFilters,
  createInitialAuditFilters,
  emptyToUndefined,
  toDateFromIso,
  toIsoRangeStart,
  toIsoRangeEnd,
} from "./audit-log-utils";
import { useAuditLogFilters } from "./use-audit-log-filters";

// Response sau unwrapEnvelope = mảng item (pagination block đỉnh bị tách ở apiFetch).
const auditLogListSchema = z.array(auditLogDtoSchema);

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------
function useAuditLogColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
  onView: (id: string) => void,
): ColumnDef<AuditLogDto>[] {
  return [
    {
      accessorKey: "createdAt",
      header: t("auditLogs.columns.createdAt"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {toDateFromIso(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: "moduleCode",
      header: t("auditLogs.columns.module"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground">{row.original.moduleCode ?? "—"}</span>
      ),
    },
    {
      accessorKey: "action",
      header: t("auditLogs.columns.action"),
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono">
          {row.original.action}
        </Badge>
      ),
    },
    {
      accessorKey: "entityType",
      header: t("auditLogs.columns.entity"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.entityType ?? row.original.objectType}
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
    {
      id: "actions",
      header: t("auditLogs.columns.actions"),
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onView(row.original.id)}>
          {t("auditLogs.columns.viewDetail")}
        </Button>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function AuditLogsPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const canView = useCan(AUDIT_LOG_VIEW.action, AUDIT_LOG_VIEW.resourceType);

  // S2-FE-FND-7 — mặc định lọc 30 ngày gần nhất (áp cho CẢ draft LẪN applied). useMemo([]) → tính
  // 1 lần/mount, ổn định để resetFilters trả về ĐÚNG mặc-định-30-ngày (không phải rỗng).
  const initialFilters = useMemo<AuditLogFilters>(() => createInitialAuditFilters(), []);
  const { offset, draft, applied, setOffset, setDraftField, applyFilters, resetFilters } =
    useAuditLogFilters<AuditLogFilters>(initialFilters);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...AUDIT_LOGS_QUERY_KEY, offset, applied] as const,
    queryFn: () => {
      const qs = buildQueryString({
        limit: AUDIT_LOG_PAGE_SIZE,
        offset,
        moduleCode: emptyToUndefined(applied.moduleCode),
        action: emptyToUndefined(applied.action),
        actorUserId: emptyToUndefined(applied.actorUserId),
        entityType: emptyToUndefined(applied.entityType),
        dateFrom: toIsoRangeStart(applied.fromDate),
        dateTo: toIsoRangeEnd(applied.toDate),
      });
      return apiFetch(`${AUDIT_LOGS_API}${qs}`, auditLogListSchema);
    },
    enabled: canView,
    staleTime: 30_000,
  });

  const columns = useAuditLogColumns(
    t,
    (id) => void navigate({ to: auditLogDetailPath(id) as "/" }),
  );

  // ── Forbidden ──────────────────────────────────────────────────────────────
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

  // ── Error ──────────────────────────────────────────────────────────────────
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

  const items: AuditLogDto[] = data ?? [];

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("auditLogs.title")}
        description={t("auditLogs.description")}
        icon={FileClock}
      />

      <FilterShell onApply={applyFilters} onReset={resetFilters}>
        <TextField
          label={t("auditLogFilters.module")}
          value={draft.moduleCode}
          placeholder={t("auditLogFilters.modulePlaceholder")}
          onChange={(v) => setDraftField("moduleCode", v)}
        />
        <TextField
          label={t("auditLogFilters.action")}
          value={draft.action}
          placeholder={t("auditLogFilters.actionPlaceholder")}
          onChange={(v) => setDraftField("action", v)}
        />
        <TextField
          label={t("auditLogFilters.actor")}
          value={draft.actorUserId}
          placeholder={t("auditLogFilters.actorPlaceholder")}
          onChange={(v) => setDraftField("actorUserId", v)}
        />
        <TextField
          label={t("auditLogFilters.entity")}
          value={draft.entityType}
          placeholder={t("auditLogFilters.entityPlaceholder")}
          onChange={(v) => setDraftField("entityType", v)}
        />
        <DateField
          label={t("auditLogFilters.fromDate")}
          value={draft.fromDate}
          onChange={(v) => setDraftField("fromDate", v)}
        />
        <DateField
          label={t("auditLogFilters.toDate")}
          value={draft.toDate}
          onChange={(v) => setDraftField("toDate", v)}
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
        pageSize={AUDIT_LOG_PAGE_SIZE}
      />

      <AuditLogPagination
        offset={offset}
        pageSize={AUDIT_LOG_PAGE_SIZE}
        currentCount={items.length}
        onOffsetChange={setOffset}
      />
    </div>
  );
}
