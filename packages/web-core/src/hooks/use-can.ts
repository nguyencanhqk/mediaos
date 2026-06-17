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
