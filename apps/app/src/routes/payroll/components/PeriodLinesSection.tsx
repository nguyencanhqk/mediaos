import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PayrollPeriodDto, PayrollPeriodLineDto } from "@mediaos/contracts";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import { Button, DataTable, EmptyState, TableFooter } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "../constants";
import {
  formatPayrollDays,
  formatPayrollMinutes,
  formatPayrollMoney,
  formatPayrollSignedMoney,
  isPayrollMoneyMasked,
  PAYROLL_NUMERIC_CELL_CLASS,
} from "../payroll-format";
import {
  componentValue,
  deriveComponentColumns,
  isWholePeriod,
  toLineRows,
  type ComponentColumn,
  type LineTotals,
  type PeriodLineRow,
} from "../period-line-columns";
import { displayUserRef, type PayrollPeopleLookup } from "../use-payroll-people";
import { useTemplateDrift } from "../use-template-drift";

type Translate = (key: string, opts?: Record<string, unknown>) => string;

const num = (content: string, bold = false) => (
  <span className={`${PAYROLL_NUMERIC_CELL_CLASS}${bold ? " font-medium" : ""}`}>{content}</span>
);

/** Một cột tiền: ô dòng đọc `pick(line)`, ô tổng đọc `total(totals)`. */
function moneyColumn(
  id: string,
  header: string,
  pick: (l: PayrollPeriodLineDto) => number | undefined,
  total: (t: LineTotals) => number | undefined,
  signed = false,
  bold = false,
): ColumnDef<PeriodLineRow> {
  const fmt = signed ? formatPayrollSignedMoney : formatPayrollMoney;
  return {
    id,
    header,
    cell: ({ row }) => {
      const r = row.original;
      const value = r.kind === "line" ? pick(r.line) : total(r.totals);
      return num(fmt(value), bold || r.kind === "total");
    },
  };
}

function buildColumns(
  t: Translate,
  people: PayrollPeopleLookup,
  dynamic: readonly ComponentColumn[],
  totalLabel: string,
): ColumnDef<PeriodLineRow>[] {
  const lineOnly = (render: (l: PayrollPeriodLineDto) => string) => ({
    cell: ({ row }: { row: { original: PeriodLineRow } }) =>
      row.original.kind === "line" ? num(render(row.original.line)) : null,
  });
  const head: ColumnDef<PeriodLineRow>[] = [
    {
      id: "user",
      header: t("lines.columns.employee"),
      cell: ({ row }) =>
        row.original.kind === "line" ? (
          displayUserRef(row.original.line.userId, people)
        ) : (
          <span className="font-semibold">{totalLabel}</span>
        ),
    },
    {
      id: "days",
      header: t("lines.columns.days"),
      ...lineOnly((l) => `${formatPayrollDays(l.presentDays)} / ${formatPayrollDays(l.workDays)}`),
    },
  ];
  // v2 — cột theo mẫu (snapshot lúc tính). v1/bị che ⇒ bộ cột cũ.
  const middle: ColumnDef<PeriodLineRow>[] =
    dynamic.length > 0
      ? dynamic.map((c) =>
          moneyColumn(
            `c:${c.code}`,
            c.label,
            (l) => componentValue(l, c.code),
            (tot) => tot.byCode[c.code],
            true,
          ),
        )
      : [
          {
            id: "unpaid",
            header: t("lines.columns.unpaidLeave"),
            ...lineOnly((l) => formatPayrollDays(l.unpaidLeaveDays)),
          },
          {
            id: "late",
            header: t("lines.columns.lateMinutes"),
            ...lineOnly((l) => formatPayrollMinutes(l.lateMinutes)),
          },
          moneyColumn(
            "gross",
            t("lines.columns.gross"),
            (l) => l.gross,
            (x) => x.gross,
          ),
          moneyColumn(
            "deduction",
            t("lines.columns.deduction"),
            (l) => l.deductionAmount,
            (x) => x.deduction,
          ),
        ];
  const tail: ColumnDef<PeriodLineRow>[] = [
    moneyColumn(
      "adjustment",
      t("lines.columns.adjustment"),
      (l) => l.adjustmentAmount,
      (x) => x.adjustment,
      true,
    ),
    moneyColumn(
      "net",
      t("lines.columns.net"),
      (l) => l.net,
      (x) => x.net,
      false,
      true,
    ),
  ];
  return [...head, ...middle, ...tail];
}

