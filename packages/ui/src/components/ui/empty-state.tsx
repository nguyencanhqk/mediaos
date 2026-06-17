import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";

interface EmptyStateProps {
  /** Icon minh hoạ (lucide). */
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Nút hành động (vd "Thêm mới") — tuỳ chọn. */
  action?: React.ReactNode;
  className?: string;
}

/** Trạng thái rỗng dùng chung: icon tròn + tiêu đề + mô tả + hành động. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </span>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
