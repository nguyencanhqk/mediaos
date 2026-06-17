import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import type { AttendanceRecordDto } from "@mediaos/contracts";
import {
  ATTENDANCE_STATUS_COLORS,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_METHOD_LABELS,
  formatDate,
  formatTime,
} from "./constants";

interface Props {
  records: AttendanceRecordDto[];
}

const col = createColumnHelper<AttendanceRecordDto>();

/**
 * Bảng chấm công tháng — hiển thị ngày, giờ vào/ra, trạng thái, ghi chú.
 */
export function AttendanceMonthlyTable({ records }: Props) {
  const { t } = useTranslation("hr");

  const columns = useMemo(
    () => [
      col.accessor("workDate", {
        header: t("attendanceMonthlyTable.colDate"),
        cell: (ctx) => formatDate(ctx.getValue()),
      }),
      col.accessor("status", {
        header: t("attendanceMonthlyTable.colStatus"),
        cell: (ctx) => {
          const v = ctx.getValue();
          return (
            <span className={`text-sm font-medium ${ATTENDANCE_STATUS_COLORS[v]}`}>
              {ATTENDANCE_STATUS_LABELS[v]}
            </span>
          );
        },
      }),
      col.accessor("checkInAt", {
        header: t("attendanceMonthlyTable.colCheckIn"),
        cell: (ctx) => (
          <span className="tabular-nums">{formatTime(ctx.getValue())}</span>
        ),
      }),
      col.accessor("checkOutAt", {
        header: t("attendanceMonthlyTable.colCheckOut"),
        cell: (ctx) => (
          <span className="tabular-nums">{formatTime(ctx.getValue())}</span>
        ),
      }),
      col.accessor("checkInMethod", {
        header: t("attendanceMonthlyTable.colMethod"),
        cell: (ctx) => {
          const v = ctx.getValue();
          return v ? ATTENDANCE_METHOD_LABELS[v] : "—";
        },
      }),
      col.accessor("lateMinutes", {
        header: t("attendanceMonthlyTable.colLate"),
        cell: (ctx) => {
          const v = ctx.getValue();
          return v > 0 ? (
            <span className="text-orange-500 tabular-nums">{v}</span>
          ) : (
            <span className="text-muted-foreground">0</span>
          );
        },
      }),
      col.accessor("earlyLeaveMinutes", {
        header: t("attendanceMonthlyTable.colEarlyLeave"),
        cell: (ctx) => {
          const v = ctx.getValue();
          return v > 0 ? (
            <span className="text-yellow-600 tabular-nums">{v}</span>
          ) : (
            <span className="text-muted-foreground">0</span>
          );
        },
      }),
      col.accessor("note", {
        header: t("attendanceMonthlyTable.colNote"),
        cell: (ctx) => (
          <span className="text-muted-foreground text-sm">{ctx.getValue() ?? "—"}</span>
        ),
      }),
    ],
    [t],
  );

  const table = useReactTable({
    data: records,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (records.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        {t("attendanceMonthlyTable.empty")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap"
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-border">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/20">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 whitespace-nowrap">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
