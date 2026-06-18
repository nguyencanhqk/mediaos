import { useTranslation } from "react-i18next";
import type { PriorityDto } from "@mediaos/contracts";
import { cn } from "@/lib/utils";
import { PRIORITY_META } from "@/lib/priority";

interface PriorityIconProps {
  priority: PriorityDto;
  /** Hiện nhãn vi cạnh icon (dùng ở picker/list). Mặc định false (chỉ icon — dùng trên card). */
  showLabel?: boolean;
  className?: string;
}

/**
 * Icon mức ưu tiên kiểu Plane (urgent đỏ / high cam / medium vàng / low xanh / none xám).
 * Lấy icon + màu + nhãn vi từ PRIORITY_META (nguồn sự thật). `data-testid` ổn định cho test.
 */
export function PriorityIcon({ priority, showLabel = false, className }: PriorityIconProps) {
  const { t } = useTranslation("projects");
  const meta = PRIORITY_META[priority];
  const Icon = meta.icon;
  const label = t(meta.labelKey);

  return (
    <span
      data-testid={`priority-icon-${priority}`}
      className={cn("inline-flex items-center gap-1.5", className)}
      title={label}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.color)} strokeWidth={2.2} aria-hidden />
      {showLabel ? (
        <span className="text-sm text-foreground">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );
}
