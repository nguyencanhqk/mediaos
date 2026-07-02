/**
 * SYSTEM-SCREEN-PUBLIC-HOLIDAYS (S2-FE-FND-4) — /system/public-holidays list + CRUD.
 *
 * GET /foundation/public-holidays (year filter) → gate view:foundation-holiday.
 * POST/PATCH/DELETE /foundation/public-holidays(/:id) → gate manage:foundation-holiday. Holiday scope
 * 'global' (hệ thống, companyId=null) KHÔNG sửa/xoá được ở đây — server chặn, nút chỉ hiện cho scope
 * 'company'. Xoá luôn xác nhận (ConfirmDialog) trước khi gọi DELETE (soft-delete, BẤT BIẾN #2).
 *
 * States: forbidden · loading · error · empty · list.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { CalendarDays, RefreshCw, Plus, Pencil, Trash2 } from "lucide-react";
import { useCan, type HolidayView } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Badge } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useDeleteHoliday, useHolidays } from "./useHolidays";
import { FOUNDATION_ENGINE_PAIRS } from "./constants";
import { HolidayFormDialog } from "./HolidayFormDialog";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

function useColumns(
  t: TF,
  onEdit: ((holiday: HolidayView) => void) | null,
  onDelete: ((holiday: HolidayView) => void) | null,
): ColumnDef<HolidayView>[] {
  const cols: ColumnDef<HolidayView>[] = [
    {
      accessorKey: "holidayDate",
      header: t("publicHolidays.columns.date"),
      cell: ({ row }) => (
        <span className="text-sm font-medium tabular-nums">{row.original.holidayDate}</span>
      ),
    },
    {
      accessorKey: "name",
      header: t("publicHolidays.columns.name"),
      cell: ({ row }) => <span className="text-sm">{row.original.name}</span>,
    },
    {
      accessorKey: "holidayCode",
      header: t("publicHolidays.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">{row.original.holidayCode}</span>
      ),
    },
    {
      accessorKey: "holidayType",
      header: t("publicHolidays.columns.type"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.holidayType}</span>
      ),
    },
    {
      accessorKey: "scope",
      header: t("publicHolidays.columns.scope"),
      cell: ({ row }) => (
        <Badge variant={row.original.scope === "global" ? "muted" : "brand"}>
          {t(`publicHolidays.scope.${row.original.scope}` as "publicHolidays.scope.company")}
        </Badge>
      ),
    },
  ];
  if (onEdit || onDelete) {
    cols.push({
      id: "actions",
      header: t("publicHolidays.actions.columnHeader"),
      cell: ({ row }) => {
        // Holiday scope 'global' (hệ thống) KHÔNG sửa/xoá được — server chặn, ẨN nút ở FE tương ứng.
        const isCompanyScope = row.original.scope === "company";
        return (
          <div className="flex items-center gap-2">
            {onEdit && isCompanyScope && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(row.original)}
                data-testid="holiday-edit-btn"
              >
                <Pencil className="mr-1 h-3.5 w-3.5" />
                {t("publicHolidays.actions.edit")}
              </Button>
            )}
            {onDelete && isCompanyScope && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(row.original)}
                data-testid="holiday-delete-btn"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5 text-destructive" />
                {t("publicHolidays.actions.delete")}
              </Button>
            )}
          </div>
        );
      },
    });
  }
  return cols;
}

export function PublicHolidaysPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");

  const canView = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_HOLIDAY.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_HOLIDAY.resourceType,
  );
  const canManage = useCan(
    FOUNDATION_ENGINE_PAIRS.MANAGE_HOLIDAY.action,
    FOUNDATION_ENGINE_PAIRS.MANAGE_HOLIDAY.resourceType,
  );

  const year = useMemo(() => new Date().getFullYear(), []);
  const { data, isLoading, isError, refetch } = useHolidays({ year }, canView);
  const deleteMutation = useDeleteHoliday();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<HolidayView | null>(null);
  const [deleting, setDeleting] = useState<HolidayView | null>(null);

  const columns = useColumns(
    t,
    canManage ? (h) => setEditing(h) : null,
    canManage ? (h) => setDeleting(h) : null,
  );

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("publicHolidays.forbidden.title")}
          description={t("publicHolidays.forbidden.description")}
          data-testid="holidays-forbidden"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("publicHolidays.error.title")}
          description={t("publicHolidays.error.description")}
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
        title={t("publicHolidays.title")}
        description={t("publicHolidays.description")}
        icon={CalendarDays}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="holiday-create-btn">
              <Plus className="mr-2 h-4 w-4" />
              {t("publicHolidays.actions.create")}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("publicHolidays.empty.title")}
            description={t("publicHolidays.empty.description")}
          />
        }
      />

      {canManage && <HolidayFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />}
      {canManage && editing && (
        <HolidayFormDialog open onClose={() => setEditing(null)} holiday={editing} />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t("publicHolidays.confirmDelete.title")}
        description={t("publicHolidays.confirmDelete.description", {
          name: deleting?.name ?? "",
        })}
        confirmLabel={t("publicHolidays.confirmDelete.confirmLabel")}
        cancelLabel={t("publicHolidays.confirmDelete.cancelLabel")}
        destructive
        busy={deleteMutation.isPending}
        busyLabel={t("publicHolidays.confirmDelete.busyLabel")}
        onConfirm={() => {
          if (!deleting) return;
          deleteMutation.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
