import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  salaryComponentKindEnum,
  type PayslipDetailDto,
  type PayslipItemDto,
  type SalaryComponentKind,
} from "@mediaos/contracts";
import {
  formatPayrollDays,
  formatPayrollMinutes,
  formatPayrollMoney,
  formatPayrollSignedMoney,
  isPayrollMoneyMasked,
  PAYROLL_NUMERIC_CELL_CLASS,
} from "../payroll-format";
import { PayslipStatusBadge } from "./StatusBadges";

/**
 * Breakdown phiếu lương — dùng CHUNG cho PAY-SCREEN-003 (quản trị, `view-payslip:payslip`) và
 * PAY-SCREEN-006 («Phiếu lương của tôi», `view-own-payslip:payslip`).
 *
 * ⚠️ Dùng chung được vì **hình dạng DTO giống hệt** (`payslipDetailSchema` cho cả 030 lẫn 032) và
 * masking do SERVER quyết theo cặp quyền của TỪNG đường tải — component không tự suy quyền, không nhận
 * cờ `isOwn`. Thêm nhánh `if (isOwn)` vào đây là dựng cổng thứ hai ở FE lệch pha với cổng thật ở BE.
 *
 * ⚠️ **KHÔNG tự cộng `items` để ra `net`.** Bất biến `SUM(items) = gross − deduction + adjustment` đã
 * được BE assert TRONG transaction sinh phiếu (`findItemSumMismatchesTx` — lệch thì rollback cả lượt).
 * Cộng lại ở JS trên `numeric(18,2)` chỉ đẻ ra một con số thứ hai lệch với con số in trên phiếu.
 *
 * `amount` của item **CÓ DẤU** (earning/allowance/bonus dương · penalty/attendance/deduction âm ·
 * adjustment theo dấu người nhập) — hiện bằng `formatPayrollSignedMoney` để dòng trừ đọc ra là trừ.
 */
/**
 * S15-PAYROLL-FE-2 (D12) — `meta` của item phiếu v2 do `generate-payslips` ghi (`payroll-payslips.repository.ts`):
 * `{ componentCode, kind, isVisible }`. `meta` đi CÙNG cổng mask với `amount` ⇒ vắng khi bị che, và vắng ở
 * phiếu v1 ⇒ rơi về bảng theo `itemType`. Parse an toàn — `meta` là jsonb tự do.
 */
const componentMetaSchema = z.object({
  componentCode: z.string(),
  kind: salaryComponentKindEnum,
  isVisible: z.boolean().optional(),
});

export type PayslipBreakdownGroup = "income" | "deduction" | "adjustment";

const KIND_GROUP: Readonly<Record<SalaryComponentKind, PayslipBreakdownGroup>> = {
  earning: "income",
  tax_exempt: "income",
  deduction: "deduction",
  statutory_employee: "deduction",
  statutory_employer: "deduction",
  tax: "deduction",
  // Không bao giờ tới đây: `generate-payslips` KHÔNG sinh item cho `aggregate`/`statutory_employer`
  // (`payroll-payslips.repository.ts` — chỉ earning · tax_exempt · deduction · statutory_employee · tax). Hai
  // khoá dưới có mặt chỉ vì `Record<SalaryComponentKind, …>` bắt đủ 7 loại.
  aggregate: "deduction",
};

export interface BreakdownEntry {
  readonly item: PayslipItemDto;
  readonly code: string | null;
  readonly group: PayslipBreakdownGroup;
  readonly hidden: boolean;
}

/**
 * Nhóm item theo thành phần — CHỈ khi MỌI item không phải `adjustment` đều parse được `meta` (phiếu v2 nhìn
 * thấy tiền). Thiếu một ⇒ `null` ⇒ caller dùng bảng v1 (không trộn hai kiểu trong một phiếu). KHÔNG cộng tiền.
 */
