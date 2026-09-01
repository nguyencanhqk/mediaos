import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import type { PayrollPeriodLineDto } from "@mediaos/contracts";
import { Button, Dialog, Input } from "@mediaos/ui";
import { parsePayrollError, payrollErrorI18nKey } from "../payroll-errors";

/**
 * PAY-SCREEN-002 — điều chỉnh tay MỘT dòng lương (PAYROLL-API-009, `calculate:payroll-period`).
 *
 * ⚠️ **`adjustmentAmount` CÓ DẤU** (dương = truy lĩnh · âm = truy thu) và nằm NGOÀI `gross`/`deduction`
 * — nó cố ý ngoài CHECK `payroll_period_lines_amounts_check`. Đừng ép `Math.abs`, đừng thêm nút
 * «thu/chi» rồi tự đổi dấu: người dùng gõ thẳng số âm.
 *
 * ⚠️ **Lý do BẮT BUỘC khi số ≠ 0** — mirror ĐÚNG BẰNG CHECK `payroll_period_lines_adjustment_check`
 * (`adjustment_amount = 0 OR adjustment_reason IS NOT NULL`). Gửi thiếu là `23514` = 500 ở vùng đỏ.
 * Ngược lại khi số = 0 thì lý do KHÔNG bắt buộc (đó là đường "gỡ điều chỉnh").
 *
 * ⚠️ Route này trả `PayrollWriteResultDto` — **0 khoá tiền** (SPEC-11 §21). `net` mới tính lại ở SQL và
 * chỉ đọc được qua `GET …/lines`; vì thế `onSuccess` invalidate `linesOf(periodId)` chứ không "cập
 * nhật tại chỗ" từ kết quả mutation — ở đó không có số.
 */
export function AdjustLineDialog({
  open,
  onClose,
  periodId,
  line,
}: {
  open: boolean;
  onClose: () => void;
  periodId: string;
  line: PayrollPeriodLineDto | null;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (open && line) {
      // Trường tiền có thể VẮNG (server mask) — `?? 0` ở ĐÂY là đúng: form đang GHI, và giá trị khởi tạo
      // của một ô nhập không phải là dữ liệu hiển thị. Người không có cặp chở-tiền không mở được màn này.
      setAmount(String(line.adjustmentAmount ?? 0));
      setReason(line.adjustmentReason ?? "");
      setErrorKey(null);
    }
  }, [open, line]);

  const parsedAmount = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(parsedAmount);
  const reasonRequired = amountValid && parsedAmount !== 0;
  const canSubmit = amountValid && (!reasonRequired || reason.trim() !== "");

  const mutation = useMutation({
    mutationFn: () => {
      if (line === null) throw new Error("no line");
      return payrollApi.adjustLine(periodId, line.id, {
        adjustmentAmount: parsedAmount,
        ...(reason.trim() ? { adjustmentReason: reason.trim() } : {}),
      });
    },
    onSuccess: () => {
      // Prefix: dòng đổi ⇒ MỌI trang/lọc đang cache của kỳ này phải làm mới, không chỉ trang đang mở.
      void queryClient.invalidateQueries({ queryKey: payrollKeys.periods.linesOf(periodId) });
      onClose();
    },
    onError: (error) => setErrorKey(payrollErrorI18nKey(parsePayrollError(error))),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("adjust.title")}
      description={t("adjust.description")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
            {t("adjust.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("adjust.amountLabel")}</span>
          <Input
            value={amount}
            inputMode="numeric"
            onChange={(e) => setAmount(e.target.value)}
            className="tabular-nums"
          />
          <span className="mt-1 block text-xs text-muted-foreground">{t("adjust.amountHint")}</span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">
            {reasonRequired ? t("adjust.reasonLabelRequired") : t("adjust.reasonLabel")}
          </span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {reasonRequired && reason.trim() === "" && (
            <span className="mt-1 block text-xs text-danger">{t("adjust.reasonRequired")}</span>
          )}
        </label>

        {errorKey && <p className="text-sm text-danger">{t(errorKey)}</p>}
      </div>
    </Dialog>
  );
}
