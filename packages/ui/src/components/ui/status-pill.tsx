import { Badge } from "./badge";
import { cn } from "../../lib/utils";

/**
 * `StatusPill` — chip trạng thái CHUẨN dùng chung mọi module (UI-07 §13.7, DEC-020).
 *
 * Vì sao tồn tại bên cạnh `Badge`: `Badge` là primitive tô màu tuỳ ý; `StatusPill` là **hợp đồng
 * ngữ nghĩa** — «một trạng thái ⇒ một màu ở MỌI màn». Caller truyền `tone` tra từ bảng hằng của
 * module (SPEC-01 §17.x), KHÔNG tự chọn màu tại chỗ gọi. Đó là lý do prop tên `tone` chứ không phải
 * `variant`: nó nói về *trạng thái nghiệp vụ*, không phải về sắc thái hiển thị.
 *
 * Chấm màu đứng trước nhãn để trạng thái còn phân biệt được khi in đen trắng hoặc khi người dùng
 * không phân biệt được màu — màu KHÔNG phải kênh thông tin duy nhất (WCAG 1.4.1).
 */

/** Sắc thái ngữ nghĩa — tập con CỐ Ý của `Badge` (bỏ `default`/`secondary`/`outline` vốn không mang nghĩa trạng thái). */
export type StatusTone = "muted" | "brand" | "success" | "warning" | "danger";

export interface StatusPillProps {
  /** Nhãn ĐÃ dịch. Component không gọi i18n — nhãn trạng thái thuộc namespace của module. */
  label: string;
  tone?: StatusTone;
  /** Ẩn chấm màu (dùng khi pill nằm trong ô bảng hẹp). */
  hideDot?: boolean;
  className?: string;
}

const DOT_CLASS: Readonly<Record<StatusTone, string>> = {
  muted: "bg-muted-foreground/60",
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function StatusPill({ label, tone = "muted", hideDot = false, className }: StatusPillProps) {
  // `StatusTone` là tập con của `BadgeProps["variant"]` — truyền thẳng, không bảng ánh xạ thứ hai.
  return (
    <Badge variant={tone} className={cn("gap-1.5", className)} data-slot="status-pill">
      {!hideDot && (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASS[tone])} aria-hidden />
      )}
      {label}
    </Badge>
  );
}

/** Kiểu chung cho bảng tra `trạng thái → tone` mà mỗi module khai trong `constants` của mình. */
export type StatusToneMap<TStatus extends string = string> = Readonly<Record<TStatus, StatusTone>>;

export { DOT_CLASS as STATUS_PILL_DOT_CLASS };
