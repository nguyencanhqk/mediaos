/**
 * MeAppearancePage — ME-SCREEN-014 "Giao diện" (SPEC-09 §8.1/§8.2/§10.8, route "/me/preferences/appearance").
 *
 * Chọn theme System/Light/Dark: `useTheme().setTheme()` áp NGAY (local — luôn thành công, class `dark`
 * trên `<html>` + localStorage) SONG SONG `meApi.patchAppearance({theme})` ghi server. Lỗi ghi server
 * KHÔNG revert theme local (fail-soft tuyệt đối — mirror `session.ts` syncThemeFromServer, người dùng vẫn
 * thấy đúng theme vừa chọn trên máy này dù server tạm lỗi).
 *
 * Ngôn ngữ & múi giờ: READ-ONLY (ME-DEC-008 P2 "Có NẾU company cho phép" — policy override CHƯA mở ở MVP)
 * — CHỈ hiển thị giá trị kế thừa hiện tại từ `GET /me/preferences`, KHÔNG có control để sửa/gửi override.
 */
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette, Monitor, Sun, Moon } from "lucide-react";
import { meApi, meKeys, useCan } from "@mediaos/web-core";
import { EmptyState, PageHeader, Card, CardHeader, CardTitle, CardContent, cn } from "@mediaos/ui";
import { useTheme, type ThemePreference } from "@mediaos/ui";
import { ME_ACCESS_PAIR } from "./constants";

const THEME_OPTIONS: readonly { value: ThemePreference; labelKey: string; icon: typeof Monitor }[] =
  [
    { value: "system", labelKey: "appearancePage.theme.system", icon: Monitor },
    { value: "light", labelKey: "appearancePage.theme.light", icon: Sun },
    { value: "dark", labelKey: "appearancePage.theme.dark", icon: Moon },
  ];

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function MeAppearancePageInner() {
  const { t } = useTranslation("me");
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  // GET /me/preferences CHỈ để đọc locale/timezone hiện tại (hiển thị read-only) — theme lấy từ useTheme
  // (nguồn sự thật local, đã sync 2 chiều ở bootstrapSession). Lỗi/loading KHÔNG chặn cả trang (fail-soft) —
  // chỉ khối read-only hiện "—" khi chưa có dữ liệu.
  const prefsQuery = useQuery({
    queryKey: meKeys.preferences(),
    queryFn: meApi.getPreferences,
    staleTime: 60_000,
  });

  const patchMutation = useMutation({
    mutationFn: meApi.patchAppearance,
    onSuccess: (result) => queryClient.setQueryData(meKeys.preferences(), result),
    // onError: KHÔNG revert theme local — fail-soft tuyệt đối, xem docstring đầu file.
  });

  const handleSelectTheme = (value: ThemePreference) => {
    setTheme(value);
    patchMutation.mutate({ theme: value });
  };

  const localeLabel =
    prefsQuery.data?.locale === "vi"
      ? t("appearancePage.localeVi")
      : prefsQuery.data?.locale === "en"
        ? t("appearancePage.localeEn")
        : t("appearancePage.inherited");
  const timezoneLabel = prefsQuery.data?.timezone ?? t("appearancePage.inherited");

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("appearancePage.title")}
        description={t("appearancePage.description")}
        icon={Palette}
      />

      <Card className="max-w-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            {t("appearancePage.themeSectionTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex flex-wrap gap-3"
            role="radiogroup"
            aria-label={t("appearancePage.themeSectionTitle")}
          >
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={theme === opt.value}
                onClick={() => handleSelectTheme(opt.value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border px-5 py-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  theme === opt.value
                    ? "border-brand bg-brand-muted text-brand"
                    : "border-border text-foreground hover:bg-accent",
                )}
              >
                <opt.icon className="h-5 w-5" />
                <span className="text-sm font-medium">{t(opt.labelKey)}</span>
              </button>
            ))}
          </div>
          {patchMutation.isError && (
            <p className="mt-3 text-xs text-warning">{t("appearancePage.syncError")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            {t("appearancePage.readOnlySectionTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <ReadOnlyField label={t("appearancePage.language")} value={localeLabel} />
          <ReadOnlyField label={t("appearancePage.timezone")} value={timezoneLabel} />
          <p className="pt-2 text-xs text-muted-foreground">{t("appearancePage.readOnlyNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export function MeAppearancePage() {
  const { t } = useTranslation("me");
  const canAccess = useCan(ME_ACCESS_PAIR.action, ME_ACCESS_PAIR.resourceType);

  if (!canAccess) {
    return (
      <div className="p-6">
        <EmptyState title={t("forbidden.title")} description={t("forbidden.description")} />
      </div>
    );
  }

  return <MeAppearancePageInner />;
}
