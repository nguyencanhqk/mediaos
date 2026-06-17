import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../db/db.service';
import {
  objectPermissions,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from '../db/schema';
import type {
  CompanyRoleGrant,
  IPermissionRepository,
  ObjectGrant,
  PermissionCatalogEntry,
} from './permission.types';

/**
 * PermissionRepository — real Drizzle implementation of IPermissionRepository.
 *
 * All queries run inside withTenant() to enforce RLS (company_id isolation).
 * max 2 queries per can() call: 1 company JOIN + 1 object batch (plan §3b cache miss rule).
 */
@Injectable()
export class PermissionRepository implements IPermissionRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Returns all role_permissions for all active roles held by userId in companyId.
   * Includes expiresAt from user_roles — service re-checks on every can() call.
   */
  async getCompanyRoleGrants(userId: string, companyId: string): Promise<CompanyRoleGrant[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({
          action: permissions.action,
          resourceType: permissions.resourceType,
          isSensitive: permissions.isSensitive,
          effect: rolePermissions.effect,
          expiresAt: userRoles.expiresAt,
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(
          and(
            eq(userRoles.userId, userId),
            eq(userRoles.companyId, companyId),
            isNull(roles.deletedAt),
          ),
        );

      return rows.map((r) => ({
        action: r.action,
        resourceType: r.resourceType,
        isSensitive: r.isSensitive,
        effect: r.effect as 'ALLOW' | 'DENY',
        expiresAt: r.expiresAt ?? null,
      }));
    });
  }

  /**
   * Returns all object_permissions for userId (direct + via roles) scoped to one object instance.
   */
  async getObjectGrants(
    userId: string,
    companyId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<ObjectGrant[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const userRoleRows = await tx
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.companyId, companyId)));

      const roleIds = userRoleRows.map((r) => r.roleId);

      const subjectConditions = [
        and(eq(objectPermissions.subjectType, 'user'), eq(objectPermissions.subjectId, userId)),
        ...roleIds.map((roleId) =>
          and(
            eq(objectPermissions.subjectType, 'role'),
            eq(objectPermissions.subjectId, roleId),
          ),
        ),
      ].filter(Boolean);

      if (subjectConditions.length === 0) return [];

      const rows = await tx
        .select({
          action: permissions.action,
          resourceType: permissions.resourceType,
          isSensitive: permissions.isSensitive,
          effect: objectPermissions.effect,
        })
        .from(objectPermissions)
        .innerJoin(permissions, eq(objectPermissions.permissionId, permissions.id))
        .where(
          and(
            eq(objectPermissions.companyId, companyId),
            eq(objectPermissions.objectType, resourceType),
            eq(objectPermissions.objectId, resourceId),
            or(...(subjectConditions as [ReturnType<typeof and>, ...ReturnType<typeof and>[]])),
          ),
        );

      return rows.map((r) => ({
        action: r.action,
        resourceType: r.resourceType,
        isSensitive: r.isSensitive,
        effect: r.effect as 'ALLOW' | 'DENY',
      }));
    });
  }

  /** AC-5 — catalog entry cho tập id. permissions là global no-RLS → đọc không cần tenant context. */
  async getPermissionsByIds(permissionIds: string[]): Promise<PermissionCatalogEntry[]> {
    if (permissionIds.length === 0) return [];
    const rows = await this.db.runRaw<{
      id: string;
      action: string;
      resource_type: string;
      is_sensitive: boolean;
    }>(
      sql`SELECT id, action, resource_type, is_sensitive FROM permissions WHERE id IN (${sql.join(
        permissionIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      resourceType: r.resource_type,
      isSensitive: r.is_sensitive,
    }));
  }

  /** AC-5 — toàn bộ catalog (global no-RLS). Catalog nhỏ (vài trăm hàng) → đọc 1 phát. */
  async getAllPermissions(): Promise<PermissionCatalogEntry[]> {
    const rows = await this.db.runRaw<{
      id: string;
      action: string;
      resource_type: string;
      is_sensitive: boolean;
    }>(sql`SELECT id, action, resource_type, is_sensitive FROM permissions`);
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      resourceType: r.resource_type,
      isSensitive: r.is_sensitive,
    }));
  }
}
