import { useAuth } from "./auth-context";

/**
 * Pure capability resolver — mirrors apps/web/src/hooks/use-can.ts wildcard order so the
 * mobile client makes the SAME deny/allow decision as the web client. The server is still the
 * source of truth (every gated route re-checks); this only hides UX the user can't use.
 *
 * Wildcard resolution order (highest priority first):
 *   1. exact match:        action:resourceType
 *   2. action wildcard:    *:resourceType
 *   3. resource wildcard:  action:*
 *   4. full wildcard:      *:*
 */
export function hasCapability(
  capabilities: Record<string, boolean> | undefined,
  action: string,
  resourceType: string,
): boolean {
  if (!capabilities) return false;
  return (
    capabilities[`${action}:${resourceType}`] ??
    capabilities[`*:${resourceType}`] ??
    capabilities[`${action}:*`] ??
    capabilities["*:*"] ??
    false
  );
}

/**
 * O(1) permission check from the current user's capabilities map (populated by /auth/me).
 * NEVER makes an API call. Returns false while the session is still loading / logged out.
 */
export function useCan(action: string, resourceType: string): boolean {
  const { user } = useAuth();
  return hasCapability(user?.capabilities, action, resourceType);
}
