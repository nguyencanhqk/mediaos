import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ApiError, authApi } from "@mediaos/web-core";
import { Button, Input } from "@mediaos/ui";
import { AuthShell } from "@/components/AuthShell";
import { SINGLE_COMPANY_SLUG } from "@/lib/config";
import {
  forgotPasswordFormSchema,
  type ForgotPasswordFormValues,
} from "@/lib/forgot-password-form-schema";

/**
 * /forgot-password (UI-AUTH-SCREEN-002, SPEC-02 §14.2). Nhập email → POST /auth/forgot-password.
 * Server LUÔN trả `{ ok: true }` (chống email enumeration) → FE hiển thị thông báo GENERIC dù thành
 * công hay email không tồn tại. Lỗi rate-limit (429) hiển thị mềm (KHÔNG chặn thử lại vĩnh viễn).
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation("auth");

  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordFormSchema),
    mode: "onSubmit",
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    setBusy(true);
    setError(null);
    try {
      await authApi.forgotPassword({
        companySlug: SINGLE_COMPANY_SLUG,
        email: values.email.trim(),
      });
      // Thành công → luôn hiện thông báo GENERIC (server không lộ email có tồn tại hay không).
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(t("errors.tooManyAttempts"));
      } else if (err instanceof ApiError && err.status >= 500) {
        setError(t("errors.serverError"));
      } else {
        // Mọi lỗi khác (network/…) vẫn KHÔNG lộ chi tiết — thông điệp chung.
        setError(t("errors.unknown"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell heading={t("forgotPassword.heading")} subtitle={t("forgotPassword.subtitle")}>
      {submitted ? (
        <div className="space-y-4">
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-border bg-muted/40 px-3 py-3 text-sm text-foreground"
          >
            {t("forgotPassword.genericSuccess")}
          </p>
          <Link
            to="/login"
            className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <ArrowLeft className="size-4" />
            {t("forgotPassword.backToLogin")}
          </Link>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit((values) => {
            void onSubmit(values);
          })}
          noValidate
          className="space-y-4"
        >
          {error && (
            <p
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

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

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("forgotPassword.submitting") : t("forgotPassword.submit")}
          </Button>

          <Link
            to="/login"
            className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            <ArrowLeft className="size-4" />
            {t("forgotPassword.backToLogin")}
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
