import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * Popover — panel nổi controlled, đóng khi click ra ngoài / nhấn Escape.
 * Hand-rolled (không Radix — đồng bộ convention primitives hiện có). Trigger do caller render,
 * truyền qua prop `trigger` để wrapper quản lý outside-click cho CẢ trigger lẫn panel.
 */
interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nút mở/đóng — caller tự gắn onClick toggle. */
  trigger: React.ReactNode;
  /** Căn mép panel so với trigger. */
  align?: "start" | "end";
  className?: string;
  children: React.ReactNode;
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  align = "end",
  className,
  children,
}: PopoverProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative inline-block">
      {trigger}
      {open && (
        <div
          role="dialog"
          className={cn(
            "absolute z-50 mt-2 min-w-[16rem] rounded-lg border border-border bg-card p-3 shadow-lg",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
