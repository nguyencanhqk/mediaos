import { SignalHigh, SignalLow, SignalMedium, AlertTriangle, Minus, type LucideIcon } from "lucide-react";
import type { PriorityDto } from "@mediaos/contracts";

/**
 * Hằng số mức ưu tiên kiểu Plane — NGUỒN SỰ THẬT cho icon + màu + nhãn vi + thứ tự.
 * `PriorityDto` = "urgent" | "high" | "medium" | "low" | "none" (contracts).
 *
 * Màu giữ tông Plane: urgent = đỏ, high = cam, medium = vàng, low = xanh dương, none = xám.
 * Icon là lucide (SignalHigh/Medium/Low cho thang tín hiệu; AlertTriangle cho urgent; Minus cho none).
 */
export interface PriorityMeta {
  value: PriorityDto;
  labelKey: string;
  icon: LucideIcon;
  /** Class màu chữ/icon (text-*). */
  color: string;
  /** Class nền nhạt cho chip/badge (bg-*). */
  bg: string;
  /** Thứ tự sắp xếp (urgent cao nhất → none thấp nhất). */
  order: number;
}

export const PRIORITY_META: Record<PriorityDto, PriorityMeta> = {
  urgent: {
    value: "urgent",
    labelKey: "priority.urgent",
    icon: AlertTriangle,
    color: "text-red-600",
    bg: "bg-red-50",
    order: 0,
  },
  high: {
    value: "high",
    labelKey: "priority.high",
    icon: SignalHigh,
    color: "text-orange-500",
    bg: "bg-orange-50",
    order: 1,
  },
  medium: {
    value: "medium",
    labelKey: "priority.medium",
    icon: SignalMedium,
    color: "text-amber-500",
    bg: "bg-amber-50",
    order: 2,
  },
  low: {
    value: "low",
    labelKey: "priority.low",
    icon: SignalLow,
    color: "text-blue-500",
    bg: "bg-blue-50",
    order: 3,
  },
  none: {
    value: "none",
    labelKey: "priority.none",
    icon: Minus,
    color: "text-slate-400",
    bg: "bg-slate-50",
    order: 4,
  },
};

/** Thứ tự hiển thị trong picker / filter (urgent → none). */
export const PRIORITY_ORDER: readonly PriorityDto[] = ["urgent", "high", "medium", "low", "none"];
