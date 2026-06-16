import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PayslipAcknowledgementDto } from "@mediaos/contracts";
import { payslipApi } from "@/lib/payslip-api";

interface PayslipAckActionsProps {
  payslipId: string;
  /** Existing acknowledgement if any. */
  ack?: PayslipAcknowledgementDto;
  /** True when current user is HR (can resolve disputed payslips). */
  isHr?: boolean;
  onSuccess?: (updated: PayslipAcknowledgementDto) => void;
}

/**
 * PayslipAckActions (G12-FE) — employee acknowledges / disputes payslip;
 * HR resolves disputed payslips.
 *
 * BẤT BIẾN: reason is validated by payslipApi.dispute (Zod) before network call.
 * KHÔNG chứa tiền — only status + reason text.
 */
export function PayslipAckActions({ payslipId, ack, isHr = false, onSuccess }: PayslipAckActionsProps) {
  const { t } = useTranslation("payroll");
  const [disputeReason, setDisputeReason] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [showResolveForm, setShowResolveForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAcknowledge = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await payslipApi.acknowledge(payslipId);
      onSuccess?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("payslips.ack.ackError"));
    } finally {
      setLoading(false);
    }
  };

  const handleDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await payslipApi.dispute(payslipId, disputeReason);
      setShowDisputeForm(false);
      setDisputeReason("");
      onSuccess?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("payslips.ack.disputeError"));
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await payslipApi.resolve(payslipId, resolutionNote || undefined);
      setShowResolveForm(false);
      setResolutionNote("");
      onSuccess?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("payslips.ack.resolveError"));
    } finally {
      setLoading(false);
    }
  };

  // Already acknowledged/disputed/resolved → show status
  if (ack) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {t("payslips.ack.statusLabel")}{" "}
          <span className="font-medium">
            {ack.status === "acknowledged" && t("payslips.ack.statusAcknowledged")}
            {ack.status === "disputed" && t("payslips.ack.statusDisputed")}
            {ack.status === "resolved" && t("payslips.ack.statusResolved")}
          </span>
        </p>
        {ack.reason && (
          <p className="text-sm">
            {t("payslips.ack.disputeReasonLabel")} <span className="italic">{ack.reason}</span>
          </p>
        )}
        {ack.resolutionNote && (
          <p className="text-sm text-green-700">{t("payslips.ack.resolutionNoteLabel")} {ack.resolutionNote}</p>
        )}

        {/* HR: resolve disputed */}
        {isHr && ack.status === "disputed" && !showResolveForm && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError(null);
              setShowResolveForm(true);
            }}
          >
            {t("payslips.ack.resolveButton")}
          </Button>
        )}
        {isHr && ack.status === "disputed" && showResolveForm && (
          <form onSubmit={handleResolve} className="space-y-2">
            <Input
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder={t("payslips.ack.resolutionNotePlaceholder")}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? t("payslips.ack.resolving") : t("payslips.ack.confirmResolve")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowResolveForm(false);
                  setError(null);
                }}
              >
                {t("payslips.ack.cancelButton")}
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  // No ack yet — show acknowledge / dispute actions
  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!showDisputeForm && (
        <div className="flex gap-2">
          <Button size="sm" onClick={handleAcknowledge} disabled={loading}>
            {loading ? t("payslips.ack.acknowledging") : t("payslips.ack.acknowledgeButton")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError(null);
              setShowDisputeForm(true);
            }}
            disabled={loading}
          >
            {t("payslips.ack.disputeButton")}
          </Button>
        </div>
      )}

      {showDisputeForm && (
        <form onSubmit={handleDispute} className="space-y-2">
          <Input
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder={t("payslips.ack.disputeReasonPlaceholder")}
            required
            maxLength={500}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={loading || !disputeReason.trim()}>
              {loading ? t("payslips.ack.submittingDispute") : t("payslips.ack.submitDispute")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowDisputeForm(false);
                setDisputeReason("");
                setError(null);
              }}
            >
              {t("payslips.ack.cancelButton")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
