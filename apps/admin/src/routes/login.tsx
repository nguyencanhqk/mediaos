import { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { LogIn, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthTokens } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { authApi } from "@/lib/auth-api";
import { useAuthStore } from "@/stores/auth";

type LoginStep = { kind: "credentials" } | { kind: "twoFactor" };

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

/** Sau khi có tokens: gọi /me → populate store → vào operator plane. */
async function finalizeLogin(
  tokens: AuthTokens,
  setTokens: (a: string, r: string) => void,
  setUser: (
    u: { id: string; companyId: string; email: string; fullName: string | null; status: string },
    c: Record<string, boolean>,
  ) => void,
  logout: () => void,
  navigate: ReturnType<typeof useNavigate>,
): Promise<void> {
  // setTokens TRƯỚC: apiFetch đọc access token từ store để gắn Bearer cho /me.
  setTokens(tokens.accessToken, tokens.refreshToken);
  try {
    const me = await authApi.me();
    // capabilities là field BẮT BUỘC trong contract (z.record(z.boolean())) → apiFetch đã parse;
    // `?? {}` chỉ là lưới an toàn, khớp default của store, tránh useCan đọc trên undefined.
    setUser(me, me.capabilities ?? {});
    await navigate({ to: "/operator" });
  } catch (err) {
    // /me thất bại sau khi đã lưu token → xoá token mồ côi, tránh half-auth state.
    logout();
    throw err;
  }
}

/**
 * Màn đăng nhập operator. Luồng credentials → tokens → /me → operator plane.
 *
 * Luồng 2FA: BE trả challenge → AC-0a chỉ thông báo (2FA bắt buộc cho platform-admin +
 * UI challenge operator hoàn thiện ở AC-0b). KHÔNG bỏ qua 2FA, chỉ chưa render form ở đây.
 */
export function LoginPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

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
        setStep({ kind: "twoFactor" });
      } else {
        await finalizeLogin(result, setTokens, setUser, logout, navigate);
      }
    } catch (err) {
      setError(friendlyError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border p-8 shadow-sm">
        <div className="mb-6 space-y-1 text-center">
          <h1 className="text-2xl font-semibold">{t("common:appName")}</h1>
          <p className="text-sm text-muted-foreground">{t("login.subtitle")}</p>
        </div>

        {error && (
          <p role="alert" aria-live="assertive" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {step.kind === "twoFactor" ? (
          <div className="space-y-4">
            <div
              className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm"
              role="status"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p>{t("twoFactor.required")}</p>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setStep({ kind: "credentials" });
                setError(null);
              }}
            >
              {t("common:actions.back")}
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmitCredentials(e)} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="company-slug">
                {t("login.companySlugLabel")}
              </label>
              <Input
                id="company-slug"
                value={companySlug}
                onChange={(e) => setCompanySlug(e.target.value)}
                placeholder="platform"
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
                placeholder="operator@company.com"
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
