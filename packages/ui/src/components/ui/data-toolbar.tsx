import { Search } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Input } from "./input";
import { cn } from "../../lib/utils";

/**
 * `DataToolbar` — thanh công cụ CHUẨN trên mọi màn danh sách (UI-07 §10.4, DEC-020).
 *
 * Bố cục một hàng, xuống dòng được: [tìm kiếm] [các bộ lọc…] ······ [hành động phải: ⚙ chọn cột, …].
 *
 * Component KHÔNG tự giữ state và KHÔNG debounce: mỗi màn có kiểu gọi API riêng (có màn lọc client,
 * có màn refetch server theo `page`), gói debounce vào đây là áp một nhịp cho tất cả. Màn nào cần thì
 * tự debounce ở chỗ gọi.
 *
 * Ô tìm kiếm là **tuỳ chọn** — không truyền `onSearchChange` thì không render (màn chỉ có bộ lọc
 * chọn-sẵn không cần một ô trống vô dụng).
 */

export interface DataToolbarProps {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Nhãn cho trình đọc màn hình. Mặc định lấy `common.actions.search`. */
  searchLabel?: string;
  /** Bộ lọc (trạng thái · đơn vị · khoảng ngày · nút xoá lọc…). */
  children?: React.ReactNode;
  /** Cụm bên PHẢI — `ColumnPicker`, làm mới, đổi kiểu xem. */
  actions?: React.ReactNode;
  className?: string;
}

export function DataToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  children,
  actions,
  className,
}: DataToolbarProps) {
  const { t } = useTranslation("common");
  const label = searchLabel ?? t("actions.search");

  return (
    <div
      className={cn("flex flex-wrap items-center gap-3", className)}
      role="search"
      data-slot="data-toolbar"
    >
      {onSearchChange && (
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-9"
            value={search ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder ?? label}
            aria-label={label}
            data-testid="data-toolbar-search"
          />
        </div>
      )}
      {children}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
