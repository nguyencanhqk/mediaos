import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * StatCard — thẻ KPI cho dải tổng quan (headcount, trạng thái nhân sự…).
 * tone gradient rực cho các thẻ đếm nhanh; tone "neutral" cho thẻ nền card thường.
 */
type StatCardTone = "emerald" | "cyan" | "blue" | "amber" | "neutral";

const toneClass: Record<StatCardTone, string> = {
  emerald: "bg-gradient-to-br from-emerald-500 to-teal-400 text-white",
  cyan: "bg-gradient-to-br from-cyan-500 to-sky-400 text-white",
  blue: "bg-gradient-to-br from-blue-500 to-indigo-400 text-white",
  amber: "bg-gradient-to-br from-amber-400 to-orange-400 text-white",
  neutral: "border border-border bg-card text-foreground",
};

interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: StatCardTone;
  className?: string;
  /** Nội dung phụ dưới value (vd chú thích nhỏ). */
  children?: React.ReactNode;
}

export function StatCard({ label, value, tone = "neutral", className, children }: StatCardProps) {
  const neutral = tone === "neutral";
  return (
    <div className={cn("flex flex-col gap-1 rounded-xl p-4 shadow-sm", toneClass[tone], className)}>
      <span
        className={cn("text-sm font-medium", neutral ? "text-muted-foreground" : "text-white/90")}
      >
        {label}
      </span>
      <span className="text-3xl leading-tight font-bold tabular-nums">{value}</span>
      {children}
    </div>
  );
}
