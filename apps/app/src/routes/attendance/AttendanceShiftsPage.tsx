/**
 * AttendanceShiftsPage — danh mục ca làm việc (UI-02 §9.6 `/attendance/shifts`, S3-FE-ATT-5).
 *
 * Gate: useCan('view','shift') — cặp KHÔNG sensitive (attendance-permissions.const.ts) nên wildcard
 * (vd `*:shift`, `*:*`) vẫn hợp lệ, khớp hành vi BE (@RequirePermission view:shift, isSensitive=false).
 * Read-only minimum: list only — CRUD (create/update/delete) carry-over CO-S4-007 (giữ tối thiểu, xem
 * done_when S3-FE-ATT-5 + harness/backlog.mjs). Masking là việc server; danh mục nhỏ theo company
 * (KHÔNG phân trang server) — DataTable tự phân trang client-side.
 *
 * BE-3 (S3-ATT-BE-3) CHƯA build (harness/backlog.mjs status=todo) lúc viết lane này: query có thể trả
 * lỗi mạng/404 tới khi BE land — trạng thái error EmptyState phủ đúng nhánh này.
 */
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { Clock, RefreshCw } from "lucide-react";
import { useCan, type AttShiftListItem } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button } from "@mediaos/ui";
import { useShifts } from "./hooks/useAttendanceAdmin";
import { ATT_ENGINE_PAIRS } from "./constants";

function useColumns(
  t: ReturnType<typeof useTranslation<"attendance">>["t"],
): ColumnDef<AttShiftListItem>[] {
  return [
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
        <span className="text-sm tabular-nums">{row.original.requiredWorkingMinutes ?? "—"}</span>
      ),
    },
    {
      accessorKey: "status",
      header: t("shifts.columns.status"),
      cell: ({ row }) => <span className="text-sm">{row.original.status}</span>,
    },
  ];
}

export function AttendanceShiftsPage() {
  const { t } = useTranslation("attendance");

  // KHÔNG sensitive — useCan (cho phép wildcard fallback, khớp BE isSensitive=false).
  const canView = useCan(
    ATT_ENGINE_PAIRS.SHIFT_VIEW.action,
    ATT_ENGINE_PAIRS.SHIFT_VIEW.resourceType,
  );

  const { data, isLoading, isError, refetch } = useShifts(canView);
  const columns = useColumns(t);

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
      <PageHeader title={t("shifts.title")} description={t("shifts.description")} icon={Clock} />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState title={t("shifts.empty.title")} description={t("shifts.empty.description")} />
        }
      />
    </div>
  );
}
