import {
  type ColumnDef,
  type VisibilityState,
  type GroupingState,
  type SortingState,
  type OnChangeFn,
  type Row,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "./skeleton";
import { cn } from "../../lib/utils";

// Khi GOM NHÓM: hiển thị TẤT CẢ hàng (leaf + group-header) trên MỘT trang client — grouping áp trên
// trang server ĐÃ tải, KHÔNG để phân trang client cắt ngang một nhóm. (Server-pagination giữ nguyên ở
// tầng trên; DataTable chỉ nhận 1 trang.)
const GROUPED_PAGE_SIZE = 100_000;

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
  /** Ẩn/hiện cột (controlled) — key = column id/accessorKey. Không truyền = hiện tất cả. */
  columnVisibility?: VisibilityState;
  /** Click 1 dòng (vd điều hướng sang chi tiết). Có truyền → row đổi cursor-pointer. */
  onRowClick?: (row: TData) => void;
  /**
   * GOM NHÓM (controlled) — mảng column id gom nhóm 1–2 cấp (TanStack getGroupedRowModel). Có truyền →
   * bảng render hàng group-header (thu/gọn được + đếm số hàng con) trên trang đã tải. Cột phải đặt
   * `enableGrouping` (mặc định TanStack = true). Không truyền = không gom nhóm (hành vi cũ nguyên vẹn).
   */
  grouping?: GroupingState;
  onGroupingChange?: OnChangeFn<GroupingState>;
  /**
   * SẮP XẾP SERVER (manual-mode) — khi truyền `onSortingChange`, bảng KHÔNG tự sắp; header cột sortable
   * (column.enableSorting !== false) hiện affordance click → phát sort-key + direction ra ngoài để gọi
   * lại API. `sorting` là state hiện tại (để vẽ mũi tên asc/desc). Không truyền = không có UI sắp xếp.
   */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /**
   * GHIM CỘT (v1.1 — UI-07 §12.4). Cột ĐẦU (Identity) ghim TRÁI / cột CUỐI (Actions) ghim PHẢI: bảng
   * rộng cuộn ngang thì hai cột này đứng yên, người dùng không mất dấu «dòng này là ai».
   *
   * ⚠️ Ô ghim phải có nền ĐỤC, nếu không nội dung cuộn qua sẽ hiện xuyên bên dưới. Cách làm ở đây:
   * khi bật ghim, `<tr>` đổi sang nền đục (`bg-card` / hover `bg-accent`, `bg-muted` cho header) và ô
   * ghim dùng `bg-inherit` để ăn ĐÚNG màu của hàng — kể cả lúc hover. Không bật ghim thì mọi class
   * giữ NGUYÊN như trước (`bg-muted/50` · `hover:bg-muted/40`), nên mọi bảng HR/ATT/LEAVE/TASK hiện
   * có render y hệt.
   */
  pinFirstColumn?: boolean;
  pinLastColumn?: boolean;
  /**
   * Footer tuỳ biến dưới bảng (thường là `TableFooter` cho phân trang SERVER — UI-07 §12.3). Có
   * truyền thì phân trang CLIENT sẵn có không render (hai bộ điều khiển trang chồng nhau là lỗi).
   */
  footer?: React.ReactNode;
}

