import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { PayrollPeriodStatus, PayslipDto } from "@mediaos/contracts";
import { payslipApi } from "@/lib/payslip-api";
import { payrollPeriodApi } from "@/lib/payroll-period-api";
import { ApiError } from "@/lib/api-client";
import { Select } from "@/components/ui/select";
import { PayslipTable } from "@/components/payroll/payslip-table";
import { PayslipDetail } from "@/components/payroll/payslip-detail";
import { PayslipAckActions } from "@/components/payroll/payslip-ack-actions";
import { usePayslipReauthController } from "@/components/payroll/use-payslip-reauth-controller";
import { PERIOD_STATUS_LABELS } from "@/components/payroll/period-constants";
import { useAuthStore } from "@/stores/auth";

/**
 * PayslipsPage (B1) — "Phiếu lương của tôi" (employee self-service) at /payroll/payslips.
 *
 * Lương NHẠY CẢM (BẤT BIẾN #3):
 *  - The list uses payslipApi.listOwn → GET /payslips/me/list returns a money-FREE projection
 *    (no net/gross/base), so money never enters component state or the React Query cache. The table
 *    has NO money columns. Ownership (user_id = self) is enforced SERVER-SIDE — no userId is sent.
 *  - Detail money is fetched ONLY after re-auth via the OWN endpoints wired into
 *    usePayslipReauthController ({ reauth: reauthOwn, getOne: getOwn } — a direct fetch, never
 *    useQuery) and held in ephemeral state that is cleared whenever the selection changes.
 *  - A 403 on the list surfaces as a permission notice, never as leaked numbers.
 *
 * B1: this page now wires the employee OWN endpoints (view-own-payslip, re-auth-gated, ownership-scoped
 * server-side) instead of the admin GET /payslips. A plain employee who holds only view-own-payslip can
 * list their slips and reveal money after re-auth — no more degrade-to-403 for normal staff. The 403
 * branch remains as defense-in-depth for callers who lack even view-own-payslip.
 */
