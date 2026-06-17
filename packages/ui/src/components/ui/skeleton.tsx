import * as React from "react";
import { cn } from "../../lib/utils";

/** Khối loading nhấp nháy — dùng cho skeleton bảng/card khi đang tải. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
