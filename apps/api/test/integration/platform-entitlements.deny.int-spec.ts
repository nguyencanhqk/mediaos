import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { DatabaseService } from "../../src/db/db.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedRolePermission,
  seedPermissionCatalog,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001";
const PLATFORM_ADMIN_ROLE = "00000000-0000-0000-0000-0000000000f0";

/**
 * AC-2 platform-entitlements deny-path (DB cô lập mediaos_ac2) — chứng minh fail-closed cho cổng nhạy cảm
 * `manage:platform-subscription` (REUSE quyền AC-1 set-plan; mọi route entitlement dùng chung quyền này):
 *
 *  (1) company-admin KHÔNG có manage:platform-subscription ⇒ permission.can DENY (PermissionGuard fail-closed).
 *  (2) is_sensitive ⇒ wildcard `*:*` (is_sensitive=false) KHÔNG kế thừa cổng nhạy cảm ⇒ vẫn DENY.
 *  (3) platform-admin (grant tường minh non-wildcard, đã seed AC-1) ⇒ ALLOW.
 *  (4) REVEAL-CLASS: isSensitive+requiresReauth+resourceId=target ⇒ platform-admin DENY (deny-object-required)
 *      → CHỨNG MINH vì sao route PUT KHÔNG được requiresReauth (operator chỉ có grant ROLE-level).
 *
 * Audience (aud=operator) + step-up window là hành vi guard HTTP (JwtAuthGuard/OperatorReauthGuard) đã có
 * unit test riêng. Ở tầng int này ta khóa chặt CƠ CHẾ QUYẾT ĐỊNH QUYỀN (permission.can).
 */
describe.skipIf(!hasDb)("AC-2 platform-entitlements deny-path", () => {
  const direct = directPool();
  let A: SeededTenant;
  let paActor: string; // platform-admin
  let caUser: string; // company-admin
  let wildcardUser: string; // grant wildcard *:* (chứng minh KHÔNG lọt sensitive)
  let permission: PermissionService;

  beforeAll(async () => {
    A = await seedCompany(direct, "entDeny");

    const paUser = await seedUser(direct, A.companyId, `pa-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, paUser, PLATFORM_ADMIN_ROLE, A.companyId);
    paActor = paUser;

    caUser = await seedUser(direct, A.companyId, `ca-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, caUser, COMPANY_ADMIN_ROLE, A.companyId);

    // user với grant WILDCARD *:* (is_sensitive=false) — KHÔNG được kế thừa cổng nhạy cảm.
    wildcardUser = await seedUser(direct, A.companyId, `wc-${randomUUID().slice(0, 8)}@a.test`);
    const wildcardRole = await seedRole(direct, A.companyId, `wildcard-${randomUUID().slice(0, 8)}`);
    const wildcardPerm = await seedPermissionCatalog(direct, "*", "*", false);
    await seedRolePermission(direct, wildcardRole, wildcardPerm, "ALLOW");
    await seedUserRole(direct, wildcardUser, wildcardRole, A.companyId);

    permission = new PermissionService(new PermissionRepository(new DatabaseService()));
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("(1) company-admin KHÔNG có manage:platform-subscription ⇒ DENY", async () => {
    const d = await permission.can({
      userId: caUser,
      companyId: A.companyId,
      action: "manage",
      resourceType: "platform-subscription",
      isSensitive: true,
    });
    expect(d.allow).toBe(false);
  });

  it("(2) wildcard *:* KHÔNG kế thừa cổng nhạy cảm manage:platform-subscription ⇒ DENY", async () => {
    const d = await permission.can({
      userId: wildcardUser,
      companyId: A.companyId,
      action: "manage",
      resourceType: "platform-subscription",
      isSensitive: true,
    });
    expect(d.allow).toBe(false);
  });

  it("(3) platform-admin (grant tường minh) ⇒ ALLOW manage:platform-subscription", async () => {
    const d = await permission.can({
      userId: paActor,
      companyId: A.companyId,
      action: "manage",
      resourceType: "platform-subscription",
      isSensitive: true,
    });
    expect(d.allow).toBe(true);
  });

  // (4) REGRESSION GUARD cho TRAP reveal-class (objectGrantRequired). Nếu route entitlement lỡ đặt
  // requiresReauth:true trên @RequirePermission, PermissionGuard bật "reveal-class" (isSensitive &&
  // requiresReauth) → forward resourceId=target company + đòi PER-OBJECT grant. Operator chỉ có grant
  // ROLE-level ⇒ DENY VĨNH VIỄN. Test CHỨNG MINH: chính platform-admin (ALLOW ở test 3) BỊ DENY khi đi
  // nhánh reveal-class → lý do route PHẢI giữ isSensitive-only (step-up do OperatorReauthGuard).
  it("(4) reveal-class (isSensitive+requiresReauth+resourceId) ⇒ platform-admin DENY (vì sao route KHÔNG được requiresReauth)", async () => {
    const d = await permission.can({
      userId: paActor,
      companyId: A.companyId,
      action: "manage",
      resourceType: "platform-subscription",
      resourceId: A.companyId, // guard set req.params.id khi reveal-class
      isSensitive: true,
      requiresReauth: true,
    });
    expect(d.allow).toBe(false); // role-level grant KHÔNG đủ cho reveal-class ⇒ deny-object-required
  });
});
