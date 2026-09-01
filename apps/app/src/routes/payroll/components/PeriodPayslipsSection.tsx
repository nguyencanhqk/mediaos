import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import { Button, EmptyState } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "../constants";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "../payroll-format";
import { displayUserRef, type PayrollPeopleLookup } from "../use-payroll-people";
import { PayslipStatusBadge } from "./StatusBadges";

/**
 * Khối «phiếu lương của kỳ» trong PAY-SCREEN-002 — **đường đi DUY NHẤT tới PAY-SCREEN-003**.
 *
 * ⚠️ CỐ Ý không phải màn riêng: SPEC-11 §9 chốt đúng 6 màn và không có "danh sách phiếu lương". Phiếu
 * chỉ có nghĩa TRONG một kỳ (append-only, sinh theo lô ở `generate-payslips`), nên nó là một khối của
 * không gian làm việc kỳ lương — thêm màn thứ 7 là nới phạm vi WO.
 *
 * ⚠️ Cặp gác **KHÁC** cặp của bảng dòng: `('view-payslip','payslip')` chứ không phải `view-line`. Một
 * vai xem được bảng lương nháp vẫn có thể không xem được phiếu đã phát hành — khối này tự ẩn, không
 * kéo cả trang xuống 403.
 *
 * Chỉ render khi kỳ ĐÃ sinh phiếu; caller kiểm `payslipsGeneratedAt !== null` trước.
 */
export function PeriodPayslipsSection({
  periodId,
  people,
  onOpenPayslip,
}: {
  periodId: string;
  people: PayrollPeopleLookup;
  onOpenPayslip: (payslipId: string) => void;
}) {
  const { t } = useTranslation("payroll");

  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.payslipList.action,
    PAYROLL_ENGINE_PAIRS.payslipList.resourceType,
  );

  const params = { payrollPeriodId: periodId, page: 1, per_page: PAYROLL_PAGE_SIZE };
  const query = useQuery({
    queryKey: payrollKeys.payslips.list(params),
    queryFn: () => payrollApi.listPayslips(params),
    enabled: canView,
  });

  if (!canView) return null;

  const rows = query.data?.data ?? [];
  const total = query.data?.pagination?.total ?? rows.length;

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{t("periodPayslips.title", { count: total })}</h3>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("states.loading")}</p>
      ) : query.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("periodPayslips.empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onOpenPayslip(p.id)}
                className="flex w-full items-center justify-between gap-4 px-4 py-2 text-left text-sm hover:bg-accent"
              >
                <span>{displayUserRef(p.userId, people)}</span>
                <span className="flex items-center gap-3">
                  <PayslipStatusBadge status={p.status} />
                  <span className={PAYROLL_NUMERIC_CELL_CLASS}>{formatPayrollMoney(p.net)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {total > rows.length && (
        <p className="text-xs text-muted-foreground">
          {t("periodPayslips.truncated", { shown: rows.length, total })}
        </p>
      )}
    </section>
  );
}
