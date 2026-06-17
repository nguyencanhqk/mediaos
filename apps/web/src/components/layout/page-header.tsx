import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Icon thương hiệu cạnh tiêu đề (lucide) — tuỳ chọn. */
  icon?: LucideIcon;
  /** Hành động bên phải (nút, menu…). */
  actions?: React.ReactNode;
  /** Toolbar/filter hiển thị ngay dưới header. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Tiêu đề trang chuẩn (MISA-style): icon + tiêu đề + mô tả ở trái,
 * vùng hành động ở phải, slot toolbar bên dưới. Dùng chung mọi module.
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {Icon && (
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
              <Icon className="h-5 w-5" strokeWidth={1.9} />
            </span>
          )}
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {title}
            </h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
