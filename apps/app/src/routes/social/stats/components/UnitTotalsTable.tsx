/**
 * S16-SOCIAL-FE-3B (L5) — bảng «Theo đơn vị» của màn Thống kê tương tác (`SOC-SCREEN-011`). `<table>` thuần
 * trong khung cuộn ngang (plan D9).
 *
 * Chỉ TRÌNH BÀY: nhận hàng ĐÃ gộp (`unitTotals` ở `lib/stats-aggregate.ts`). KHÔNG có cột thành viên — số
 * người hoạt động là DISTINCT theo tuần, cộng qua các tuần là đếm một người nhiều lần (plan D12).
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@mediaos/ui";
import { formatCount, type UnitTotalRow } from "../lib/stats-aggregate";
import { useUnitName } from "../lib/use-stats-labels";

export interface UnitTotalsTableProps {
  rows: readonly UnitTotalRow[];
}

const METRICS = ["posts", "comments", "reactions"] as const;

const CELL = "px-3 py-2";
const NUMBER_CELL = cn(CELL, "text-right tabular-nums");

export function UnitTotalsTable({ rows }: UnitTotalsTableProps): React.ReactElement {
  const { t } = useTranslation("social");
  const unitName = useUnitName();

  const labelOf = (row: UnitTotalRow): string => {
    if (row.kind === "unassigned") return t("admin.stats.unit.unassigned");
    if (row.kind === "unknown" || row.name === null) return t("admin.stats.unit.unknown");
    return unitName({ name: row.name, isDeleted: row.isDeleted });
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-testid="stats-unit-table">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <caption className="sr-only">{t("admin.stats.unitTable.caption")}</caption>
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th scope="col" className={cn(CELL, "text-left font-medium")}>
              {t("admin.stats.unitTable.unit")}
            </th>
            {METRICS.map((metric) => (
              <th key={metric} scope="col" className={cn(CELL, "text-right font-medium")}>
                {t(`admin.stats.metric.${metric}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              data-kind={row.kind}
              className={cn("border-t border-border", row.isDeleted && "text-muted-foreground")}
            >
              <th scope="row" className={cn(CELL, "text-left font-medium")}>
                {labelOf(row)}
              </th>
              {METRICS.map((metric) => (
                <td key={metric} className={NUMBER_CELL}>
                  {formatCount(row[metric])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
