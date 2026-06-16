import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { LeaveRequestDto } from "@mediaos/contracts";
import { leaveApi } from "@/lib/leave-api";
import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import {
  HR_REQUEST_STATUS_COLORS,
  HR_REQUEST_STATUS_LABELS,
  formatDateFull,
} from "./constants";

interface Props {
  requests: LeaveRequestDto[];
  canApprove: boolean;
}

const col = createColumnHelper<LeaveRequestDto>();

export function LeaveRequestTable({ requests, canApprove }: Props) {
  const { t } = useTranslation("hr");
  const qc = useQueryClient();

  const approve = useMutation({
    mutationFn: (id: string) => leaveApi.approveRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leave", "requests"] });
      void qc.invalidateQueries({ queryKey: ["leave", "balances"] });
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => leaveApi.rejectRequest(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["leave", "requests"] }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => leaveApi.cancelRequest(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["leave", "requests"] }),
  });

  const columns = useMemo(
    () => [
      col.accessor("leaveTypeName", {
        header: t("leaveRequestTable.colType"),
        cell: (ctx) => ctx.getValue() ?? "—",
      }),
      col.accessor("startDate", {
        header: t("leaveRequestTable.colStartDate"),
        cell: (ctx) => formatDateFull(ctx.getValue()),
      }),
      col.accessor("endDate", {
        header: t("leaveRequestTable.colEndDate"),
        cell: (ctx) => formatDateFull(ctx.getValue()),
      }),
      col.accessor("totalDays", {
        header: t("leaveRequestTable.colDays"),
        cell: (ctx) => (
          <span className="tabular-nums">{ctx.getValue()}</span>
        ),
      }),
      col.accessor("status", {
        header: t("leaveRequestTable.colStatus"),
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
        header: t("leaveRequestTable.colReviewNote"),
        cell: (ctx) => (
          <span className="text-sm text-muted-foreground">{ctx.getValue() ?? "—"}</span>
        ),
      }),
      col.display({
        id: "actions",
        header: t("leaveRequestTable.colActions"),
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
                    {t("leaveRequestTable.approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isLoading}
                    onClick={() => reject.mutate(row.id)}
                  >
                    {t("leaveRequestTable.reject")}
                  </Button>
                </>
              )}
              {row.status === "pending" && !canApprove && (
                <PermissionGate action="create" resourceType="leave">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isLoading}
                    onClick={() => cancel.mutate(row.id)}
                  >
                    {t("leaveRequestTable.cancel")}
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
        {t("leaveRequestTable.empty")}
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
