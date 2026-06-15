import { useState } from "react";
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
      setError(err instanceof Error ? err.message : "Lỗi xác nhận.");
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
      setError(err instanceof Error ? err.message : "Lý do không hợp lệ.");
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
      setError(err instanceof Error ? err.message : "Lỗi xử lý khiếu nại.");
    } finally {
      setLoading(false);
    }
  };

  // Already acknowledged/disputed/resolved → show status
  if (ack) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Trạng thái:{" "}
          <span className="font-medium">
            {ack.status === "acknowledged" && "Đã xác nhận"}
            {ack.status === "disputed" && "Đang khiếu nại"}
            {ack.status === "resolved" && "Đã xử lý"}
          </span>
        </p>
        {ack.reason && (
          <p className="text-sm">
            Lý do khiếu nại: <span className="italic">{ack.reason}</span>
          </p>
        )}
        {ack.resolutionNote && (
          <p className="text-sm text-green-700">Ghi chú xử lý: {ack.resolutionNote}</p>
        )}

        {/* HR: resolve disputed */}
        {isHr && ack.status === "disputed" && !showResolveForm && (
          <Button size="sm" variant="outline" onClick={() => setShowResolveForm(true)}>
            Xử lý khiếu nại
          </Button>
        )}
        {isHr && ack.status === "disputed" && showResolveForm && (
          <form onSubmit={handleResolve} className="space-y-2">
            <Input
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="Ghi chú xử lý (tuỳ chọn)"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? "Đang xử lý…" : "Xác nhận xử lý"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowResolveForm(false)}>
                Huỷ
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
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!showDisputeForm && (
        <div className="flex gap-2">
          <Button size="sm" onClick={handleAcknowledge} disabled={loading}>
            {loading ? "Đang xác nhận…" : "Xác nhận"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowDisputeForm(true)} disabled={loading}>
            Khiếu nại
          </Button>
        </div>
      )}

      {showDisputeForm && (
        <form onSubmit={handleDispute} className="space-y-2">
          <Input
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder="Lý do khiếu nại (bắt buộc)"
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={loading || !disputeReason.trim()}>
              {loading ? "Đang gửi…" : "Gửi khiếu nại"}
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
              Huỷ
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
