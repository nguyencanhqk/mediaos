/**
 * S2-HR-BE-3 RED suite — Department CRUD permission guard + cycle detection.
 *
 * Yêu cầu nghiệm thu:
 *   1. Department mutations dùng resource_type 'department' (HR.DEPARTMENT.*) — KHÔNG 'org_unit'.
 *   2. Deny-path: thiếu quyền → 403; 2-tenant deny: sai tenant → 0 row (không tìm thấy dept).
 *   3. Cycle parent validation: parent_id trỏ vào chính nó / chu trình → BadRequestException.
 *   4. Audit log ghi khi create/update/delete department thành công.
 *
 * RED: chạy FAIL trước khi implement (OrgController chưa có route /hr/departments với resource 'department').
 */

import "reflect-metadata";
import { ForbiddenException, BadRequestException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionGuard } from "../permission/guards/permission.guard";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import type { PermissionDecision } from "../permission/permission.types";
import { HrDepartmentController } from "./hr-department.controller";
import { HrDepartmentService } from "./hr-department.service";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DEPT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const ALLOW: PermissionDecision = { allow: true, reason: "allow", auditRequired: false };
const DENY: PermissionDecision = { allow: false, reason: "deny-default", auditRequired: false };

interface MutationCase {
  method: keyof HrDepartmentController;
  action: string;
  resourceType: string;
}

const MUTATIONS: MutationCase[] = [
  { method: "createDepartment", action: "create", resourceType: "department" },
  { method: "updateDepartment", action: "update", resourceType: "department" },
  { method: "deleteDepartment", action: "delete", resourceType: "department" },
];

function handlerOf(m: keyof HrDepartmentController): (...a: unknown[]) => unknown {
  return HrDepartmentController.prototype[m] as (...a: unknown[]) => unknown;
}

function makeCtx(
  method: keyof HrDepartmentController,
  user: { id: string; companyId: string },
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params: { id: DEPT_ID } }) }),
    getHandler: () => handlerOf(method),
    getClass: () => HrDepartmentController,
  } as unknown as ExecutionContext;
}

