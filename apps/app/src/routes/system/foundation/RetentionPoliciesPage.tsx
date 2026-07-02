/**
 * SYSTEM-SCREEN-RETENTION (S2-FE-FND-6) — /system/retention config data-retention.
 *
 * GET /foundation/retention-policies → gate view:foundation-retention (KHÔNG sensitive).
 * PATCH /foundation/retention-policies/:id → gate manage:foundation-retention (is_sensitive=true,
 * System-scope — KHÔNG tự động cấp qua role seed company-admin thường; nút Sửa ẨN nếu thiếu quyền,
 * ĐÚNG thiết kế chứ không phải bug FE). Retention GOVERNS PURGE — sửa luôn xác nhận hậu quả
 * (RetentionEditDialog → ConfirmDialog destructive) trước khi PATCH.
 *
 * States: forbidden · loading · error · empty · list.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { Archive, RefreshCw, Pencil } from "lucide-react";
import { useCan, type RetentionPolicyView } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Badge } from "@mediaos/ui";
import { useRetentionPolicies } from "./useRetention";
import { FOUNDATION_ENGINE_PAIRS } from "./constants";
import { RetentionEditDialog } from "./RetentionEditDialog";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

function useColumns(
  t: TF,
  onEdit: ((policy: RetentionPolicyView) => void) | null,
): ColumnDef<RetentionPolicyView>[] {
  const cols: ColumnDef<RetentionPolicyView>[] = [
    {
      accessorKey: "moduleCode",
      header: t("retention.columns.module"),
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">{row.original.moduleCode}</span>
      ),
    },
    {
      accessorKey: "entityType",
      header: t("retention.columns.entity"),
      cell: ({ row }) => <span className="text-sm">{row.original.entityType}</span>,
    },
    {
      accessorKey: "retentionDays",
      header: t("retention.columns.retentionDays"),
      cell: ({ row }) => (
        <span className="text-sm font-medium tabular-nums">{row.original.retentionDays}</span>
      ),
    },
    {
      accessorKey: "cleanupAction",
      header: t("retention.columns.cleanupAction"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {t(
            `retention.cleanupAction.${row.original.cleanupAction}` as "retention.cleanupAction.None",
          )}
        </span>
      ),
    },
    {
      accessorKey: "isEnabled",
      header: t("retention.columns.status"),
      cell: ({ row }) => (
        <Badge variant={row.original.isEnabled ? "success" : "muted"}>
          {row.original.isEnabled ? t("retention.status.enabled") : t("retention.status.disabled")}
        </Badge>
      ),
    },
  ];
  if (onEdit) {
    cols.push({
      id: "actions",
      header: t("retention.actions.columnHeader"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(row.original)}
          data-testid="retention-edit-btn"
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          {t("retention.actions.edit")}
        </Button>
      ),
    });
  }
  return cols;
}

export function RetentionPoliciesPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");

  const canView = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_RETENTION.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_RETENTION.resourceType,
  );
  const canManage = useCan(
    FOUNDATION_ENGINE_PAIRS.MANAGE_RETENTION.action,
    FOUNDATION_ENGINE_PAIRS.MANAGE_RETENTION.resourceType,
  );

  const { data, isLoading, isError, refetch } = useRetentionPolicies(canView);
  const [editing, setEditing] = useState<RetentionPolicyView | null>(null);

  const columns = useColumns(t, canManage ? (p) => setEditing(p) : null);

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("retention.forbidden.title")}
          description={t("retention.forbidden.description")}
          data-testid="retention-forbidden"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("retention.error.title")}
          description={t("retention.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const items = data ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("retention.title")}
        description={t("retention.description")}
        icon={Archive}
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("retention.empty.title")}
            description={t("retention.empty.description")}
          />
        }
      />

      {canManage && editing && (
        <RetentionEditDialog open onClose={() => setEditing(null)} policy={editing} />
      )}
    </div>
  );
}
