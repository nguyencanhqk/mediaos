import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PermissionAdminService } from "../../src/permission/permission-admin.service";
import { PermissionAdminRepository } from "../../src/permission/permission-admin.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * G3 mutation-path — runtime permission management (CROWN JEWEL). Permission engine THẬT (4 tầng,
 * Postgres) — KHÔNG mock. Deny-path RED trước (BẤT BIẾN #3 / FULL gate):
 *  (a) user không có assign-role:user → assignRole throws Forbidden, 0 user_role ghi.
 *  (b) wildcard *:* KHÔNG kế thừa sensitive assign-role / grant-object-permission.
 *  (c) cross-tenant: admin công ty B không gán được role cho user công ty A (RLS → NotFound, 0 row A).
 * Happy-path: ghi row + audit_logs + outbox `permission.changed` CÙNG tx. Idempotent no-op không nhân đôi.
 */
describe.skipIf(!hasDb)("G3 permission mutation-path", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;

  let adminUser: string; // có assign-role:user + grant-object-permission:permission (ALLOW tường minh)
  let noPermUser: string; // role rỗng
  let wildcardUser: string; // chỉ *:* ALLOW
  let bAdminUser: string; // admin công ty B
  let targetUser: string; // user A bị gán role
  let assignableRole: string; // role sẽ gán cho targetUser
  let svc: PermissionAdminService;

  // S2-AUTH-DB-3 (mig 0471): revoke role = SOFT-DELETE (UPDATE deleted_at), KHÔNG hard-delete. "User có role"
  // = có hàng ACTIVE → đếm CHỈ deleted_at IS NULL (tombstone bị loại) khớp semantic reader findUserRole/can().
  async function countUserRoles(
    companyId: string,
    userId: string,
    roleId: string,
  ): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM user_roles
       WHERE company_id=$1 AND user_id=$2 AND role_id=$3 AND deleted_at IS NULL`,
      [companyId, userId, roleId],
    );
    return r.rows[0].n as number;
  }

  async function countAudit(
    companyId: string,
    objectType: string,
    objectId: string,
  ): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND object_type=$2 AND object_id=$3`,
      [companyId, objectType, objectId],
    );
    return r.rows[0].n as number;
  }

  async function countOutboxForUser(companyId: string, userId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM outbox_events
       WHERE event_type='permission.changed' AND payload->>'companyId'=$1 AND payload->>'userId'=$2`,
      [companyId, userId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "permadminA");
    B = await seedCompany(direct, "permadminB");

    const assignPerm = await seedPermissionCatalog(direct, "assign-role", "user", true);
    const grantObjPerm = await seedPermissionCatalog(
      direct,
      "grant-object-permission",
      "permission",
      true,
    );
    // catalog cho object-permission đích (dùng view-payslip:payslip làm ví dụ override).
    await seedPermissionCatalog(direct, "view-payslip", "payslip", true);

    // admin A: ALLOW tường minh cả hai quyền nhạy cảm.
    adminUser = await seedUser(direct, A.companyId, `padm-${randomUUID().slice(0, 8)}@a.test`);
    const adminRole = await seedRole(direct, A.companyId, `padm-role-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, adminRole, assignPerm, "ALLOW");
    await seedRolePermission(direct, adminRole, grantObjPerm, "ALLOW");
    await seedUserRole(direct, adminUser, adminRole, A.companyId);

    // noPerm A: role rỗng.
    noPermUser = await seedUser(direct, A.companyId, `pnp-${randomUUID().slice(0, 8)}@a.test`);
    const emptyRole = await seedRole(direct, A.companyId, `pnp-role-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noPermUser, emptyRole, A.companyId);

    // wildcard A: *:* ALLOW (không được kế thừa quyền sensitive).
    wildcardUser = await seedUser(direct, A.companyId, `pwc-${randomUUID().slice(0, 8)}@a.test`);
    const wildcardRole = await seedRole(
      direct,
      A.companyId,
      `pwc-role-${randomUUID().slice(0, 8)}`,
    );
    const wildcardPerm = await seedPermissionCatalog(direct, "*", "*", false);
    await seedRolePermission(direct, wildcardRole, wildcardPerm, "ALLOW");
    await seedUserRole(direct, wildcardUser, wildcardRole, A.companyId);

    // admin B: cùng quyền (assign-role + grant-object-permission) nhưng tenant khác (cross-tenant deny).
    bAdminUser = await seedUser(direct, B.companyId, `pbadm-${randomUUID().slice(0, 8)}@b.test`);
    const bAdminRole = await seedRole(
      direct,
      B.companyId,
      `pbadm-role-${randomUUID().slice(0, 8)}`,
    );
    await seedRolePermission(direct, bAdminRole, assignPerm, "ALLOW");
    await seedRolePermission(direct, bAdminRole, grantObjPerm, "ALLOW");
    await seedUserRole(direct, bAdminUser, bAdminRole, B.companyId);

    // target A + role gán.
    targetUser = await seedUser(direct, A.companyId, `ptgt-${randomUUID().slice(0, 8)}@a.test`);
    assignableRole = await seedRole(direct, A.companyId, `ptgt-role-${randomUUID().slice(0, 8)}`);

    const db = new DatabaseService();
    const permission = new PermissionService(new PermissionRepository(db));
    svc = new PermissionAdminService(
      db,
      permission,
      new AuditService(),
      new OutboxService(),
      new PermissionAdminRepository(),
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  // ── deny-path (RED) ───────────────────────────────────────────────────────────

  it("(a) user without assign-role:user → assignRole Forbidden, 0 user_role written", async () => {
    const before = await countUserRoles(A.companyId, targetUser, assignableRole);
    await expect(
      svc.assignRole({ id: noPermUser, companyId: A.companyId }, targetUser, {
        roleId: assignableRole,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await countUserRoles(A.companyId, targetUser, assignableRole)).toBe(before);
  });

  it("(b) wildcard *:* does NOT inherit sensitive assign-role / grant-object-permission", async () => {
    await expect(
      svc.assignRole({ id: wildcardUser, companyId: A.companyId }, targetUser, {
        roleId: assignableRole,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.setObjectPermission(
        { id: wildcardUser, companyId: A.companyId },
        {
          subjectType: "user",
          subjectId: targetUser,
          action: "view-payslip",
          resourceType: "payslip",
          objectType: "payslip",
          objectId: randomUUID(),
          effect: "ALLOW",
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(c) cross-tenant: B admin cannot assign role to A's user (NotFound, 0 row in A)", async () => {
    await expect(
      svc.assignRole({ id: bAdminUser, companyId: B.companyId }, targetUser, {
        roleId: assignableRole,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await countUserRoles(A.companyId, targetUser, assignableRole)).toBe(0);
  });

  it("(c2) cross-tenant: B admin cannot set object-permission on A's user (NotFound, 0 row in A)", async () => {
    const objectId = randomUUID();
    await expect(
      svc.setObjectPermission(
        { id: bAdminUser, companyId: B.companyId },
        {
          subjectType: "user",
          subjectId: targetUser, // user thuộc công ty A
          action: "view-payslip",
          resourceType: "payslip",
          objectType: "payslip",
          objectId,
          effect: "ALLOW",
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM object_permissions WHERE company_id=$1 AND subject_id=$2`,
      [A.companyId, targetUser],
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("(c3) self-assign blocked (SoD): admin cannot assign a role to themselves", async () => {
    await expect(
      svc.assignRole({ id: adminUser, companyId: A.companyId }, adminUser, {
        roleId: assignableRole,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── happy-path (GREEN) — row + audit + outbox cùng tx ──────────────────────────

  it("assignRole writes user_role + audit (RoleAssigned) + outbox permission.changed", async () => {
    const oBefore = await countOutboxForUser(A.companyId, targetUser);
    const row = await svc.assignRole({ id: adminUser, companyId: A.companyId }, targetUser, {
      roleId: assignableRole,
    });
    expect(row?.id).toBeDefined();
    expect(await countUserRoles(A.companyId, targetUser, assignableRole)).toBe(1);
    expect(await countAudit(A.companyId, "user_role", row!.id)).toBe(1);
    expect(await countOutboxForUser(A.companyId, targetUser)).toBe(oBefore + 1);
  });

  it("assignRole is idempotent (same role+expiry) — no duplicate row / audit / outbox", async () => {
    const oBefore = await countOutboxForUser(A.companyId, targetUser);
    const row = await svc.assignRole({ id: adminUser, companyId: A.companyId }, targetUser, {
      roleId: assignableRole,
    });
    expect(await countUserRoles(A.companyId, targetUser, assignableRole)).toBe(1);
    // no-op: không emit thêm event.
    expect(await countOutboxForUser(A.companyId, targetUser)).toBe(oBefore);
    expect(await countAudit(A.companyId, "user_role", row!.id)).toBe(1);
  });

  it("revokeRole soft-deletes user_role (tombstone giữ deleted_by=actor) + audit (RoleRevoked) + outbox; unknown role → NotFound", async () => {
    const oBefore = await countOutboxForUser(A.companyId, targetUser);
    await svc.revokeRole({ id: adminUser, companyId: A.companyId }, targetUser, assignableRole);
    // Active row = 0 (user MẤT quyền); nhưng row VẪN tồn tại dưới dạng tombstone (BẤT BIẾN #2 — forensic).
    expect(await countUserRoles(A.companyId, targetUser, assignableRole)).toBe(0);
    const tomb = await direct.query(
      `SELECT deleted_at, deleted_by FROM user_roles
       WHERE company_id=$1 AND user_id=$2 AND role_id=$3 AND deleted_at IS NOT NULL`,
      [A.companyId, targetUser, assignableRole],
    );
    expect(tomb.rows).toHaveLength(1);
    expect(tomb.rows[0].deleted_by).toBe(adminUser);
    expect(await countOutboxForUser(A.companyId, targetUser)).toBe(oBefore + 1);

    await expect(
      svc.revokeRole({ id: adminUser, companyId: A.companyId }, targetUser, assignableRole),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("setObjectPermission inserts → flips effect (DELETE+INSERT) → remove; each audits + emits", async () => {
    const objectId = randomUUID();
    const actor = { id: adminUser, companyId: A.companyId };
    const base = {
      subjectType: "user" as const,
      subjectId: targetUser,
      action: "view-payslip",
      resourceType: "payslip",
      objectType: "payslip",
      objectId,
    };

    const allow = await svc.setObjectPermission(actor, { ...base, effect: "ALLOW" });
    expect(allow.effect).toBe("ALLOW");
    expect(await countAudit(A.companyId, "object_permission", allow.id)).toBe(1);

    // flip ALLOW→DENY: no UPDATE grant ⇒ DELETE+INSERT (id mới), effect=DENY.
    const deny = await svc.setObjectPermission(actor, { ...base, effect: "DENY" });
    expect(deny.effect).toBe("DENY");
    expect(deny.id).not.toBe(allow.id);

    // idempotent: set DENY lần nữa = no-op (cùng id).
    const denyAgain = await svc.setObjectPermission(actor, { ...base, effect: "DENY" });
    expect(denyAgain.id).toBe(deny.id);

    // remove theo key+effect.
    await svc.removeObjectPermission(actor, { ...base, effect: "DENY" });
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM object_permissions
       WHERE company_id=$1 AND subject_id=$2 AND object_id=$3`,
      [A.companyId, targetUser, objectId],
    );
    expect(r.rows[0].n).toBe(0);

    // remove lại → NotFound.
    await expect(
      svc.removeObjectPermission(actor, { ...base, effect: "DENY" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
