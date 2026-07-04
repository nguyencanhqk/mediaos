import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { objectPermissions, permissions, roles, userRoles, users } from "../db/schema";
import type { ObjectSubjectType, PermissionEffect } from "@mediaos/contracts";
import { notOperatorRole } from "./operator-roles";

/**
 * PermissionAdminRepository (G3 mutation-path) — write-side cho quản lý phân quyền runtime.
 *
 * ⚠️ GRANT `user_roles` (mig 0005 → SỬA mig 0471, S2-AUTH-DB-3): app role có SELECT/INSERT/**UPDATE**,
 *    KHÔNG có DELETE. Gỡ role = SOFT-DELETE (UPDATE set deleted_at/deleted_by) — KHÔNG hard-delete
 *    (BẤT BIẾN #2, giữ tombstone forensic). Đổi expiry ⇒ soft-delete rồi INSERT (partial-unique chỉ chặn
 *    hàng active). `object_permissions` vẫn SELECT/INSERT/DELETE (đổi effect = DELETE+INSERT).
 * Mọi method nhận `tx` (TenantTx) từ service: ghi row + audit + outbox PHẢI cùng 1 transaction.
 */
@Injectable()
export class PermissionAdminRepository {
  // ── validation (đọc) ───────────────────────────────────────────────────────

