import * as React from "react";
import { cn } from "@/lib/utils";

interface FilterFieldProps {
  /** Nhãn nhỏ phía trên control (uppercase). */
  label: string;
  /** Control filter (Select/Input…). */
  children: React.ReactNode;
  className?: string;
}

/**
 * Ô filter chuẩn dùng chung cho các trang HR (Chấm công/Bổ sung/Nghỉ phép):
 * nhãn nhỏ uppercase + control bên dưới. Chỉ layout, không có logic.
 */
export function FilterField({ label, children, className }: FilterFieldProps) {
  return (
    <div className={cn("space-y-1", className)}>
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
