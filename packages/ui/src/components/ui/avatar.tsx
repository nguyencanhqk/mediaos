import * as React from "react";
import { cn } from "../../lib/utils";

/** Lấy 1–2 ký tự đầu (theo từ) làm initials. "Nguyễn Văn Cảnh" → "NC". */
export function initialsFrom(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Tên dùng để sinh initials khi không có ảnh. */
  name?: string | null;
  /** URL ảnh (tùy chọn). */
  src?: string | null;
  size?: "sm" | "md" | "lg";
}

const sizeClass: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-12 w-12 text-base",
};

export function Avatar({ name, src, size = "md", className, ...props }: AvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-muted font-semibold text-brand select-none",
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {src ? (
        // loading=lazy: bảng/danh sách dài không tải ảnh ngoài viewport (P1 perf).
        <img src={src} alt={name ?? ""} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        initialsFrom(name)
      )}
    </span>
  );
}
