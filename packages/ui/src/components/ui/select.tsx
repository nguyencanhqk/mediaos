import * as React from "react";
import { cn } from "../../lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Native styled `<select>` — khớp look của Input (house style nhẹ).
 *
 * CỐ Ý GIỮ `<select>` THUẦN, không đổi sang @radix-ui/react-select như apps/lms: 125 call-site
 * đang truyền `<option>` trực tiếp (244 thẻ). Đổi sang Radix là viết lại toàn bộ chúng ⇒ WO riêng.
 * Xem docs/plans/S5-FND-UI-GEN-1.md §3.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      data-slot="select"
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
