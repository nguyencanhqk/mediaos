import { useTranslation } from "react-i18next";
import type { PayrollPeriodStatus } from "@mediaos/contracts";
import type { PayslipSummary } from "@/lib/payslip-api";
import { PERIOD_STATUS_LABELS } from "./period-constants";
import { ENTRY_KIND_LABELS } from "./payslip-constants";

interface PayslipTableProps {
  rows: PayslipSummary[];
  /** period_month label per payrollPeriodId (display only). Best-effort — may be absent for some roles. */
  periodLabels?: Record<string, string>;
  /** period FSM status per payrollPeriodId (display only). Best-effort — may be absent for some roles. */
  periodStatuses?: Record<string, PayrollPeriodStatus>;
  /** Currently selected payslip id (highlight). */
  selectedId?: string | null;
  /** Row click → parent opens the re-auth/reveal flow for this payslip. */
  onSelect: (payslipId: string) => void;
}

/**
 * Payslip list (G12-FE) — money-FREE. The rows come from `payslipApi.listSummary`, which strips every
 * monetary field at the API boundary (BẤT BIẾN #3 (a)): this table has NO money columns. Money is only
 * ever visible in the per-payslip detail AFTER re-auth. A row click opens that reveal flow.
 */
export function PayslipTable({
  rows,
  periodLabels,
  periodStatuses,
  selectedId,
  onSelect,
}: PayslipTableProps) {
  const { t } = useTranslation("payroll");
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("payslips.empty")}</p>;
  }

  return (
    <table className="w-full text-sm" aria-label={t("payslips.table.ariaLabel")}>
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th scope="col" className="py-2 font-medium">
            {t("payslips.table.period")}
          </th>
          <th scope="col" className="py-2 font-medium">
            {t("payslips.table.status")}
          </th>
          <th scope="col" className="py-2 font-medium">
            {t("payslips.table.createdAt")}
          </th>
          <th scope="col" className="py-2 font-medium">
            {t("payslips.table.entryKind")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const status = periodStatuses?.[row.payrollPeriodId];
          const label = periodLabels?.[row.payrollPeriodId] ?? row.payrollPeriodId;
          const isSelected = selectedId === row.id;
          // Rows open the re-auth/reveal flow → must be keyboard-operable, not mouse-only.
          const select = () => onSelect(row.id);
          return (
            <tr
              key={row.id}
              className={`cursor-pointer border-b border-border/50 hover:bg-muted/50 focus-visible:bg-primary/10 focus-visible:outline-none ${
                isSelected ? "bg-primary/10" : ""
              }`}
              onClick={select}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select();
                }
              }}
              tabIndex={0}
              role="button"
              aria-pressed={isSelected}
            >
              <td className="py-2 font-medium">{label}</td>
              <td className="py-2">{status ? PERIOD_STATUS_LABELS[status] : "—"}</td>
              <td className="py-2 text-muted-foreground">{row.createdAt.slice(0, 10)}</td>
              <td className="py-2">{ENTRY_KIND_LABELS[row.entryKind] ?? row.entryKind}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
