/**
 * S2-HR-BE-3 RED suite — HR Master Data CRUD (job_levels + contract_types).
 *
 * Permission: manage:master-data (HR.MASTER_DATA.MANAGE)
 * Deny-path: thiếu quyền → 403; 2-tenant deny; audit ghi khi thành công.
 *
 * RED: chạy FAIL trước khi implement HrMasterDataController/Service.
 */

import "reflect-metadata";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionGuard } from "../permission/guards/permission.guard";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import type { PermissionDecision } from "../permission/permission.types";
import { HrMasterDataController } from "./hr-master-data.controller";
import { HrMasterDataService } from "./hr-master-data.service";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const JL_ID = "22222222-2222-2222-2222-222222222222";
const CT_ID = "33333333-3333-3333-3333-333333333333";
const ALLOW: PermissionDecision = { allow: true, reason: "allow", auditRequired: false };
const DENY: PermissionDecision = { allow: false, reason: "deny-default", auditRequired: false };
const PG_UNIQUE = { code: "23505" };

interface MutationCase {
  method: keyof HrMasterDataController;
  action: string;
  resourceType: string;
}

const MUTATIONS: MutationCase[] = [
  { method: "createJobLevel", action: "manage", resourceType: "master-data" },
  { method: "updateJobLevel", action: "manage", resourceType: "master-data" },
  { method: "deleteJobLevel", action: "manage", resourceType: "master-data" },
  { method: "createContractType", action: "manage", resourceType: "master-data" },
  { method: "updateContractType", action: "manage", resourceType: "master-data" },
  { method: "deleteContractType", action: "manage", resourceType: "master-data" },
];

// READ endpoints also require manage:master-data per SPEC-03 §13.12b/c
const READ_GUARDED: MutationCase[] = [
  { method: "listJobLevels", action: "manage", resourceType: "master-data" },
  { method: "listContractTypes", action: "manage", resourceType: "master-data" },
];

function handlerOf(m: keyof HrMasterDataController): (...a: unknown[]) => unknown {
  return HrMasterDataController.prototype[m] as (...a: unknown[]) => unknown;
}

function makeCtx(
  method: keyof HrMasterDataController,
  user: { id: string; companyId: string },
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params: { id: JL_ID } }) }),
    getHandler: () => handlerOf(method),
    getClass: () => HrMasterDataController,
  } as unknown as ExecutionContext;
}