  /**
   * Role gán được: hiện qua RLS (own-tenant HOẶC system company_id IS NULL) + chưa soft-delete.
   *
   * 🔴 CHẶN LEO THANG ĐẶC QUYỀN (CS-2, plan-review HIGH): LOẠI TRỪ role operator-audience (platform-admin
   * …f0) — dù RLS lộ nó (company_id IS NULL), tenant KHÔNG được gán nó cho user (sẽ phát aud='operator' →
   * leo thang chéo tenant). Ép ở TẦNG REPOSITORY: assignRole + object-grant role-subject đều validate qua
   * đây ⇒ role operator coi như "không tồn tại" với tenant plane (caller trả NotFound).
   */
  async findAssignableRole(tx: TenantTx, roleId: string): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, roleId), isNull(roles.deletedAt), notOperatorRole()))
      .limit(1);
    return row;
  }

  /** User cùng tenant (RLS lọc company_id). */
  async findUserInTenant(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .limit(1);
    return row;
  }

  /** permissionId từ catalog (action+resourceType). undefined = không có trong catalog. */
  async findPermissionId(
    tx: TenantTx,
    action: string,
    resourceType: string,
  ): Promise<string | undefined> {
    const [row] = await tx
      .select({ id: permissions.id })
      .from(permissions)
      .where(and(eq(permissions.action, action), eq(permissions.resourceType, resourceType)))
      .limit(1);
    return row?.id;
  }

  // ── role assignment (user_roles) ─────────────────────────────────────────────

  /**
   * Hàng user_role ACTIVE (chưa soft-delete). `deleted_at IS NULL` LOẠI tombstone (mig 0471) — bắt buộc để
   * re-grant CÙNG (user,role) với CÙNG expiry SAU khi soft-delete KHÔNG bị coi là no-op-giả (round-3 #9):
   * caller assignRole thấy undefined ⇒ INSERT hàng active mới + audit RoleAssigned thay vì bỏ qua.
   */
  async findUserRole(
    tx: TenantTx,
    companyId: string,
    userId: string,
    roleId: string,
  ): Promise<typeof userRoles.$inferSelect | undefined> {
    const [row] = await tx
      .select()
      .from(userRoles)
      .where(
        and(
          eq(userRoles.companyId, companyId),
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, roleId),
          isNull(userRoles.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  /** INSERT user_roles. ON CONFLICT DO NOTHING — [] khi đã tồn tại (caller xử lý idempotency). */
  async insertUserRole(
    tx: TenantTx,
    data: {
      companyId: string;
      userId: string;
      roleId: string;
      grantedBy: string;
      expiresAt: Date | null;
    },
  ): Promise<typeof userRoles.$inferSelect | undefined> {
    const [row] = await tx
      .insert(userRoles)
      .values({
        companyId: data.companyId,
        userId: data.userId,
        roleId: data.roleId,
        grantedBy: data.grantedBy,
        expiresAt: data.expiresAt,
      })
      .onConflictDoNothing()
      .returning();
    return row;
  }

  /**
   * SOFT-DELETE user_roles (mig 0471, BẤT BIẾN #2 — KHÔNG hard-delete): gỡ role = UPDATE set deleted_at=now()
   * + deleted_by=actor. App role có UPDATE, KHÔNG có DELETE (REVOKE DELETE) → hard-delete sẽ 42501.
   *
   * `AND deleted_at IS NULL` (round-2 #5): CHỈ đụng hàng ACTIVE. Sau chu kỳ re-grant→re-revoke có nhiều
   * tombstone cùng (user,role,company); nếu thiếu predicate này, UPDATE sẽ GHI ĐÈ deleted_at/deleted_by
   * của tombstone CŨ (mất dấu vết forensic ai/khi gỡ). Trả về id đã soft-delete (undefined = 0 hàng active).
   */
  async deleteUserRole(
    tx: TenantTx,
    companyId: string,
    userId: string,
    roleId: string,
    actorUserId: string,
  ): Promise<string | undefined> {
    const [row] = await tx
      .update(userRoles)
      .set({ deletedAt: new Date(), deletedBy: actorUserId })
      .where(
        and(
          eq(userRoles.companyId, companyId),
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, roleId),
          isNull(userRoles.deletedAt),
        ),
      )
      .returning({ id: userRoles.id });
    return row?.id;
  }

  // ── object permission ────────────────────────────────────────────────────────

  async findObjectPermission(
    tx: TenantTx,
    key: ObjectPermissionKey,
  ): Promise<typeof objectPermissions.$inferSelect | undefined> {
    const [row] = await tx
      .select()
      .from(objectPermissions)
      .where(objectPermissionKeyWhere(key))
      .limit(1);
    return row;
  }

  async insertObjectPermission(
    tx: TenantTx,
    data: {
      companyId: string;
      subjectType: string;
      subjectId: string;
      permissionId: string;
      objectType: string;
      objectId: string;
      effect: PermissionEffect;
      grantedBy: string;
    },
  ): Promise<typeof objectPermissions.$inferSelect> {
    const [row] = await tx
      .insert(objectPermissions)
      .values({
        companyId: data.companyId,
        subjectType: data.subjectType,
        subjectId: data.subjectId,
        permissionId: data.permissionId,
        objectType: data.objectType,
        objectId: data.objectId,
        effect: data.effect,
        grantedBy: data.grantedBy,
      })
      .returning();
    // INSERT 1 row không thể trả [] (không onConflict) — nếu xảy ra là bất biến hỏng.
    if (!row) {
      throw new Error("insertObjectPermission returned no row");
    }
    return row;
  }

  /** DELETE theo full-key (KHÔNG kèm effect — unique key không gồm effect). Dùng cho set-flip. */
  async deleteObjectPermissionByKey(tx: TenantTx, key: ObjectPermissionKey): Promise<void> {
    await tx.delete(objectPermissions).where(objectPermissionKeyWhere(key));
  }

  /** DELETE theo key + effect (xoá đúng override caller chỉ định). Trả row đã xoá (undefined = 0). */
  async deleteObjectPermissionByKeyEffect(
    tx: TenantTx,
    key: ObjectPermissionKey,
    effect: PermissionEffect,
  ): Promise<typeof objectPermissions.$inferSelect | undefined> {
    const [row] = await tx
      .delete(objectPermissions)
      .where(and(objectPermissionKeyWhere(key), eq(objectPermissions.effect, effect)))
      .returning();
    return row;
  }

  // ── invalidation fan-out ──────────────────────────────────────────────────────

  /**
   * userIds đang giữ role ACTIVE (để emit permission.changed cho từng user khi grant theo role). Lọc
   * `deleted_at IS NULL` (mig 0471) — user đã bị soft-delete role KHÔNG cần invalidate cache theo role đó.
   */
  async findUserIdsWithRole(tx: TenantTx, companyId: string, roleId: string): Promise<string[]> {
    const rows = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.companyId, companyId),
          eq(userRoles.roleId, roleId),
          isNull(userRoles.deletedAt),
        ),
      );
    return rows.map((r) => r.userId);
  }

  // ── read-only catalogs (S2-AUTH-BE-3) — UI gán quyền ──────────────────────────

  /**
   * Danh sách role gán được (UI assign): own-tenant + system (RLS lộ company_id IS NULL) chưa xoá mềm,
   * LOẠI role operator-audience (platform-admin …f0) — KHÔNG để tenant gán role chéo-plane (mirror
   * findAssignableRole / notOperatorRole). CHỈ ĐỌC. Sắp theo name.
   */
  async listRolesTx(
    tx: TenantTx,
  ): Promise<Array<{ id: string; name: string; description: string | null; isSystem: boolean }>> {
    return tx
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
      })
      .from(roles)
      .where(and(isNull(roles.deletedAt), notOperatorRole()))
      .orderBy(roles.name);
  }

  /**
   * Danh sách permission catalog (UI assign). Catalog GLOBAL (no RLS, app role SELECT-only) — KHÔNG
   * theo tenant. CHỈ ĐỌC. Sắp theo (resource_type, action).
   */
  async listPermissionsTx(
    tx: TenantTx,
  ): Promise<Array<{ id: string; action: string; resourceType: string; isSensitive: boolean }>> {
    return tx
      .select({
        id: permissions.id,
        action: permissions.action,
        resourceType: permissions.resourceType,
        isSensitive: permissions.isSensitive,
      })
      .from(permissions)
      .orderBy(permissions.resourceType, permissions.action);
  }
}

export interface ObjectPermissionKey {
  companyId: string;
  subjectType: ObjectSubjectType;
  subjectId: string;
  permissionId: string;
  objectType: string;
  objectId: string;
}

function objectPermissionKeyWhere(key: ObjectPermissionKey) {
  return and(
    eq(objectPermissions.companyId, key.companyId),
    eq(objectPermissions.subjectType, key.subjectType),
    eq(objectPermissions.subjectId, key.subjectId),
    eq(objectPermissions.permissionId, key.permissionId),
    eq(objectPermissions.objectType, key.objectType),
    eq(objectPermissions.objectId, key.objectId),
  );
}
