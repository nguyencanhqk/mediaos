import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, twoFactorApi } from "@mediaos/web-core";
import { Button, Input } from "@mediaos/ui";

interface TwoFactorChallengeFormProps {
  /** Challenge token nhận từ login khi 2FA bật. */
  challengeToken: string;
  /** Gọi khi verify thành công — phiên SSO (refresh+CSRF cookie) đã được server đặt ở /auth/2fa/verify. */
  onSuccess: () => void;
  onCancel?: () => void;
}

/** Thông báo lỗi thân thiện — KHÔNG render `err.message` thô từ BE (tránh lộ chi tiết nội bộ ở UI nhạy cảm). */
function friendlyError(err: unknown, t: TFunction<"auth">): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t("errors.tooManyAttempts");
    if (err.status >= 500) return t("errors.serverError");
    // 401/400/403 ở bước 2FA = mã sai/hết hạn → thông báo chung.
    return t("errors.invalidCode");
  }
  return t("errors.invalidCode");
}

/**
 * Bước 2 đăng nhập khi 2FA bật (FS-1b, chuyển từ apps/web). Nhập mã TOTP 6 số HOẶC một recovery code.
 * `verifyLogin` (@Public, skipAuth) thành công → server phát refresh+CSRF cookie SSO; caller điều hướng về
 * app đích. KHÔNG giữ access token ở apps/auth (app đích tự silent-refresh từ cookie).
 */
export function TwoFactorChallengeForm({ challengeToken, onSuccess, onCancel }: TwoFactorChallengeFormProps) {
  const { t } = useTranslation("auth");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    try {
      await twoFactorApi.verifyLogin(challengeToken, code.trim());
      onSuccess();
    } catch (err) {
      setError(friendlyError(err, t));
    } finally {
      // finally: nhả nút kể cả khi verify thành công nhưng điều hướng (onSuccess→redirect) chưa rời trang.
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold">{t("twoFactor.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("twoFactor.challengeHint")}</p>
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="tfa-code">
          {t("twoFactor.codeLabel")}
        </label>
        <Input
          id="tfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
      </div>
      {error && (
        <p role="alert" aria-live="assertive" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={onCancel}>
            {t("common:actions.back")}
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={busy || code.trim().length < 6}>
          {busy ? t("twoFactor.verifying") : t("common:actions.confirm")}
        </Button>
      </div>
    </form>
  );
}
