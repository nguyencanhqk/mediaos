import { ArrowLeft, MoreHorizontal } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Popover } from "../ui/popover";
import { cn } from "../../lib/utils";

/**
 * `DetailPageHeader` — khối đầu trang CHUẨN của mọi màn CHI TIẾT (UI-07 §13.7, DEC-020):
 *
 * ```text
 * [<-]  Tiêu đề đối tượng  (StatusPill)            [Hành động chính] [...]
 *       Dòng phụ: mã · đơn vị · người phụ trách
 * ```
 *
 * ⚠️ **THAY `PageHeader` trên màn chi tiết, KHÔNG cộng thêm** — hai thanh tiêu đề chồng nhau là lỗi
 * bố cục thường gặp nhất khi tách component kiểu này (UI-07 §6.3).
 *
 * ⚠️ Nút `←` gọi `onBack` do màn truyền vào — về **danh sách nguồn**, giữ bộ lọc/trang. CỐ Ý không
 * gọi `history.back()` bên trong: vào thẳng bằng deep-link (từ NOTI/email) thì không có lịch sử để
 * lùi, và người dùng bị đá ra khỏi ứng dụng.
 *
 * ⚠️ `⋯` **ẩn cả nút** khi `overflowItems` rỗng — mục không có quyền thì chỗ gọi lọc khỏi mảng, và
 * một nút mở ra menu trống là đúng lớp lỗi «cổng mở ra phòng rỗng» (UI-07 §13.7).
 */

export interface OverflowItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** Có quyền nhưng business rule chặn ⇒ disable + tooltip, KHÔNG ẩn (UI-07 §22.3). */
  disabled?: boolean;
  /** Lý do bị khoá — hiện thành `title`. */
  disabledReason?: string;
  /** Hành động nguy hiểm (xoá/huỷ) — tô đỏ. */
  destructive?: boolean;
}

export interface DetailPageHeaderProps {
  title: string;
  /** Dòng phụ: mã · đơn vị · người phụ trách. */
  subtitle?: React.ReactNode;
  /** `StatusPill` của entity — đứng cạnh tiêu đề. */
  status?: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  /** Hành động chính (đã lọc theo quyền ở chỗ gọi — thiếu quyền thì ĐỪNG truyền). */
  actions?: React.ReactNode;
  overflowItems?: readonly OverflowItem[];
  className?: string;
}

export function DetailPageHeader({
  title,
  subtitle,
  status,
  onBack,
  backLabel,
  actions,
  overflowItems,
  className,
}: DetailPageHeaderProps) {
  const { t } = useTranslation("common");
  const back = backLabel ?? t("actions.back");
  const hasOverflow = (overflowItems?.length ?? 0) > 0;

  return (
    <div
      className={cn("flex flex-wrap items-start justify-between gap-3", className)}
      data-slot="detail-page-header"
    >
      <div className="flex min-w-0 items-start gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={back}
            title={back}
            data-testid="detail-header-back"
            className={cn(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            )}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {title}
            </h1>
            {status}
          </div>
          {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {hasOverflow && <OverflowMenu items={overflowItems!} />}
      </div>
    </div>
  );
}

function OverflowMenu({ items }: { items: readonly OverflowItem[] }) {
  const { t } = useTranslation("common");
  const [open, setOpen] = React.useState(false);
  const label = t("actions.more", { defaultValue: "Hành động khác" });

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="min-w-[12rem] p-1"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          title={label}
          data-testid="detail-header-overflow"
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
          )}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      }
    >
      <div role="menu" className="space-y-0.5">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            title={item.disabled ? item.disabledReason : undefined}
            onClick={() => {
              setOpen(false);
              item.onSelect();
            }}
            className={cn(
              "w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
              "hover:bg-accent hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
              item.destructive && "text-danger hover:bg-danger-muted",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </Popover>
  );
}
