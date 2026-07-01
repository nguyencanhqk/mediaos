/**
 * AttendanceShiftsPage — danh mục ca làm việc + CRUD tối thiểu (UI-02 §9.6 `/attendance/shifts`, S3-FE-ATT-5).
 *
 * Nối S3-ATT-BE-3 (PR #69): GET/POST /attendance/shifts + PATCH /attendance/shifts/:id.
 * Gate xem: useCan('view','shift') — cặp KHÔNG sensitive (attendance-permissions.const.ts) nên wildcard OK,
 * khớp BE @RequirePermission view:shift (isSensitive=false). Gate tạo/sửa: useCan create/update:shift (cặp
 * is_sensitive) → nút chỉ hiện khi có quyền; BE vẫn là cổng thật. Advanced admin = carry-over CO-S4-007.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { Clock, RefreshCw, Plus, Pencil } from "lucide-react";
import type { ShiftDto } from "@mediaos/contracts";
import { useCan } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button } from "@mediaos/ui";
import { useShifts } from "./hooks/useAttendanceAdmin";
import { ATT_ENGINE_PAIRS } from "./constants";
import { ShiftFormDialog } from "./admin/ShiftFormDialog";

function useColumns(
  t: ReturnType<typeof useTranslation<"attendance">>["t"],
  onEdit: ((shift: ShiftDto) => void) | null,
): ColumnDef<ShiftDto>[] {
  const cols: ColumnDef<ShiftDto>[] = [
    {
      accessorKey: "shiftCode",
      header: t("shifts.columns.code"),
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.shiftCode}</span>,
    },
    {
      accessorKey: "name",
      header: t("shifts.columns.name"),
      cell: ({ row }) => <span className="text-sm">{row.original.name}</span>,
    },
    {
      accessorKey: "shiftType",
      header: t("shifts.columns.type"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.shiftType}</span>
      ),
    },
    {
      id: "time",
      header: t("shifts.columns.time"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.startTime && row.original.endTime
            ? `${row.original.startTime} — ${row.original.endTime}`
            : "—"}
        </span>
      ),
    },
    {
      accessorKey: "requiredWorkingMinutes",
      header: t("shifts.columns.requiredMinutes"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.requiredWorkingMinutes}</span>
      ),
    },
    {
      accessorKey: "status",
      header: t("shifts.columns.status"),
      cell: ({ row }) => <span className="text-sm">{row.original.status}</span>,
    },
  ];
  if (onEdit) {
    cols.push({
      id: "actions",
      header: t("shifts.actions.columnHeader"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(row.original)}
          data-testid="shift-edit-btn"
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          {t("shifts.actions.edit")}
        </Button>
      ),
    });
  }
  return cols;
}

export function AttendanceShiftsPage() {
  const { t } = useTranslation("attendance");

  // KHÔNG sensitive — useCan (cho phép wildcard fallback, khớp BE isSensitive=false).
  const canView = useCan(
    ATT_ENGINE_PAIRS.SHIFT_VIEW.action,
    ATT_ENGINE_PAIRS.SHIFT_VIEW.resourceType,
  );
  const canCreate = useCan(
    ATT_ENGINE_PAIRS.SHIFT_CREATE.action,
    ATT_ENGINE_PAIRS.SHIFT_CREATE.resourceType,
  );
  const canUpdate = useCan(
    ATT_ENGINE_PAIRS.SHIFT_UPDATE.action,
    ATT_ENGINE_PAIRS.SHIFT_UPDATE.resourceType,
  );

  const { data, isLoading, isError, refetch } = useShifts(canView);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftDto | null>(null);
  const columns = useColumns(t, canUpdate ? (s) => setEditing(s) : null);

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("shifts.forbidden.title")}
          description={t("shifts.forbidden.description")}
          data-testid="shifts-forbidden"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("shifts.error.title")}
          description={t("shifts.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
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
        title={t("shifts.title")}
        description={t("shifts.description")}
        icon={Clock}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="shift-create-btn">
              <Plus className="mr-2 h-4 w-4" />
              {t("shifts.actions.create")}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState title={t("shifts.empty.title")} description={t("shifts.empty.description")} />
        }
      />

      {canCreate && <ShiftFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />}
      {canUpdate && editing && (
        <ShiftFormDialog open onClose={() => setEditing(null)} shift={editing} />
      )}
    </div>
  );
}
