import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
 * PayslipsPage (G12-FE) — "Phiếu lương của tôi" (employee self-service) at /payroll/payslips.
 *
 * Lương NHẠY CẢM (BẤT BIẾN #3):
 *  - The list uses payslipApi.listSummary → money is stripped at the API boundary, so net/gross never
 *    enter component state or the React Query cache. The table has NO money columns.
 *  - Detail money is fetched ONLY after re-auth via usePayslipReauthController (reauth → getOne, a direct
 *    fetch, never useQuery) and held in ephemeral state that is cleared whenever the selection changes.
 *  - A 403 on the list surfaces as a permission notice, never as leaked numbers.
 *
 * NOTE (BE follow-up, out of this FE-only lane): `view-payslip` is granted only to admin/hr, and the
 * server `GET /payslips` returns the full snapshot without re-auth. So this page only reveals money to
 * roles that hold view-payslip; a plain employee gets a 403 here until the BE adds an own-payslip,
 * re-auth-gated read for employees. The page degrades gracefully for that case.
 */
export function PayslipsPage() {
  const qc = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id ?? "");
  const [periodStatus, setPeriodStatus] = useState<PayrollPeriodStatus | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Tracks the selection synchronously so an in-flight reveal can be discarded if the user
  // navigates away before it resolves (revealed money must belong to the CURRENT selection).
  const selectedIdRef = useRef<string | null>(null);
  // Revealed money — ephemeral ONLY (never cached). Cleared on selection / filter change → re-mask.
  const [revealed, setRevealed] = useState<PayslipDto | null>(null);
  const { requestReauth, modal } = usePayslipReauthController();

  const {
    data: rows = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["payslips", "mine", currentUserId],
    queryFn: () => payslipApi.listSummary({ userId: currentUserId }),
    enabled: !!currentUserId,
    retry: false,
  });

  // Period labels/status are an enrichment for display + filter. Best-effort: only after the payslip
  // list succeeds (so we never fire a known-403 for roles that can't read payslips anyway).
  const isSuccess = !isLoading && !isError && !!currentUserId;
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
      <h1 className="text-2xl font-semibold">Phiếu lương của tôi</h1>

      <div className="space-y-1">
        <label
          htmlFor="payslip-period-filter"
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Trạng thái kỳ
        </label>
        <Select
          id="payslip-period-filter"
          value={periodStatus}
          onChange={(e) => handlePeriodFilterChange(e.target.value as PayrollPeriodStatus | "")}
          className="w-44"
        >
          <option value="">Tất cả</option>
          {(Object.keys(PERIOD_STATUS_LABELS) as PayrollPeriodStatus[]).map((s) => (
            <option key={s} value={s}>
              {PERIOD_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải phiếu lương…</p>}
      {isError && isForbidden && (
        <p role="alert" className="text-sm text-amber-600">
          Bạn không có quyền xem phiếu lương ở đây. Vui lòng liên hệ HR.
        </p>
      )}
      {isError && !isForbidden && (
        <p role="alert" className="text-sm text-destructive">
          Không tải được danh sách phiếu lương.
        </p>
      )}

      {/* Period enrichment is best-effort; if it fails, say so — the label/status columns and the
          filter above rely on it and would otherwise mislead (raw ids + an all-hiding filter). */}
      {!isLoading && !isError && periodsError && (
        <p role="status" className="text-xs text-amber-600">
          Không tải được thông tin kỳ lương — nhãn "Kỳ lương" và bộ lọc trạng thái có thể không
          chính xác.
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
                  Không tải được trạng thái xác nhận — trạng thái hiển thị có thể không chính xác.
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
