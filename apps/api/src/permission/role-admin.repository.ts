import { Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import {
  permissions,
  roles,
  rolePermissions,
  userRoles,
  users,
  type Role,
  type RoleDataScope,
} from "../db/schema";
import { notOperatorRole } from "./operator-roles";

/**
 * RoleAdminRepository (S2-AUTH-BE-6) — write-side cho quản lý role + role_permissions.
 *
 * ⚠️ GRANT (migration 0005): `role_permissions` chỉ có SELECT/INSERT/DELETE — KHÔNG UPDATE cho app role.
 *    Đổi data_scope/effect ⇒ DELETE rồi INSERT (KHÔNG upsert-update, mirror 0444/0450).
 * ⚠️ RLS `roles` (mig 0005): USING company_id=own-tenant OR company_id IS NULL (đọc lộ cả system role);
 *    WITH CHECK company_id=own-tenant (app KHÔNG ghi được row company_id IS NULL) → INSERT/UPDATE role
 *    company-scope tự nhiên fail-closed chặn system role qua policy, KHÔNG chỉ dựa kỷ luật app.
 * Mọi method nhận `tx` (TenantTx) từ service: ghi row + audit + outbox PHẢI cùng 1 transaction.
 */
@Injectable()
export class RoleAdminRepository {
  /** Role theo id, own-tenant hoặc system, chưa xoá mềm, LOẠI operator-audience (mirror PermissionAdminRepository). */
  async findRoleByIdTx(tx: TenantTx, roleId: string): Promise<Role | undefined> {
    const [row] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), isNull(roles.deletedAt), notOperatorRole()))
      .limit(1);
    return row;
  }

  async insertRoleTx(
    tx: TenantTx,
    data: {
      companyId: string;
      name: string;
      description: string | null;
      // S2-AUTH-BE-11: cờ ép 2FA theo ROLE (roles.requires_two_factor). Chỉ role thường (is_system=false).
      requiresTwoFactor: boolean;
    },
  ): Promise<Role> {
    const [row] = await tx
      .insert(roles)
      .values({
        companyId: data.companyId,
        name: data.name,
        description: data.description,
        isSystem: false,
        requiresTwoFactor: data.requiresTwoFactor,
      })
      .returning();
    if (!row) {
      throw new Error("insertRoleTx returned no row");
    }
    return row;
  }

  async updateRoleTx(
    tx: TenantTx,
    companyId: string,
    roleId: string,
    patch: { name?: string; description?: string | null; requiresTwoFactor?: boolean },
  ): Promise<Role | undefined> {
    const [row] = await tx
      .update(roles)
      .set(patch)
      .where(and(eq(roles.id, roleId), eq(roles.companyId, companyId), isNull(roles.deletedAt)))
      .returning();
    return row;
  }

  /** permissionId + isSensitive từ catalog (action+resourceType). undefined = không có trong catalog. */
  async findPermissionTx(
    tx: TenantTx,
    action: string,
    resourceType: string,
  ): Promise<{ id: string; isSensitive: boolean } | undefined> {
    const [row] = await tx
      .select({ id: permissions.id, isSensitive: permissions.isSensitive })
      .from(permissions)
      .where(and(eq(permissions.action, action), eq(permissions.resourceType, resourceType)))
      .limit(1);
    return row;
  }

  async findRolePermissionTx(
    tx: TenantTx,
    roleId: string,
    permissionId: string,
    effect: "ALLOW" | "DENY",
  ): Promise<{ dataScope: string } | undefined> {
    const [row] = await tx
      .select({ dataScope: rolePermissions.dataScope })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, roleId),
          eq(rolePermissions.permissionId, permissionId),
          eq(rolePermissions.effect, effect),
        ),
      )
      .limit(1);
    return row;
  }

  async insertRolePermissionTx(
    tx: TenantTx,
    data: {
      roleId: string;
      permissionId: string;
      effect: "ALLOW" | "DENY";
      dataScope: RoleDataScope;
    },
  ): Promise<
    { roleId: string; permissionId: string; effect: string; dataScope: string } | undefined
  > {
    const [row] = await tx
      .insert(rolePermissions)
      .values({
        roleId: data.roleId,
        permissionId: data.permissionId,
        effect: data.effect,
        dataScope: data.dataScope,
      })
      .onConflictDoNothing()
      .returning();
    return row;
  }

  /**
   * S2-AUTH-ROLEMEM-1 — thành viên ACTIVE của 1 role trong TENANT hiện tại (tab Thành viên).
   * Membership là PER-TENANT qua user_roles.company_id (system role company_id NULL dùng CHUNG
   * cross-tenant — KHÔNG được lộ member tenant khác) ⇒ lọc company_id TƯỜNG MINH + RLS lớp 2.
   * Active = user_roles.deleted_at NULL (soft-delete mig 0471) + chưa hết hạn + user chưa xoá mềm.
   */
  async listRoleMembersTx(
    tx: TenantTx,
    companyId: string,
    roleId: string,
  ): Promise<
    Array<{
      userId: string;
      email: string;
      fullName: string | null;
      status: string;
      expiresAt: Date | null;
      grantedAt: Date;
    }>
  > {
    return tx
      .select({
        userId: users.id,
        email: sql<string>`${users.email}::text`,
        fullName: users.fullName,
        status: users.status,
        expiresAt: userRoles.expiresAt,
        grantedAt: userRoles.createdAt,
      })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          eq(userRoles.roleId, roleId),
          eq(userRoles.companyId, companyId),
          isNull(userRoles.deletedAt),
          or(isNull(userRoles.expiresAt), gt(userRoles.expiresAt, sql`now()`)),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(users.email);
  }

  /**
   * S2-AUTH-PERMUX-1 — toàn bộ grant của 1 role (RolePermissionsPage v2 đọc trạng thái đã gán).
   * Tenant-isolation: caller PHẢI 404-guard qua findRoleByIdTx TRƯỚC (RLS roles + notOperatorRole);
   * role_permissions không có company_id — RLS bảng (policy join roles own-tenant-or-NULL) là lớp 2.
   */
  async listRolePermissionsTx(
    tx: TenantTx,
    roleId: string,
  ): Promise<
    Array<{
      action: string;
      resourceType: string;
      effect: string;
      dataScope: string;
      isSensitive: boolean;
    }>
  > {
    return tx
      .select({
        action: permissions.action,
        resourceType: permissions.resourceType,
        effect: rolePermissions.effect,
        dataScope: rolePermissions.dataScope,
        isSensitive: permissions.isSensitive,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, roleId))
      .orderBy(permissions.resourceType, permissions.action);
  }

  /** DELETE role_permissions theo (roleId, permissionId, effect). Trả row đã xoá (undefined = 0 hàng). */
  async deleteRolePermissionReturningTx(
    tx: TenantTx,
    roleId: string,
    permissionId: string,
    effect: "ALLOW" | "DENY",
  ): Promise<{ dataScope: string } | undefined> {
    const [row] = await tx
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, roleId),
          eq(rolePermissions.permissionId, permissionId),
          eq(rolePermissions.effect, effect),
        ),
      )
      .returning({ dataScope: rolePermissions.dataScope });
    return row;
  }

  /**
   * CASCADE khi xoá role — soft-delete MỌI gán vai trò (user_roles) đang active của role TRONG TENANT hiện
   * tại (membership per-tenant qua company_id, mig 0471). App role có UPDATE (KHÔNG DELETE) trên user_roles
   * → set deleted_at + deleted_by (giữ tombstone forensic). Trả SỐ hàng đã gỡ (để audit + báo FE). Người
   * bị gỡ mất quyền của role NGAY ở request kế (getCompanyRoleGrants lọc deleted_at IS NULL, không qua cache).
   */
  async softDeleteRoleMembersTx(
    tx: TenantTx,
    companyId: string,
    roleId: string,
    actorUserId: string,
  ): Promise<number> {
    const revoked = await tx
      .update(userRoles)
      .set({ deletedAt: new Date(), deletedBy: actorUserId })
      .where(
        and(
          eq(userRoles.roleId, roleId),
          eq(userRoles.companyId, companyId),
          isNull(userRoles.deletedAt),
        ),
      )
      .returning({ id: userRoles.id });
    return revoked.length;
  }

  /**
   * Soft-delete role (BẤT BIẾN #2 — KHÔNG hard-delete). Chỉ company-scope own-tenant + chưa xoá (WHERE
   * company_id=actor + deleted_at IS NULL). RLS WITH CHECK company_id=own-tenant chặn thêm ở tầng DB (system
   * role company_id NULL không lọt). Trả row đã xoá (undefined = 0 hàng — đã xoá bởi request đua / race).
   * roles KHÔNG có cột updated_at (chỉ set deleted_at). Partial-unique(name) WHERE deleted_at IS NULL cho
   * phép tái dùng tên sau khi xoá.
   */
  async softDeleteRoleTx(
    tx: TenantTx,
    companyId: string,
    roleId: string,
  ): Promise<Role | undefined> {
    const [row] = await tx
      .update(roles)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(roles.id, roleId), eq(roles.companyId, companyId), isNull(roles.deletedAt)),
      )
      .returning();
    return row;
  }
}
