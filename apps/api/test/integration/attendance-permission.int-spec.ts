import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PermissionGuard } from "../../src/permission/guards/permission.guard";
import { AttendanceController } from "../../src/attendance/attendance.controller";
import { AttendanceAdjustmentController } from "../../src/attendance/attendance-adjustment.controller";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * G11-1 — DENY-PATH HTTP permission (RED-first). Chứng minh PermissionGuard ĐÃ wired fail-closed
 * cho các route nhạy cảm của AttendanceController, chạy trên PERMISSION ENGINE THẬT (Postgres, 4 tầng
 * G3) — KHÔNG mock permission. Trước đây deny-path chỉ ở unit (service mock decision); ở đây nâng lên
 * tầng guard+controller+DB để loại "xanh-giả": guard đọc đúng metadata @RequirePermission của route và
 * `PermissionService.can()` thật trả deny cho user thiếu grant ⇒ ForbiddenException (403).
 *
 * 'employee' (system role) theo seed 0063 CHỈ có check-in/read/adjust attendance — KHÔNG có
 * approve / lock-period / manage. Đó là user "thiếu grant" lý tưởng cho 3 route quản lý.
 */

const EMPLOYEE_ROLE_ID = "00000000-0000-0000-0000-000000000008"; // system 'employee'

describe.skipIf(!hasDb)("G11-1 attendance permission deny-path (HTTP guard, fail-closed)", () => {
  const direct = directPool();
  const db = new DatabaseService();
  const guard = new PermissionGuard(
    new Reflector(),
    new PermissionService(new PermissionRepository(db)),
  );

  let A: SeededTenant;
  let employeeUserId: string; // có role 'employee' → thiếu approve/lock-period/manage
  let noRoleUserId: string; // không role nào → thiếu TẤT CẢ

  beforeAll(async () => {
    A = await seedCompany(direct, "attperm");
    employeeUserId = await seedUser(direct, A.companyId, `emp-${A.slug}@x.test`);
    await seedUserRole(direct, employeeUserId, EMPLOYEE_ROLE_ID, A.companyId);
    noRoleUserId = await seedUser(direct, A.companyId, `norole-${A.slug}@x.test`);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    // db dùng pool module-level chia sẻ (src/db/index) — không sở hữu bởi test, không đóng ở đây.
  });

  /** Dựng ExecutionContext giả gắn handler thật của controller + user đã seed (sau JwtAuthGuard). */
  function ctxFor(
    methodName: keyof AttendanceController,
    userId: string,
    params: Record<string, string> = {},
  ): ExecutionContext {
    const handler = AttendanceController.prototype[methodName] as (...a: unknown[]) => unknown;
    const req = { user: { id: userId, companyId: A.companyId }, params };
    return {
      getHandler: () => handler,
      getClass: () => AttendanceController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  it("approve (approve:adjustment) — user thiếu grant ⇒ 403 (S3-ATT-BE-4 canonical controller)", async () => {
    const handler = AttendanceAdjustmentController.prototype.approve as (
      ...a: unknown[]
    ) => unknown;
    const req = {
      user: { id: employeeUserId, companyId: A.companyId },
      params: { id: "00000000-0000-0000-0000-0000000000aa" },
    };
    const ctx = {
      getHandler: () => handler,
      getClass: () => AttendanceAdjustmentController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lockPeriod (lock-period:attendance) — user thiếu grant ⇒ 403", async () => {
    await expect(guard.canActivate(ctxFor("lockPeriod", employeeUserId))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("listMonthly (read:attendance) route IS guarded; user không role nào ⇒ 403 (fail-closed)", async () => {
    // 'manage:attendance' (xem nhân sự khác) enforce ở service; ở guard chứng minh route được bảo vệ:
    // user 0 role thiếu cả 'read:attendance' ⇒ guard deny trước khi tới service.
    await expect(guard.canActivate(ctxFor("listMonthly", noRoleUserId))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("user 'employee' ĐƯỢC phép self check-in (check-in:attendance) — guard cho qua (sanity allow-path)", async () => {
    await expect(guard.canActivate(ctxFor("checkIn", employeeUserId))).resolves.toBe(true);
  });
});
