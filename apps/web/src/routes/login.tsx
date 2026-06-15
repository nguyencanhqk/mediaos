import { useNavigate } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { useState } from "react";
import type { AuthTokens } from "@mediaos/contracts";
import { TwoFactorChallengeForm } from "@/components/two-factor/TwoFactorChallengeForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { authApi } from "@/lib/auth-api";
import { useAuthStore } from "@/stores/auth";

type LoginStep =
  | { kind: "credentials" }
  | { kind: "twoFactor"; challengeToken: string };

/** Thông báo lỗi thân thiện — không lộ chi tiết nội bộ. */
function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Email hoặc mật khẩu không đúng.";
    if (err.status === 403) return "Tài khoản bị khóa hoặc không có quyền truy cập.";
    if (err.status === 429) return "Quá nhiều lần thử. Vui lòng thử lại sau.";
    if (err.status >= 500) return "Lỗi máy chủ. Vui lòng thử lại sau.";
    // Trường hợp khác — dùng message từ BE (đã được kiểm soát, không lộ nhạy cảm)
    return err.message;
  }
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

/** Sau khi có tokens: gọi /me → populate store → navigate home. */
async function finalizeLogin(
  tokens: AuthTokens,
  setTokens: (a: string, r: string) => void,
  setUser: (u: { id: string; companyId: string; email: string; fullName: string | null; status: string }, c: Record<string, boolean>) => void,
  navigate: ReturnType<typeof useNavigate>,
): Promise<void> {
  setTokens(tokens.accessToken, tokens.refreshToken);
  const me = await authApi.me();
  setUser(me, me.capabilities);
  await navigate({ to: "/" });
}

/** Màn đăng nhập thật (G16-real-login). Hỗ trợ luồng 2FA inline. */
export function LoginPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();

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
        await finalizeLogin(result, setTokens, setUser, navigate);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const onTwoFactorSuccess = async (tokens: AuthTokens) => {
    setBusy(true);
    setError(null);
    try {
      await finalizeLogin(tokens, setTokens, setUser, navigate);
    } catch (err) {
      setError(friendlyError(err));
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
        <div className="mb-6 space-y-1 text-center">
          <h1 className="text-2xl font-semibold">MediaOS</h1>
          <p className="text-sm text-muted-foreground">Đăng nhập vào hệ thống</p>
        </div>

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
                Mã công ty
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
                Email
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
                Mật khẩu
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
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={busy || !companySlug.trim() || !email.trim() || !password}
            >
              <LogIn className="size-4" />
              {busy ? "Đang đăng nhập…" : "Đăng nhập"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
