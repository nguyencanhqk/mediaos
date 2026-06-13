import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PermissionGuard } from "../../src/permission/guards/permission.guard";
import { SalaryProfileController } from "../../src/payroll/salary-profile.controller";
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

/**
 * G12-1 — DENY-PATH HTTP permission (RED-first). CROWN JEWEL: lương nhạy cảm (ADR-0010, BẤT BIẾN #3).
 * Chạy trên PERMISSION ENGINE THẬT (Postgres, 4 tầng G3) — KHÔNG mock permission.
 *
 * (a) Role có wildcard *:* (company-admin GENERIC dạng test) NHƯNG KHÔNG có grant sensitive
 *     view/manage-salary-profile → mọi route salary-profiles 403 (deny-sensitive-not-inherited:
 *     salary is_sensitive=TRUE KHÔNG kế thừa qua wildcard — mirror employees view-salary/update-salary).
 * (b) employee thường (không grant) đọc salary-profile của người khác → 403.
 * (c) Mỗi route phải khai @RequirePermission ⇒ user 0 role ⇒ PermissionGuard fail-closed 403.
 */

const EMPLOYEE_ROLE_ID = "00000000-0000-0000-0000-000000000008"; // system 'employee'

describe.skipIf(!hasDb)(
  "G12-1 salary-profile permission deny-path (HTTP guard, fail-closed)",
  () => {
    const direct = directPool();
    const db = new DatabaseService();
    const guard = new PermissionGuard(
      new Reflector(),
      new PermissionService(new PermissionRepository(db)),
    );

    let A: SeededTenant;
    let wildcardUserId: string; // role có '*:*' ALLOW NHƯNG KHÔNG có salary_profile grant
    let employeeUserId: string; // system 'employee' — thiếu salary_profile grant
    let noRoleUserId: string; // không role nào → thiếu TẤT CẢ

    beforeAll(async () => {
      A = await seedCompany(direct, "salperm");

      // (a) tenant role có wildcard *:* (mô phỏng "company-admin generic"): permission engine KHÔNG
      //     được để wildcard thoả mãn sensitive view/manage-salary-profile.
      const wildcardRoleId = await seedRole(direct, A.companyId, `wildcard-${A.slug}`);
      const wildcardPermId = await seedPermissionCatalog(direct, "*", "*", false);
      await seedRolePermission(direct, wildcardRoleId, wildcardPermId, "ALLOW");
      wildcardUserId = await seedUser(direct, A.companyId, `wild-${A.slug}@x.test`);
      await seedUserRole(direct, wildcardUserId, wildcardRoleId, A.companyId);

      employeeUserId = await seedUser(direct, A.companyId, `emp-${A.slug}@x.test`);
      await seedUserRole(direct, employeeUserId, EMPLOYEE_ROLE_ID, A.companyId);

      noRoleUserId = await seedUser(direct, A.companyId, `norole-${A.slug}@x.test`);
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    });

    function ctxFor(
      methodName: keyof SalaryProfileController,
      userId: string,
      params: Record<string, string> = {},
    ): ExecutionContext {
      const handler = SalaryProfileController.prototype[methodName] as (...a: unknown[]) => unknown;
      const req = { user: { id: userId, companyId: A.companyId }, params };
      return {
        getHandler: () => handler,
        getClass: () => SalaryProfileController,
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;
    }

    const SOME_ID = "00000000-0000-0000-0000-0000000000aa";

    // (a) wildcard *:* user — sensitive NOT inherited
    it("(a) wildcard *:* user → GET /salary-profiles (view-salary-profile) ⇒ 403", async () => {
      await expect(guard.canActivate(ctxFor("list", wildcardUserId))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("(a) wildcard *:* user → GET /salary-profiles/:id ⇒ 403", async () => {
      await expect(
        guard.canActivate(ctxFor("getOne", wildcardUserId, { id: SOME_ID })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("(a) wildcard *:* user → POST /salary-profiles (manage-salary-profile) ⇒ 403", async () => {
      await expect(guard.canActivate(ctxFor("create", wildcardUserId))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("(a) wildcard *:* user → PATCH /salary-profiles/:id ⇒ 403", async () => {
      await expect(
        guard.canActivate(ctxFor("update", wildcardUserId, { id: SOME_ID })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("(a) wildcard *:* user → DELETE /salary-profiles/:id ⇒ 403", async () => {
      await expect(
        guard.canActivate(ctxFor("remove", wildcardUserId, { id: SOME_ID })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // (b) employee đọc lương người khác → 403
    it("(b) employee reads another user's salary-profile (GET) ⇒ 403", async () => {
      await expect(
        guard.canActivate(ctxFor("getOne", employeeUserId, { id: SOME_ID })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // (c) route guarded fail-closed for no-role user
    it("(c) no-role user → every CRUD route ⇒ 403 (fail-closed, @RequirePermission present)", async () => {
      await expect(guard.canActivate(ctxFor("list", noRoleUserId))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(guard.canActivate(ctxFor("create", noRoleUserId))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        guard.canActivate(ctxFor("update", noRoleUserId, { id: SOME_ID })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        guard.canActivate(ctxFor("remove", noRoleUserId, { id: SOME_ID })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  },
);
