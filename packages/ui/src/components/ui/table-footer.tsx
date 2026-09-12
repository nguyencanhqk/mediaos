import { useTranslation } from "react-i18next";
import { PaginationFooter } from "./pagination-footer";
import { Select } from "./select";
import { cn } from "../../lib/utils";

/**
 * `TableFooter` — một dòng dưới bảng: **«Tổng số N» · «Số dòng/trang» · «1–N»** + điều hướng trang
 * (UI-07 §12.3/§12.4 v1.1, DEC-020).
 *
 * ⚠️ **`total` phải đến từ `meta.total` của API, KHÔNG phải `rows.length` của trang hiện tại.** Khi
 * API trả mảng trần không kèm pagination thì truyền `total={null}` — footer nói «không rõ tổng» chứ
 * **không bịa số** (`apifetch-drops-pagination-bare-array`). Đó là lý do prop nhận `null` tường minh
 * thay vì `?? 0` ở chỗ gọi.
 *
 * ⚠️ Dải «1–N» tính từ **trang + kích thước trang**, không từ độ dài mảng trả về — nên component tự
 * tính, chỗ gọi không truyền `from`/`to`. Trang CUỐI bị kẹp theo `total` (trang 7 của 128 bản ghi với
 * 20 dòng/trang là «121–128», không phải «121–140»).
 *
 * Điều hướng tái dùng `PaginationFooter` (S14-FE-DEBT-1) — KHÔNG chép lại cặp nút prev/next lần thứ hai.
 */

export interface TableFooterProps {
  /** Trang hiện tại, 1-based. */
  page: number;
  /** Số dòng mỗi trang. */
  pageSize: number;
  /** Tổng bản ghi từ `meta.total`. `null`/`undefined` = server KHÔNG trả tổng ⇒ hiện «không rõ tổng». */
  total?: number | null;
  onPageChange: (next: (prev: number) => number) => void;
  /** Có truyền ⇒ hiện bộ chọn «Số dòng/trang». */
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  /** Ép chiều tiến khi server chỉ trả `hasNext` (không có tổng). */
  hasNext?: boolean;
  /** Đang tải trang mới — khoá điều khiển, KHÔNG ẩn footer (tránh giật bố cục). */
  disabled?: boolean;
  className?: string;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export function TableFooter({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  hasNext,
  disabled = false,
  className,
}: TableFooterProps) {
  const { t } = useTranslation("common");
  const knownTotal = typeof total === "number";
  const totalPages = knownTotal ? Math.max(1, Math.ceil(total / pageSize)) : undefined;

  // Dải hiển thị: suy từ trang, KẸP theo tổng. Tổng = 0 ⇒ không có dải nào để nói.
  const from = knownTotal && total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = knownTotal ? Math.min(page * pageSize, total) : page * pageSize;

  // Bộ chọn dòng/trang chỉ liệt kê giá trị hợp lệ + giá trị ĐANG dùng (server có thể trả per_page
  // ngoài danh sách; bỏ nó đi thì `<select>` hiện sai giá trị đang áp).
  const sizes = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, pageSize];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-1 py-1 text-sm text-muted-foreground",
        className,
      )}
      data-slot="table-footer"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span data-testid="table-footer-total">
          {/* Cố ý KHÔNG dùng biến `count`: i18next coi `count` là khoá SỐ NHIỀU và đi tìm
              `table.total_other` trước — tiếng Việt không có dạng số nhiều nên đó là một lượt tra
              khoá không tồn tại. `total` là biến thường. */}
          {knownTotal
            ? t("table.total", { total, defaultValue: "Tổng số {{total}}" })
            : t("table.totalUnknown", { defaultValue: "Không rõ tổng" })}
        </span>

        {onPageSizeChange && (
          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap">
              {t("table.pageSize", { defaultValue: "Số dòng/trang" })}
            </span>
            <Select
              className="h-8 w-[4.5rem] py-1 text-sm"
              value={String(pageSize)}
              disabled={disabled}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label={t("table.pageSize", { defaultValue: "Số dòng/trang" })}
              data-testid="table-footer-page-size"
            >
              {[...sizes]
                .sort((a, b) => a - b)
                .map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
            </Select>
          </label>
        )}

        {(!knownTotal || total > 0) && (
          <span className="tabular-nums" data-testid="table-footer-range">
            {t("pagination.rangeShort", { from, to, defaultValue: "{{from}}–{{to}}" })}
          </span>
        )}
      </div>

      <PaginationFooter
        page={page}
        totalPages={totalPages}
        hasNext={hasNext}
        disabled={disabled}
        onPageChange={onPageChange}
        className="gap-2 px-0"
      />
    </div>
  );
}
