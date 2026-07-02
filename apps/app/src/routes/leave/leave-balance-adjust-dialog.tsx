import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adjustLeaveBalanceSchema } from "@mediaos/contracts";
import type { LeaveBalanceAdminView } from "@mediaos/contracts";
import { leaveApi, leaveInvalidation, ApiError } from "@mediaos/web-core";
import { Dialog, Button, Input } from "@mediaos/ui";

/**
 * Dialog "Điều chỉnh số dư phép" (LEAVE-SCREEN-013 · S3-FE-LEAVE-5).
 *
 * Gate: adjust:leave-balance (SENSITIVE, Company-scope hr/company-admin, mig 0455) — CHỦ Ý KHÔNG tự
 * check quyền ở đây; caller (LeaveBalancesPage / LeaveBalanceTransactionsPage) bọc nút mở dialog bằng
 * `<PermissionGate action="adjust" resourceType="leave-balance">` — cổng THẬT vẫn ở server
 * (POST /leave/admin/balances/:id/adjust), dialog chỉ là UI-hint.
 *
 * amountDays validate qua contract `adjustLeaveBalanceSchema` (≠0, |amount|<=366) — KHÔNG tự chế rule.
 * Server LUÔN ghi 1 dòng leave_balance_transactions kèm UPDATE total_days (bất biến #2, append-only) —
 * client KHÔNG có cách nào sửa số dư ngoài luồng này.
 */
export function AdjustBalanceDialog({
  balanceId,
  onClose,
  onSuccess,
}: {
  /** id của leave_balances — CHỈ cần id (dialog KHÔNG phụ thuộc field hiển thị khác của balance),
   * dùng chung được cho cả LeaveBalancesPage (đã có row đầy đủ) lẫn LeaveBalanceTransactionsPage
   * (chỉ có balanceId từ route param). */
  balanceId: string;
  onClose: () => void;
  onSuccess?: (updated: LeaveBalanceAdminView) => void;
}) {
  const { t } = useTranslation("leave");
  const queryClient = useQueryClient();
  const [amountDays, setAmountDays] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: { amountDays: number; reason: string }) =>
      leaveApi.adjustBalance(balanceId, body),
    onSuccess: async (updated) => {
      await Promise.all(
        leaveInvalidation
          .adjustBalance(balanceId)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onSuccess?.(updated);
      onClose();
    },
  });

  function submit() {
    const parsed = adjustLeaveBalanceSchema.safeParse({
      amountDays: Number(amountDays),
      reason: reason.trim(),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setFieldError(
        issue?.path[0] === "reason"
          ? t("adjustBalance.reasonRequired")
          : t("adjustBalance.amountRequired"),
      );
      return;
    }
    setFieldError(null);
    mutation.mutate(parsed.data);
  }

  const busy = mutation.isPending;

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={t("adjustBalance.title")}
      description={t("adjustBalance.description")}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t("adjustBalance.cancel")}
          </Button>
          <Button size="sm" onClick={submit} disabled={busy} data-testid="btn-confirm-adjust">
            {busy ? t("adjustBalance.submitting") : t("adjustBalance.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {mutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error instanceof ApiError && mutation.error.status === 403
              ? t("adjustBalance.forbidden")
              : t("adjustBalance.error")}
          </p>
        )}
        <div className="space-y-1.5">
          <label htmlFor="adjust-amount-days" className="text-sm font-medium text-foreground">
            {t("adjustBalance.amountLabel")}
            <span className="ml-0.5 text-destructive">*</span>
          </label>
          <Input
            id="adjust-amount-days"
            type="number"
            step="0.5"
            value={amountDays}
            placeholder={t("adjustBalance.amountPlaceholder")}
            onChange={(e) => setAmountDays(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="adjust-reason" className="text-sm font-medium text-foreground">
            {t("adjustBalance.reasonLabel")}
            <span className="ml-0.5 text-destructive">*</span>
          </label>
          <Input
            id="adjust-reason"
            value={reason}
            placeholder={t("adjustBalance.reasonPlaceholder")}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {fieldError && (
          <p role="alert" className="text-sm text-destructive">
            {fieldError}
          </p>
        )}
      </div>
    </Dialog>
  );
}