/**
 * PAY-SCREEN-002 — bảng lương nháp của kỳ (008), tách khỏi `PayrollPeriodDetailPage` ở S15-PAYROLL-FE-2
 * (trả nợ N1 của FE-1) để thêm cột ĐỘNG theo mẫu + hàng tổng (D9) + băng «mẫu đã đổi» (D11).
 *
 * ⚠️ `enabled` của 008 = `canViewLines && active` — trang cha truyền `active = tab === "lines"`: 008 CÓ audit
 * lượt đọc, kéo nó khi đang ở tab «Bảng công» là hàng audit «đã xem tiền» giả (bẫy FE-1).
 */
export function PeriodLinesSection({
  period,
  people,
  canViewLines,
  active,
  adjustable,
  onAdjust,
}: {
  period: PayrollPeriodDto;
  people: PayrollPeopleLookup;
  canViewLines: boolean;
  active: boolean;
  adjustable: boolean;
  onAdjust: (line: PayrollPeriodLineDto) => void;
}) {
  const { t } = useTranslation("payroll");
  const [page, setPage] = useState(1);
  const canViewTemplates = useCanExact(
    PAYROLL_ENGINE_PAIRS.templateDetail.action,
    PAYROLL_ENGINE_PAIRS.templateDetail.resourceType,
  );

  const params = useMemo(() => ({ page, per_page: PAYROLL_PAGE_SIZE }), [page]);
  const linesQuery = useQuery({
    queryKey: payrollKeys.periods.lines(period.id, params),
    queryFn: () => payrollApi.listLines(period.id, params),
    enabled: canViewLines && active,
  });

  const lines = useMemo(() => linesQuery.data?.data ?? [], [linesQuery.data]);
  // Tổng CHỈ từ API (mảng trần ⇒ footer nói «không rõ tổng», không lấy độ dài trang làm tổng).
  const lineTotal = linesQuery.data?.pagination?.total;
  const moneyMasked = lines.length > 0 && lines.every((l) => isPayrollMoneyMasked(l));
  const drift = useTemplateDrift(period, lines, canViewTemplates);

  const dynamic = useMemo(() => deriveComponentColumns(lines), [lines]);
  const rows = useMemo(() => toLineRows(lines, dynamic), [lines, dynamic]);
  const totalLabel = isWholePeriod(page, lines.length, lineTotal)
    ? t("lines.total")
    : t("lines.pageTotal");
  const columns = useMemo(
    () => buildColumns(t, people, dynamic, totalLabel),
    [t, people, dynamic, totalLabel],
  );

  if (!canViewLines) return <EmptyState title={t("lines.noPermission")} />;
  if (linesQuery.isError) {
    return (
      <EmptyState
        title={t("states.error")}
        action={
          <Button variant="outline" onClick={() => void linesQuery.refetch()}>
            {t("states.retry")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {moneyMasked && (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
          {t("lines.moneyMasked")}
        </div>
      )}
      {drift && (
        <div
          role="status"
          className="rounded-md border border-warning/40 bg-warning-muted/40 px-4 py-3 text-sm"
        >
          {t("lines.templateDrift")}
        </div>
      )}
      <DataTable
        columns={columns}
        data={rows}
        isLoading={linesQuery.isLoading}
        pageSize={PAYROLL_PAGE_SIZE + 1}
        pinFirstColumn
        onRowClick={
          adjustable
            ? (row) => {
                if (row.kind === "line") onAdjust(row.line);
              }
            : undefined
        }
        emptyState={<EmptyState title={t("lines.empty")} />}
        footer={
          <TableFooter
            page={page}
            pageSize={PAYROLL_PAGE_SIZE}
            total={lineTotal}
            disabled={linesQuery.isFetching}
            onPageChange={setPage}
          />
        }
      />
    </div>
  );
}
