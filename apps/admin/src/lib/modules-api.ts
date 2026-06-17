import { z } from "zod";
import {
  systemModuleSchema,
  tenantModuleStateSchema,
  type TenantModuleStateDto,
  type ToggleModuleRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Operator API client cho module-registry (AC-7).
 *
 * Map 1-1 vào `ModuleRegistryController` (`@Controller("admin/platform")`) — route cross-tenant
 * (withTenant(target)). `apiFetch` tự gắn Bearer + gỡ envelope + Zod-parse. Schema TÁI DÙNG từ
 * `@mediaos/contracts`.
 *
 * Permission (server ép, FE chỉ gate UI):
 *   - catalog/list / tenant modules → `view:system-module`
 *   - toggle module/tenant          → `manage:module-toggle` (is_sensitive; step-up qua OperatorReauthGuard)
 */

const BASE = "/admin/platform";

/** Service trả bare `{ items, total, page, limit }` cho catalog. */
export const moduleCatalogResultSchema = z.object({
  items: z.array(systemModuleSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type ModuleCatalogResult = z.infer<typeof moduleCatalogResultSchema>;

/** GET tenant modules trả mảng catalog + enabled hiệu lực. */
export const tenantModulesSchema = z.array(tenantModuleStateSchema);

export interface ListModulesParams {
  search?: string;
  page?: number;
  limit?: number;
}

function buildListQuery(params: ListModulesParams): string {
  const qs = new URLSearchParams();
  if (params.search && params.search.trim()) qs.set("search", params.search.trim());
  if (params.page != null) qs.set("page", String(params.page));
  if (params.limit != null) qs.set("limit", String(params.limit));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const modulesApi = {
  /** GET catalog module (paginate/search). */
  listCatalog: (params: ListModulesParams = {}): Promise<ModuleCatalogResult> =>
    apiFetch(`${BASE}/modules${buildListQuery(params)}`, moduleCatalogResultSchema),

  /** GET catalog + trạng thái hiệu lực cho 1 tenant. */
  listForTenant: (companyId: string): Promise<TenantModuleStateDto[]> =>
    apiFetch(`${BASE}/companies/${companyId}/modules`, tenantModulesSchema),

  /** PUT bật/tắt 1 module cho 1 tenant (cross-tenant, step-up bắt buộc). */
  toggle: (
    companyId: string,
    moduleKey: string,
    body: ToggleModuleRequest,
  ): Promise<TenantModuleStateDto> =>
    apiFetch(
      `${BASE}/companies/${companyId}/modules/${encodeURIComponent(moduleKey)}`,
      tenantModuleStateSchema,
      { method: "PUT", body: JSON.stringify(body) },
    ),
};
