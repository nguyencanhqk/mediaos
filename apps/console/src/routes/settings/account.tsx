import type { FormEvent } from "react";
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { ApiError, authApi, logoutSession, useAuthStore, usersApi } from "@mediaos/web-core";
import { Button, Input } from "@mediaos/ui";

/** Lỗi → text: ApiError trả message thân thiện (vi) của BE cho 400/401; còn lại → thông báo chung. */
function errorText(err: unknown, t: TFunction<"settings">): string {
  if (err instanceof ApiError) return err.message;
  return t("account.genericError");
}

/** Card hồ sơ: email (read-only, định danh) + họ tên (sửa được). Lưu → refetch /me → đồng bộ store. */
function ProfileSection() {
  const { t } = useTranslation("settings");
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const name = fullName.trim();
    if (!name) return;
    setBusy(true);
    setMsg(null);
    try {
      await usersApi.updateProfile({ fullName: name });
      // Refetch /me để store khớp server (full_name + capabilities) thay vì sửa cục bộ.
      const me = await authApi.me();
      setUser(
        {
          id: me.id,
          companyId: me.companyId,
          email: me.email,
          fullName: me.fullName,
          status: me.status,
        },
        me.capabilities,
      );
      setMsg({ ok: true, text: t("account.profileSaved") });
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  };

  const unchanged = fullName.trim() === (user?.fullName ?? "");

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="space-y-4 rounded-lg border border-border bg-card p-6"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("account.profileTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("account.profileDesc")}</p>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="acc-email">
          {t("account.emailLabel")}
        </label>
        <Input id="acc-email" value={user?.email ?? ""} readOnly disabled />
        <p className="text-xs text-muted-foreground">{t("account.emailHint")}</p>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="acc-fullname">
          {t("account.fullNameLabel")}
        </label>
        <Input
          id="acc-fullname"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={200}
        />
      </div>
      {msg && (
        <p role="status" className={`text-sm ${msg.ok ? "text-success" : "text-destructive"}`}>
          {msg.text}
        </p>
      )}
      <Button type="submit" disabled={busy || !fullName.trim() || unchanged}>
        {busy ? t("account.saving") : t("account.save")}
      </Button>
    </form>
  );
}

interface SecretFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  autoComplete: string;
  hint?: string;
}
function SecretField({ id, label, value, onChange, show, autoComplete, hint }: SecretFieldProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        maxLength={200}
      />
      {hint && <p className="text-xs text-destructive">{hint}</p>}
    </div>
  );
}

/** Card đổi mật khẩu: re-auth bằng mật khẩu hiện tại. Thành công → server thu hồi mọi phiên → logoutSession. */
function ChangePasswordSection() {
  const { t } = useTranslation("settings");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsCurrent = next.length > 0 && next === current;
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && next !== current;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword({ currentPassword: current, newPassword: next });
      // Server đã thu hồi MỌI phiên → đăng xuất toàn cục + điều hướng về /login (đăng nhập lại bằng mật khẩu mới).
      await logoutSession();
    } catch (err) {
      setError(errorText(err, t));
      setBusy(false);
    }
  };

  const newHint = tooShort
    ? t("account.tooShort")
    : sameAsCurrent
      ? t("account.sameAsCurrent")
      : undefined;

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="space-y-4 rounded-lg border border-border bg-card p-6"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("account.passwordTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("account.passwordDesc")}</p>
      </div>
      <SecretField
        id="acc-current"
        label={t("account.currentLabel")}
        value={current}
        onChange={setCurrent}
        show={show}
        autoComplete="current-password"
      />
      <SecretField
        id="acc-new"
        label={t("account.newLabel")}
        value={next}
        onChange={setNext}
        show={show}
        autoComplete="new-password"
        hint={newHint}
      />
      <SecretField
        id="acc-confirm"
        label={t("account.confirmLabel")}
        value={confirm}
        onChange={setConfirm}
        show={show}
        autoComplete="new-password"
        hint={mismatch ? t("account.mismatch") : undefined}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        {show ? t("account.hidePassword") : t("account.showPassword")}
      </button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !canSubmit}>
        {busy ? t("account.changing") : t("account.changeButton")}
      </Button>
    </form>
  );
}

/**
 * Trang "Tài khoản của tôi" (Module 2a) — self-service: sửa hồ sơ + đổi mật khẩu của CHÍNH user.
 * Chỉ authGuard (không permission-gate, giống trang Bảo mật 2FA): mỗi người tự quản tài khoản của mình.
 */
export function AccountSettingsPage() {
  const { t } = useTranslation("settings");
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("account.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("account.pageDesc")}</p>
      </div>
      <ProfileSection />
      <ChangePasswordSection />
    </div>
  );
}
