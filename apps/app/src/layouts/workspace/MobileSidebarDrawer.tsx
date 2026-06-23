/**
 * MobileSidebarDrawer — wrapper sidebar thành drawer full-height cho mobile/tablet.
 * Đóng khi click backdrop hoặc nhấn Esc.
 */
import * as React from "react";
import { cn } from "@mediaos/ui";

interface MobileSidebarDrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function MobileSidebarDrawer({ open, onClose, children }: MobileSidebarDrawerProps) {
  // Esc để đóng
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Menu điều hướng"
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      {/* Drawer panel */}
      <div
        className={cn(
          "relative z-50 flex h-full w-64 flex-col bg-card shadow-xl",
          "animate-in slide-in-from-left duration-200",
        )}
      >
        {children}
      </div>
    </div>
  );
}
