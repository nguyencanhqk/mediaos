/**
 * SYSTEM-SCREEN-PERMISSIONS (S2-FE-AUTH-4 · lane FE batch C) — danh mục quyền hệ thống, chỉ đọc.
 *
 * API: GET /auth/permissions (view:permission — auth-roles-permissions.controller.ts, is_sensitive=false).
 * States: forbidden · loading · error · empty · list (search + pagination qua DataTable).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { KeySquare, RefreshCw } from "lucide-react";
import type { PermissionCatalogDto } from "@mediaos/contracts";
import { roleAdminApi, authKeys, useCan } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input, Badge } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "./constants";

function useColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
): ColumnDef<PermissionCatalogDto>[] {
  return [
    {
      accessorKey: "resourceType",
      header: t("permissions.columns.resourceType"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.resourceType}</span>,
    },
    {
      accessorKey: "action",
      header: t("permissions.columns.action"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span>,
    },
    {
      accessorKey: "isSensitive",
      header: t("permissions.columns.sensitive"),
      cell: ({ row }) =>
        row.original.isSensitive ? (
          <Badge variant="warning">{t("permissions.sensitive")}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];
}

export function PermissionsPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const canView = useCan(
    SYSTEM_ENGINE_PAIRS.READ_PERMISSION.action,
    SYSTEM_ENGINE_PAIRS.READ_PERMISSION.resourceType,
  );
  const [filter, setFilter] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: authKeys.permissionCatalog.list(),
    queryFn: () => roleAdminApi.listPermissions(),
    enabled: canView,
    staleTime: 60_000,
  });

  const columns = useColumns(t);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("permissions.forbidden.title")}
          description={t("permissions.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("permissions.title")}
          description={t("permissions.description")}
          icon={KeySquare}
        />
        <div className="mt-8">
          <EmptyState
            title={t("permissions.error.title")}
            description={t("permissions.error.description")}
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
      <PageHeader
        title={t("permissions.title")}
        description={t("permissions.description")}
        icon={KeySquare}
      />

      <Input
        placeholder={t("permissions.search")}
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
          <EmptyState
            title={t("permissions.empty.title")}
            description={t("permissions.empty.description")}
          />
        }
        pageSize={20}
      />
    </div>
  );
}
