import { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { LogIn } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthTokens } from "@mediaos/contracts";
import { TwoFactorChallengeForm } from "@/components/two-factor/TwoFactorChallengeForm";
import { Button } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { BrandMark, BrandWordmark } from "@/components/brand/brand-mark";
import { BRAND } from "@/lib/brand";
import { ApiError } from "@mediaos/web-core";
import { authApi } from "@mediaos/web-core";
import { useAuthStore } from "@mediaos/web-core";

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
    // Trường hợp khác — dùng message từ BE (đã được kiểm soát, không lộ nhạy cảm)
    return err.message;
  }
  return t("common:errors.generic");
}

/** Sau khi có tokens: gọi /me → populate store → navigate home. */
async function finalizeLogin(
  tokens: AuthTokens,
  setTokens: (a: string, r: string) => void,
  setUser: (u: { id: string; companyId: string; email: string; fullName: string | null; status: string }, c: Record<string, boolean>) => void,
  logout: () => void,
  navigate: ReturnType<typeof useNavigate>,
): Promise<void> {
  // setTokens TRƯỚC: authApi.me() đọc access token từ store (getAccessToken) để gắn Bearer.
  setTokens(tokens.accessToken, tokens.refreshToken);
  try {
    const me = await authApi.me();
    setUser(me, me.capabilities);
    await navigate({ to: "/" });
  } catch (err) {
    // /me thất bại sau khi đã lưu token → xoá token mồ côi, tránh half-auth state
    // (getAccessToken() trả token cho phiên chưa hoàn tất). Re-throw để caller hiển thị lỗi.
    logout();
    throw err;
  }
}

/** Màn đăng nhập thật (G16-real-login). Hỗ trợ luồng 2FA inline. */
export function LoginPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const [step, setStep] = useState<LoginStep>({ kind: "credentials" });

  // credentials form state
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
        // Cần bước 2: hiển thị 2FA challenge form
        setStep({ kind: "twoFactor", challengeToken: result.challengeToken });
      } else {
        // Đăng nhập thành công, không cần 2FA
        await finalizeLogin(result, setTokens, setUser, logout, navigate);
      }
    } catch (err) {
      setError(friendlyError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onTwoFactorSuccess = async (tokens: AuthTokens) => {
    setBusy(true);
    setError(null);
    try {
      await finalizeLogin(tokens, setTokens, setUser, logout, navigate);
    } catch (err) {
      setError(friendlyError(err, t));
    } finally {
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
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <BrandMark className="h-14 w-14 drop-shadow-sm" />
          <BrandWordmark text={BRAND.name} className="text-xl" />
          <p className="text-xs font-medium text-muted-foreground">{BRAND.slogan}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>
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
            onSuccess={(tokens) => { void onTwoFactorSuccess(tokens); }}
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
