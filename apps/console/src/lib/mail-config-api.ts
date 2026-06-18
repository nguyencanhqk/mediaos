import type { TestMailConfigRequest, UpsertMailConfigRequest } from "@mediaos/contracts";
import { mailConfigListSchema, mailConfigSchema, mailTestResultSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

// Dùng `apiFetch` chung của @mediaos/web-core (Bearer + credentials + refresh-on-401 + base URL).
// Route /settings/mail-config có PermissionGuard (configure-mail:company) — thiếu token sẽ 401.
// CHÚ Ý SECRET: GET KHÔNG bao giờ trả password; PUT gửi password (RAM → server encrypt); test trả ĐÃ sanitize.

export const mailConfigApi = {
  list: () => apiFetch("/settings/mail-config", mailConfigListSchema),
  upsert: (data: UpsertMailConfigRequest) =>
    apiFetch("/settings/mail-config", mailConfigSchema, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  test: (data: TestMailConfigRequest) =>
    apiFetch("/settings/mail-config/test", mailTestResultSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
