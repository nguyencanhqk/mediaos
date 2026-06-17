import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AdjustmentRequestDto } from "@mediaos/contracts";
import { attendanceApi } from "@/lib/attendance-api";
import { PermissionGate } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import {
  HR_REQUEST_STATUS_COLORS,
  HR_REQUEST_STATUS_LABELS,
  formatDateFull,
  formatTime,
} from "./constants";

interface Props {
  requests: AdjustmentRequestDto[];
  /** Whether the current user can approve/reject (approve permission). */
  canApprove: boolean;
}

const col = createColumnHelper<AdjustmentRequestDto>();

export function AdjustmentTable({ requests, canApprove }: Props) {
  const { t } = useTranslation("hr");
  const qc = useQueryClient();

  const approve = useMutation({
    mutationFn: (id: string) => attendanceApi.approveAdjustment(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["attendance", "adjustments"] }),
  });

  const reject = useMutation({
    mutationFn: (id: string) => attendanceApi.rejectAdjustment(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["attendance", "adjustments"] }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => attendanceApi.cancelAdjustment(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["attendance", "adjustments"] }),
  });

  const columns = useMemo(
    () => [
      col.accessor("workDate", {
        header: t("adjustmentTable.colDate"),
        cell: (ctx) => formatDateFull(ctx.getValue()),
      }),
      col.accessor("requestedCheckInAt", {
        header: t("adjustmentTable.colCheckInRequested"),
        cell: (ctx) => (
          <span className="tabular-nums">{formatTime(ctx.getValue())}</span>
        ),
      }),
      col.accessor("requestedCheckOutAt", {
        header: t("adjustmentTable.colCheckOutRequested"),
        cell: (ctx) => (
          <span className="tabular-nums">{formatTime(ctx.getValue())}</span>
        ),
      }),
      col.accessor("reason", {
        header: t("adjustmentTable.colReason"),
        cell: (ctx) => (
          <span className="max-w-xs truncate block text-sm">{ctx.getValue()}</span>
        ),
      }),
      col.accessor("status", {
        header: t("adjustmentTable.colStatus"),
        cell: (ctx) => {
          const v = ctx.getValue();
          return (
            <span className={`text-sm font-medium ${HR_REQUEST_STATUS_COLORS[v]}`}>
              {HR_REQUEST_STATUS_LABELS[v]}
            </span>
          );
        },
      }),
      col.accessor("reviewNote", {
        header: t("adjustmentTable.colReviewNote"),
        cell: (ctx) => (
          <span className="text-sm text-muted-foreground">{ctx.getValue() ?? "—"}</span>
        ),
      }),
      col.display({
        id: "actions",
        header: t("adjustmentTable.colActions"),
        cell: (ctx) => {
          const row = ctx.row.original;
          const isLoading =
            (approve.isPending && approve.variables === row.id) ||
            (reject.isPending && reject.variables === row.id) ||
            (cancel.isPending && cancel.variables === row.id);

          return (
            <div className="flex gap-2">
              {canApprove && row.status === "pending" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isLoading}
                    onClick={() => approve.mutate(row.id)}
                  >
                    {t("adjustmentTable.approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isLoading}
                    onClick={() => reject.mutate(row.id)}
                  >
                    {t("adjustmentTable.reject")}
                  </Button>
                </>
              )}
              {row.status === "pending" && !canApprove && (
                <PermissionGate action="adjust" resourceType="attendance">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isLoading}
                    onClick={() => cancel.mutate(row.id)}
                  >
                    {t("adjustmentTable.cancel")}
                  </Button>
                </PermissionGate>
              )}
            </div>
          );
        },
      }),
    ],
    [t, canApprove, approve, reject, cancel],
  );

  const table = useReactTable({
    data: requests,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (requests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        {t("adjustmentTable.empty")}
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
