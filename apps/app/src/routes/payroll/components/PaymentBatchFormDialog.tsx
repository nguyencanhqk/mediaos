import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import type { PaymentBatchMethod } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { parsePayrollError, payrollErrorI18nKey } from "../payroll-errors";

const CODE_RE = /^[A-Za-z0-9_-]+$/;
const CODE_MAX = 40;

/**
 * PAY-SCREEN-013 — lập đợt chi trả (PAYROLL-API-067, `manage:payment-batch`, @Idempotent).
 *
 * ⚠️ **KHÔNG BAO GIỜ trường số tài khoản ở form này** (D6 của plan) — snapshot TK do SERVER sinh từ
 * `payroll_employee_settings` lúc lập đợt; body `.strict()` nên gửi thêm trường lạ (kể cả một khoá tài
 * khoản tưởng tượng) là 400. Form chỉ hỏi: kỳ nguồn · hình thức · mã (tuỳ chọn) · ngày chi · ghi chú.
 *
 * ⚠️ Kỳ nguồn CHỈ lấy từ picker lọc `status: ["Published"]` — đợt chỉ lập được từ kỳ đã phát hành
 * (khác ⇒ 409 `period-not-published`); đưa kỳ khác vào chọn là mời người dùng ăn đúng lỗi đó.
 *
 * ⚠️ `warnings` trả về là SỐ ĐẾM (`no-bank-account:<n>` · `zero-net:<n>`) hoặc chuỗi bare
 * `no-eligible-payees` — KHÔNG phải tiền, hiện thẳng cho người dùng sau khi tạo thành công.
 */
export function PaymentBatchFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();

  const [periodId, setPeriodId] = useState("");
  const [method, setMethod] = useState<PaymentBatchMethod>("bank");
  const [code, setCode] = useState("");
  const [payDate, setPayDate] = useState("");
  const [note, setNote] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[] | null>(null);

  useEffect(() => {
    if (!open) {
      setPeriodId("");
      setMethod("bank");
      setCode("");
      setPayDate("");
      setNote("");
      setErrorKey(null);
      setWarnings(null);
    }
  }, [open]);

  const periodsQuery = useQuery({
    queryKey: payrollKeys.periods.list({ status: ["Published"], page: 1, per_page: 100 }),
    queryFn: () => payrollApi.listPeriods({ status: ["Published"], page: 1, per_page: 100 }),
    enabled: open,
  });
  const periods = useMemo(() => periodsQuery.data?.data ?? [], [periodsQuery.data]);

  const codeValid =
    code.trim() === "" || (code.trim().length <= CODE_MAX && CODE_RE.test(code.trim()));
  const canSubmit = periodId !== "" && codeValid;

  const mutation = useMutation({
    mutationFn: () =>
      payrollApi.createPaymentBatch({
        payrollPeriodId: periodId,
        method,
        ...(code.trim() ? { code: code.trim() } : {}),
        ...(payDate ? { payDate } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.paymentBatches.allOf() });
      if (result.warnings.length > 0) {
        setWarnings(result.warnings);
        return;
      }
      onClose();
    },
    onError: (error) => setErrorKey(payrollErrorI18nKey(parsePayrollError(error))),
  });

  /** Diễn dịch một mục `warnings` thành câu tiếng Việt — hai dạng `<slug>:<n>` (số đếm) và bare `no-eligible-payees`. */
  const renderWarning = (warning: string): string => {
    if (warning === "no-eligible-payees") return t("paymentBatchForm.noEligiblePayees");
    const [slug, countRaw] = warning.split(":");
    const count = Number(countRaw ?? 0);
    if (slug === "no-bank-account") return t("paymentBatchForm.noBankAccount", { count });
    if (slug === "zero-net") return t("paymentBatchForm.zeroNet", { count });
    return warning;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("paymentBatchForm.title")}
      footer={
        warnings !== null ? (
          <Button onClick={onClose}>{t("actions.confirm")}</Button>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              {t("actions.cancel")}
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
              {t("paymentBatchForm.submit")}
            </Button>
          </div>
        )
      }
    >
      {warnings !== null ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {warnings.map((w) => (
            <li key={w}>{renderWarning(w)}</li>
          ))}
        </ul>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("paymentBatchForm.periodLabel")}</span>
            <Select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              disabled={periodsQuery.isLoading}
            >
              <option value="">{t("paymentBatchForm.periodPlaceholder")}</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.periodMonth}
                </option>
              ))}
            </Select>
            <span className="mt-1 block text-xs text-muted-foreground">
              {periods.length === 0 && !periodsQuery.isLoading
                ? t("paymentBatchForm.periodEmpty")
                : t("paymentBatchForm.periodHint")}
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("paymentBatchForm.methodLabel")}</span>
            <Select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentBatchMethod)}
            >
              <option value="bank">{t("paymentBatchMethod.bank")}</option>
              <option value="cash">{t("paymentBatchMethod.cash")}</option>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("paymentBatchForm.codeLabel")}</span>
            <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={CODE_MAX} />
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("paymentBatchForm.codeHint")}
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("paymentBatchForm.payDateLabel")}</span>
            <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("paymentBatchForm.noteLabel")}</span>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          {errorKey && <p className="text-sm text-danger">{t(errorKey)}</p>}
        </div>
      )}
    </Dialog>
  );
}
