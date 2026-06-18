/**
 * CS-8 — permission deny-path cho configure-mail:company (Postgres thật; auto-skip khi thiếu DB).
 *
 * Chứng minh fail-closed:
 *  (a) user role RỖNG (KHÔNG grant configure-mail) ⇒ permission.can DENY.
 *  (b) system-admin role (00000000-...-0001, grant tường minh ở mig 0380) ⇒ ALLOW.
 *  (c) permission 'configure-mail'/'company' tồn tại + is_sensitive=true (seed 0380).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedRole, seedUser, seedUserRole, type SeededTenant } from "../helpers/seed";

const SYSTEM_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001";
const ACTION = "configure-mail";
const RESOURCE = "company";

describe.skipIf(!hasDb)("CS-8 configure-mail:company permission gate", () => {
  const direct = directPool();
  let A: SeededTenant;
  let adminUser: string;
  let noGrantUser: string;
  let permission: PermissionService;

  beforeAll(async () => {
    A = await seedCompany(direct, "cs8perm");

    adminUser = await seedUser(direct, A.companyId, `adm-${randomUUID().slice(0, 6)}@a.test`);
    await seedUserRole(direct, adminUser, SYSTEM_ADMIN_ROLE, A.companyId);

    noGrantUser = await seedUser(direct, A.companyId, `ng-${randomUUID().slice(0, 6)}@a.test`);
    const emptyRole = await seedRole(direct, A.companyId, `empty-${randomUUID().slice(0, 6)}`);
    await seedUserRole(direct, noGrantUser, emptyRole, A.companyId);

    permission = new PermissionService(new PermissionRepository(new DatabaseService()));
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("(c) permission configure-mail:company tồn tại + is_sensitive=true (seed 0380)", async () => {
    const r = await direct.query(
      `SELECT is_sensitive FROM permissions WHERE action=$1 AND resource_type=$2`,
      [ACTION, RESOURCE],
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].is_sensitive).toBe(true);
  });

  it("(a) user role rỗng (KHÔNG grant) ⇒ DENY", async () => {
    const d = await permission.can({
      userId: noGrantUser,
      companyId: A.companyId,
      action: ACTION,
      resourceType: RESOURCE,
      isSensitive: true,
    });
    expect(d.allow).toBe(false);
  });

  it("(b) system-admin (grant tường minh mig 0380) ⇒ ALLOW", async () => {
    const d = await permission.can({
      userId: adminUser,
      companyId: A.companyId,
      action: ACTION,
      resourceType: RESOURCE,
      isSensitive: true,
    });
    expect(d.allow).toBe(true);
  });
});
