import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollIdempotencyKey, payrollKeys } from "@mediaos/web-core";
import type { BonusKind } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { parsePayrollError, payrollErrorI18nKey } from "../payroll-errors";
import type { PayrollPeopleLookup } from "../use-payroll-people";

const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * PAY-SCREEN-005 — tạo khoản thưởng/phạt theo kỳ (PAYROLL-API-024, `manage:bonus-penalty`).
 *
 * ⚠️ **`amount` LUÔN DƯƠNG — `kind` mới là thứ mang dấu.** DB ép `bonus_penalties_amount_check
 * (amount > 0)` chính vì lý do đó: cho phép số âm thì một khoản "phạt −500.000" cộng vào `bonus` là mất
 * dấu ở chỗ khác. Đừng thêm ô "số âm = phạt".
 *
 * ⚠️ `reason` **BẮT BUỘC** (`reason NOT NULL` ở DB; `.trim().min(1)` ở contracts là lớp NỘI DUNG vì DB
 * không chặn chuỗi khoảng trắng).
 *
 * ⚠️ `periodMonth` là **tháng của khoản**, không phải id kỳ lương. Khoản được gộp vào kỳ lúc
 * `calculate` (khớp `period_month` + `status='Approved'` + chưa consume) — không có ô chọn kỳ ở đây.
 */
export function BonusPenaltyFormDialog({
  open,
  onClose,
  people,
  defaultPeriodMonth,
}: {
  open: boolean;
  onClose: () => void;
  people: PayrollPeopleLookup;
  defaultPeriodMonth?: string;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();

  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState<BonusKind>("bonus");
  const [amount, setAmount] = useState("");
  const [periodMonth, setPeriodMonth] = useState("");
  const [reason, setReason] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPeriodMonth(defaultPeriodMonth ?? "");
      return;
    }
    setUserId("");
    setKind("bonus");
    setAmount("");
    setReason("");
    setErrorKey(null);
  }, [open, defaultPeriodMonth]);

  const parsedAmount = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const canSubmit =
    userId !== "" && amountValid && PERIOD_MONTH_RE.test(periodMonth) && reason.trim() !== "";

  const mutation = useMutation({
    mutationFn: () =>
      payrollApi.createBonusPenalty(
        { userId, kind, amount: parsedAmount, periodMonth, reason: reason.trim() },
        // Neo theo (người, tháng, loại, số tiền): hai khoản CỐ Ý giống hệt nhau là chuyện hiếm và người
        // dùng sẽ thấy 409 idempotency — đúng hơn là âm thầm tạo hai khoản vì bấm đúp.
        payrollIdempotencyKey(`create-bonus-${kind}-${parsedAmount}`, userId, periodMonth),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.bonusPenalties.allOf() });
      onClose();
    },
    onError: (error) => setErrorKey(payrollErrorI18nKey(parsePayrollError(error))),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("bonusForm.title")}
      description={t("bonusForm.description")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
            {t("bonusForm.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("bonusForm.employeeLabel")}</span>
          <Select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={people.isLoading}
          >
            <option value="">{t("bonusForm.employeePlaceholder")}</option>
            {[...people.byUserId.entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          {!people.canResolve && (
            <span className="mt-1 block text-xs text-danger">
              {t("bonusForm.pickerNoPermission")}
            </span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("bonusForm.kindLabel")}</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value as BonusKind)}>
            <option value="bonus">{t("bonusKind.bonus")}</option>
            <option value="penalty">{t("bonusKind.penalty")}</option>
          </Select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("bonusForm.amountLabel")}</span>
          <Input
            value={amount}
            inputMode="numeric"
            onChange={(e) => setAmount(e.target.value)}
            className="tabular-nums"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("bonusForm.amountHint")}
          </span>
          {amount !== "" && !amountValid && (
            <span className="mt-1 block text-xs text-danger">{t("bonusForm.amountInvalid")}</span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("bonusForm.monthLabel")}</span>
          <Input
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            placeholder="2026-09"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("bonusForm.reasonLabel")}</span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {reason.trim() === "" && (
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("bonusForm.reasonRequired")}
            </span>
          )}
        </label>

        {errorKey && <p className="text-sm text-danger">{t(errorKey)}</p>}
      </div>
    </Dialog>
  );
}
