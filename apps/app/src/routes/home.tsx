import { useTranslation } from "react-i18next";

/**
 * Trang chủ (placeholder) — vỏ nghiệp vụ hợp nhất apps/app.
 * Nội dung Home Portal thật (app launcher, layout chrome, nav module) = S1-FE-LAYOUT-1 (OUT-OF-SCOPE
 * lane này). Ở đây chỉ là điểm hạ cánh có phiên hợp lệ để khẳng định boot/guard/i18n đã chạy.
 */
export function HomePage() {
  const { t } = useTranslation("common");
  return (
    <div className="control-room-bg flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="brand-gradient-text font-display text-3xl font-bold tracking-tight">
        MediaOS
      </h1>
      <div className="brand-gradient-line h-0.5 w-48 max-w-full rounded-full opacity-80" />
      <p className="text-sm text-muted-foreground">{t("loading")}</p>
    </div>
  );
}
