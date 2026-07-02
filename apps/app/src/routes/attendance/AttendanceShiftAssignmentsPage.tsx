/**
 * AttendanceShiftAssignmentsPage — danh sách gán ca + CREATE tối thiểu (UI-02 §9.6
 * `/attendance/shift-assignments`, S3-FE-ATT-5).
 *
 * Nối S3-ATT-BE-3 (PR #69): GET/POST /attendance/shift-assignments. DTO thật (shiftAssignmentSchema) CHỈ có
 * shiftId (KHÔNG có shiftName) → cột "Ca" tra tên từ danh mục ca (nếu load được), fallback shiftId.
 * Gate xem: useCanExact('view','shift-assignment') — cặp is_sensitive → fail-closed. Gate tạo:
 * useCanExact('update','shift-assignment'). Sửa/xoá gán ca = carry-over CO-S4-007 (contract chỉ có POST).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { CalendarClock, RefreshCw, Plus } from "lucide-react";
import type { ShiftAssignmentDto } from "@mediaos/contracts";
import { useCan, useCanExact } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button } from "@mediaos/ui";
import { useShiftAssignments, useShifts } from "./hooks/useAttendanceAdmin";
import { ATT_ENGINE_PAIRS } from "./constants";
import { ShiftAssignmentFormDialog } from "./admin/ShiftAssignmentFormDialog";

function useColumns(
  t: ReturnType<typeof useTranslation<"attendance">>["t"],
  shiftLabel: (shiftId: string) => string,
): ColumnDef<ShiftAssignmentDto>[] {
  return [
    {
      id: "shift",
      header: t("shiftAssignments.columns.shift"),
      cell: ({ row }) => (
        <span className="text-sm font-medium">{shiftLabel(row.original.shiftId)}</span>
      ),
    },
    {
      accessorKey: "assignmentScope",
      header: t("shiftAssignments.columns.scope"),
      cell: ({ row }) => <span className="text-sm">{row.original.assignmentScope}</span>,
    },
    {
      id: "target",
      header: t("shiftAssignments.columns.target"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.employeeId ?? row.original.departmentId ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "effectiveFrom",
      header: t("shiftAssignments.columns.effectiveFrom"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.effectiveFrom}</span>,
    },
    {
      accessorKey: "effectiveTo",
      header: t("shiftAssignments.columns.effectiveTo"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.effectiveTo ?? "—"}</span>
      ),
    },
    {
      accessorKey: "priority",
      header: t("shiftAssignments.columns.priority"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.priority}</span>,
    },
    {
      accessorKey: "status",
      header: t("shiftAssignments.columns.status"),
      cell: ({ row }) => <span className="text-sm">{row.original.status}</span>,
    },
  ];
}

export function AttendanceShiftAssignmentsPage() {
  const { t } = useTranslation("attendance");

  // NHẠY CẢM: useCanExact — KHÔNG wildcard fallback (view/update:shift-assignment is_sensitive).
  const canView = useCanExact(
    ATT_ENGINE_PAIRS.SHIFT_ASSIGNMENT_VIEW.action,
    ATT_ENGINE_PAIRS.SHIFT_ASSIGNMENT_VIEW.resourceType,
  );
  const canCreate = useCanExact(
    ATT_ENGINE_PAIRS.SHIFT_ASSIGNMENT_UPDATE.action,
    ATT_ENGINE_PAIRS.SHIFT_ASSIGNMENT_UPDATE.resourceType,
  );
  // Danh mục ca cho select tạo gán ca + tra tên ca — chỉ load khi có quyền xem ca (BE gate view:shift).
  const canViewShift = useCan(
    ATT_ENGINE_PAIRS.SHIFT_VIEW.action,
    ATT_ENGINE_PAIRS.SHIFT_VIEW.resourceType,
  );

  const { data, isLoading, isError, refetch } = useShiftAssignments(canView);
  const { data: shifts } = useShifts(canView && canViewShift);

  const [createOpen, setCreateOpen] = useState(false);

  const shiftLabel = (shiftId: string): string => {
    const s = (shifts ?? []).find((x) => x.id === shiftId);
    return s ? `${s.shiftCode} — ${s.name}` : shiftId;
  };
  const columns = useColumns(t, shiftLabel);

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("shiftAssignments.forbidden.title")}
          description={t("shiftAssignments.forbidden.description")}
          data-testid="shift-assignments-forbidden"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("shiftAssignments.error.title")}
          description={t("shiftAssignments.error.description")}
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
        title={t("shiftAssignments.title")}
        description={t("shiftAssignments.description")}
        icon={CalendarClock}
        actions={
          canCreate ? (
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              data-testid="assignment-create-btn"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("shiftAssignments.actions.create")}
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
            title={t("shiftAssignments.empty.title")}
            description={t("shiftAssignments.empty.description")}
          />
        }
      />

      {canCreate && (
        <ShiftAssignmentFormDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          shifts={shifts ?? []}
        />
      )}
    </div>
  );
}
