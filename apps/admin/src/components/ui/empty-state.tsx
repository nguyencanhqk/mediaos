import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Lucide icon hiển thị phía trên (tuỳ chọn). */
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Nút hành động (vd "Tạo mới"). */
  action?: React.ReactNode;
  className?: string;
}

/** Trạng thái rỗng tường minh — dùng cho list/table khi không có dữ liệu. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
      role="status"
    >
      {Icon && <Icon className="size-8 text-muted-foreground" aria-hidden="true" />}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
