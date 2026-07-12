/**
 * DashboardConfigPage — cấu hình widget dashboard theo dashboard-type/role/user: bật/tắt · thứ tự ·
 * kích thước (S4-FE-DASH-3). Nối S4-DASH-BE-3 (dashboard-config.controller.ts): GET /dashboard/configs ·
 * PATCH /dashboard/configs/:id.
 *
 * Gate:
 *   - Xem  : useCanExact('view','dashboard-config')   — is_sensitive=true, Company-scope company-admin,
 *            fail-closed (KHÔNG wildcard '*:*'), mirror NotificationEventsPage/AttendanceRulesPage.
 *   - Sửa  : useCanExact('update','dashboard-config') — is_sensitive=true; nút "Sửa" ẨN nếu thiếu quyền,
 *            đồng thời bọc thêm <PermissionGate> (defense-in-depth, đúng yêu cầu nghiệm thu).
 *
 * Danh mục nhỏ theo company (~20 dòng seed) → fetch 1 lần, lọc dashboard_type CLIENT-SIDE (mirror
 * NotificationEventsPage — KHÔNG cần AuthLogPagination server-side heuristic).
 *
 * Masking là việc của SERVER — trang chỉ render field nhận được từ dashboardConfigItemSchema.
 * States: forbidden · loading · error · empty · list (+ dialog sửa).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { LayoutGrid, RefreshCw, Pencil } from "lucide-react";
import type { DashboardConfigItemDto, DashboardConfigDashboardType } from "@mediaos/contracts";
import { dashboardConfigDashboardTypeEnum } from "@mediaos/contracts";
import { PermissionGate, useCanExact } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Select, Badge } from "@mediaos/ui";
import { useDashboardConfigs } from "./hooks/useDashboardConfigAdmin";
import { DashboardConfigFormDialog } from "./DashboardConfigFormDialog";
import { DASH_CONFIG_ENGINE_PAIRS } from "./constants";

type TF = ReturnType<typeof useTranslation<"dashboard">>["t"];

function formatSize(config: DashboardConfigItemDto, t: TF): string {
  const { width, height } = config.layout;
  if (width == null && height == null) return t("config.size.notSet");
  return `${width ?? "—"} × ${height ?? "—"}`;
}

function useColumns(
  t: TF,
  onEdit: ((config: DashboardConfigItemDto) => void) | null,
): ColumnDef<DashboardConfigItemDto>[] {
  const cols: ColumnDef<DashboardConfigItemDto>[] = [
    {
      accessorKey: "dashboard_type",
      header: t("config.columns.dashboardType"),
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.dashboard_type}</span>,
    },
    {
      accessorKey: "widget_name",
      header: t("config.columns.widget"),
      cell: ({ row }) => (
        <div>
          <div className="text-sm">{row.original.widget_name}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.original.widget_code}</div>
        </div>
      ),
    },
    {
      accessorKey: "config_scope",
      header: t("config.columns.scope"),
      cell: ({ row }) => <span className="text-sm">{row.original.config_scope}</span>,
    },
    {
      accessorKey: "is_enabled",
      header: t("config.columns.status"),
      cell: ({ row }) => (
        <Badge variant={row.original.is_enabled ? "success" : "muted"}>
          {row.original.is_enabled ? t("config.status.enabled") : t("config.status.disabled")}
        </Badge>
      ),
    },
    {
      accessorKey: "sort_order",
      header: t("config.columns.sortOrder"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.sort_order}</span>,
    },
    {
      id: "size",
      header: t("config.columns.size"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{formatSize(row.original, t)}</span>
      ),
    },
  ];
  if (onEdit) {
    cols.push({
      id: "actions",
      header: t("config.columns.actions"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(row.original)}
          data-testid={`config-edit-btn-${row.original.id}`}
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          {t("config.actions.edit")}
        </Button>
      ),
    });
  }
  return cols;
}

function DashboardConfigPageInner() {
  const { t } = useTranslation("dashboard");
  const { t: tc } = useTranslation("common");

  const canUpdate = useCanExact(
    DASH_CONFIG_ENGINE_PAIRS.UPDATE.action,
    DASH_CONFIG_ENGINE_PAIRS.UPDATE.resourceType,
  );

  const [typeFilter, setTypeFilter] = useState<DashboardConfigDashboardType | "">("");
  const [editing, setEditing] = useState<DashboardConfigItemDto | null>(null);

  const { data, isLoading, isError, refetch } = useDashboardConfigs();
  const items = data?.items ?? [];
  const filteredItems = useMemo(
    () => (typeFilter ? items.filter((c) => c.dashboard_type === typeFilter) : items),
    [items, typeFilter],
  );

  const columns = useColumns(t, canUpdate ? (c) => setEditing(c) : null);

  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("config.title")}
          description={t("config.description")}
          icon={LayoutGrid}
        />
        <div className="mt-8">
          <EmptyState
            title={t("config.error.title")}
            description={t("config.error.description")}
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
    <div className="space-y-6 p-6">
      <PageHeader title={t("config.title")} description={t("config.description")} icon={LayoutGrid}>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as DashboardConfigDashboardType | "")}
          className="w-52"
          aria-label={t("config.filters.dashboardType")}
        >
          <option value="">{t("config.filters.allTypes")}</option>
          {dashboardConfigDashboardTypeEnum.options.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </PageHeader>

      <DataTable
        columns={columns}
        data={filteredItems}
        isLoading={isLoading}
        emptyState={
          <EmptyState title={t("config.empty.title")} description={t("config.empty.description")} />
        }
        pageSize={20}
      />

      {editing && (
        <PermissionGate
          action={DASH_CONFIG_ENGINE_PAIRS.UPDATE.action}
          resourceType={DASH_CONFIG_ENGINE_PAIRS.UPDATE.resourceType}
        >
          <DashboardConfigFormDialog config={editing} onClose={() => setEditing(null)} />
        </PermissionGate>
      )}
    </div>
  );
}

export function DashboardConfigPage() {
  const { t } = useTranslation("dashboard");
  const canView = useCanExact(
    DASH_CONFIG_ENGINE_PAIRS.VIEW.action,
    DASH_CONFIG_ENGINE_PAIRS.VIEW.resourceType,
  );

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("config.forbidden.title")}
          description={t("config.forbidden.description")}
          data-testid="config-forbidden"
        />
      </div>
    );
  }

  return <DashboardConfigPageInner />;
}
