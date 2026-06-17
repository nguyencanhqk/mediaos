import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Inbox } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DeadLetterRow } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { useCan } from "@/hooks/use-can";
import { observabilityApi } from "@/lib/observability-api";

/**
 * Trang Operator — giám sát hàng đợi sự kiện CHÉO TENANT (`/operator/queue`, AC-8).
 *
 * PermissionGate `view:platform-audit` (server ép + step-up; FE chỉ gate UI). Đếm outbox theo status +
 * dead-letter unresolved/total + bảng dead-letter (row-capped). loading→role=status, error→role=alert.
 */
export function OperatorQueuePage() {
  const { t } = useTranslation("observability");
  const canView = useCan("view", "platform-audit");

  const query = useQuery({
    queryKey: ["observability:queue"],
    queryFn: () => observabilityApi.getQueueStatus(),
    enabled: canView,
  });

  const dlColumns: ColumnDef<DeadLetterRow>[] = useMemo(
    () => [
      {
        accessorKey: "createdAt",
        header: t("queue.deadLetter.table.createdAt"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs">
            {new Date(row.original.createdAt).toLocaleString("vi-VN")}
          </span>
        ),
      },
      {
        accessorKey: "companyId",
        header: t("queue.deadLetter.table.company"),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.companyId.slice(0, 8)}</span>
        ),
      },
      { accessorKey: "eventType", header: t("queue.deadLetter.table.eventType") },
      { accessorKey: "consumerName", header: t("queue.deadLetter.table.consumer") },
      {
        accessorKey: "error",
        header: t("queue.deadLetter.table.error"),
        cell: ({ row }) => (
          <span className="max-w-xs truncate text-xs text-destructive">{row.original.error}</span>
        ),
      },
      {
        accessorKey: "resolvedAt",
        header: t("queue.deadLetter.table.resolved"),
        cell: ({ row }) =>
          row.original.resolvedAt
            ? t("queue.deadLetter.resolvedYes")
            : t("queue.deadLetter.resolvedNo"),
      },
    ],
    [t],
  );

  if (!canView) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={Inbox}
          title={t("queue.noPermission.title")}
          description={t("queue.noPermission.description")}
        />
      </div>
    );
  }

  const dlRows = query.data?.deadLetter.rows ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("queue.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("queue.subtitle")}</p>
      </header>

      {query.isLoading ? (
        <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
          …
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center"
        >
          <p className="text-sm text-destructive">{t("queue.error.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <h2 className="mb-2 font-medium">{t("queue.outbox.title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("queue.outbox.total")}: <strong>{query.data?.outbox.total ?? 0}</strong>
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {(query.data?.outbox.counts ?? []).map((c) => (
                  <li key={c.status} className="flex justify-between">
                    <span className="font-mono text-xs">{c.status}</span>
                    <span>{c.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h2 className="mb-2 font-medium">{t("queue.deadLetter.title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("queue.deadLetter.unresolved")}:{" "}
                <strong className="text-destructive">
                  {query.data?.deadLetter.unresolved ?? 0}
                </strong>{" "}
                / {t("queue.deadLetter.total")}: <strong>{query.data?.deadLetter.total ?? 0}</strong>
              </p>
            </div>
          </section>

          {dlRows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={t("queue.empty.title")}
              description={t("queue.empty.description")}
            />
          ) : (
            <DataTable columns={dlColumns} data={dlRows} pagination={false} />
          )}
        </>
      )}
    </div>
  );
}