/**
 * Bảng dữ liệu dùng chung (TanStack Table v8 headless) — style house Slate-Corporate.
 * Tích hợp sẵn: filter tự do, phân trang client-side, skeleton loading, empty state.
 * HR-PROFILE-UI-2: thêm gom nhóm (getGroupedRowModel + getExpandedRowModel, group-header thu/gọn +
 * đếm) và sắp-xếp-server (manual-mode header click) — additive, KHÔNG lib bảng mới.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  globalFilter = "",
  emptyState,
  pageSize = 10,
  columnVisibility,
  onRowClick,
  grouping,
  onGroupingChange,
  sorting,
  onSortingChange,
  pinFirstColumn = false,
  pinLastColumn = false,
  footer,
}: DataTableProps<TData, TValue>) {
  const { t } = useTranslation("common");
  const isGrouping = (grouping?.length ?? 0) > 0;
  const isManualSort = onSortingChange !== undefined;
  // Gom nhóm trải hàng group-header qua MỌI cột ⇒ không còn "cột đầu/cuối" để ghim. Tắt ghim khi gom.
  const isPinning = (pinFirstColumn || pinLastColumn) && !isGrouping;

  const table = useReactTable({
    data,
    columns,
    state: {
      globalFilter,
      ...(columnVisibility ? { columnVisibility } : {}),
      ...(grouping ? { grouping } : {}),
      ...(sorting ? { sorting } : {}),
    },
    ...(onGroupingChange ? { onGroupingChange } : {}),
    ...(onSortingChange ? { onSortingChange } : {}),
    // Sắp xếp là việc của SERVER khi có onSortingChange → không sắp lại ở client (chỉ phát sự kiện).
    manualSorting: isManualSort,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // Nhóm mặc định MỞ; không tự reset khi data đổi (giữ trạng thái thu/gọn của người dùng).
    autoResetExpanded: false,
    initialState: {
      pagination: { pageSize: isGrouping ? GROUPED_PAGE_SIZE : pageSize },
      expanded: true,
    },
  });

  // Khi GOM NHÓM đổi lúc runtime → đồng bộ pageSize (bơm to lúc gom, trả prop khi thôi gom). Guard so-sánh
  // để KHÔNG setState thừa ở mount (initialState đã đúng) — tránh cảnh báo act() và re-render vô ích.
  React.useEffect(() => {
    const desired = isGrouping ? GROUPED_PAGE_SIZE : pageSize;
    if (table.getState().pagination.pageSize !== desired) {
      table.setPageSize(desired);
    }
  }, [isGrouping, pageSize, table]);

  const rows = table.getRowModel().rows;
  // colSpan theo cột ĐANG hiển thị — không dùng columns.length (sai khi có cột bị ẩn).
  const colSpan = table.getVisibleLeafColumns().length;
  const totalRows = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;
  const from = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(from + pageSize - 1, totalRows);
  // Không hiện phân trang client khi đang gom nhóm (tất cả trên 1 trang) hoặc khi ít hơn 1 trang.
  const showPagination = !isGrouping && totalRows > pageSize && footer === undefined;

  /** Class ghim cho ô ở vị trí `index` trong hàng có `count` ô hiển thị. */
  const pinClass = (index: number, count: number): string | undefined => {
    if (!isPinning) return undefined;
    if (pinFirstColumn && index === 0) {
      return "sticky left-0 z-10 bg-inherit border-r border-border";
    }
    if (pinLastColumn && index === count - 1) {
      return "sticky right-0 z-10 bg-inherit border-l border-border";
    }
    return undefined;
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr
              className={cn(
                "border-b border-border text-left",
                // Nền ĐỤC khi ghim (ô ghim `bg-inherit` ăn theo) — ngoài ra giữ nguyên bản cũ.
                isPinning ? "bg-muted" : "bg-muted/50",
              )}
            >
              {table.getHeaderGroups()[0]?.headers.map((header, index, all) => {
                const canSort = isManualSort && header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={cn(
                      "px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                      pinClass(index, all.length),
                    )}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground"
                        data-testid={`sort-${header.column.id}`}
                        aria-label={t("sort.by", {
                          defaultValue: "Sắp xếp theo cột",
                        })}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortIndicator dir={sortDir} />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
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
                    <p className="py-12 text-center text-sm text-muted-foreground">{t("noData")}</p>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) =>
                row.getIsGrouped() ? (
                  <GroupHeaderRow key={row.id} row={row} colSpan={colSpan} />
                ) : (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={cn(
                      "border-b border-border transition-colors last:border-0",
                      isPinning ? "bg-card hover:bg-accent" : "hover:bg-muted/40",
                      onRowClick && "cursor-pointer",
                    )}
                  >
                    {row.getVisibleCells().map((cell, index, all) => (
                      <td
                        key={cell.id}
                        className={cn(
                          "px-4 py-3 align-middle",
                          isGrouping && "pl-8",
                          pinClass(index, all.length),
                        )}
                      >
                        {cell.getIsPlaceholder()
                          ? null
                          : flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ),
              )
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

      {footer !== undefined && <div className="border-t border-border px-4 py-2.5">{footer}</div>}
    </div>
  );
}

/** Mũi tên chỉ chiều sắp xếp: không sắp → 2 chiều mờ; asc → lên; desc → xuống. */
function SortIndicator({ dir }: { dir: false | "asc" | "desc" }) {
  if (dir === "asc") return <ChevronUp className="h-3.5 w-3.5" aria-hidden />;
  if (dir === "desc") return <ChevronDown className="h-3.5 w-3.5" aria-hidden />;
  return <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden />;
}

/**
 * Hàng tiêu đề nhóm (group-header) — thu/gọn được + đếm số hàng con (aggregation count). Trải hết cột;
 * thụt lề theo độ sâu nhóm (nhóm cấp 2 lồng trong cấp 1). Nhấn để expand/collapse.
 */
function GroupHeaderRow<TData>({ row, colSpan }: { row: Row<TData>; colSpan: number }) {
  const expanded = row.getIsExpanded();
  const value = row.getGroupingValue(row.groupingColumnId ?? "");
  const label = value === null || value === undefined || value === "" ? "—" : String(value);
  return (
    <tr className="border-b border-border bg-muted/40 last:border-0">
      <td colSpan={colSpan} className="px-2 py-2">
        <button
          type="button"
          onClick={row.getToggleExpandedHandler()}
          className="flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-brand"
          style={{ paddingLeft: `${row.depth * 1.25}rem` }}
          data-testid="group-header-toggle"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span>{label}</span>
          <span className="text-xs font-normal text-muted-foreground">({row.subRows.length})</span>
        </button>
      </td>
    </tr>
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
