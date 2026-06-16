import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthTokens } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { twoFactorApi } from "@/lib/two-factor-api";

interface TwoFactorChallengeFormProps {
  /** Challenge token nhận từ login khi 2FA bật. */
  challengeToken: string;
  /** Gọi khi verify thành công — tokens để real-login store lưu lại. */
  onSuccess: (tokens: AuthTokens) => void;
  onCancel?: () => void;
}

/**
 * Bước 2 đăng nhập khi 2FA bật (G16-1): nhập mã TOTP 6 số HOẶC một recovery code. Ready-to-wire vào
 * luồng real-login (login hiện mock G1). Loading/error đầy đủ.
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
      const tokens = await twoFactorApi.verifyLogin(challengeToken, code.trim());
      onSuccess(tokens);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("errors.invalidCode"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold">{t("twoFactor.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("twoFactor.challengeHint")}
        </p>
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
      {error && <p className="text-sm text-destructive">{error}</p>}
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
