import { useAuthStore } from "../stores/auth";

/**
 * O(1) permission check from the Zustand capabilities map (populated by /me response).
 * Checks exact key first, then wildcard variants — NEVER makes an API call.
 *
 * Wildcard resolution order (highest priority first):
 *   1. exact match:          action:resourceType
 *   2. action wildcard:      *:resourceType
 *   3. resource wildcard:    action:*
 *   4. full wildcard:        *:*
 */
export function useCan(action: string, resourceType: string): boolean {
  return useAuthStore((s) => {
    const caps = s.capabilities;
    return (
      caps[`${action}:${resourceType}`] ??
      caps[`*:${resourceType}`] ??
      caps[`${action}:*`] ??
      caps["*:*"] ??
      false
    );
  });
}

/**
 * useCanExact — O(1) fail-closed permission check.
 * Checks ONLY the exact key `action:resourceType` in capabilities — NO wildcard fallback.
 *
 * Use this for pairs marked `is_sensitive` in the permission seed
 * (e.g. view-team:attendance, view-company:attendance, view-sensitive:attendance).
 *
 * Rationale: useCan() falls through *:resourceType → action:* → *:* meaning a super-admin
 * wildcard would silently permit a call the BE would still 403 for a sensitive pair. useCanExact
 * mirrors the BE behaviour: only an explicit grant for the exact (action, resourceType) pair opens
 * the gate → prevents FE-permit / BE-403 mismatch that would surface as a confusing error state
 * instead of the intentional "forbidden" page.
 */
export function useCanExact(action: string, resourceType: string): boolean {
  return useAuthStore((s) => s.capabilities[`${action}:${resourceType}`] ?? false);
}
