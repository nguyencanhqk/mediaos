import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AdminUserDto } from "@mediaos/contracts";
import { Button, Dialog } from "@mediaos/ui";

interface SuspendUserDialogProps {
  open: boolean;
  user: AdminUserDto;
  pending: boolean;
  error: string | null;
  onConfirm: (reason?: string) => void;
  onClose: () => void;
}

/**
 * Dialog xác nhận khoá tài khoản user — yêu cầu suspend:user (is_sensitive).
 * Reason là tuỳ chọn (ghi vào audit log phía server).
 */
export function SuspendUserDialog({
  open,
  user,
  pending,
  error,
  onConfirm,
  onClose,
}: SuspendUserDialogProps) {
  const { t } = useTranslation("users");
  const [reason, setReason] = useState("");

  function handleConfirm() {
    onConfirm(reason.trim() || undefined);
  }

  function handleClose() {
    setReason("");
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t("suspend.title")}
      description={t("suspend.description", { email: user.email })}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={pending}>
            {t("suspend.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? t("common:saving") : t("suspend.confirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <label htmlFor="suspend-reason" className="text-sm font-medium">
          {t("suspend.reasonLabel")}
        </label>
        <textarea
          id="suspend-reason"
          className="w-full rounded border border-border px-3 py-2 text-sm"
          placeholder={t("suspend.reasonPlaceholder")}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={pending}
          maxLength={500}
        />
      </div>
      {error && (
        <p role="alert" aria-live="assertive" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </Dialog>
  );
}
