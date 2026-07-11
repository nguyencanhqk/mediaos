import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * DonutChart — donut SVG thuần (không thêm dependency chart; Recharts chỉ cân nhắc khi cần
 * chart phức tạp — DECISIONS stack). Tổng = 0 → vẽ vòng xám trống.
 */
export interface DonutSegment {
  label: string;
  value: number;
  /** Màu CSS (vd "#10b981"). */
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  /** Đường kính (px). */
  size?: number;
  /** Bề dày vành (px). */
  thickness?: number;
  /** Nội dung giữa donut (vd tổng số). */
  center?: React.ReactNode;
  className?: string;
}

export function DonutChart({
  segments,
  size = 128,
  thickness = 18,
  center,
  className,
}: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const cxy = size / 2;

  let acc = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const fraction = s.value / total;
      const arc = { ...s, dash: fraction * circumference, offset: acc * circumference };
      acc += fraction;
      return arc;
    });

  const title = segments.map((s) => `${s.label}: ${s.value}`).join(" · ");

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} role="img" aria-label={title}>
        <title>{title}</title>
        {/* vành nền */}
        <circle
          cx={cxy}
          cy={cxy}
          r={radius}
          fill="none"
          className="stroke-muted"
          strokeWidth={thickness}
        />
        {total > 0 && (
          <g transform={`rotate(-90 ${cxy} ${cxy})`}>
            {arcs.map((a) => (
              <circle
                key={a.label}
                cx={cxy}
                cy={cxy}
                r={radius}
                fill="none"
                stroke={a.color}
                strokeWidth={thickness}
                strokeDasharray={`${a.dash} ${circumference - a.dash}`}
                strokeDashoffset={-a.offset}
              />
            ))}
          </g>
        )}
      </svg>
      {center && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {center}
        </div>
      )}
    </div>
  );
}
