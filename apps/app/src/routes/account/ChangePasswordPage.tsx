import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { ApiError, authApi, getAuthRedirectUrl, logoutSession } from "@mediaos/web-core";
import { PageHeader, Button, Input, Card, CardContent } from "@mediaos/ui";
import {
  changePasswordFormSchema,
  type ChangePasswordFormValues,
} from "./change-password-form-schema";

/**
 * /account/change-password (UI-ACCOUNT-SCREEN-003, SPEC-02 §14.5). Đổi mật khẩu khi ĐÃ đăng nhập.
 *
 * Quyền: `/auth/change-password` là endpoint self-service (JwtAuthGuard, KHÔNG PermissionGuard/
 * permission-table gate — bất kỳ user đã đăng nhập đều đổi được mật khẩu CỦA CHÍNH MÌNH). KHÔNG có cặp
 * permission `password:*` trong catalog thật (grep seed migrations) → KHÔNG bọc PermissionGate ở đây,
 * giữ đúng pattern MyProfilePage (self-service/own-scope, server là cổng quyền thật).
 *
 * Thành công → server thu hồi MỌI phiên (refresh token) → FE PHẢI logoutSession() rồi điều hướng /login.
 */
export function ChangePasswordPage() {
  const { t } = useTranslation("auth");
  const { t: tc } = useTranslation("common");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordFormSchema),
    mode: "onSubmit",
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const onSubmit = async (values: ChangePasswordFormValues) => {
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      // Server đã thu hồi mọi phiên — FE dọn state cục bộ + điều hướng về app đăng nhập trung tâm.
      setRedirecting(true);
      await logoutSession();
      window.location.href = getAuthRedirectUrl();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setError(t("errors.invalidCredentials"));
        } else if (err.status === 422 || err.status === 400) {
          setError(err.message);
        } else if (err.status >= 500) {
          setError(t("errors.serverError"));
        } else {
          setError(t("errors.unknown"));
        }
      } else {
        setError(tc("errors.generic"));
      }
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("changePassword.heading")}
        description={t("changePassword.subtitle")}
        icon={KeyRound}
      />

      <Card className="max-w-md">
        <CardContent className="pt-5">
          {redirecting ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {t("changePassword.successRedirecting")}
            </p>
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
                <label className="text-sm font-medium" htmlFor="currentPassword">
                  {t("changePassword.fields.currentPassword")}
                </label>
                <Input
                  id="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={errors.currentPassword ? "true" : undefined}
                  {...register("currentPassword")}
                />
                {errors.currentPassword && (
                  <p role="alert" className="text-sm text-destructive">
                    {t(errors.currentPassword.message ?? "")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="newPassword">
                  {t("changePassword.fields.newPassword")}
                </label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
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

              <Button type="submit" disabled={busy}>
                {busy ? t("changePassword.submitting") : t("changePassword.submit")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
