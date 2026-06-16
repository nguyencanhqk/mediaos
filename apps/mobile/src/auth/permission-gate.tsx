import React from "react";
import { useCan } from "./use-can";

interface PermissionGateProps {
  action: string;
  resourceType: string;
  /** Rendered when the user lacks the permission. Defaults to null (renders nothing). */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Renders children only when the current user has the given permission.
 * Mirrors apps/web/src/components/permission-gate.tsx — capabilities map, no API call.
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
