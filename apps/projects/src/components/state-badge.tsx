import { cn } from "@/lib/utils";

interface StateBadgeProps {
  /** Tên trạng thái (vd "Đang làm"). null → hiển thị "Chưa có trạng thái". */
  name: string | null;
  /** Màu HEX của state (chấm tròn). null → xám. */
  color?: string | null;
  /** Nhãn fallback khi name rỗng. */
  emptyLabel?: string;
  className?: string;
}

/**
 * Badge trạng thái tùy biến (project_state) — chấm màu (lấy HEX từ state) + tên.
 * Màu đến từ DB (server là sự thật); fallback xám khi thiếu.
 */
export function StateBadge({ name, color, emptyLabel = "—", className }: StateBadgeProps) {
  const dotColor = color ?? "#94a3b8";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
        aria-hidden
      />
      <span className="truncate">{name ?? emptyLabel}</span>
    </span>
  );
}
