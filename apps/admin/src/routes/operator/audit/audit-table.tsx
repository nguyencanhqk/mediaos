import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuditLogDto, AuditLogListResponse, AuditLogQuery } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";

const PAGE_LIMIT = 25;

interface AuditTableProps {
  /** Tiêu đề + phụ đề (i18n đã resolve ở caller). */
  title: string;
  subtitle: string;
  /** Bật ô lọc companyId (chỉ operator cross-tenant). */
  showCompanyFilter: boolean;
  /** Key query (operator vs tenant phân biệt cache). */
  queryKeyBase: string;
  /** Hàm fetch 1 trang theo query. */
  fetchPage: (q: Partial<AuditLogQuery>) => Promise<AuditLogListResponse>;
}

interface FilterState {
  action: string;
  objectType: string;
  companyId: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTER: FilterState = {
  action: "",
  objectType: "",
  companyId: "",
  dateFrom: "",
  dateTo: "",
};

/**
 * Bảng nhật ký kiểm toán dùng chung (operator cross-tenant + tenant self). DataTable v8 + filter + phân
 * trang server-side (offset). loading→role=status (DataTable skeleton), error→role=alert, empty→EmptyState.
 *
 * before/after ĐÃ redact phía server (object_type nhạy cảm → {redacted:true}); FE chỉ hiển thị marker.
 */
export function AuditTable({
  title,
  subtitle,
  showCompanyFilter,
  queryKeyBase,
  fetchPage,
}: AuditTableProps) {
  const { t } = useTranslation("audit");
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTER);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTER);
  const [offset, setOffset] = useState(0);

  const queryArgs = useMemo<Partial<AuditLogQuery>>(() => {
    const q: Partial<AuditLogQuery> = { limit: PAGE_LIMIT, offset };
    if (applied.action.trim()) q.action = applied.action.trim();
    if (applied.objectType.trim()) q.objectType = applied.objectType.trim();
    if (showCompanyFilter && applied.companyId.trim()) q.companyId = applied.companyId.trim();
    if (applied.dateFrom) q.dateFrom = new Date(applied.dateFrom).toISOString();
    if (applied.dateTo) q.dateTo = new Date(applied.dateTo).toISOString();
    return q;
  }, [applied, offset, showCompanyFilter]);

  const query = useQuery({
    queryKey: [queryKeyBase, queryArgs],
    queryFn: () => fetchPage(queryArgs),
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
      ...(showCompanyFilter
        ? [
            {
              accessorKey: "companyId",
              header: t("table.company"),
              cell: ({ row }) => (
                <span className="font-mono text-xs">{row.original.companyId.slice(0, 8)}</span>
              ),
            } as ColumnDef<AuditLogDto>,
          ]
        : []),
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
    [t, showCompanyFilter],
  );

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
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
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
        {showCompanyFilter && (
          <label className="flex flex-col gap-1 text-xs">
            <span>{t("filter.companyId")}</span>
            <input
              className="w-72 rounded border border-border px-2 py-1 text-sm"
              value={draft.companyId}
              placeholder={t("filter.companyIdPlaceholder")}
              onChange={(e) => setDraft({ ...draft, companyId: e.target.value })}
            />
          </label>
        )}
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
        <EmptyState icon={ScrollText} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={data}
            loading={query.isLoading}
            pagination={false}
            emptyMessage={t("empty.title")}
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
