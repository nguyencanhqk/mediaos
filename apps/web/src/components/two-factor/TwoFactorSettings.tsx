import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { TwoFactorEnrollResponse, TwoFactorStatus } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import { twoFactorApi } from "@/lib/two-factor-api";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Đã xảy ra lỗi.";
}

/**
 * TwoFactorSettings (G16-1, AUTH-003) — quản lý 2FA của user hiện tại: trạng thái, enroll (QR + recovery
 * codes), bật (verify mã), tắt (re-auth mật khẩu). Loading/error/empty đầy đủ.
 * ⚠️ Cần access token thật (auth store) — DORMANT cho tới khi real-login FE land.
 */
export function TwoFactorSettings() {
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
      setLoadError(errMsg(e));
    }
  }, []);

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
      setActionError(errMsg(e));
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
      setActionError(errMsg(e));
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
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm text-destructive">Không tải được trạng thái 2FA: {loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void loadStatus()}>
          Thử lại
        </Button>
      </div>
    );
  }

  if (!status) {
    return <p className="text-sm text-muted-foreground">Đang tải trạng thái 2FA…</p>;
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium">Xác thực 2 lớp (2FA)</h3>
          <p className="text-sm text-muted-foreground">
            {status.enabled ? "Đang BẬT — yêu cầu mã TOTP khi đăng nhập." : "Đang TẮT."}
            {status.required && !status.enabled && (
              <span className="ml-1 font-medium text-destructive">Vai trò của bạn BẮT BUỘC bật 2FA.</span>
            )}
          </p>
        </div>
        {status.enabled ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setDisableOpen(true)}>
            Tắt 2FA
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void startEnroll()}>
            Bật 2FA
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
        title="Thiết lập 2FA"
        description="Quét QR bằng app authenticator (Google Authenticator/Authy), rồi nhập mã 6 số để xác nhận."
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setEnroll(null)}>
              Huỷ
            </Button>
            <Button disabled={busy || enableCode.trim().length < 6} onClick={() => void confirmEnable()}>
              Xác nhận bật
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
              <p className="mb-1 text-sm font-medium">Mã khôi phục (lưu ngay — chỉ hiện 1 lần):</p>
              <ul className="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-xs">
                {enroll.recoveryCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="enable-code">
                Mã xác nhận
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
        title="Tắt 2FA"
        description="Nhập lại mật khẩu để xác nhận tắt xác thực 2 lớp."
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setDisableOpen(false)}>
              Huỷ
            </Button>
            <Button
              variant="destructive"
              disabled={busy || disablePassword.length === 0}
              onClick={() => void confirmDisable()}
            >
              Tắt 2FA
            </Button>
          </>
        }
      >
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="disable-pw">
            Mật khẩu
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
