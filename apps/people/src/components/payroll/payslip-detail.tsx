import { useTranslation } from "react-i18next";
import type { PayslipDto } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { MASKED_AMOUNT_PLACEHOLDER } from "./period-constants";

interface PayslipDetailProps {
  payslipId: string;
  /** Called when user clicks 'Xác minh để xem' — parent opens reauth modal. */
  onRequestReauth: () => void;
  /**
   * Revealed payslip detail — passed by parent AFTER successful reauth.
   * Undefined = masked state (default). Component NEVER self-unmasks.
   */
  revealedSlip?: PayslipDto;
}

function fmt(amount: number, currency = "VND"): string {
  return `${amount.toLocaleString("vi-VN")} ${currency}`;
}

/**
 * PayslipDetail (G12-FE) — mask-by-default for payslip monetary values.
 *
 * BẤT BIẾN:
 *  - Before re-auth: renders ••• for net/gross/base + 'Xác minh để xem' button.
 *  - After re-auth: renders numbers from revealedSlip (ephemeral state in parent).
 *  - Component NEVER self-unmasks; always driven by revealedSlip prop.
 *  - Does not call any API directly — parent controls reveal lifecycle.
 */
export function PayslipDetail({ payslipId: _payslipId, onRequestReauth, revealedSlip }: PayslipDetailProps) {
  const { t } = useTranslation("payroll");
  const revealed = revealedSlip != null;

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("payslips.detail.title")}</h2>
        {!revealed && (
          <Button size="sm" variant="outline" onClick={onRequestReauth}>
            {t("payslips.detail.reauthButton")}
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t("payslips.detail.baseSalary")}</dt>
        <dd className="font-medium">
          {revealed ? fmt(revealedSlip.baseSalary, revealedSlip.currency) : MASKED_AMOUNT_PLACEHOLDER}
        </dd>

        <dt className="text-muted-foreground">{t("payslips.detail.allowances")}</dt>
        <dd className="font-medium">
          {revealed ? fmt(revealedSlip.totalAllowances, revealedSlip.currency) : MASKED_AMOUNT_PLACEHOLDER}
        </dd>

        <dt className="text-muted-foreground">{t("payslips.detail.gross")}</dt>
        <dd className="font-medium">
          {revealed ? fmt(revealedSlip.gross, revealedSlip.currency) : MASKED_AMOUNT_PLACEHOLDER}
        </dd>

        <dt className="text-muted-foreground">{t("payslips.detail.net")}</dt>
        <dd className="font-medium text-green-700">
          {revealed ? fmt(revealedSlip.net, revealedSlip.currency) : MASKED_AMOUNT_PLACEHOLDER}
        </dd>

        <dt className="text-muted-foreground">{t("payslips.detail.workDays")}</dt>
        <dd>{revealed ? `${revealedSlip.presentDays} / ${revealedSlip.workDays}` : MASKED_AMOUNT_PLACEHOLDER}</dd>

        {revealed && revealedSlip.kpiAmount != null && (
          <>
            <dt className="text-muted-foreground">{t("payslips.detail.kpi")}</dt>
            <dd>{fmt(revealedSlip.kpiAmount, revealedSlip.currency)}</dd>
          </>
        )}
        {revealed && revealedSlip.bonusAmount != null && (
          <>
            <dt className="text-muted-foreground">{t("payslips.detail.bonus")}</dt>
            <dd className="text-green-700">{fmt(revealedSlip.bonusAmount, revealedSlip.currency)}</dd>
          </>
        )}
        {revealed && revealedSlip.penaltyAmount != null && (
          <>
            <dt className="text-muted-foreground">{t("payslips.detail.penalty")}</dt>
            <dd className="text-red-700">{fmt(revealedSlip.penaltyAmount, revealedSlip.currency)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
