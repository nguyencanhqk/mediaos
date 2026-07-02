/**
 * SYSTEM-SCREEN-SEEDS (S2-FE-FND-5 · lane FE batch C) — /system/seeds, chỉ đọc.
 *
 * API: GET /foundation/seeds (view:foundation-seed, is_sensitive=true — System scope, KHÔNG kế thừa
 * wildcard bulk-grant) — seed.controller.ts (mig 0435). Gate dùng useCanExact (KHÔNG useCan).
 *
 * States: forbidden · loading · error · empty · list (search + pagination qua DataTable).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Database, RefreshCw } from "lucide-react";
import type { SeedBatchStatusView } from "@mediaos/contracts";
import { foundationOpsApi, foundationKeys, useCanExact } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input, Badge } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "../constants";

const STATUS_BADGE_VARIANT: Record<
  SeedBatchStatusView["status"],
  "success" | "danger" | "muted" | "warning"
> = {
  Success: "success",
  Failed: "danger",
  Running: "warning",
  Pending: "muted",
  Skipped: "muted",
  RolledBack: "danger",
};

function useColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
): ColumnDef<SeedBatchStatusView>[] {
  return [
    {
      accessorKey: "seedKey",
      header: t("seeds.columns.seedKey"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.seedKey}</span>,
    },
    {
      accessorKey: "seedVersion",
      header: t("seeds.columns.seedVersion"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.seedVersion}</span>,
    },
    {
      accessorKey: "environment",
      header: t("seeds.columns.environment"),
      cell: ({ row }) => <span className="text-sm">{row.original.environment ?? "—"}</span>,
    },
    {
      accessorKey: "status",
      header: t("seeds.columns.status"),
      cell: ({ row }) => (
        <Badge variant={STATUS_BADGE_VARIANT[row.original.status]}>
          {t(`seeds.status.${row.original.status}`)}
        </Badge>
      ),
    },
    {
      accessorKey: "checksum",
      header: t("seeds.columns.checksum"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.checksum ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "finishedAt",
      header: t("seeds.columns.finishedAt"),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.finishedAt ?? "—"}</span>
      ),
    },
  ];
}

export function SeedsPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const canView = useCanExact(
    SYSTEM_ENGINE_PAIRS.READ_SEED.action,
    SYSTEM_ENGINE_PAIRS.READ_SEED.resourceType,
  );
  const [filter, setFilter] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: foundationKeys.seeds.list(),
    queryFn: () => foundationOpsApi.listSeeds(),
    enabled: canView,
    staleTime: 30_000,
  });

  const columns = useColumns(t);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("seeds.forbidden.title")}
          description={t("seeds.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader title={t("seeds.title")} description={t("seeds.description")} icon={Database} />
        <div className="mt-8">
          <EmptyState
            title={t("seeds.error.title")}
            description={t("seeds.error.description")}
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

  const items = data ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("seeds.title")} description={t("seeds.description")} icon={Database} />

      <Input
        placeholder={t("seeds.search")}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-72"
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        globalFilter={filter}
        emptyState={
          <EmptyState title={t("seeds.empty.title")} description={t("seeds.empty.description")} />
        }
        pageSize={20}
      />
    </div>
  );
}
