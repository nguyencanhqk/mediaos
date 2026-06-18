import { X } from "lucide-react";
import type { LabelDto } from "@mediaos/contracts";
import { cn } from "@/lib/utils";

interface LabelChipProps {
  label: LabelDto;
  /** Callback gỡ nhãn — có thì render nút ✕. */
  onRemove?: (labelId: string) => void;
  /** Disable nút gỡ (đang mutate). */
  removing?: boolean;
  className?: string;
}

/**
 * Chip nhãn màu (label) kiểu Plane — chấm màu + tên, viền nhạt cùng tông màu nhãn.
 * Khi có `onRemove` hiện nút ✕ để gỡ nhãn khỏi work item.
 */
export function LabelChip({ label, onRemove, removing = false, className }: LabelChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={{
        borderColor: `${label.color}55`,
        backgroundColor: `${label.color}14`,
        color: label.color,
      }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
        aria-hidden
      />
      <span className="truncate">{label.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(label.id)}
          disabled={removing}
          className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/10 disabled:opacity-50"
          aria-label={`Gỡ nhãn ${label.name}`}
        >
          <X className="h-2.5 w-2.5" strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}
