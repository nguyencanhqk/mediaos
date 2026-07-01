/**
 * AttendanceShiftAssignmentsPage — danh sách gán ca (UI-02 §9.6 `/attendance/shift-assignments`,
 * S3-FE-ATT-5).
 *
 * Gate: useCanExact('view','shift-assignment') — cặp is_sensitive (attendance-permissions.const.ts) →
 * fail-closed, KHÔNG wildcard fallback (khớp BE @RequirePermission view:shift-assignment,
 * isSensitive=true). Read-only minimum — CRUD carry-over CO-S4-007. company_id do SERVER resolve.
 */
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { CalendarClock, RefreshCw } from "lucide-react";
import { useCanExact, type AttShiftAssignmentListItem } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button } from "@mediaos/ui";
import { useShiftAssignments } from "./hooks/useAttendanceAdmin";
import { ATT_ENGINE_PAIRS } from "./constants";

function useColumns(
  t: ReturnType<typeof useTranslation<"attendance">>["t"],
): ColumnDef<AttShiftAssignmentListItem>[] {
  return [
    {
      id: "shift",
      header: t("shiftAssignments.columns.shift"),
      cell: ({ row }) => (
        <span className="text-sm font-medium">
          {row.original.shiftName ?? row.original.shiftId}
        </span>
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

  // NHẠY CẢM: useCanExact — KHÔNG wildcard fallback (view:shift-assignment is_sensitive).
  const canView = useCanExact(
    ATT_ENGINE_PAIRS.SHIFT_ASSIGNMENT_VIEW.action,
    ATT_ENGINE_PAIRS.SHIFT_ASSIGNMENT_VIEW.resourceType,
  );

  const { data, isLoading, isError, refetch } = useShiftAssignments(canView);
  const columns = useColumns(t);

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
    </div>
  );
}