export function groupPayslipItems(items: readonly PayslipItemDto[]): BreakdownEntry[] | null {
  const entries: BreakdownEntry[] = [];
  for (const item of [...items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (item.itemType === "adjustment") {
      entries.push({ item, code: null, group: "adjustment", hidden: false });
      continue;
    }
    const meta = componentMetaSchema.safeParse(item.meta);
    if (!meta.success) return null;
    entries.push({
      item,
      code: meta.data.componentCode,
      group: KIND_GROUP[meta.data.kind],
      hidden: meta.data.isVisible === false,
    });
  }
  return entries.some((e) => e.code !== null) ? entries : null;
}

const GROUP_ORDER: readonly PayslipBreakdownGroup[] = ["income", "deduction", "adjustment"];

function ComponentBreakdown({ entries }: { entries: readonly BreakdownEntry[] }) {
  const { t } = useTranslation("payroll");
  return (
    <div className="space-y-4" data-testid="payslip-breakdown-v2">
      {GROUP_ORDER.map((group) => {
        const rows = entries.filter((e) => e.group === group);
        if (rows.length === 0) return null;
        return (
          <div key={group} className="overflow-x-auto">
            <h4 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
              {t(`payslip.group.${group}`)}
            </h4>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.item.id}
                    className={`border-b border-border/60${e.hidden ? " text-muted-foreground" : ""}`}
                  >
                    <td className="w-40 py-1.5 font-mono text-xs">{e.code ?? ""}</td>
                    <td className="py-1.5">
                      {e.item.label}
                      {e.hidden && (
                        <span className="ml-2 text-xs">{t("payslip.hiddenComponent")}</span>
                      )}
                    </td>
                    <td className={`py-1.5 ${PAYROLL_NUMERIC_CELL_CLASS}`}>
                      {formatPayrollSignedMoney(e.item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export function PayslipBreakdown({ payslip }: { payslip: PayslipDetailDto }) {
  const { t } = useTranslation("payroll");
  const masked = isPayrollMoneyMasked(payslip);
  const grouped = groupPayslipItems(payslip.items);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <PayslipStatusBadge status={payslip.status} />
        {payslip.acknowledgedAt !== null && (
          <span className="text-sm text-muted-foreground">
            {t("payslip.acknowledgedAt", { at: payslip.acknowledgedAt })}
          </span>
        )}
      </div>

      {masked && (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
          {t("payslip.moneyMasked")}
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("payslip.inputsTitle")}</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t("payslip.workDays")}</dt>
            <dd className="tabular-nums">{formatPayrollDays(payslip.workDays)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("payslip.presentDays")}</dt>
            <dd className="tabular-nums">{formatPayrollDays(payslip.presentDays)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("payslip.paidLeaveDays")}</dt>
            <dd className="tabular-nums">{formatPayrollDays(payslip.paidLeaveDays)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("payslip.unpaidLeaveDays")}</dt>
            <dd className="tabular-nums">{formatPayrollDays(payslip.unpaidLeaveDays)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("payslip.lateMinutes")}</dt>
            <dd className="tabular-nums">{formatPayrollMinutes(payslip.lateMinutes)}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("payslip.breakdownTitle")}</h3>
        {payslip.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("payslip.breakdownEmpty")}</p>
        ) : grouped ? (
          <ComponentBreakdown entries={grouped} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 font-medium">{t("payslip.itemType")}</th>
                  <th className="py-2 font-medium">{t("payslip.itemLabel")}</th>
                  <th className="py-2 text-right font-medium">{t("payslip.itemAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {payslip.items.map((item) => (
                  <tr key={item.id} className="border-b border-border/60">
                    <td className="py-2 text-muted-foreground">
                      {t(`payslipItemType.${item.itemType}`)}
                    </td>
                    <td className="py-2">{item.label}</td>
                    <td className={`py-2 ${PAYROLL_NUMERIC_CELL_CLASS}`}>
                      {formatPayrollSignedMoney(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("payslip.totalsTitle")}</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t("payslip.gross")}</dt>
            <dd className="tabular-nums">{formatPayrollMoney(payslip.gross)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("payslip.deduction")}</dt>
            <dd className="tabular-nums">{formatPayrollMoney(payslip.deductionAmount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("payslip.adjustment")}</dt>
            <dd className="tabular-nums">{formatPayrollSignedMoney(payslip.adjustmentAmount)}</dd>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-muted-foreground">{t("payslip.net")}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatPayrollMoney(payslip.net)}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
