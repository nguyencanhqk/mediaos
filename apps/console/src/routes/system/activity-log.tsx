import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuditLogDto, AuditLogQuery } from "@mediaos/contracts";
import { useCan } from "@mediaos/web-core";
import { Button, DataTable, EmptyState } from "@mediaos/ui";
import { observabilityApi } from "@/lib/observability-api";

/**
 * CS-1 — Nhật ký hoạt động (console, tenant self, /system/activity-log).
 *
 * Gate hiển thị quyền `view:audit-log` (server ép qua withTenant(JWT.companyId) + RLS).
 * FE chỉ ẩn/hiện — không expose cột companyId (console = 1 công ty).
 */

const PAGE_LIMIT = 25;

interface FilterState {
  action: string;
  objectType: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTER: FilterState = { action: "", objectType: "", dateFrom: "", dateTo: "" };

export function ActivityLogPage() {
  const { t } = useTranslation("audit");
  const canView = useCan("view", "audit-log");

  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTER);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTER);
  const [offset, setOffset] = useState(0);

  const queryArgs = useMemo<Partial<AuditLogQuery>>(() => {
    const q: Partial<AuditLogQuery> = { limit: PAGE_LIMIT, offset };
    if (applied.action.trim()) q.action = applied.action.trim();
    if (applied.objectType.trim()) q.objectType = applied.objectType.trim();
    if (applied.dateFrom) q.dateFrom = new Date(applied.dateFrom).toISOString();
    if (applied.dateTo) q.dateTo = new Date(applied.dateTo).toISOString();
    return q;
  }, [applied, offset]);

  const query = useQuery({
    queryKey: ["console:activity-log", queryArgs],
    queryFn: () => observabilityApi.listTenantAudit(queryArgs),
    enabled: canView,
  });

  const columns: ColumnDef<AuditLogDto>[] = useMemo(
    () => [
      {
        accessorKey: "createdAt",
        header: t("table.createdAt"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs">
            {new Date(row.original.createdAt).toLocaleString("vi-VN")}
          </span>
        ),
      },
      { accessorKey: "action", header: t("table.action") },
      {
        accessorKey: "objectType",
        header: t("table.objectType"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.objectType}</span>,
      },
      {
        accessorKey: "actorUserId",
        header: t("table.actor"),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.actorUserId ? row.original.actorUserId.slice(0, 8) : "—"}
          </span>
        ),
      },
      {
        accessorKey: "objectId",
        header: t("table.objectId"),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.objectId ? row.original.objectId.slice(0, 8) : "—"}
          </span>
        ),
      },
      {
        accessorKey: "ip",
        header: "IP",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.ip ?? "—"}</span>
        ),
      },
      {
        id: "detail",
        header: t("table.detail"),
        cell: ({ row }) => {
          const after = row.original.after as { redacted?: boolean } | null;
          if (after && typeof after === "object" && after.redacted) {
            return <span className="text-xs italic text-muted-foreground">{t("redacted")}</span>;
          }
          return (
            <span className="max-w-xs truncate text-xs text-muted-foreground">
              {after ? JSON.stringify(after) : "—"}
            </span>
          );
        },
      },
    ],
    [t],
  );

  if (!canView) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={ClipboardList}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  const data = query.data?.data ?? [];
  const total = query.data?.meta.total ?? 0;
  const isEmpty = !query.isLoading && !query.isError && data.length === 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = offset + data.length;

  function applyFilter() {
    setOffset(0);
    setApplied(draft);
  }
  function clearFilter() {
    setOffset(0);
    setDraft(EMPTY_FILTER);
    setApplied(EMPTY_FILTER);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <label className="flex flex-col gap-1 text-xs">
          <span>{t("filter.action")}</span>
          <input
            className="rounded border border-border px-2 py-1 text-sm"
            value={draft.action}
            placeholder={t("filter.actionPlaceholder")}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>{t("filter.objectType")}</span>
          <input
            className="rounded border border-border px-2 py-1 text-sm"
            value={draft.objectType}
            placeholder={t("filter.objectTypePlaceholder")}
            onChange={(e) => setDraft({ ...draft, objectType: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>{t("filter.dateFrom")}</span>
          <input
            type="date"
            className="rounded border border-border px-2 py-1 text-sm"
            value={draft.dateFrom}
            onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>{t("filter.dateTo")}</span>
          <input
            type="date"
            className="rounded border border-border px-2 py-1 text-sm"
            value={draft.dateTo}
            onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })}
          />
        </label>
        <div className="flex gap-2">
          <Button size="sm" onClick={applyFilter}>
            {t("filter.apply")}
          </Button>
          <Button size="sm" variant="outline" onClick={clearFilter}>
            {t("filter.clear")}
          </Button>
        </div>
      </div>

      {query.isError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center"
        >
          <p className="text-sm text-destructive">{t("error.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : isEmpty ? (
        <EmptyState icon={ClipboardList} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={data}
            isLoading={query.isLoading}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("pagination.summary", { from, to, total })}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}
              >
                {t("pagination.prev")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={to >= total}
                onClick={() => setOffset(offset + PAGE_LIMIT)}
              >
                {t("pagination.next")}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
