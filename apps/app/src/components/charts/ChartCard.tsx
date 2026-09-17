import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Table2 } from "lucide-react";
import { Button, Card, Skeleton } from "@mediaos/ui";
import { CHART_HEIGHT } from "./chart-theme";

export type ChartCardState = "loading" | "error" | "empty" | "denied" | "ready";

export interface ChartTableView {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Khung một khối biểu đồ: tiêu đề · trạng thái riêng của khối (skeleton / rỗng / lỗi / không quyền) · nút
 * chuyển sang BẢNG (dataviz: mọi giá trị trong tooltip phải tới được mà không cần rê chuột — bảng là lối đó).
 *
 * Khi `refreshing` (đang tải lại mà đã có dữ liệu) khối GIỮ khung cũ ở độ mờ thấp — không nháy skeleton.
 */
export function ChartCard({
  title,
  description,
  state,
  emptyText,
  deniedText,
  errorText,
  onRetry,
  refreshing = false,
  table,
  height = CHART_HEIGHT,
  children,
  testId,
}: {
  title: string;
  description?: string;
  state: ChartCardState;
  emptyText: string;
  deniedText?: string;
  errorText?: string;
  onRetry?: () => void;
  refreshing?: boolean;
  table?: ChartTableView;
  height?: number;
  children: ReactNode;
  testId?: string;
}) {
  const { t } = useTranslation("common");
  const [showTable, setShowTable] = useState(false);
  const canToggle = state === "ready" && table !== undefined;

  let body: ReactNode;
  if (state === "loading") {
    body = <Skeleton className="w-full" style={{ height }} />;
  } else if (state === "denied" || state === "empty" || state === "error") {
    const text =
      state === "denied"
        ? deniedText
        : state === "error"
          ? (errorText ?? t("errors.loadFailed"))
          : emptyText;
    body = (
      <div
        className="flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground"
        style={{ minHeight: height }}
      >
        <span>{text}</span>
        {state === "error" && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("actions.retry")}
          </Button>
        )}
      </div>
    );
  } else if (showTable && table) {
    body = (
      <div className="overflow-x-auto" style={{ minHeight: height }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              {table.columns.map((c) => (
                <th key={c} scope="col" className="px-2 py-1.5 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className={`px-2 py-1.5 ${j > 0 ? "text-right tabular-nums" : ""}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else {
    body = (
      <div className={refreshing ? "opacity-60 transition-opacity" : undefined} style={{ height }}>
        {children}
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {canToggle && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
            title={showTable ? t("chart.showChart") : t("chart.showTable")}
          >
            {showTable ? (
              <BarChart3 className="size-4" aria-hidden />
            ) : (
              <Table2 className="size-4" aria-hidden />
            )}
            <span className="sr-only">
              {showTable ? t("chart.showChart") : t("chart.showTable")}
            </span>
          </Button>
        )}
      </div>
      {body}
    </Card>
  );
}
