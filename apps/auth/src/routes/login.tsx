import { zodResolver } from "@hookform/resolvers/zod";
import type { TFunction } from "i18next";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { ApiError, authApi } from "@mediaos/web-core";
import { Button, Input } from "@mediaos/ui";
import { SignalBar } from "@/components/SignalBar";
import { TwoFactorChallengeForm } from "@/components/TwoFactorChallengeForm";
import { BRAND_SYSTEM_LABEL, BRAND_WORDMARK } from "@/lib/brand";
import { DEFAULT_APP_URL, SINGLE_COMPANY_SLUG } from "@/lib/config";
import { loginFormSchema, type LoginFormValues } from "@/lib/login-form-schema";

type LoginStep = { kind: "credentials" } | { kind: "twoFactor"; challengeToken: string };

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

/** Bảng nhận diện bên trái — "bàn điều khiển": wordmark + tagline + thanh tín hiệu on-air + trạng thái. */
function BrandPanel() {
  const { t } = useTranslation("auth");
  return (
    <section className="flex flex-1 flex-col justify-between gap-10 lg:max-w-md">
      <div className="space-y-2">
        <h1 className="brand-gradient-text font-display text-4xl font-bold tracking-tight">
          {BRAND_WORDMARK}
        </h1>
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.25em] text-muted-foreground">
          {BRAND_SYSTEM_LABEL}
        </p>
      </div>

      <div className="space-y-5">
        <p className="font-display text-xl font-medium text-foreground/90">{t("login.tagline")}</p>
        <SignalBar />
      </div>

      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <span className="live-dot inline-block size-2 rounded-full bg-brand shadow-[0_0_8px] shadow-brand" />
        <span className="tracking-widest text-foreground/80">{t("login.onAir")}</span>
        <span aria-hidden>·</span>
        <span>{t("login.sessionNote")}</span>
      </div>
    </section>
  );
}

/** App đăng nhập trung tâm (FS-1b). Credentials → (2FA challenge nếu bật) → cookie SSO → về app đích. */
export function LoginPage() {
  const { t } = useTranslation("auth");

  const [step, setStep] = useState<LoginStep>({ kind: "credentials" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    mode: "onSubmit",
    defaultValues: { email: "", password: "" },
  });

  // Disable nút khi chưa nhập gì (UX) — validation NỘI DUNG (định dạng) do Zod lo khi submit.
  const watchedEmail = watch("email");
  const watchedPassword = watch("password");
  const isEmpty = !watchedEmail?.trim() || !watchedPassword;

  // Chỉ chạy khi Zod validate PASS (email hợp lệ + password không rỗng). Lỗi field hiển thị inline qua `errors`.
  const onSubmitCredentials = async (values: LoginFormValues) => {
    setBusy(true);
    setError(null);
    try {
      // Đơn-tenant: slug đến từ config (SINGLE_COMPANY_SLUG), user KHÔNG phải gõ — hợp đồng backend không đổi.
      const result = await authApi.login({
        companySlug: SINGLE_COMPANY_SLUG,
        email: values.email.trim(),
        password: values.password,
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
    <div className="control-room-bg min-h-screen w-full">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-12 px-6 py-12 lg:flex-row lg:items-stretch lg:gap-20 lg:py-0">
        <BrandPanel />

        {/* Bảng console xác thực */}
        <section className="flex w-full max-w-sm items-center lg:flex-1">
          <div className="w-full rounded-xl border border-border bg-card p-7 shadow-2xl shadow-black/40">
            <div className="mb-6 space-y-1">
              <h2 className="font-display text-2xl font-semibold">
                {step.kind === "twoFactor" ? t("twoFactor.title") : t("login.heading")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {step.kind === "twoFactor" ? t("twoFactor.challengeHint") : t("login.subtitle")}
              </p>
            </div>

            {/* Lỗi hiển thị ở container — nhìn thấy ở CẢ bước credentials lẫn 2FA. */}
            {error && (
              <p
                role="alert"
                aria-live="assertive"
                className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            {step.kind === "twoFactor" ? (
              <TwoFactorChallengeForm
                challengeToken={step.challengeToken}
                onSuccess={() => {
                  void onTwoFactorSuccess();
                }}
                onCancel={onCancelTwoFactor}
              />
            ) : (
              <form
                onSubmit={handleSubmit((values) => {
                  void onSubmitCredentials(values);
                })}
                noValidate
                className="space-y-4"
              >
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="email">
                    {t("fields.email")}
                  </label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@company.com"
                    autoComplete="email"
                    autoFocus
                    aria-invalid={errors.email ? "true" : undefined}
                    {...register("email")}
                  />
                  {errors.email && (
                    <p role="alert" className="text-sm text-destructive">
                      {t(errors.email.message ?? "")}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="password">
                    {t("fields.password")}
                  </label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="pr-10"
                      aria-invalid={errors.password ? "true" : undefined}
                      {...register("password")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={
                        showPassword ? t("fields.hidePassword") : t("fields.showPassword")
                      }
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p role="alert" className="text-sm text-destructive">
                      {t(errors.password.message ?? "")}
                    </p>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={busy || isEmpty}>
                  {busy ? t("login.submitting") : t("login.submit")}
                  {!busy && <ArrowRight className="size-4" />}
                </Button>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
