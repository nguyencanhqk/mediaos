import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Row-model factory ref ỔN ĐỊNH (module-level) — TanStack Table v8 khuyến nghị truyền ref bền,
// tránh khởi tạo lại pipeline + reset pagination khi parent re-render thường xuyên.
const CORE_ROW_MODEL = getCoreRowModel();
const PAGINATION_ROW_MODEL = getPaginationRowModel();

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Hiển thị skeleton rows khi đang tải. */
  loading?: boolean;
  /** Thông điệp khi không có dữ liệu (mặc định common:noData). */
  emptyMessage?: string;
  /** Bật phân trang client-side (mặc định bật). */
  pagination?: boolean;
  /** Kích thước trang khi bật phân trang. */
  pageSize?: number;
  className?: string;
}

/**
 * Bảng dữ liệu generic trên TanStack Table v8 (headless) — đúng tech-stack đã chốt
 * (CLAUDE.md §4: KHÔNG MUI X Pro/AG Grid). Lo skeleton + empty + phân trang client.
 * Filter/sort do lane sau cấu hình qua columns/state khi cần.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  loading = false,
  emptyMessage,
  pagination = true,
  pageSize = 20,
  className,
}: DataTableProps<TData, TValue>) {
  const { t } = useTranslation("common");
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: CORE_ROW_MODEL,
    ...(pagination
      ? { getPaginationRowModel: PAGINATION_ROW_MODEL, initialState: { pagination: { pageSize } } }
      : {}),
  });

  return (
    <div className={cn("space-y-3", className)}>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-3 py-2 text-left font-medium">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, rowIdx) => (
                <tr key={`skeleton-${rowIdx}`} className="border-b border-border last:border-0">
                  {columns.map((_col, colIdx) => (
                    <td key={colIdx} className="px-3 py-2">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-10 text-center text-muted-foreground"
                  role="status"
                >
                  {emptyMessage ?? t("noData")}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && !loading && table.getPageCount() > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            {t("pagination.prev")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {t("pagination.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
