import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
      title="Đổi secret"
      description={label ? `Đặt secret mới cho "${label}".` : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            size="sm"
            onClick={() => update.mutate()}
            disabled={!parsed.success || update.isPending}
          >
            {update.isPending ? "Đang lưu…" : "Lưu secret mới"}
          </Button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Secret mới *</span>
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
          Lưu thất bại:{" "}
          {update.error instanceof Error ? update.error.message : "Lỗi không xác định"}
        </p>
      )}
    </Dialog>
  );
}
