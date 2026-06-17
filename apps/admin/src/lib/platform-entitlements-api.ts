import { z } from "zod";
import {
  effectiveEntitlementsSchema,
  featureFlagSchema,
  usageLimitSchema,
  type EffectiveEntitlementsDto,
  type FeatureFlagDto,
  type SetFeatureFlagRequest,
  type SetUsageLimitRequest,
  type UsageLimitDto,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Operator API client cho platform-entitlements (AC-2).
 *
 * Map 1-1 vào `PlatformEntitlementsController` (`@Controller("admin/platform/companies")`) — route
 * CHÉO TENANT (withTenant(target)). `apiFetch` tự gắn Bearer + gỡ envelope + Zod-parse. Schema TÁI DÙNG
 * từ `@mediaos/contracts` (KHÔNG redefine).
 *
 * Permission (server ép, FE chỉ gate UI): mọi route → `manage:platform-subscription` (is_sensitive;
 * step-up qua OperatorReauthGuard cho PUT).
 *
 * Masking: chỉ render field server gửi về (FeatureFlagDto/UsageLimitDto/EffectiveEntitlementsDto). Đây là
 * metadata bật/tắt + số nguyên, KHÔNG chứa secret.
 */

const BASE = "/admin/platform/companies";

const featureFlagsSchema = z.array(featureFlagSchema);
const usageLimitsSchema = z.array(usageLimitSchema);

export const platformEntitlementsApi = {
  /** GET feature-flag hiệu lực của 1 tenant. */
  getFeatureFlags: (companyId: string): Promise<FeatureFlagDto[]> =>
    apiFetch(`${BASE}/${companyId}/feature-flags`, featureFlagsSchema),

  /** GET usage-limit hiệu lực của 1 tenant. */
  getUsageLimits: (companyId: string): Promise<UsageLimitDto[]> =>
    apiFetch(`${BASE}/${companyId}/usage-limits`, usageLimitsSchema),

  /** GET entitlement HIỆU LỰC tổng hợp (gói + override) — viewer. */
  getEntitlements: (companyId: string): Promise<EffectiveEntitlementsDto> =>
    apiFetch(`${BASE}/${companyId}/entitlements`, effectiveEntitlementsSchema),

  /** PUT đặt override 1 feature-flag cho 1 tenant (cross-tenant, step-up bắt buộc). */
  setFeatureFlag: (companyId: string, body: SetFeatureFlagRequest): Promise<FeatureFlagDto> =>
    apiFetch(`${BASE}/${companyId}/feature-flags`, featureFlagSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  /** PUT đặt override 1 usage-limit cho 1 tenant (cross-tenant, step-up bắt buộc). */
  setUsageLimit: (companyId: string, body: SetUsageLimitRequest): Promise<UsageLimitDto> =>
    apiFetch(`${BASE}/${companyId}/usage-limits`, usageLimitSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};
