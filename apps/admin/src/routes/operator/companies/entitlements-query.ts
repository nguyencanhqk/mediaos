/** Query-key gốc cho entitlements (AC-2) — invalidate sau mọi mutation set flag/limit. */
export const ENTITLEMENTS_QUERY_KEY = ["entitlements"] as const;

/** Query-key entitlement hiệu lực của 1 tenant. */
export function tenantEntitlementsQueryKey(companyId: string) {
  return [...ENTITLEMENTS_QUERY_KEY, "tenant", companyId] as const;
}
