import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BonusPenaltyDto } from "@mediaos/contracts";
import { bonusPenaltyApi } from "@/lib/bonus-penalty-api";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";

interface BonusPenaltyDecisionActionsProps {
  row: BonusPenaltyDto;
  /** Id của user đang đăng nhập (auth store) — để chặn self-approve ở UI (mirror BE SoD). */
  currentUserId: string | null;
}

/** Lý do từ chối tối đa (parity decideBonusPenaltySchema.reason max 500). */
const REJECT_REASON_MAX = 500;

/**
 * Nút Duyệt/Từ chối cho 1 hàng thưởng/phạt. CHỈ render khi:
 *  - row.status === 'draft' (approved/rejected không còn quyết định),
 *  - row.createdBy !== currentUserId (CHẶN self-approve — mirror @RequirePermission + SoD ở service),
 *  - useCan('approve-bonus-penalty','bonus_penalty') (defense-in-depth UX; server là chốt thật).
 *
 * Lưu ý: UI chỉ là lớp UX. BE đã chốt (createdBy===user → 403). Nếu currentUserId=null (mock login
 * G1) thì createdBy !== null ⇒ KHÔNG match self ⇒ vẫn an toàn vì server vẫn 403 self-approve.
 */
export function BonusPenaltyDecisionActions({
  row,
  currentUserId,
}: BonusPenaltyDecisionActionsProps) {
  const canApprove = useCan("approve-bonus-penalty", "bonus_penalty");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["bonus-penalties"] });

  const approveMutation = useMutation({
    mutationFn: () => bonusPenaltyApi.approve(row.id),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "Không duyệt được"),
  });

  const rejectMutation = useMutation({
    mutationFn: () => bonusPenaltyApi.reject(row.id, reason ? { reason } : {}),
    onSuccess: () => {
      invalidate();
      setRejecting(false);
      setReason("");
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "Không từ chối được"),
  });

  const isSelf = currentUserId != null && row.createdBy === currentUserId;
  if (row.status !== "draft" || isSelf || !canApprove) return null;

  if (rejecting) {
    return (
      <div className="space-y-1">
        <textarea
          value={reason}
          maxLength={REJECT_REASON_MAX}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Lý do từ chối (tuỳ chọn)"
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
        />
        <div className="flex gap-1">
          <Button
            type="button"
            variant="destructive"
            disabled={rejectMutation.isPending}
            onClick={() => rejectMutation.mutate()}
          >
            Xác nhận từ chối
          </Button>
          <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
            Huỷ
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      <Button type="button" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate()}>
        Duyệt
      </Button>
      <Button type="button" variant="ghost" onClick={() => setRejecting(true)}>
        Từ chối
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
