import type { UpdateCompanySettingsRequest } from "@mediaos/contracts";
import { companySettingsSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

// Dùng `apiFetch` chung của @mediaos/web-core (gắn Bearer + credentials:'include' + refresh-on-401 +
// base URL đã configureApiBaseUrl ở main.tsx). KHÔNG tự viết fetch riêng — route /settings/company
// có PermissionGuard nên thiếu token sẽ 401 và trang kẹt mãi ở trạng thái loading.

export const settingsApi = {
  getCompanySettings: () => apiFetch("/settings/company", companySettingsSchema),
  updateCompanySettings: (data: UpdateCompanySettingsRequest) =>
    apiFetch("/settings/company", companySettingsSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};
