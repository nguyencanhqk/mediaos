import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Dialog } from "@mediaos/ui";

/**
 * S13-PAYROLL-FE-1 — hộp nhập LÝ DO bắt buộc, dùng chung cho `reject` (PAYROLL-API-012) và `reopen`
 * (016), và cho «từ chối thưởng/phạt» (028).
 *
 * ⚠️ Nút gửi **disabled khi lý do rỗng** — không phải để "cho đẹp": `reason`/`decisionNote` là NOT NULL
 * ở DB và mirror CHECK ở contracts (`bonus_penalties_reject_note_check`). Cho gửi rỗng là đẩy `23514`
 * lên thành 500 ở vùng đỏ thay vì một dòng chữ đỏ dưới ô nhập.
 *
 * `trim()` ở client là lớp NỘI DUNG (DB chỉ chặn NULL, không chặn chuỗi khoảng trắng) — cùng lý do
 * contracts khai `.trim().min(1)`.
 */
export function ReasonDialog({
  open,
  onClose,
  onSubmit,
  title,
  description,
  submitLabel,
  isPending,
  errorMessage,
  maxLength = 500,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  title: string;
  description?: string;
  submitLabel: string;
  isPending: boolean;
  errorMessage?: string | null;
  maxLength?: number;
}) {
  const { t } = useTranslation("payroll");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  const trimmed = reason.trim();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => onSubmit(trimmed)} disabled={trimmed === "" || isPending}>
            {submitLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("actions.reasonLabel")}</span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={maxLength}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("actions.reasonHint")}
          </span>
        </label>
        {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}
      </div>
    </Dialog>
  );
}
