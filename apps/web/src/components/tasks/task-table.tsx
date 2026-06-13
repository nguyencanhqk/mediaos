import { useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import type { TaskDto } from "@mediaos/contracts";
import { OfficeTaskStatus } from "./office-task-status";
import {
  TASK_STATUS_COLORS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  isShortenedFlowTask,
} from "./task-status-constants";

/**
 * Table view (G9-3) — TanStack Table v8 headless (pattern channel-table.tsx). Sort theo cột.
 * Cột "Trạng thái": office/non-workflow → control luồng rút gọn; workflow-task → badge read-only.
 */
interface TaskTableProps {
  tasks: TaskDto[];
}

const columnHelper = createColumnHelper<TaskDto>();

export function TaskTable({ tasks }: TaskTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("title", {
        header: "Công việc",
        cell: (ctx) => <span className="font-medium">{ctx.getValue()}</span>,
      }),
      columnHelper.accessor("taskType", {
        header: "Loại",
        cell: (ctx) => TASK_TYPE_LABELS[ctx.getValue()],
      }),
      columnHelper.accessor((row) => row.projectName ?? row.contentTitle ?? "—", {
        id: "context",
        header: "Bối cảnh",
      }),
      columnHelper.accessor("status", {
        header: "Trạng thái",
        cell: (ctx) => {
          const task = ctx.row.original;
          if (isShortenedFlowTask(task)) return <OfficeTaskStatus task={task} />;
          return (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${TASK_STATUS_COLORS[task.status]}`}
            >
              {TASK_STATUS_LABELS[task.status]}
            </span>
          );
        },
      }),
      columnHelper.accessor((row) => row.dueDate ?? "", {
        id: "dueDate",
        header: "Hạn",
        cell: (ctx) => {
          const v = ctx.getValue();
          return v ? new Date(v).toLocaleDateString("vi-VN") : "—";
        },
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: tasks,
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
            <tr
              key={row.id}
              data-testid={`task-row-${row.original.id}`}
              className="border-b border-border last:border-0 hover:bg-muted/30"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-2.5">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                Không có công việc nào.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
