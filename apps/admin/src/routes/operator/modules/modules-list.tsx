import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useParams } from "@tanstack/react-router";
import { Boxes } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TenantModuleStateDto } from "@mediaos/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PermissionGate } from "@/components/permission-gate";
import { useCan } from "@/hooks/use-can";
import { modulesApi } from "@/lib/modules-api";
import { tenantModulesQueryKey } from "./modules-query";
import { ModuleToggleDialog } from "./module-toggle";

/**
 * Trang Operator — Module registry cho 1 tenant (`/tenant/:companyId/modules`, AC-7).
 *
 * Catalog module GLOBAL + trạng thái HIỆU LỰC của tenant (đọc từ FeatureFlagService server). Toggle
 * bật/tắt module = set bundle feature-key của module (server, atomic + audit).
 *
 * Permission (server ép; FE chỉ ẩn UI):
 *   - read   → `view:system-module`
 *   - toggle → `manage:module-toggle` (is_sensitive, step-up bắt buộc)
 */
export function ModulesListPage() {
  const { t } = useTranslation("modules");
  const { companyId } = useParams({ strict: false });
  const canToggle = useCan("manage", "module-toggle");

  const [toggleTarget, setToggleTarget] = useState<TenantModuleStateDto | null>(null);

  const query = useQuery({
    queryKey: tenantModulesQueryKey(companyId ?? ""),
    queryFn: () => modulesApi.listForTenant(companyId as string),
    enabled: Boolean(companyId),
  });

  const columns: ColumnDef<TenantModuleStateDto>[] = useMemo(() => {
    const base: ColumnDef<TenantModuleStateDto>[] = [
      { accessorKey: "name", header: t("table.name") },
      {
        accessorKey: "key",
        header: t("table.key"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span>,
      },
      {
        accessorKey: "enabled",
        header: t("table.status"),
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? "default" : "secondary"}>
            {row.original.enabled ? t("status.enabled") : t("status.disabled")}
          </Badge>
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
    ];

    if (!canToggle) return base;

    base.push({
      id: "actions",
      header: t("table.actions"),
      cell: ({ row }) => (
        <PermissionGate action="manage" resourceType="module-toggle">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setToggleTarget(row.original)}
            disabled={!row.original.isActive}
          >
            {row.original.enabled ? t("actions.disable") : t("actions.enable")}
          </Button>
        </PermissionGate>
      ),
    });
    return base;
  }, [t, canToggle]);

  const items = query.data ?? [];
  const isEmpty = !query.isLoading && !query.isError && items.length === 0;

  if (!companyId) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p role="alert" className="text-sm text-destructive">
          {t("error.noTenant")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

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
        <EmptyState icon={Boxes} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          loading={query.isLoading}
          pagination={false}
          emptyMessage={t("empty.title")}
        />
      )}

      <ModuleToggleDialog
        companyId={companyId}
        module={toggleTarget}
        onClose={() => setToggleTarget(null)}
      />
    </div>
  );
}
