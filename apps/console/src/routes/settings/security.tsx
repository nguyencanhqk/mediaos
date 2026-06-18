import { useTranslation } from "react-i18next";
import { TwoFactorSettings } from "@/components/two-factor/TwoFactorSettings";

/**
 * Trang "Bảo mật tài khoản" — self-service của user đang đăng nhập (aud=user). KHÔNG gắn permission
 * (giống đổi mật khẩu: mỗi người tự quản 2FA của chính mình); chỉ cần authGuard ở router.
 */
export function SecuritySettingsPage() {
  const { t } = useTranslation("settings");
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("security.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("security.pageDesc")}</p>
      </div>
      <TwoFactorSettings />
    </div>
  );
}
