/**
 * ACCOUNT-SCREEN-SETUP-2FA (S2-FE-AUTH-6) — /account/setup-2fa.
 *
 * Ép user enroll 2FA khi `/auth/me.mustSetupTwoFactor === true` (role/company yêu cầu — AUTH-003).
 * `ProtectedShell` điều hướng TỚI ĐÂY khi cờ này bật; sau khi enable thành công, cờ về false và mọi
 * route khác lại truy cập được bình thường (KHÔNG có nút "bỏ qua"/"huỷ" — BE cũng chặn mọi tài nguyên
 * khác qua TwoFactorEnforcementGuard, đây chỉ là UX phản ánh đúng chặn đó).
 *
 * API: POST /auth/2fa/enroll (QR + recovery codes, hiển thị 1 LẦN) → POST /auth/2fa/enable (xác nhận mã
 * TOTP) → refetch /auth/me (ĐÚNG entrypoint session.ts dùng) để đồng bộ store trước khi vào app.
 *
 * BẤT BIẾN #3: recovery codes CHỈ render trong DOM — KHÔNG bao giờ ghi vào localStorage/sessionStorage/
 * console (server đã strip khỏi mọi response sau lần enroll đầu).
 *
 * States: loading (đang gọi enroll) · error (enroll thất bại → retry) · form (QR + recovery codes + xác
 * nhận mã) · verifying (đang enable).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck } from "lucide-react";
import type { TwoFactorEnrollResponse } from "@mediaos/contracts";
import { ApiError, authApi, twoFactorApi, useAuthStore } from "@mediaos/web-core";
import { PageHeader, Button, Input, Card, CardContent } from "@mediaos/ui";

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : fallback;
}

export function TwoFactorSetupPage() {
  const { t } = useTranslation("account");
  const { t: ta } = useTranslation("auth");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();

  const [enroll, setEnroll] = useState<TwoFactorEnrollResponse | null>(null);
  const [loadingEnroll, setLoadingEnroll] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const startEnroll = useCallback(async () => {
    setLoadingEnroll(true);
    setLoadError(null);
    try {
      const res = await twoFactorApi.enroll();
      setEnroll(res);
      setCode("");
    } catch (e) {
      setEnroll(null);
      setLoadError(errMsg(e, t("setup2fa.loadFailed")));
    } finally {
      setLoadingEnroll(false);
    }
  }, [t]);

  useEffect(() => {
    void startEnroll();
  }, [startEnroll]);

  const confirmEnable = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await twoFactorApi.enable(code.trim());
      // Đồng bộ store qua ĐÚNG entrypoint /auth/me (session.ts dùng cùng cặp gọi) — mustSetupTwoFactor
      // sẽ về false sau khi server xác nhận đã enroll, ProtectedShell hết ép điều hướng.
      const me = await authApi.me();
      useAuthStore.getState().setUser(me, me.capabilities);
      useAuthStore.getState().setMustSetupTwoFactor(me.mustSetupTwoFactor);
      void navigate({ to: "/home" });
    } catch (e) {
      setActionError(errMsg(e, ta("errors.unknown")));
    } finally {
      setBusy(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loadingEnroll) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("setup2fa.title")}
          description={t("setup2fa.description")}
          icon={ShieldCheck}
        />
        <div className="h-72 max-w-md animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Error (enroll thất bại) ───────────────────────────────────────────────
  if (loadError || !enroll) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("setup2fa.title")}
          description={t("setup2fa.description")}
          icon={ShieldCheck}
        />
        <div className="mt-8 max-w-md space-y-3 rounded-lg border border-border p-4">
          <p role="alert" className="text-sm text-destructive">
            {loadError ?? t("setup2fa.loadFailed")}
          </p>
          <Button variant="outline" size="sm" onClick={() => void startEnroll()}>
            {tc("actions.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("setup2fa.title")}
        description={t("setup2fa.description")}
        icon={ShieldCheck}
      />
      <Card className="max-w-md">
        <CardContent className="space-y-4 pt-5">
          <p className="text-sm font-medium text-destructive">{t("setup2fa.requiredNote")}</p>

          <div className="flex justify-center rounded-lg bg-white p-4">
            <QRCodeSVG value={enroll.otpauthUri} size={192} />
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">{ta("twoFactor.recoveryCodesLabel")}</p>
            <ul className="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-xs">
              {enroll.recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">{t("setup2fa.recoveryCodesHint")}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="setup-2fa-code">
              {ta("twoFactor.enableCodeLabel")}
            </label>
            <Input
              id="setup-2fa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          )}

          <Button disabled={busy || code.trim().length < 6} onClick={() => void confirmEnable()}>
            {busy ? t("setup2fa.verifying") : ta("twoFactor.confirmEnable")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
