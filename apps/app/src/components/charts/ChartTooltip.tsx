import type { ReactNode } from "react";

export interface ChartTooltipRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** Màu KHOÁ (vạch ngắn) — chữ vẫn dùng token chữ. Vắng ⇒ hàng phụ không khoá màu. */
  readonly color?: string;
}

/**
 * Hộp tooltip dùng chung (dataviz §interaction): GIÁ TRỊ đậm dẫn đầu, tên chuỗi phụ theo sau; khoá chuỗi là
 * VẠCH ngắn, không phải ô màu. Nội dung là text React (không `innerHTML`) — nhãn đến từ API.
 */
export function ChartTooltip({
  title,
  rows,
}: {
  title: ReactNode;
  rows: readonly ChartTooltipRow[];
}) {
  return (
    <div className="min-w-40 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium text-muted-foreground">{title}</div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            {r.color ? (
              <span
                aria-hidden
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ backgroundColor: r.color }}
              />
            ) : (
              <span aria-hidden className="inline-block w-3" />
            )}
            <span className="font-semibold tabular-nums text-foreground">{r.value}</span>
            <span className="text-muted-foreground">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
