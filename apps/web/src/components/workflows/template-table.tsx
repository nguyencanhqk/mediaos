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
import { useTranslation } from "react-i18next";
import type { TemplateDto } from "@/lib/workflow-builder/contract";
import { Button } from "@/components/ui/button";
import { TemplateStatusBadge } from "./template-status-badge";
import { appliesToLabel } from "./constants";

interface TemplateTableProps {
  templates: TemplateDto[];
  canDelete: boolean;
  onDelete: (template: TemplateDto) => void;
  deletingId?: string | null;
}

const columnHelper = createColumnHelper<TemplateDto>();

export function TemplateTable({ templates, canDelete, onDelete, deletingId }: TemplateTableProps) {
  const { t } = useTranslation("workflows");
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: t("templates.table.colName"),
        cell: (ctx) => (
          <Link
            to="/workflows/templates/$templateId"
            params={{ templateId: ctx.row.original.id }}
            className="font-medium text-primary hover:underline"
          >
            {ctx.getValue()}
          </Link>
        ),
      }),
      columnHelper.accessor("code", { header: t("templates.table.colCode") }),
      columnHelper.accessor((row) => appliesToLabel(row.appliesTo), {
        id: "appliesTo",
        header: t("templates.table.colAppliesTo"),
      }),
      columnHelper.accessor("status", {
        header: t("templates.table.colStatus"),
        cell: (ctx) => (
          <TemplateStatusBadge status={ctx.getValue()} version={ctx.row.original.version} />
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: () => null,
        cell: (ctx) =>
          canDelete && ctx.row.original.status === "draft" ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(ctx.row.original)}
              disabled={deletingId === ctx.row.original.id}
            >
              {t("templates.table.deleteBtn")}
            </Button>
          ) : null,
      }),
    ],
    [canDelete, deletingId, onDelete, t],
  );

  const table = useReactTable({
    data: templates,
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
