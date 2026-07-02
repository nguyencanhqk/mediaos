import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { ApiError, authApi } from "@mediaos/web-core";
import { Button, Input } from "@mediaos/ui";
import { AuthShell } from "@/components/AuthShell";
import {
  resetPasswordFormSchema,
  type ResetPasswordFormValues,
} from "@/lib/reset-password-form-schema";

/** Đọc `?token=` từ query-string hiện tại (server phát token qua link email). */
function useResetToken(): string | null {
  return useMemo(() => new URLSearchParams(window.location.search).get("token"), []);
}

/**
 * /reset-password (UI-AUTH-SCREEN-003, SPEC-02 §14.3). Token từ query-string → POST /auth/reset-password
 * kèm mật khẩu mới. Token sai/hết hạn/đã dùng → lỗi chuẩn KHÔNG lộ user. Thành công → điều hướng /login.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation("auth");
  const token = useResetToken();

  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    mode: "onSubmit",
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const onSubmit = async (values: ResetPasswordFormValues) => {
    if (!token) {
      setError(t("resetPassword.missingToken"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.resetPassword({ token, newPassword: values.newPassword });
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 401)) {
        setError(t("resetPassword.invalidToken"));
      } else if (err instanceof ApiError && err.status >= 500) {
        setError(t("errors.serverError"));
      } else {
        setError(t("errors.unknown"));
      }
    } finally {
      setBusy(false);
    }
  };

  // Thiếu token ngay từ đầu (link hỏng/không có query) — chặn sớm, không cho gõ form vô nghĩa.
  if (!token) {
    return (
      <AuthShell heading={t("resetPassword.heading")}>
        <div className="space-y-4">
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {t("resetPassword.missingToken")}
          </p>
          <Link to="/login" className="text-sm font-medium text-primary hover:underline">
            {t("resetPassword.goToLogin")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (success) {
    return (
      <AuthShell heading={t("resetPassword.successTitle")}>
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto size-10 text-green-500" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("resetPassword.successDescription")}</p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            {t("resetPassword.goToLogin")}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell heading={t("resetPassword.heading")} subtitle={t("resetPassword.subtitle")}>
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
          <label className="text-sm font-medium" htmlFor="newPassword">
            {t("changePassword.fields.newPassword")}
          </label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            autoFocus
            aria-invalid={errors.newPassword ? "true" : undefined}
            {...register("newPassword")}
          />
          {errors.newPassword && (
            <p role="alert" className="text-sm text-destructive">
              {t(errors.newPassword.message ?? "")}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="confirmPassword">
            {t("changePassword.fields.confirmPassword")}
          </label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.confirmPassword ? "true" : undefined}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p role="alert" className="text-sm text-destructive">
              {t(errors.confirmPassword.message ?? "")}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t("resetPassword.submitting") : t("resetPassword.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