export function PayslipsPage() {
  const { t } = useTranslation("payroll");
  const qc = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id ?? "");
  const [periodStatus, setPeriodStatus] = useState<PayrollPeriodStatus | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Tracks the selection synchronously so an in-flight reveal can be discarded if the user
  // navigates away before it resolves (revealed money must belong to the CURRENT selection).
  const selectedIdRef = useRef<string | null>(null);
  // Revealed money — ephemeral ONLY (never cached). Cleared on selection / filter change → re-mask.
  const [revealed, setRevealed] = useState<PayslipDto | null>(null);
  // B1: reveal goes through the OWN endpoints (re-auth-gated, ownership-scoped server-side).
  const { requestReauth, modal } = usePayslipReauthController({
    reauth: payslipApi.reauthOwn,
    getOne: payslipApi.getOwn,
  });

  const {
    data: rows = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    // B1: money-FREE own list. Ownership (user_id = self) enforced SERVER-SIDE — no userId param.
    queryKey: ["payslips", "mine"],
    queryFn: () => payslipApi.listOwn(),
    retry: false,
  });

  // Period labels/status are an enrichment for display + filter. Best-effort: only after the payslip
  // list succeeds (so we never fire a known-403 for roles that can't read payslips anyway).
  const isSuccess = !isLoading && !isError;
  const { data: periods = [], isError: periodsError } = useQuery({
    queryKey: ["payroll-periods"],
    queryFn: () => payrollPeriodApi.list(),
    enabled: isSuccess,
    retry: false,
  });

  const periodLabels = useMemo(
    () => Object.fromEntries(periods.map((p) => [p.id, p.periodMonth])),
    [periods],
  );
  const periodStatuses = useMemo(
    () =>
      Object.fromEntries(periods.map((p) => [p.id, p.status])) as Record<
        string,
        PayrollPeriodStatus
      >,
    [periods],
  );

  const visibleRows = useMemo(() => {
    if (!periodStatus) return rows;
    return rows.filter((r) => periodStatuses[r.payrollPeriodId] === periodStatus);
  }, [rows, periodStatus, periodStatuses]);

  const selectedRow = visibleRows.find((r) => r.id === selectedId) ?? null;
  const revealedForSelected =
    revealed && selectedRow && revealed.id === selectedRow.id ? revealed : undefined;

  const { data: ackData, isError: ackError } = useQuery({
    queryKey: ["payslip-acks", selectedId],
    queryFn: () => payslipApi.listAcknowledgements(selectedId as string),
    enabled: !!selectedId,
    retry: false,
  });
  // ONLY the current user's own ack — never fall back to data[0] (the list may include other
  // people's acks for HR), which would mislabel a stranger's record as "mine".
  const myAck = ackData?.find((a) => a.userId === currentUserId);

  const handleSelect = (id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setRevealed(null); // re-mask when switching payslips
  };

  const handlePeriodFilterChange = (next: PayrollPeriodStatus | "") => {
    setPeriodStatus(next);
    // Re-mask on filter change: a filter round-trip must NOT re-surface money without a fresh re-auth.
    setRevealed(null);
  };

  const handleRequestReauth = async () => {
    if (!selectedRow) return;
    const id = selectedRow.id;
    const detail = await requestReauth(id);
    // Discard if the user moved on while the re-auth was in flight — money must match the selection.
    if (detail && selectedIdRef.current === id) setRevealed(detail);
  };

  const isForbidden = error instanceof ApiError && error.status === 403;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">{t("payslips.pageTitle")}</h1>

      <div className="space-y-1">
        <label
          htmlFor="payslip-period-filter"
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          {t("payslips.filterPeriodStatus")}
        </label>
        <Select
          id="payslip-period-filter"
          value={periodStatus}
          onChange={(e) => handlePeriodFilterChange(e.target.value as PayrollPeriodStatus | "")}
          className="w-44"
        >
          <option value="">{t("payslips.all")}</option>
          {(Object.keys(PERIOD_STATUS_LABELS) as PayrollPeriodStatus[]).map((s) => (
            <option key={s} value={s}>
              {PERIOD_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("payslips.loading")}</p>}
      {isError && isForbidden && (
        <p role="alert" className="text-sm text-amber-600">
          {t("payslips.forbidden")}
        </p>
      )}
      {isError && !isForbidden && (
        <p role="alert" className="text-sm text-destructive">
          {t("payslips.loadFailed")}
        </p>
      )}

      {/* Period enrichment is best-effort; if it fails, say so — the label/status columns and the
          filter above rely on it and would otherwise mislead (raw ids + an all-hiding filter). */}
      {!isLoading && !isError && periodsError && (
        <p role="status" className="text-xs text-amber-600">
          {t("payslips.periodsLoadFailed")}
        </p>
      )}

      {!isLoading && !isError && (
        <div className="grid gap-6 md:grid-cols-[1fr_360px]">
          <PayslipTable
            rows={visibleRows}
            periodLabels={periodLabels}
            periodStatuses={periodStatuses}
            selectedId={selectedId}
            onSelect={handleSelect}
          />

          {selectedRow && (
            <div className="space-y-4">
              <PayslipDetail
                payslipId={selectedRow.id}
                onRequestReauth={handleRequestReauth}
                revealedSlip={revealedForSelected}
              />
              {/* If we can't load the ack state, say so — otherwise the fresh acknowledge/dispute
                  buttons below would imply "not acted yet" when the truth is simply unknown. */}
              {ackError && (
                <p role="alert" className="text-sm text-amber-600">
                  {t("payslips.ackLoadFailed")}
                </p>
              )}
              {/* Self-service view ("Phiếu lương của tôi"): isHr=false on purpose. HR resolves disputes
                  from the payroll/HR surface, not here; the server enforces SoD regardless. */}
              <PayslipAckActions
                key={selectedRow.id}
                payslipId={selectedRow.id}
                ack={myAck}
                isHr={false}
                onSuccess={() =>
                  void qc.invalidateQueries({ queryKey: ["payslip-acks", selectedRow.id] })
                }
              />
            </div>
          )}
        </div>
      )}

      {modal}
    </div>
  );
}
