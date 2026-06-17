import { useCan } from "../hooks/use-can";

interface PermissionGateProps {
  action: string;
  resourceType: string;
  /** Rendered when the user lacks the permission. Defaults to null (renders nothing). */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Renders children only when the current user has the given permission.
 * Uses the capabilities map from the auth store — no API call, O(1) per render.
 */
export function PermissionGate({
  action,
  resourceType,
  fallback = null,
  children,
}: PermissionGateProps): React.ReactNode {
  const allowed = useCan(action, resourceType);
  return <>{allowed ? children : fallback}</>;
}
