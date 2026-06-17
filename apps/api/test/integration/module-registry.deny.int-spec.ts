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
 * AC-7 module-registry deny-path (DB cô lập mediaos_ac7) — chứng minh fail-closed cho cổng nhạy cảm
 * `manage:module-toggle`:
 *
 *  (1) operator KHÔNG có manage:module-toggle ⇒ permission.can DENY (PermissionGuard fail-closed).
 *  (2) is_sensitive ⇒ wildcard `*:*` KHÔNG kế thừa (grant chỉ wildcard ⇒ vẫn DENY trên cổng nhạy cảm).
 *  (3) platform-admin (grant tường minh non-wildcard) ⇒ ALLOW.
 *  (4) company-admin KHÔNG có view:system-module ⇒ DENY (perm mới không tự vào role).
 *
 * Lưu ý audience (aud=operator) + step-up window là hành vi guard HTTP (JwtAuthGuard/OperatorReauthGuard)
 * đã có unit test riêng (operator-only / operator-reauth.guard.spec). Ở tầng int này ta khóa chặt CƠ CHẾ
 * QUYẾT ĐỊNH QUYỀN (permission.can) — lớp authorize fail-closed mà controller dựa vào.
 */
describe.skipIf(!hasDb)("AC-7 module-registry deny-path", () => {
  const direct = directPool();
  let A: SeededTenant;
  let paActor: string; // platform-admin
  let caUser: string; // company-admin
  let wildcardUser: string; // user có grant wildcard *:* (chứng minh KHÔNG lọt sensitive)
  let permission: PermissionService;

  beforeAll(async () => {
    A = await seedCompany(direct, "modDeny");

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

  it("(1) operator thường (company-admin) KHÔNG có manage:module-toggle ⇒ DENY", async () => {
    const d = await permission.can({
      userId: caUser,
      companyId: A.companyId,
      action: "manage",
      resourceType: "module-toggle",
      isSensitive: true,
    });
    expect(d.allow).toBe(false);
  });

  it("(2) wildcard *:* KHÔNG kế thừa cổng nhạy cảm manage:module-toggle ⇒ DENY", async () => {
    const d = await permission.can({
      userId: wildcardUser,
      companyId: A.companyId,
      action: "manage",
      resourceType: "module-toggle",
      isSensitive: true,
    });
    expect(d.allow).toBe(false);
  });

  it("(3) platform-admin (grant tường minh) ⇒ ALLOW manage:module-toggle", async () => {
    const d = await permission.can({
      userId: paActor,
      companyId: A.companyId,
      action: "manage",
      resourceType: "module-toggle",
      isSensitive: true,
    });
    expect(d.allow).toBe(true);
  });

  it("(3b) platform-admin ⇒ ALLOW view:system-module", async () => {
    const d = await permission.can({
      userId: paActor,
      companyId: A.companyId,
      action: "view",
      resourceType: "system-module",
    });
    expect(d.allow).toBe(true);
  });

  it("(4) company-admin KHÔNG có view:system-module ⇒ DENY", async () => {
    const d = await permission.can({
      userId: caUser,
      companyId: A.companyId,
      action: "view",
      resourceType: "system-module",
    });
    expect(d.allow).toBe(false);
  });

  // (5) REGRESSION GUARD cho TRAP G12-4 (objectGrantRequired). Nếu route module-toggle lỡ đặt
  // requiresReauth:true trên @RequirePermission, PermissionGuard bật "reveal-class" (isSensitive &&
  // requiresReauth) → forward resourceId=target company + đòi PER-OBJECT grant. Operator chỉ có grant
  // ROLE-level ⇒ DENY VĨNH VIỄN (đúng input guard cũ từng gửi — test(3) type-level KHÔNG bắt được).
  // Test này CHỨNG MINH: chính platform-admin (đang ALLOW ở test 3) BỊ DENY khi đi nhánh reveal-class →
  // lý do route PHẢI giữ isSensitive-only (step-up do OperatorReauthGuard, KHÔNG qua reveal-class).
  it("(5) reveal-class (isSensitive+requiresReauth+resourceId) ⇒ platform-admin DENY (vì sao route KHÔNG được requiresReauth)", async () => {
    const d = await permission.can({
      userId: paActor,
      companyId: A.companyId,
      action: "manage",
      resourceType: "module-toggle",
      resourceId: A.companyId, // guard set req.params.id khi reveal-class
      isSensitive: true,
      requiresReauth: true,
    });
    expect(d.allow).toBe(false); // role-level grant KHÔNG đủ cho reveal-class ⇒ deny-object-required
  });
});
