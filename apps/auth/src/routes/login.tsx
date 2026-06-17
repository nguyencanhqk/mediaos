import type { TFunction } from "i18next";
import { LogIn } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, authApi } from "@mediaos/web-core";
import { Button, Input } from "@mediaos/ui";
import { TwoFactorChallengeForm } from "@/components/TwoFactorChallengeForm";
import { DEFAULT_APP_URL } from "@/lib/config";

type LoginStep =
  | { kind: "credentials" }
  | { kind: "twoFactor"; challengeToken: string };

/** Thông báo lỗi thân thiện — không lộ chi tiết nội bộ. */
function friendlyError(err: unknown, t: TFunction<"auth">): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return t("errors.invalidCredentials");
    if (err.status === 403) return t("errors.forbidden");
    if (err.status === 429) return t("errors.tooManyAttempts");
    if (err.status >= 500) return t("errors.serverError");
    return err.message;
  }
  return t("common:errors.generic");
}

/**
 * Đăng nhập thành công (server ĐÃ đặt refresh+CSRF cookie SSO `Domain=.<domain>`) → điều hướng về app đích.
 * Hỏi server `?redirect` có ∈ allowlist origin không (chống open-redirect, rủi ro #11) — server là nguồn DUY
 * NHẤT, client KHÔNG tự phán. Hợp lệ → `target`; không hợp lệ / lỗi mạng → landing mặc định. Access token
 * KHÔNG cần ở apps/auth: app đích tự silent-refresh từ cookie khi load.
 */
async function redirectToTarget(): Promise<void> {
  const requested = new URLSearchParams(window.location.search).get("redirect");
  // Không có `?redirect` → về landing mặc định luôn (khỏi round-trip + khỏi gửi `?redirect=` rỗng cho server).
  if (!requested) {
    window.location.assign(DEFAULT_APP_URL);
    return;
  }
  try {
    const { allowed, target } = await authApi.checkRedirect(requested);
    window.location.assign(allowed && target ? target : DEFAULT_APP_URL);
  } catch {
    // checkRedirect lỗi (API down / mạng) → landing mặc định. AN TOÀN: chỉ origin tin cậy, KHÔNG theo URL tấn công.
    window.location.assign(DEFAULT_APP_URL);
  }
}

/** App đăng nhập trung tâm (FS-1b). Credentials → (2FA challenge nếu bật) → cookie SSO → về app đích. */
export function LoginPage() {
  const { t } = useTranslation("auth");

  const [step, setStep] = useState<LoginStep>({ kind: "credentials" });
  const [companySlug, setCompanySlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companySlug.trim() || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.login({
        companySlug: companySlug.trim(),
        email: email.trim(),
        password,
      });
      if ("twoFactorRequired" in result) {
        setStep({ kind: "twoFactor", challengeToken: result.challengeToken });
        setBusy(false);
      } else {
        // Đăng nhập xong (cookie SSO đã đặt) → rời trang về app đích. GIỮ busy=true (đang điều hướng).
        await redirectToTarget();
      }
    } catch (err) {
      setError(friendlyError(err, t));
      setBusy(false);
    }
  };

  const onTwoFactorSuccess = async () => {
    setBusy(true);
    setError(null);
    try {
      await redirectToTarget();
    } catch (err) {
      setError(friendlyError(err, t));
    } finally {
      // finally: nếu điều hướng KHÔNG xảy ra (bị chặn / test mock) → nhả nút, tránh kẹt spinner vĩnh viễn.
      setBusy(false);
    }
  };

  const onCancelTwoFactor = () => {
    setStep({ kind: "credentials" });
    setError(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border p-8 shadow-sm">
        <div className="mb-6 space-y-1 text-center">
          <h1 className="text-2xl font-semibold">{t("common:appName")}</h1>
          <p className="text-sm text-muted-foreground">{t("login.subtitle")}</p>
        </div>

        {/* Lỗi hiển thị ở container — nhìn thấy ở CẢ bước credentials lẫn 2FA. */}
        {error && (
          <p role="alert" aria-live="assertive" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {step.kind === "twoFactor" ? (
          <TwoFactorChallengeForm
            challengeToken={step.challengeToken}
            onSuccess={() => { void onTwoFactorSuccess(); }}
            onCancel={onCancelTwoFactor}
          />
        ) : (
          <form onSubmit={(e) => { void onSubmitCredentials(e); }} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="company-slug">
                {t("login.companySlugLabel")}
              </label>
              <Input
                id="company-slug"
                value={companySlug}
                onChange={(e) => setCompanySlug(e.target.value)}
                placeholder="my-company"
                autoComplete="organization"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="email">
                {t("fields.email")}
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="password">
                {t("fields.password")}
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={busy || !companySlug.trim() || !email.trim() || !password}
            >
              <LogIn className="size-4" />
              {busy ? t("login.submitting") : t("login.submit")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
