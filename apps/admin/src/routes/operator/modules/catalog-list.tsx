import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Boxes } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SystemModuleDto } from "@mediaos/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { modulesApi } from "@/lib/modules-api";
import { modulesCatalogQueryKey } from "./modules-query";

/**
 * Trang Operator — Danh mục module GLOBAL (`/operator/modules`, AC-7).
 *
 * Read-only viewer toàn bộ catalog `system_modules` (dùng chung mọi tenant) qua `GET admin/platform/modules`.
 * KHÔNG gắn tenant — bật/tắt theo tenant ở `/tenant/:companyId/modules`. Server ép `view:system-module`;
 * FE chỉ render (mọi route admin đã sau auth + operator-only ở BE).
 */
export function ModuleCatalogPage() {
  const { t } = useTranslation("modules");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: modulesCatalogQueryKey({ search: search.trim() || undefined }),
    queryFn: () => modulesApi.listCatalog({ search: search.trim() || undefined }),
  });

  const columns: ColumnDef<SystemModuleDto>[] = useMemo(
    () => [
      { accessorKey: "name", header: t("table.name") },
      {
        accessorKey: "key",
        header: t("table.key"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span>,
      },
      {
        accessorKey: "route",
        header: t("catalog.route"),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.route ?? "—"}</span>
        ),
      },
      {
        id: "featureKeys",
        header: t("table.featureKeys"),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.featureKeys.join(", ") || "—"}
          </span>
        ),
      },
      {
        id: "dependsOn",
        header: t("catalog.dependsOn"),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.dependsOn.join(", ") || "—"}
          </span>
        ),
      },
      {
        accessorKey: "isActive",
        header: t("table.status"),
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? "default" : "secondary"}>
            {row.original.isActive ? t("catalog.active") : t("catalog.inactive")}
          </Badge>
        ),
      },
    ],
    [t],
  );

  const items = query.data?.items ?? [];
  const isEmpty = !query.isLoading && !query.isError && items.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("catalog.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("catalog.subtitle")}</p>
      </header>

      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("catalog.searchPlaceholder")}
        className="max-w-sm"
        aria-label={t("catalog.searchPlaceholder")}
      />

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
        <EmptyState
          icon={Boxes}
          title={t("catalog.empty.title")}
          description={t("catalog.empty.description")}
        />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          loading={query.isLoading}
          pagination={false}
          emptyMessage={t("catalog.empty.title")}
        />
      )}
    </div>
  );
}
