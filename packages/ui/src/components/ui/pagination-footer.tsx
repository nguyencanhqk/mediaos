import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

export interface PaginationRange {
  /** Số thứ tự bản ghi ĐẦU của trang hiện tại (1-based). */
  from: number;
  /** Số thứ tự bản ghi CUỐI của trang hiện tại. */
  to: number;
  /** Tổng số bản ghi khớp bộ lọc. */
  total: number;
}

export interface PaginationFooterProps {
  /** Trang hiện tại, 1-based. */
  page: number;
  /** Tổng số trang. Bỏ trống khi server không trả tổng (chỉ có `hasNext`). */
  totalPages?: number;
  /**
   * Đổi trang. Nhận **hàm cập nhật** `(prev) => next` — khớp thẳng `Dispatch<SetStateAction<number>>`
   * của `useState`, nên 19 chỗ gọi truyền `setPage` là xong.
   *
   * Cố ý KHÔNG truyền giá trị tính sẵn từ prop `page`: prop là ảnh của lần render hiện tại, nên hai
   * cú nhấn nhanh trước khi React render lại sẽ cùng tính ra một số ⇒ cú thứ hai thành no-op câm.
   * 19 bản chép tay trước đây đều dùng functional updater; giữ đúng như vậy.
   */
  onPageChange: (next: (prev: number) => number) => void;
  /** Ép chiều lùi. Mặc định suy từ `page > 1`. Truyền khi server trả `meta.hasPrev`. */
  hasPrev?: boolean;
  /** Ép chiều tiến. Mặc định suy từ `page < totalPages`. Truyền khi server trả `meta.hasNext`. */
  hasNext?: boolean;
  /** Đang tải trang mới — tắt cả hai nút, KHÔNG ẩn footer (tránh giật bố cục). */
  disabled?: boolean;
  /** Dải bản ghi đang xem. Không truyền thì không render ô dải. */
  range?: PaginationRange | null;
  className?: string;
}

/**
 * Footer phân trang SERVER-side dùng chung (S14-FE-DEBT-1).
 *
 * Gộp 27 bản chép tay ở `apps/app` (10 hình dạng). `DataTable` đã có footer riêng cho phân trang
 * CLIENT-side (`table.previousPage()`); component này dành cho màn tự giữ state `page` rồi refetch.
 *
 * **Ẩn/hiện:** tự ẩn khi không còn chiều nào đi được. Ba khuôn guard cũ (`lastPage > 1` ·
 * `totalPages > 1` · `page > 1 || hasNext`) đều tương đương `hasPrev || hasNext`. Guard `!isLoading`
 * ở phía gọi thì GIỮ NGUYÊN tại chỗ gọi — nó nói về vòng tải đầu, không phải về số trang.
 *
 * **a11y:** nút mang `aria-label` lấy từ i18n. 10 bản cũ render trần `‹`/`›` nên trình đọc màn hình
 * đọc ra đúng ký tự đó; đây là lỗi thật chứ không chỉ là trùng lặp.
 */
export function PaginationFooter({
  page,
  totalPages,
  onPageChange,
  hasPrev,
  hasNext,
  disabled = false,
  range,
  className,
}: PaginationFooterProps) {
  const { t } = useTranslation("common");

  const canPrev = hasPrev ?? page > 1;
  const canNext = hasNext ?? (totalPages !== undefined && page < totalPages);

  // Không còn chiều nào đi được ⇒ footer không nói thêm được gì.
  if (!canPrev && !canNext) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground",
        className,
      )}
    >
      <span>{range ? t("pagination.range", { ...range }) : null}</span>
      <div className="flex items-center gap-2">
        <PageButton
          label={t("pagination.prev")}
          disabled={disabled || !canPrev}
          onClick={() => onPageChange((prev) => Math.max(1, prev - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </PageButton>
        {totalPages !== undefined && (
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
        )}
        <PageButton
          label={t("pagination.next")}
          disabled={disabled || !canNext}
          onClick={() =>
            onPageChange((prev) =>
              totalPages === undefined ? prev + 1 : Math.min(totalPages, prev + 1),
            )
          }
        >
          <ChevronRight className="h-4 w-4" />
        </PageButton>
      </div>
    </div>
  );
}

/** Nút tròn 1 chiều — cùng khuôn với nút phân trang của `DataTable`. */
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
