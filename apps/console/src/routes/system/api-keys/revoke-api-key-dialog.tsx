import { useTranslation } from "react-i18next";
import type { ApiKeyDto } from "@mediaos/contracts";
import { Button, Dialog } from "@mediaos/ui";

interface RevokeApiKeyDialogProps {
  open: boolean;
  apiKey: ApiKeyDto;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Xác nhận thu hồi 1 PAT. Không thể hoàn tác — revoke set revoked_at ở BE. */
export function RevokeApiKeyDialog({
  open,
  apiKey,
  pending,
  error,
  onConfirm,
  onClose,
}: RevokeApiKeyDialogProps) {
  const { t } = useTranslation("api-keys");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("revoke.title")}
      description={t("revoke.description", { name: apiKey.name })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? t("common:saving") : t("revoke.confirm")}
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
