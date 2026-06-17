import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Hiển thị skeleton thay cho dữ liệu khi đang tải. */
  isLoading?: boolean;
  /** Filter tự do (controlled từ ngoài) — lọc trên mọi cột text/số. */
  globalFilter?: string;
  /** Nội dung khi không có dòng nào (đã fetch xong). */
  emptyState?: React.ReactNode;
  /** Số dòng mỗi trang (mặc định 10). */
  pageSize?: number;
}

/**
 * Bảng dữ liệu dùng chung (TanStack Table v8 headless) — style house Slate-Corporate.
 * Tích hợp sẵn: filter tự do, phân trang client-side, skeleton loading, empty state.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  globalFilter = "",
  emptyState,
  pageSize = 10,
}: DataTableProps<TData, TValue>) {
  const { t } = useTranslation("common");
  const table = useReactTable({
    data,
    columns,
    state: { globalFilter },
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const colSpan = columns.length;
  const totalRows = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;
  const from = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(from + pageSize - 1, totalRows);
  const showPagination = totalRows > pageSize;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left">
              {table.getHeaderGroups()[0]?.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {columns.map((_col, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <Skeleton className="h-4 w-full max-w-[160px]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="p-0">
                  {emptyState ?? (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                      {t("noData")}
                    </p>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showPagination && !isLoading && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {t("pagination.range", { from, to, total: totalRows })}
          </p>
          <div className="flex items-center gap-1">
            <PageButton
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              label={t("pagination.prev")}
            >
              <ChevronLeft className="h-4 w-4" />
            </PageButton>
            <PageButton
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              label={t("pagination.next")}
            >
              <ChevronRight className="h-4 w-4" />
            </PageButton>
          </div>
        </div>
      )}
    </div>
  );
}

function PageButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}
