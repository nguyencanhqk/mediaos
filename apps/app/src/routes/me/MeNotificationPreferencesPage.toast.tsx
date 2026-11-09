/**
 * S20-NOTI-LIVETOAST-1 — ba công tắc toast của «Tuỳ chọn thông báo». Lưu `localStorage` trình duyệt này
 * theo `userId` (xem `lib/toast-prefs`), KHÔNG gọi API nên không phụ thuộc trạng thái tải/lỗi của trang.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, Checkbox } from "@mediaos/ui";
import { useAuthStore } from "@mediaos/web-core";
import { readToastPrefs, writeToastPrefs, type ToastPrefs } from "@/lib/toast-prefs";

const FIELDS = [
  "notifications",
  "messages",
  "preview",
] as const satisfies readonly (keyof ToastPrefs)[];

export function ToastPrefsCard() {
  const { t } = useTranslation("me");
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [prefs, setPrefs] = useState<ToastPrefs>(() => readToastPrefs(userId));

  if (userId === null) return null;

  return (
    <Card data-testid="toast-prefs-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          {t("notificationPreferencesPage.toastPrefs.title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("notificationPreferencesPage.toastPrefs.browserOnly")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {FIELDS.map((field) => (
          <label key={field} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={prefs[field]}
              onChange={(e) => setPrefs(writeToastPrefs(userId, { [field]: e.target.checked }))}
            />
            {t(`notificationPreferencesPage.toastPrefs.${field}`)}
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          {t("notificationPreferencesPage.toastPrefs.previewHint")}
        </p>
      </CardContent>
    </Card>
  );
}