describe("HrDepartmentController — permission guard (S2-HR-BE-3 RED)", () => {
  const reflector = new Reflector();

  it.each(MUTATIONS)(
    "$method declares @RequirePermission($action, $resourceType)",
    ({ method, action, resourceType }) => {
      const meta = reflector.get<RequirePermissionMeta>(REQUIRE_PERMISSION, handlerOf(method));
      expect(meta, `${method} is missing @RequirePermission`).toBeDefined();
      expect(meta.action).toBe(action);
      expect(meta.resourceType).toBe(resourceType);
    },
  );

  it.each(MUTATIONS)("$method is protected by PermissionGuard", ({ method }) => {
    const classGuards =
      (Reflect.getMetadata("__guards__", HrDepartmentController) as unknown[]) ?? [];
    const methodGuards = (Reflect.getMetadata("__guards__", handlerOf(method)) as unknown[]) ?? [];
    expect([...classGuards, ...methodGuards]).toContain(PermissionGuard);
  });

  describe("deny-path: user without permission → 403", () => {
    let permSvc: { can: ReturnType<typeof vi.fn> };
    beforeEach(() => {
      permSvc = { can: vi.fn() };
    });

    it.each(MUTATIONS)("$method → ForbiddenException when can() denies", async ({ method }) => {
      permSvc.can.mockResolvedValue(DENY);
      const guard = new PermissionGuard(reflector, permSvc as never);
      await expect(
        guard.canActivate(makeCtx(method, { id: ACTOR_ID, companyId: COMPANY_A })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(MUTATIONS)(
      "$method → allowed when can() grants",
      async ({ method, action, resourceType }) => {
        permSvc.can.mockResolvedValue(ALLOW);
        const guard = new PermissionGuard(reflector, permSvc as never);
        await expect(
          guard.canActivate(makeCtx(method, { id: ACTOR_ID, companyId: COMPANY_A })),
        ).resolves.toBe(true);
        expect(permSvc.can).toHaveBeenCalledWith(
          expect.objectContaining({ action, resourceType, companyId: COMPANY_A }),
        );
      },
    );
  });
});

describe("HrDepartmentService — cycle detection + 2-tenant deny (S2-HR-BE-3 RED)", () => {
  function makeRepo() {
    return {
      listDepartments: vi.fn().mockResolvedValue([]),
      findDepartmentById: vi
        .fn()
        .mockResolvedValue([{ id: DEPT_ID, companyId: COMPANY_A, parentId: null }]),
      createDepartment: vi.fn().mockResolvedValue([{ id: DEPT_ID, companyId: COMPANY_A }]),
      updateDepartment: vi.fn().mockResolvedValue([{ id: DEPT_ID, companyId: COMPANY_A }]),
      softDeleteDepartment: vi.fn().mockResolvedValue([{ id: DEPT_ID }]),
      getAncestors: vi.fn().mockResolvedValue([]), // no ancestors by default
    };
  }

  function makeDb() {
    return {
      withTenant: vi
        .fn()
        .mockImplementation((_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
          fn({ __tx: true }),
        ),
    };
  }

  function makeAudit() {
    return { record: vi.fn().mockResolvedValue(undefined) };
  }

  function makeService(opts: {
    repo?: ReturnType<typeof makeRepo>;
    db?: ReturnType<typeof makeDb>;
    audit?: ReturnType<typeof makeAudit>;
  }) {
    const repo = opts.repo ?? makeRepo();
    const db = opts.db ?? makeDb();
    const audit = opts.audit ?? makeAudit();
    const service = new HrDepartmentService(repo as never, db as never, audit as never);
    return { service, repo, db, audit };
  }

  beforeEach(() => vi.clearAllMocks());

  // RED: pre-insert parentId validation — parentId NOT found in same company → BadRequestException.
  // (Post-insert self-ref check `created.id === dto.parentId` was a no-op in production because
  //  DB-generated UUIDs are always fresh. Fixed: validate parentId existence BEFORE INSERT in tx.)
  it("createDepartment: parentId does not exist in company → BadRequestException (HR-ERR-016)", async () => {
    const NONEXISTENT_PARENT_ID = "99999999-9999-9999-9999-999999999999";
    const repo = makeRepo();
    // Simulate: parent row absent (different company or deleted or never existed).
    // findDepartmentById called with (companyId, parentId, tx) returns empty → parent not found.
    repo.findDepartmentById.mockResolvedValue([]);
    // createDepartment returns a FRESH UUID (≠ NONEXISTENT_PARENT_ID) — in real DB, UUID never matches.
    repo.createDepartment.mockResolvedValue([
      { id: "aaaabbbb-0000-0000-0000-000000000001", companyId: COMPANY_A },
    ]);
    const { service } = makeService({ repo });
    await expect(
      service.createDepartment(COMPANY_A, ACTOR_ID, {
        name: "Orphan Dept",
        parentId: NONEXISTENT_PARENT_ID, // different from any returned id → post-insert check is dead
        code: "ORPHAN",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("createDepartment: parentId exists in same company → succeeds (no cycle)", async () => {
    const PARENT_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const NEW_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const repo = makeRepo();
    // Parent exists in COMPANY_A
    repo.findDepartmentById.mockResolvedValue([{ id: PARENT_ID, companyId: COMPANY_A }]);
    repo.createDepartment.mockResolvedValue([{ id: NEW_ID, companyId: COMPANY_A }]);
    const { service } = makeService({ repo });
    const result = await service.createDepartment(COMPANY_A, ACTOR_ID, {
      name: "Child Dept",
      parentId: PARENT_ID,
      code: "CHILD",
    });
    expect(result).toMatchObject({ id: NEW_ID });
  });

  it("updateDepartment: parentId = own id → BadRequestException (self-cycle)", async () => {
    const repo = makeRepo();
    repo.findDepartmentById.mockResolvedValue([
      { id: DEPT_ID, companyId: COMPANY_A, parentId: null },
    ]);
    const { service } = makeService({ repo });
    await expect(
      service.updateDepartment(COMPANY_A, ACTOR_ID, DEPT_ID, { parentId: DEPT_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("updateDepartment: parentId in ancestors → BadRequestException (cycle)", async () => {
    const CHILD_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const repo = makeRepo();
    // DEPT_ID is being updated; CHILD_ID is proposed as parent; but CHILD_ID is already a descendant
    repo.findDepartmentById.mockResolvedValue([
      { id: DEPT_ID, companyId: COMPANY_A, parentId: null },
    ]);
    // getAncestors of CHILD_ID returns DEPT_ID → cycle detected
    repo.getAncestors.mockResolvedValue([DEPT_ID]);
    const { service } = makeService({ repo });
    await expect(
      service.updateDepartment(COMPANY_A, ACTOR_ID, DEPT_ID, { parentId: CHILD_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("2-tenant deny: deleteDepartment with wrong tenant → NotFoundException", async () => {
    const repo = makeRepo();
    // Simulate: DB returns empty (RLS + company_id filter returns 0 rows for wrong company)
    repo.softDeleteDepartment.mockResolvedValue([]);
    const { service } = makeService({ repo });
    // COMPANY_B tries to delete dept from COMPANY_A → 0 rows → NotFoundException
    await expect(service.deleteDepartment(COMPANY_B, ACTOR_ID, DEPT_ID)).rejects.toThrow();
  });

  it("createDepartment: audit record is called on success", async () => {
    const repo = makeRepo();
    repo.createDepartment.mockResolvedValue([
      { id: DEPT_ID, companyId: COMPANY_A, name: "HR Dept" },
    ]);
    const { service, audit } = makeService({ repo });
    await service.createDepartment(COMPANY_A, ACTOR_ID, { name: "HR Dept", code: "HR" });
    expect(audit.record).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "create",
        objectType: "org_unit",
        objectId: DEPT_ID,
        actorUserId: ACTOR_ID,
      }),
    );
  });

  it("updateDepartment: audit record is called on success", async () => {
    const repo = makeRepo();
    repo.findDepartmentById.mockResolvedValue([
      { id: DEPT_ID, companyId: COMPANY_A, parentId: null },
    ]);
    repo.updateDepartment.mockResolvedValue([
      { id: DEPT_ID, companyId: COMPANY_A, name: "Updated" },
    ]);
    const { service, audit } = makeService({ repo });
    await service.updateDepartment(COMPANY_A, ACTOR_ID, DEPT_ID, { name: "Updated" });
    expect(audit.record).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "update",
        objectType: "org_unit",
        objectId: DEPT_ID,
        actorUserId: ACTOR_ID,
      }),
    );
  });

  it("deleteDepartment: audit record is called on success", async () => {
    const repo = makeRepo();
    repo.softDeleteDepartment.mockResolvedValue([{ id: DEPT_ID }]);
    const { service, audit } = makeService({ repo });
    await service.deleteDepartment(COMPANY_A, ACTOR_ID, DEPT_ID);
    expect(audit.record).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "delete", objectType: "org_unit", objectId: DEPT_ID }),
    );
  });
});
