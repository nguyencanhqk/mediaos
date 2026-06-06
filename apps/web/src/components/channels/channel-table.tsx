import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import type { ChannelDto, EmployeeListItemDto } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import {
  CHANNEL_STATUS_LABELS,
  HEALTH_COLORS,
  HEALTH_LABELS,
  PLATFORM_LABELS,
} from "./constants";

interface ChannelTableProps {
  channels: ChannelDto[];
  employees: EmployeeListItemDto[];
  canDelete: boolean;
  onDelete: (channel: ChannelDto) => void;
  deletingId?: string | null;
}

const columnHelper = createColumnHelper<ChannelDto>();

export function ChannelTable({
  channels,
  employees,
  canDelete,
  onDelete,
  deletingId,
}: ChannelTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const managerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.userId, e.userFullName ?? e.userEmail ?? e.userId);
    return map;
  }, [employees]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Tên kênh",
        cell: (ctx) => (
          <Link
            to="/channels/$channelId"
            params={{ channelId: ctx.row.original.id }}
            className="font-medium text-primary hover:underline"
          >
            {ctx.getValue()}
          </Link>
        ),
      }),
      columnHelper.accessor("platform", {
        header: "Nền tảng",
        cell: (ctx) => PLATFORM_LABELS[ctx.getValue()],
      }),
      columnHelper.accessor((row) => row.niche ?? "—", { id: "niche", header: "Niche" }),
      columnHelper.accessor(
        (row) => (row.channelManagerId ? managerName.get(row.channelManagerId) ?? "—" : "—"),
        { id: "manager", header: "Manager" },
      ),
      columnHelper.accessor("healthStatus", {
        header: "Health",
        cell: (ctx) => {
          const h = ctx.getValue();
          return h ? (
            <span className={HEALTH_COLORS[h]}>{HEALTH_LABELS[h]}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      }),
      columnHelper.accessor("status", {
        header: "Trạng thái",
        cell: (ctx) => CHANNEL_STATUS_LABELS[ctx.getValue()],
      }),
      columnHelper.display({
        id: "actions",
        header: () => null,
        cell: (ctx) =>
          canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(ctx.row.original)}
              disabled={deletingId === ctx.row.original.id}
            >
              Xoá
            </Button>
          ) : null,
      }),
    ],
    [canDelete, deletingId, managerName, onDelete],
  );

  const table = useReactTable({
    data: channels,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                return (
                  <th
                    key={header.id}
                    className="px-4 py-2 text-left font-medium text-muted-foreground"
                  >
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className={canSort ? "flex items-center gap-1" : "cursor-default"}
                        onClick={header.column.getToggleSortingHandler()}
                        disabled={!canSort}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" ? " ↑" : sorted === "desc" ? " ↓" : ""}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-2.5">
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
