import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, PlusCircle, RefreshCw, ListChecks } from "lucide-react";
import type { LeaveBalanceView } from "@mediaos/contracts";
import { leaveApi, leaveKeys, useCan } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent } from "@mediaos/ui";
import { LEAVE_ENGINE_PAIRS, LEAVE_PATHS } from "./constants";

// ── LeaveBalanceCard ──────────────────────────────────────────────────────────

interface LeaveBalanceCardProps {
  balance: LeaveBalanceView;
}

export function LeaveBalanceCard({ balance }: LeaveBalanceCardProps) {
  const { t } = useTranslation("leave");
  const unit = t(`overview.balance.unit.${balance.unit}`, { defaultValue: balance.unit });
  const pct =
    balance.openingBalance > 0 ? Math.round((balance.usedDays / balance.openingBalance) * 100) : 0;
  const isLow = balance.remainingDays <= 1;

  return (
    <Card className={isLow ? "border-warning/60" : undefined}>
      <CardContent className="pt-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">{balance.leaveType.name}</span>
          <span className="text-xs text-muted-foreground">{balance.periodYear}</span>
        </div>

        {/* Metric grid */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-bold text-foreground">{balance.remainingDays}</p>
            <p className="text-xs text-muted-foreground">{t("overview.balance.remaining")}</p>
            <p className="text-xs text-muted-foreground">{unit}</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-muted-foreground">{balance.usedDays}</p>
            <p className="text-xs text-muted-foreground">{t("overview.balance.used")}</p>
            <p className="text-xs text-muted-foreground">{unit}</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-amber-600">{balance.reservedDays}</p>
            <p className="text-xs text-muted-foreground">{t("overview.balance.reserved")}</p>
            <p className="text-xs text-muted-foreground">{unit}</p>
          </div>
        </div>

        {/* Progress bar */}
        {balance.openingBalance > 0 && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(pct, 100)}%` }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${pct}% đã dùng`}
              />
            </div>
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {t("overview.balance.opening")}: {balance.openingBalance} {unit}
            </p>
          </div>
        )}

        {isLow && (
          <p className="mt-2 text-xs text-warning-foreground" role="alert">
            {t("overview.warning.lowBalance", { days: balance.remainingDays })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── MyLeaveBalancePage ─────────────────────────────────────────────────────────

export function MyLeaveBalancePage() {
  const { t } = useTranslation("leave");
  const navigate = useNavigate();
  const canViewBalance = useCan(
    LEAVE_ENGINE_PAIRS.VIEW_OWN_BALANCE.action,
    LEAVE_ENGINE_PAIRS.VIEW_OWN_BALANCE.resourceType,
  );
  const canCreate = useCan(
    LEAVE_ENGINE_PAIRS.CREATE_REQUEST.action,
    LEAVE_ENGINE_PAIRS.CREATE_REQUEST.resourceType,
  );

  const {
    data: balances,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: leaveKeys.balances.my(),
    queryFn: () => leaveApi.getMyBalances(),
    enabled: canViewBalance,
    staleTime: 60_000,
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canViewBalance) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("overview.forbidden.title")}
          description={t("overview.forbidden.description")}
        />
      </div>
    );
  }

  const year = new Date().getFullYear();

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("overview.title")}
        description={t("overview.description") + " — " + t("overview.currentYear", { year })}
        icon={CalendarDays}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigate({ to: LEAVE_PATHS.MY_REQUESTS as "/" })}
            >
              <ListChecks className="mr-2 h-4 w-4" />
              {t("myRequests.title")}
            </Button>
            {canCreate && (
              <Button size="sm" onClick={() => void navigate({ to: LEAVE_PATHS.CREATE as "/" })}>
                <PlusCircle className="mr-2 h-4 w-4" />
                {t("overview.createRequest")}
              </Button>
            )}
          </div>
        }
      />

      {/* ── Error ── */}
      {isError && (
        <EmptyState
          title={t("overview.error.title")}
          description={t("overview.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      )}

      {/* ── Loading skeleton ── */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-5">
                <div className="animate-pulse space-y-3">
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="grid grid-cols-3 gap-3">
                    <div className="h-12 rounded bg-muted" />
                    <div className="h-12 rounded bg-muted" />
                    <div className="h-12 rounded bg-muted" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Empty ── */}
      {!isLoading && !isError && balances?.length === 0 && (
        <EmptyState
          title={t("overview.empty.title")}
          description={t("overview.empty.description")}
          action={
            canCreate ? (
              <Button size="sm" onClick={() => void navigate({ to: LEAVE_PATHS.CREATE as "/" })}>
                <PlusCircle className="mr-2 h-4 w-4" />
                {t("overview.createRequest")}
              </Button>
            ) : undefined
          }
        />
      )}

      {/* ── Balance cards ── */}
      {!isLoading && !isError && (balances?.length ?? 0) > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {balances!.map((b) => (
            <LeaveBalanceCard key={b.id} balance={b} />
          ))}
        </div>
      )}
    </div>
  );
}