describe("HrMasterDataController — permission guard (S2-HR-BE-3 RED)", () => {
  const reflector = new Reflector();

  it.each([...MUTATIONS, ...READ_GUARDED])(
    "$method declares @RequirePermission($action, $resourceType)",
    ({ method, action, resourceType }) => {
      const meta = reflector.get<RequirePermissionMeta>(REQUIRE_PERMISSION, handlerOf(method));
      expect(meta, `${method} is missing @RequirePermission`).toBeDefined();
      expect(meta.action).toBe(action);
      expect(meta.resourceType).toBe(resourceType);
    },
  );

  it.each([...MUTATIONS, ...READ_GUARDED])(
    "$method is protected by PermissionGuard",
    ({ method }) => {
      const classGuards =
        (Reflect.getMetadata("__guards__", HrMasterDataController) as unknown[]) ?? [];
      const methodGuards =
        (Reflect.getMetadata("__guards__", handlerOf(method)) as unknown[]) ?? [];
      expect([...classGuards, ...methodGuards]).toContain(PermissionGuard);
    },
  );

  describe("deny-path: user without manage:master-data → 403", () => {
    let permSvc: { can: ReturnType<typeof vi.fn> };
    beforeEach(() => {
      permSvc = { can: vi.fn() };
    });

    it.each([...MUTATIONS, ...READ_GUARDED])(
      "$method → ForbiddenException when can() denies",
      async ({ method }) => {
        permSvc.can.mockResolvedValue(DENY);
        const guard = new PermissionGuard(reflector, permSvc as never);
        await expect(
          guard.canActivate(makeCtx(method, { id: ACTOR_ID, companyId: COMPANY_A })),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it.each([...MUTATIONS, ...READ_GUARDED])(
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

describe("HrMasterDataService — job_levels CRUD (S2-HR-BE-3 RED)", () => {
  function makeRepo() {
    return {
      listJobLevels: vi.fn().mockResolvedValue([{ id: JL_ID, name: "Senior" }]),
      findJobLevelById: vi
        .fn()
        .mockResolvedValue([{ id: JL_ID, companyId: COMPANY_A, name: "Senior" }]),
      createJobLevel: vi
        .fn()
        .mockResolvedValue([{ id: JL_ID, companyId: COMPANY_A, name: "Senior" }]),
      updateJobLevel: vi
        .fn()
        .mockResolvedValue([{ id: JL_ID, companyId: COMPANY_A, name: "Lead" }]),
      softDeleteJobLevel: vi.fn().mockResolvedValue([{ id: JL_ID }]),
      listContractTypes: vi.fn().mockResolvedValue([{ id: CT_ID, name: "Full-time" }]),
      findContractTypeById: vi
        .fn()
        .mockResolvedValue([{ id: CT_ID, companyId: COMPANY_A, name: "Full-time" }]),
      createContractType: vi
        .fn()
        .mockResolvedValue([{ id: CT_ID, companyId: COMPANY_A, name: "Full-time" }]),
      updateContractType: vi
        .fn()
        .mockResolvedValue([{ id: CT_ID, companyId: COMPANY_A, name: "Part-time" }]),
      softDeleteContractType: vi.fn().mockResolvedValue([{ id: CT_ID }]),
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
    const service = new HrMasterDataService(repo as never, db as never, audit as never);
    return { service, repo, db, audit };
  }

  beforeEach(() => vi.clearAllMocks());

  // ── Job Levels ──────────────────────────────────────────────────────────────

  it("listJobLevels forwards companyId filter", async () => {
    const { service, repo } = makeService({});
    await service.listJobLevels(COMPANY_A);
    expect(repo.listJobLevels).toHaveBeenCalledWith(COMPANY_A, undefined);
  });

  it("createJobLevel returns created row + ghi audit", async () => {
    const { service, repo, audit } = makeService({});
    const result = await service.createJobLevel(COMPANY_A, ACTOR_ID, {
      code: "SR",
      name: "Senior",
    });
    expect(result).toMatchObject({ id: JL_ID });
    expect(repo.createJobLevel).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "create",
        objectType: "job_level",
        objectId: JL_ID,
        actorUserId: ACTOR_ID,
      }),
    );
  });

  it("createJobLevel: unique violation → ConflictException", async () => {
    const repo = makeRepo();
    repo.createJobLevel.mockRejectedValueOnce(PG_UNIQUE);
    const { service } = makeService({ repo });
    await expect(
      service.createJobLevel(COMPANY_A, ACTOR_ID, { code: "DUP", name: "Dup" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("updateJobLevel: NotFound when row missing", async () => {
    const repo = makeRepo();
    repo.updateJobLevel.mockResolvedValueOnce([]);
    const { service } = makeService({ repo });
    await expect(
      service.updateJobLevel(COMPANY_A, ACTOR_ID, JL_ID, { name: "X" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("updateJobLevel: ghi audit on success", async () => {
    const { service, audit } = makeService({});
    await service.updateJobLevel(COMPANY_A, ACTOR_ID, JL_ID, { name: "Lead" });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "update", objectType: "job_level", objectId: JL_ID }),
    );
  });

  it("deleteJobLevel: NotFound when 0 rows deleted", async () => {
    const repo = makeRepo();
    repo.softDeleteJobLevel.mockResolvedValueOnce([]);
    const { service } = makeService({ repo });
    await expect(service.deleteJobLevel(COMPANY_A, ACTOR_ID, JL_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("deleteJobLevel: ghi audit on success", async () => {
    const { service, audit } = makeService({});
    await service.deleteJobLevel(COMPANY_A, ACTOR_ID, JL_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "delete", objectType: "job_level", objectId: JL_ID }),
    );
  });

  it("2-tenant deny: deleteJobLevel with COMPANY_B → NotFoundException (RLS + company_id filter = 0 rows)", async () => {
    const repo = makeRepo();
    repo.softDeleteJobLevel.mockResolvedValueOnce([]);
    const { service } = makeService({ repo });
    await expect(service.deleteJobLevel(COMPANY_B, ACTOR_ID, JL_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // ── Contract Types ──────────────────────────────────────────────────────────

  it("listContractTypes forwards companyId filter", async () => {
    const { service, repo } = makeService({});
    await service.listContractTypes(COMPANY_A);
    expect(repo.listContractTypes).toHaveBeenCalledWith(COMPANY_A, undefined);
  });

  it("createContractType returns created row + ghi audit", async () => {
    const { service, repo, audit } = makeService({});
    const result = await service.createContractType(COMPANY_A, ACTOR_ID, {
      code: "FT",
      name: "Full-time",
      requiresEndDate: false,
    });
    expect(result).toMatchObject({ id: CT_ID });
    expect(repo.createContractType).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "create",
        objectType: "contract_type",
        objectId: CT_ID,
        actorUserId: ACTOR_ID,
      }),
    );
  });

  it("createContractType: unique violation → ConflictException", async () => {
    const repo = makeRepo();
    repo.createContractType.mockRejectedValueOnce(PG_UNIQUE);
    const { service } = makeService({ repo });
    await expect(
      service.createContractType(COMPANY_A, ACTOR_ID, {
        code: "DUP",
        name: "Dup",
        requiresEndDate: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("updateContractType: NotFound when row missing", async () => {
    const repo = makeRepo();
    repo.updateContractType.mockResolvedValueOnce([]);
    const { service } = makeService({ repo });
    await expect(
      service.updateContractType(COMPANY_A, ACTOR_ID, CT_ID, { name: "X" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("updateContractType: ghi audit on success", async () => {
    const { service, audit } = makeService({});
    await service.updateContractType(COMPANY_A, ACTOR_ID, CT_ID, { name: "Part-time" });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "update",
        objectType: "contract_type",
        objectId: CT_ID,
      }),
    );
  });

  it("deleteContractType: NotFound when 0 rows deleted", async () => {
    const repo = makeRepo();
    repo.softDeleteContractType.mockResolvedValueOnce([]);
    const { service } = makeService({ repo });
    await expect(service.deleteContractType(COMPANY_A, ACTOR_ID, CT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("2-tenant deny: deleteContractType with COMPANY_B → NotFoundException", async () => {
    const repo = makeRepo();
    repo.softDeleteContractType.mockResolvedValueOnce([]);
    const { service } = makeService({ repo });
    await expect(service.deleteContractType(COMPANY_B, ACTOR_ID, CT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
