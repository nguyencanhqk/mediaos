import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  updatePlatformAccountSecretSchema,
  type SafePlatformAccountDto,
} from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { platformAccountsApi } from "@/lib/platform-accounts-api";

interface UpdateSecretDialogProps {
  /** null = đóng. Account đang đổi secret. */
  account: SafePlatformAccountDto | null;
  onClose: () => void;
}

/**
 * Đổi secret (rotate) — sinh DEK+nonce mới phía server. Plaintext mới chỉ ở form state, clear khi đóng.
 * Cần quyền `edit-platform-account` (gate ở table + enforce ở server).
 */
export function UpdateSecretDialog({ account, onClose }: UpdateSecretDialogProps) {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();
  const [secret, setSecret] = useState("");

  useEffect(() => {
    if (!account) setSecret("");
  }, [account]);

  const parsed = useMemo(() => updatePlatformAccountSecretSchema.safeParse({ secret }), [secret]);

  const update = useMutation({
    mutationFn: () => {
      if (!account) throw new Error("Không có tài khoản.");
      if (!parsed.success) throw new Error("Secret không hợp lệ.");
      return platformAccountsApi.updateSecret(account.id, parsed.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform-accounts"] });
      setSecret("");
      onClose();
    },
  });

  const label = account?.accountName ?? account?.accountIdentifier ?? account?.id ?? "";

  return (
    <Dialog
      open={account !== null}
      onClose={onClose}
      title={t("platformAccounts.updateSecretDialog.title")}
      description={label ? t("platformAccounts.updateSecretDialog.description", { label }) : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("platformAccounts.updateSecretDialog.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => update.mutate()}
            disabled={!parsed.success || update.isPending}
          >
            {update.isPending ? t("common:saving") : t("platformAccounts.updateSecretDialog.saveButton")}
          </Button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("platformAccounts.updateSecretDialog.fieldSecretNew")}</span>
        <Input
          type="password"
          autoComplete="new-password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="••••••••"
          maxLength={8192}
          autoFocus
        />
      </label>

      {update.isError && (
        <p className="mt-3 text-sm text-destructive">
          {t("platformAccounts.updateSecretDialog.saveError")}{" "}
          {update.error instanceof Error ? update.error.message : t("platformAccounts.updateSecretDialog.unknownError")}
        </p>
      )}
    </Dialog>
  );
}
