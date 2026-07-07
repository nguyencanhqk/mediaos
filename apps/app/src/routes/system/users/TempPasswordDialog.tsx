/**
 * S2-AUTH-USEROPS-1 — dialog hiển thị MẬT KHẨU TẠM sau khi admin đặt lại mật khẩu.
 *
 * BẤT BIẾN #3: tempPassword CHỈ tồn tại trong props/RAM của dialog — KHÔNG log, KHÔNG đưa vào
 * query-cache/store, KHÔNG persist. Đóng dialog = mất (server không bao giờ trả lại lần 2).
 * Người dùng đích bị ép đổi mật khẩu ở lần đăng nhập kế tiếp (must_change_password, mig 0469).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, KeyRound } from "lucide-react";
import { Button, Dialog } from "@mediaos/ui";

export interface TempPasswordDialogProps {
  open: boolean;
  email: string;
  tempPassword: string;
  revokedSessionCount: number;
  onClose: () => void;
}

export function TempPasswordDialog({
  open,
  email,
  tempPassword,
  revokedSessionCount,
  onClose,
}: TempPasswordDialogProps) {
  const { t } = useTranslation("system");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard bị chặn (permission/không secure-context) → người dùng vẫn đọc & gõ tay được.
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("users.resetPw.dialogTitle")}
      description={t("users.resetPw.dialogDescription", { email })}
      footer={
        <Button type="button" onClick={onClose}>
          {t("users.resetPw.close")}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          {/* select-all để bôi đen nhanh; font-mono tránh nhầm ký tự */}
          <code className="flex-1 select-all break-all font-mono text-sm">{tempPassword}</code>
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span className="ml-1">
              {copied ? t("users.resetPw.copied") : t("users.resetPw.copy")}
            </span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("users.resetPw.showOnceWarning")}</p>
        <p className="text-xs text-muted-foreground">{t("users.resetPw.mustChangeNote")}</p>
        <p className="text-xs text-muted-foreground">
          {t("users.resetPw.revoked", { count: revokedSessionCount })}
        </p>
      </div>
    </Dialog>
  );
}
