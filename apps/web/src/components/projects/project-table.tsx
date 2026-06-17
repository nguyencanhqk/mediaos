import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import type { EmployeeListItemDto, ProjectDto } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import {
  PROJECT_PRIORITY_COLORS,
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
} from "./constants";

interface ProjectTableProps {
  projects: ProjectDto[];
  employees: EmployeeListItemDto[];
  canDelete: boolean;
  onDelete: (project: ProjectDto) => void;
  deletingId?: string | null;
}

const columnHelper = createColumnHelper<ProjectDto>();

export function ProjectTable({
  projects,
  employees,
  canDelete,
  onDelete,
  deletingId,
}: ProjectTableProps) {
  const { t } = useTranslation("projects");
  const [sorting, setSorting] = useState<SortingState>([]);

  const managerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.userId, e.userFullName ?? e.userEmail ?? e.userId);
    return map;
  }, [employees]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: t("table.colName"),
        cell: (ctx) => (
          <Link
            to="/projects/$projectId"
            params={{ projectId: ctx.row.original.id }}
            className="font-medium text-primary hover:underline"
          >
            {ctx.getValue()}
          </Link>
        ),
      }),
      columnHelper.accessor((row) => row.code ?? "—", { id: "code", header: t("table.colCode") }),
      columnHelper.accessor(
        (row) => (row.projectType ? PROJECT_TYPE_LABELS[row.projectType] : "—"),
        { id: "type", header: t("table.colType") },
      ),
      columnHelper.accessor(
        (row) => (row.projectManagerId ? managerName.get(row.projectManagerId) ?? "—" : "—"),
        { id: "manager", header: t("table.colPM") },
      ),
      columnHelper.accessor("priority", {
        header: t("table.colPriority"),
        cell: (ctx) => {
          const p = ctx.getValue();
          return p ? (
            <span className={PROJECT_PRIORITY_COLORS[p]}>{PROJECT_PRIORITY_LABELS[p]}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      }),
      columnHelper.accessor((row) => row.channels?.length ?? 0, {
        id: "channels",
        header: t("table.colChannels"),
        cell: (ctx) => ctx.getValue(),
      }),
      columnHelper.accessor("status", {
        header: t("table.colStatus"),
        cell: (ctx) => PROJECT_STATUS_LABELS[ctx.getValue()],
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
              {t("table.deleteRow")}
            </Button>
          ) : null,
      }),
    ],
    [canDelete, deletingId, managerName, onDelete, t],
  );

  const table = useReactTable({
    data: projects,
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
