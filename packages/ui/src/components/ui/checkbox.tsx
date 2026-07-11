import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * Checkbox — native input styled (đồng bộ convention select.tsx: không Radix).
 * Dùng accent-color của trình duyệt cho tick; forwardRef để react-hook-form register được.
 */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      "h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-brand",
      "focus-visible:ring-brand focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = "Checkbox";
