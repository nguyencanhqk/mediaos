import type { ListModulesParams } from "@/lib/modules-api";

/** Query-key gốc cho catalog module — invalidate sau mọi mutation. */
export const MODULES_QUERY_KEY = ["system-modules"] as const;

/** Query-key catalog (paginate/search). */
export function modulesCatalogQueryKey(params: ListModulesParams) {
  return [...MODULES_QUERY_KEY, "catalog", params] as const;
}

/** Query-key trạng thái module hiệu lực của 1 tenant. */
export function tenantModulesQueryKey(companyId: string) {
  return [...MODULES_QUERY_KEY, "tenant", companyId] as const;
}
