import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileClock, ShieldAlert, ShieldOff } from "lucide-react";
import type { PayrollInsuranceIssue, PayrollOverviewRemindersDto } from "@mediaos/contracts";
import { formatDate } from "@mediaos/web-core";
import { Button, Card, Skeleton } from "@mediaos/ui";
import { formatPeriodMonth } from "../../report-view";

const LINK_CLASS = "text-left text-xs text-brand underline-offset-2 hover:underline";

/**
 * Lời nhắc (079) — 3 mục SỐ ĐẾM + link sâu. Link chỉ hiện khi người dùng MỞ ĐƯỢC màn đích (có callback —
 * trang cha chỉ truyền khi giữ cặp ĐƯỜNG TẢI của đích); không thì chỉ hiện số, không đưa họ tới trang 403.
 * Điều hướng qua callback (khuôn các trang PAYROLL) để component không phụ thuộc router.
 */
export function RemindersPanel({
  data,
  state,
  onRetry,
  onOpenPeriod,
  onOpenEmployees,
}: {
  data: PayrollOverviewRemindersDto | undefined;
  state: "loading" | "error" | "ready";
  onRetry: () => void;
  onOpenPeriod?: (periodId: string) => void;
  onOpenEmployees?: (issue: PayrollInsuranceIssue) => void;
}) {
  const { t } = useTranslation("payroll");

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="payroll-reminders">
      <h3 className="text-sm font-semibold text-foreground">{t("reminders.title")}</h3>
      {state === "loading" ? (
        <Skeleton className="h-24 w-full" />
      ) : state === "error" || !data ? (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{t("states.error")}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("states.retry")}
          </Button>
        </div>
      ) : (
        <ul className="space-y-3 text-sm">
          <li className="flex gap-2">
            <FileClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 space-y-1">
              <p className="text-foreground">
                {data.unpublishedPayslips.periodCount === 0
                  ? t("reminders.unpublishedNone")
                  : t("reminders.unpublished", {
                      count: data.unpublishedPayslips.payslipCount,
                      periods: data.unpublishedPayslips.periodCount,
                    })}
              </p>
              {data.unpublishedPayslips.periods.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {data.unpublishedPayslips.periods.map((p) => {
                    const text = t("reminders.periodItem", {
                      month: formatPeriodMonth(p.periodMonth),
                      count: p.payslipCount,
                    });
                    return (
                      <li key={p.id}>
                        {onOpenPeriod ? (
                          <button
                            type="button"
                            className={LINK_CLASS}
                            onClick={() => onOpenPeriod(p.id)}
                          >
                            {text}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{text}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </li>
          <InsuranceReminder
            icon={
              <ShieldOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            }
            text={t("reminders.uninsured", { count: data.uninsuredEmployees.count })}
            issue="not-joined"
            count={data.uninsuredEmployees.count}
            onOpen={onOpenEmployees}
          />
          <InsuranceReminder
            icon={
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            }
            text={
              data.insuranceSalaryOutOfRange.rateMissing
                ? t("reminders.rateMissing")
                : t("reminders.outOfRange", { count: data.insuranceSalaryOutOfRange.count })
            }
            hint={t("reminders.asOf", { date: formatDate(data.insuranceSalaryOutOfRange.asOf) })}
            issue="salary-out-of-range"
            count={
              data.insuranceSalaryOutOfRange.rateMissing ? 0 : data.insuranceSalaryOutOfRange.count
            }
            onOpen={onOpenEmployees}
          />
        </ul>
      )}
    </Card>
  );
}

function InsuranceReminder({
  icon,
  text,
  hint,
  issue,
  count,
  onOpen,
}: {
  icon: ReactNode;
  text: string;
  hint?: string;
  issue: PayrollInsuranceIssue;
  count: number;
  onOpen?: (issue: PayrollInsuranceIssue) => void;
}) {
  const { t } = useTranslation("payroll");
  return (
    <li className="flex gap-2">
      {icon}
      <div className="min-w-0 space-y-1">
        <p className="text-foreground">{text}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {onOpen && count > 0 && (
          <button type="button" className={LINK_CLASS} onClick={() => onOpen(issue)}>
            {t("reminders.view")}
          </button>
        )}
      </div>
    </li>
  );
}
