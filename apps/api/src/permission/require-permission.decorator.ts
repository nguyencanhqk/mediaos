import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION = 'REQUIRE_PERMISSION';

export interface RequirePermissionMeta {
  action: string;
  resourceType: string;
  /** Set true when this permission is marked is_sensitive in the catalog. */
  isSensitive?: boolean;
  /** Set true when this action requires a valid re-auth window (e.g. reveal-secret). */
  requiresReauth?: boolean;
}

/**
 * Declare what permission is needed for a route or controller.
 * Must be present on every non-@Public route — PermissionGuard is fail-closed.
 */
export const RequirePermission = (
  action: string,
  resourceType: string,
  opts?: { isSensitive?: boolean; requiresReauth?: boolean },
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSION, { action, resourceType, ...opts } satisfies RequirePermissionMeta);
