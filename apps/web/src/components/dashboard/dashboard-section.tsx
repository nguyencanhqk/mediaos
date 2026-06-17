import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

interface DashboardSectionProps {
  title: string;
  /** Icon thương hiệu cạnh tiêu đề mục (lucide) — tuỳ chọn. */
  icon?: LucideIcon;
  /** Nội dung phụ bên phải tiêu đề (badge, link…). */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Khối section chuẩn cho dashboard (MISA-style): thẻ bo góc, header nhỏ
 * có icon + tiêu đề, nội dung bên dưới. Dùng chung cho mọi mục thống kê.
 * Chỉ là vỏ layout — không chứa data/permission logic.
 */
export function DashboardSection({
  title,
  icon: Icon,
  aside,
  children,
  className,
}: DashboardSectionProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card/60 p-5 shadow-sm sm:p-6",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
              <Icon className="h-4 w-4" strokeWidth={2} />
            </span>
          )}
          <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
