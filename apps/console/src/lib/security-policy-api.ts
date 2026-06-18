import type { UpdateSecurityPolicyRequest } from "@mediaos/contracts";
import { securityPolicySchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

// CS-9 — dùng apiFetch chung (Bearer + credentials + refresh-on-401 + base URL). Route /settings/security-policy
// có PermissionGuard (configure-security-policy:company, sensitive) nên thiếu token/quyền sẽ 401/403.
export const securityPolicyApi = {
  getPolicy: () => apiFetch("/settings/security-policy", securityPolicySchema),
  updatePolicy: (data: UpdateSecurityPolicyRequest) =>
    apiFetch("/settings/security-policy", securityPolicySchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};
