import { useTranslation } from "react-i18next";
import type { PayrollPeriodDto } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { PERIOD_STATUS_BADGE, PERIOD_STATUS_LABELS } from "./period-constants";
import { SodWarning } from "./sod-warning";

interface PayrollPeriodTableProps {
  rows: PayrollPeriodDto[];
  currentUserId: string;
  onApprove: (id: string) => void;
  onPublish: (id: string) => void;
  /** Map of periodId → error message (server fail-closed). */
  errors?: Record<string, string>;
}

/**
 * PayrollPeriodTable — kỳ lương + cột vết duyệt + nút FSM (draft→approved→published).
 *
 * BẤT BIẾN:
 *  - approve/publish are isSensitive → NOT in /me capabilities → render OPTIMISTIC
 *    (không dùng PermissionGate / useCan — nút luôn hiện, server fail-closed).
 *  - SoD: khi createdBy === currentUserId thì hiện cảnh báo + disable nút Duyệt.
 *  - FSM một chiều: draft → Duyệt nút; approved → Phát hành nút; published → khoá.
 */
export function PayrollPeriodTable({
  rows,
  currentUserId,
  onApprove,
  onPublish,
  errors = {},
}: PayrollPeriodTableProps) {
  const { t } = useTranslation("payroll");
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("periods.empty")}</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const isSodViolation = row.createdBy === currentUserId;
        const rowError = errors[row.id];

        return (
          <div key={row.id} className="rounded-lg border border-border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="font-medium">{t("periods.periodLabel", { periodMonth: row.periodMonth })}</p>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PERIOD_STATUS_BADGE[row.status]}`}
                >
                  {PERIOD_STATUS_LABELS[row.status]}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {row.status === "draft" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSodViolation}
                    onClick={() => onApprove(row.id)}
                  >
                    {t("periods.approveButton")}
                  </Button>
                )}
                {row.status === "approved" && (
                  <Button size="sm" onClick={() => onPublish(row.id)}>
                    {t("periods.publishButton")}
                  </Button>
                )}
              </div>
            </div>

            {/* SoD warning — shown when currentUser === createdBy */}
            {row.status === "draft" && <SodWarning show={isSodViolation} />}

            {/* Server error (fail-closed) */}
            {rowError && (
              <p role="alert" className="text-sm text-destructive">
                {rowError}
              </p>
            )}

            {/* Audit trail */}
            <dl className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              {row.createdBy && (
                <>
                  <dt>{t("periods.audit.createdBy")}</dt>
                  <dd className="col-span-2 font-mono truncate">{row.createdBy}</dd>
                </>
              )}
              {row.approvedBy && (
                <>
                  <dt>{t("periods.audit.approvedBy")}</dt>
                  <dd className="col-span-2 font-mono truncate">{row.approvedBy}</dd>
                </>
              )}
              {row.publishedBy && (
                <>
                  <dt>{t("periods.audit.publishedBy")}</dt>
                  <dd className="col-span-2 font-mono truncate">{row.publishedBy}</dd>
                </>
              )}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
