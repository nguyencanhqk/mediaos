/**
 * SYSTEM-SCREEN-SETTINGS (S2-FE-FND-1 · FND1-APP) — /system/settings — DEFER.
 *
 * Cấu hình cấp HỆ THỐNG (SYSTEM_MANAGE) CHƯA có endpoint backend → màn hình placeholder có TODO trỏ BE
 * follow-up. TUYỆT ĐỐI KHÔNG dựng nút mutation chết (anti dead-button, FRONTEND-13 §5.2): chỉ hiển thị
 * thông báo "sắp ra mắt", không form/không nút submit.
 *
 * TODO(BE follow-up): cần endpoint system-settings (GET/PATCH cấp hệ thống) + cặp quyền seed cho
 * SYSTEM_MANAGE trước khi dựng CRUD ở đây. Hiện chỉ đọc-thông-báo.
 */
import { useTranslation } from "react-i18next";
import { Wrench } from "lucide-react";
import { PageHeader, EmptyState } from "@mediaos/ui";

export function SystemSettingsPage() {
  const { t } = useTranslation("system");
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("systemSettings.title")}
        description={t("systemSettings.description")}
        icon={Wrench}
      />
      <EmptyState
        icon={Wrench}
        title={t("systemSettings.deferredTitle")}
        description={t("systemSettings.deferredDescription")}
      />
    </div>
  );
}
