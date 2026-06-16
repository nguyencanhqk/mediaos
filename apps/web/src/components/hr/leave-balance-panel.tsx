import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { leaveApi } from "@/lib/leave-api";
import { currentYear } from "./constants";

/**
 * Panel số phép còn lại của user hiện tại trong năm nay.
 */
export function LeaveBalancePanel() {
  const { t } = useTranslation("hr");
  const year = currentYear();

  const { data: balances = [], isLoading, isError } = useQuery({
    queryKey: ["leave", "balances", { scope: "me", year }],
    queryFn: () => leaveApi.listBalances({ scope: "me", year }),
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">{t("leaveBalance.loading")}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-destructive">{t("leaveBalance.loadError")}</p>
      </div>
    );
  }

  if (balances.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">{t("leaveBalance.empty", { year })}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold">{t("leaveBalance.heading", { year })}</h3>
      <div className="space-y-2">
        {balances.map((b) => {
          const pct =
            b.totalDays > 0 ? Math.round((b.usedDays / b.totalDays) * 100) : 0;
          return (
            <div key={b.id} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{b.leaveTypeName ?? "—"}</span>
                <span className="tabular-nums text-muted-foreground">
                  {t("leaveBalance.remaining", { remaining: b.remainingDays, total: b.totalDays })}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
