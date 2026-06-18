import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PermissionAdminService } from "../../src/permission/permission-admin.service";
import { PermissionAdminRepository } from "../../src/permission/permission-admin.repository";
import { OrgRepository } from "../../src/org/org.repository";
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
 * CS-2 RBAC — 🔴 CHẶN LEO THANG ĐẶC QUYỀN (plan-review HIGH).
 *
 * Role hệ thống `platform-admin` (id …f0, company_id IS NULL, seed mig 0230) = role aud='operator'
 * (AuthService.PLATFORM_ADMIN_ROLE_ID): user giữ role này login phát token aud='operator' → control-plane
 * chéo tenant. RLS của bảng roles (mig 0005) LỘ role system (company_id IS NULL) cho MỌI tenant ⇒ nếu
 * không lọc, một tenant-admin có `assign-role:user` sẽ gán được role operator cho user của họ → leo thang
 * RA NGOÀI tenant. Bất biến: loại trừ role operator phải ép Ở TẦNG REPOSITORY (không chỉ UI):
 *   - findAssignableRole (permission-admin.repository) → assignRole/object-grant role-subject KHÔNG thấy nó.
 *   - listRoles (org.repository) → GET /org/roles KHÔNG liệt kê nó (UI không render lựa chọn).
 *
 * Test RED trước (deny-path): platform-admin role KHÔNG gán được + KHÔNG xuất hiện trong danh mục;
 * role tenant + role system hợp lệ (company-admin) VẪN gán/liệt kê được (không over-block).
 */
const PLATFORM_ADMIN_ROLE_ID = "00000000-0000-0000-0000-0000000000f0";
const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";

describe.skipIf(!hasDb)("CS-2 RBAC operator-role escalation guard", () => {
  const direct = directPool();
  let A: SeededTenant;

  let adminUser: string; // có assign-role:user (ALLOW tường minh)
  let targetUser: string; // user A bị (thử) gán role
  let tenantRole: string; // role tenant hợp lệ
  let svc: PermissionAdminService;
  let orgRepo: OrgRepository;

  async function countUserRoles(userId: string, roleId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM user_roles WHERE company_id=$1 AND user_id=$2 AND role_id=$3`,
      [A.companyId, userId, roleId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "rbacesc");

    const assignPerm = await seedPermissionCatalog(direct, "assign-role", "user", true);

    adminUser = await seedUser(direct, A.companyId, `radm-${randomUUID().slice(0, 8)}@a.test`);
    const adminRole = await seedRole(direct, A.companyId, `radm-role-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, adminRole, assignPerm, "ALLOW");
    await seedUserRole(direct, adminUser, adminRole, A.companyId);

    targetUser = await seedUser(direct, A.companyId, `rtgt-${randomUUID().slice(0, 8)}@a.test`);
    tenantRole = await seedRole(direct, A.companyId, `rtgt-role-${randomUUID().slice(0, 8)}`);

    const db = new DatabaseService();
    const permission = new PermissionService(new PermissionRepository(db));
    svc = new PermissionAdminService(
      db,
      permission,
      new AuditService(),
      new OutboxService(),
      new PermissionAdminRepository(),
    );
    orgRepo = new OrgRepository(db);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  // ── deny-path (RED) — operator role KHÔNG gán được ─────────────────────────────

  it("tenant admin CANNOT assign the platform-admin/operator role (NotFound, 0 row)", async () => {
    await expect(
      svc.assignRole({ id: adminUser, companyId: A.companyId }, targetUser, {
        roleId: PLATFORM_ADMIN_ROLE_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await countUserRoles(targetUser, PLATFORM_ADMIN_ROLE_ID)).toBe(0);
  });

  it("GET /org/roles catalog EXCLUDES the platform-admin/operator role", async () => {
    const roles = await orgRepo.listRoles(A.companyId);
    const ids = roles.map((r) => r.id);
    expect(ids).not.toContain(PLATFORM_ADMIN_ROLE_ID);
  });

  // ── happy-path (GREEN) — không over-block role hợp lệ ──────────────────────────

  it("tenant role + legitimate system role (company-admin) remain assignable/listed", async () => {
    // tenant role gán được
    const row = await svc.assignRole({ id: adminUser, companyId: A.companyId }, targetUser, {
      roleId: tenantRole,
    });
    expect(row?.id).toBeDefined();
    expect(await countUserRoles(targetUser, tenantRole)).toBe(1);

    // danh mục vẫn chứa tenant role + system role hợp lệ, không chứa operator role
    const roles = await orgRepo.listRoles(A.companyId);
    const ids = roles.map((r) => r.id);
    expect(ids).toContain(tenantRole);
    expect(ids).toContain(COMPANY_ADMIN_ROLE_ID);
    expect(ids).not.toContain(PLATFORM_ADMIN_ROLE_ID);
  });
});
