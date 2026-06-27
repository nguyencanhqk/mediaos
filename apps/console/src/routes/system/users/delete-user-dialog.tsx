import { useTranslation } from "react-i18next";
import type { AdminUserDto } from "@mediaos/contracts";
import { Button, Dialog } from "@mediaos/ui";

interface DeleteUserDialogProps {
  open: boolean;
  user: AdminUserDto;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Dialog xác nhận xoá mềm tài khoản user — yêu cầu delete-user:user (is_sensitive).
 * Xoá mềm: server set deleted_at + status='suspended'. Không thể hoàn tác qua UI.
 */
export function DeleteUserDialog({
  open,
  user,
  pending,
  error,
  onConfirm,
  onClose,
}: DeleteUserDialogProps) {
  const { t } = useTranslation("users");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("delete.title")}
      description={t("delete.description", { email: user.email })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("delete.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? t("common:saving") : t("delete.confirm")}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" aria-live="assertive" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Dialog>
  );
}
