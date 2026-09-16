import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import type { PayrollAdvanceDto } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { parsePayrollError, payrollErrorI18nKey } from "../payroll-errors";
import type { PayrollPeopleLookup } from "../use-payroll-people";

const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * PAY-SCREEN-012 — tạo (060) **hoặc** sửa (062) một khoản tạm ứng, trong CÙNG một dialog.
 *
 * ⚠️ **Body tạo và sửa KHÔNG cùng hình dạng — cả hai `.strict()`.** Tạo gửi
 * `{ userId, amount, deductPeriodMonth, reason }`; sửa gửi CHỈ những trường đổi trong
 * `{ amount?, deductPeriodMonth?, reason? }`. `userId` KHÔNG đổi được sau khi tạo (không có trong body
 * sửa) và KHÔNG BAO GIỜ gửi `createdBy`/`status` — khoá lạ ⇒ 400 (BE-4B L7).
 *
 * ⚠️ `amount` LUÔN DƯƠNG (mirror `payroll_advances_amount_check`); `reason` **BẮT BUỘC**
 * (`.trim().min(1)` là lớp NỘI DUNG, DB chỉ chặn NULL chứ không chặn chuỗi khoảng trắng).
 *
 * ⚠️ `deductPeriodMonth` là **tháng khấu trừ**, không phải id kỳ lương — khoản được gộp vào kỳ lúc
 * `calculate` khớp `deduct_period_month` + `status='Approved'` + chưa consume.
 */
export function AdvanceFormDialog({
  open,
  onClose,
  people,
  advance,
}: {
  open: boolean;
  onClose: () => void;
  people: PayrollPeopleLookup;
  advance?: PayrollAdvanceDto | null;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const isEdit = advance != null;

  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [deductPeriodMonth, setDeductPeriodMonth] = useState("");
  const [reason, setReason] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUserId("");
      setAmount("");
      setDeductPeriodMonth("");
      setReason("");
      setErrorKey(null);
      return;
    }
    setUserId(advance?.userId ?? "");
    setAmount(advance?.amount !== undefined ? String(advance.amount) : "");
    setDeductPeriodMonth(advance?.deductPeriodMonth ?? "");
    setReason(advance?.reason ?? "");
    setErrorKey(null);
    // Bám theo cả `open` lẫn `advance`: tái nạp form mỗi lần dialog mở lại với một khoản khác.
  }, [open, advance]);

  const parsedAmount = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const monthValid = PERIOD_MONTH_RE.test(deductPeriodMonth);
  const reasonValid = reason.trim() !== "" && reason.trim().length <= 500;
  const canSubmit = isEdit
    ? amountValid && monthValid && reasonValid
    : userId !== "" && amountValid && monthValid && reasonValid;

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? payrollApi.updateAdvance(advance.id, {
            amount: parsedAmount,
            deductPeriodMonth,
            reason: reason.trim(),
          })
        : payrollApi.createAdvance({
            userId,
            amount: parsedAmount,
            deductPeriodMonth,
            reason: reason.trim(),
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.advances.allOf() });
      onClose();
    },
    onError: (error) => setErrorKey(payrollErrorI18nKey(parsePayrollError(error))),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t("advanceForm.editTitle") : t("advanceForm.title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
            {isEdit ? t("advanceForm.save") : t("advanceForm.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("advanceForm.employeeLabel")}</span>
          <Select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={isEdit || people.isLoading}
          >
            <option value="">{t("advanceForm.employeePlaceholder")}</option>
            {[...people.byUserId.entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          {!people.canResolve && (
            <span className="mt-1 block text-xs text-danger">
              {t("advanceForm.pickerNoPermission")}
            </span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("advanceForm.amountLabel")}</span>
          <Input
            value={amount}
            inputMode="numeric"
            onChange={(e) => setAmount(e.target.value)}
            className="tabular-nums"
          />
          {amount !== "" && !amountValid && (
            <span className="mt-1 block text-xs text-danger">{t("advanceForm.amountInvalid")}</span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("advanceForm.monthLabel")}</span>
          <Input
            value={deductPeriodMonth}
            onChange={(e) => setDeductPeriodMonth(e.target.value)}
            placeholder="2026-09"
          />
          {deductPeriodMonth !== "" && !monthValid && (
            <span className="mt-1 block text-xs text-danger">{t("advanceForm.monthInvalid")}</span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("advanceForm.reasonLabel")}</span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {reason.trim() === "" && (
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("advanceForm.reasonRequired")}
            </span>
          )}
        </label>

        {errorKey && <p className="text-sm text-danger">{t(errorKey)}</p>}
      </div>
    </Dialog>
  );
}
