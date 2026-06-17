import type { TFunction } from "i18next";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import type { TwoFactorEnrollResponse, TwoFactorStatus } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Dialog } from "@mediaos/ui";
import { ApiError } from "@mediaos/web-core";
import { twoFactorApi } from "@mediaos/web-core";

function errMsg(e: unknown, t: TFunction<"auth">): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : t("errors.unknown");
}

/**
 * TwoFactorSettings (G16-1, AUTH-003) — quản lý 2FA của user hiện tại: trạng thái, enroll (QR + recovery
 * codes), bật (verify mã), tắt (re-auth mật khẩu). Loading/error/empty đầy đủ.
 * ⚠️ Cần access token thật (auth store) — DORMANT cho tới khi real-login FE land.
 */
export function TwoFactorSettings() {
  const { t } = useTranslation("auth");
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<TwoFactorEnrollResponse | null>(null);
  const [enableCode, setEnableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");

  const loadStatus = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(await twoFactorApi.status());
    } catch (e) {
      setStatus(null);
      setLoadError(errMsg(e, t));
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const startEnroll = async () => {
    setBusy(true);
    setActionError(null);
    try {
      setEnroll(await twoFactorApi.enroll());
      setEnableCode("");
    } catch (e) {
      setActionError(errMsg(e, t));
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await twoFactorApi.enable(enableCode.trim());
      setEnroll(null);
      await loadStatus();
    } catch (e) {
      setActionError(errMsg(e, t));
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await twoFactorApi.disable(disablePassword);
      setDisableOpen(false);
      setDisablePassword("");
      await loadStatus();
    } catch (e) {
      setActionError(errMsg(e, t));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm text-destructive">{t("twoFactor.loadStatusFailed", { detail: loadError })}</p>
        <Button variant="outline" size="sm" onClick={() => void loadStatus()}>
          {t("common:actions.retry")}
        </Button>
      </div>
    );
  }

  if (!status) {
    return <p className="text-sm text-muted-foreground">{t("twoFactor.loadingStatus")}</p>;
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium">{t("twoFactor.settingsTitle")}</h3>
          <p className="text-sm text-muted-foreground">
            {status.enabled ? t("twoFactor.enabledDesc") : t("twoFactor.disabledDesc")}
            {status.required && !status.enabled && (
              <span className="ml-1 font-medium text-destructive">{t("twoFactor.requiredNote")}</span>
            )}
          </p>
        </div>
        {status.enabled ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setDisableOpen(true)}>
            {t("twoFactor.disable")}
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void startEnroll()}>
            {t("twoFactor.enable")}
          </Button>
        )}
      </div>

      {actionError && !enroll && <p className="text-sm text-destructive">{actionError}</p>}

      {/* Modal enroll: QR + recovery codes + nhập mã xác nhận */}
      <Dialog
        open={enroll !== null}
        onClose={() => {
          if (!busy) setEnroll(null);
        }}
        title={t("twoFactor.enrollTitle")}
        description={t("twoFactor.enrollDesc")}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setEnroll(null)}>
              {t("twoFactor.cancel")}
            </Button>
            <Button disabled={busy || enableCode.trim().length < 6} onClick={() => void confirmEnable()}>
              {t("twoFactor.confirmEnable")}
            </Button>
          </>
        }
      >
        {enroll && (
          <div className="space-y-4">
            <div className="flex justify-center rounded-lg bg-white p-4">
              <QRCodeSVG value={enroll.otpauthUri} size={176} />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">{t("twoFactor.recoveryCodesLabel")}</p>
              <ul className="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-xs">
                {enroll.recoveryCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="enable-code">
                {t("twoFactor.enableCodeLabel")}
              </label>
              <Input
                id="enable-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={enableCode}
                onChange={(e) => setEnableCode(e.target.value)}
              />
            </div>
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          </div>
        )}
      </Dialog>

      {/* Modal tắt: re-auth mật khẩu */}
      <Dialog
        open={disableOpen}
        onClose={() => {
          if (!busy) setDisableOpen(false);
        }}
        title={t("twoFactor.disableTitle")}
        description={t("twoFactor.disableDesc")}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setDisableOpen(false)}>
              {t("twoFactor.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || disablePassword.length === 0}
              onClick={() => void confirmDisable()}
            >
              {t("twoFactor.disable")}
            </Button>
          </>
        }
      >
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="disable-pw">
            {t("fields.password")}
          </label>
          <Input
            id="disable-pw"
            type="password"
            autoComplete="current-password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
          />
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        </div>
      </Dialog>
    </div>
  );
}
