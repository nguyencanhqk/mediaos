import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { AuditMaskerService } from "../../src/events/audit-masker.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PermissionGuard } from "../../src/permission/guards/permission.guard";
import { HrDepartmentController } from "../../src/org/hr-department.controller";
import { HrDepartmentService } from "../../src/org/hr-department.service";
import { HrDepartmentRepository } from "../../src/org/hr-department.repository";
import { HrMasterDataController } from "../../src/org/hr-master-data.controller";
import { HrMasterDataService } from "../../src/org/hr-master-data.service";
import { HrMasterDataRepository } from "../../src/org/hr-master-data.repository";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * S2-HR-BE-3-FIX-RLS-INTSPEC — RED→GREEN trên POSTGRES THẬT (gate hasDb && LANE_DB).
 *
 * Thay bằng chứng "xanh-mock" (org.department.spec / hr-master-data.spec) bằng bằng chứng DB thật cho 4
 * điểm Đội 3 FAIL:
 *
 *   (a) AUDIT CHECK 0446 — create/update/delete job_level + contract_type ghi audit object_type
 *       'job_level'/'contract_type' INSERT THÀNH CÔNG vào audit_logs trên Postgres thật. Trước mig 0446,
 *       CHECK audit_logs_object_type chặn 2 type này ⇒ INSERT vỡ ràng buộc (23514)=500. Chạy service
 *       THẬT (withTenant app-role) chứng minh audit-in-tx commit, KHÔNG vỡ CHECK (BẤT BIẾN #2 nguyên vẹn).
 *
 *   (b) 2-TENANT DENY RLS THẬT — service tenant B KHÔNG đọc/thấy được department + master-data của tenant A
 *       (RLS FORCE ở DB lọc, không phải mock repo trả 0 row). Chứng minh BẤT BIẾN #1 ép Ở TẦNG DB qua đúng
 *       đường app (withTenant → set_config app.current_company_id → mediaos_app non-BYPASSRLS).
 *
 *   (c) 403 THIẾU QUYỀN — PermissionGuard + PermissionService THẬT (engine 4-tầng trên Postgres): user
 *       'employee' (read:department, KHÔNG create/update/delete + KHÔNG manage:master-data) ⇒ deny mutate.
 *       User KHÔNG role nào ⇒ deny tất cả. User 'hr' canonical ⇒ allow (sanity allow-path).
 *
 *   (d) CREATE DEPARTMENT parentId CROSS-TENANT BỊ CHẶN — service tenant B tạo department với parentId trỏ
 *       department của tenant A ⇒ BadRequestException (pre-insert validate parentId trong CÙNG company qua
 *       RLS thấy 0 row). Chứng minh guard parentId không phải no-op post-insert.
 *
 * Mirror: hr-core-reconcile.int-spec.ts (asTenant + seedCompany 2 tenant) + attendance-permission.int-spec.ts
 * (PermissionGuard + ExecutionContext giả trỏ handler controller thật). Gate hasDb && LANE_DB (CLAUDE.md §9.5):
 * DB chung bị drift migration-band ⇒ chỉ tin DB lane cô lập (mediaos_<lane>) đã chain 0000→latest sạch.
 */

const hasLaneDb = hasDb && !!process.env.LANE_DB;

const HR_ROLE_ID = "00000000-0000-0000-0000-000000000011"; // canonical 'hr' (seed 0444) — read/create:department
//                                                            + update/delete:department + manage:master-data (0445)
const EMPLOYEE_ROLE_ID = "00000000-0000-0000-0000-000000000008"; // system 'employee' — read:department ONLY

describe.skipIf(!hasLaneDb)("S2-HR-BE-3 HR department + master-data on real Postgres", () => {
  const direct = directPool();
  const app = appPool(2);

  // Real wiring (no mocks) — DatabaseService uses module-level pool (mediaos_app via DATABASE_URL),
  // so every service call goes through withTenant → RLS FORCE is enforced at the DB.
  const db = new DatabaseService();
  const audit = new AuditService(new AuditMaskerService());
  const deptService = new HrDepartmentService(new HrDepartmentRepository(db), db, audit);
  const masterService = new HrMasterDataService(new HrMasterDataRepository(db), db, audit);
  const guard = new PermissionGuard(
    new Reflector(),
    new PermissionService(new PermissionRepository(db)),
  );

  let A: SeededTenant;
  let B: SeededTenant;
  let hrUserA: string; // 'hr' role in A — full allow-path
  let employeeUserA: string; // 'employee' role in A — read only, deny mutate
  let noRoleUserA: string; // no role — deny everything

  const sfx = Date.now();

  beforeAll(async () => {
    A = await seedCompany(direct, "hrbe3-a");
    B = await seedCompany(direct, "hrbe3-b");

    hrUserA = await seedUser(direct, A.companyId, `hr-${A.slug}@x.test`);
    await seedUserRole(direct, hrUserA, HR_ROLE_ID, A.companyId);

    employeeUserA = await seedUser(direct, A.companyId, `emp-${A.slug}@x.test`);
    await seedUserRole(direct, employeeUserA, EMPLOYEE_ROLE_ID, A.companyId);

    noRoleUserA = await seedUser(direct, A.companyId, `norole-${A.slug}@x.test`);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
    // db dùng pool module-level chia sẻ (src/db/index) — không sở hữu bởi test, không đóng ở đây.
  });

  /** Đếm audit_logs cho 1 (objectType, objectId) trong company — đường DIRECT (bypass RLS) để verify ghi thật. */
  async function auditCount(
    companyId: string,
    objectType: string,
    objectId: string,
    action: string,
  ): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs
        WHERE company_id = $1 AND object_type = $2 AND object_id = $3 AND action = $4`,
      [companyId, objectType, objectId, action],
    );
    return r.rows[0].n as number;
  }

  /** Dựng ExecutionContext giả gắn handler thật của controller + user đã seed (sau JwtAuthGuard). */
  function ctxFor(
    ControllerClass: typeof HrDepartmentController | typeof HrMasterDataController,
    methodName: string,
    userId: string,
    companyId = A.companyId,
    params: Record<string, string> = {},
  ): ExecutionContext {
    const proto = ControllerClass.prototype as unknown as Record<string, unknown>;
    const handler = proto[methodName] as (...a: unknown[]) => unknown;
    const req = { user: { id: userId, companyId }, params };
    return {
      getHandler: () => handler,
      getClass: () => ControllerClass,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  // ── (a) AUDIT CHECK 0446 — master-data create/update/delete ghi audit INSERT thật ─────────────────
  describe("(a) audit object_type job_level/contract_type INSERT thật (CHECK 0446)", () => {
    it("job_level create/update/delete ghi 3 audit row (KHÔNG vỡ CHECK 23514)", async () => {
      const created = await masterService.createJobLevel(A.companyId, hrUserA, {
        code: `JL-${sfx}`,
        name: `Junior ${sfx}`,
        rankOrder: 1,
      });
      expect(created.id).toBeTruthy();
      expect(await auditCount(A.companyId, "job_level", created.id, "create")).toBe(1);

      await masterService.updateJobLevel(A.companyId, hrUserA, created.id, {
        name: `Junior Updated ${sfx}`,
      });
      expect(await auditCount(A.companyId, "job_level", created.id, "update")).toBe(1);

      await masterService.deleteJobLevel(A.companyId, hrUserA, created.id);
      expect(await auditCount(A.companyId, "job_level", created.id, "delete")).toBe(1);
    });

    it("contract_type create/update/delete ghi 3 audit row (KHÔNG vỡ CHECK 23514)", async () => {
      const created = await masterService.createContractType(A.companyId, hrUserA, {
        code: `CT-${sfx}`,
        name: `Full-time ${sfx}`,
        requiresEndDate: false,
      });
      expect(created.id).toBeTruthy();
      expect(await auditCount(A.companyId, "contract_type", created.id, "create")).toBe(1);

      await masterService.updateContractType(A.companyId, hrUserA, created.id, {
        name: `Full-time Updated ${sfx}`,
      });
      expect(await auditCount(A.companyId, "contract_type", created.id, "update")).toBe(1);

      await masterService.deleteContractType(A.companyId, hrUserA, created.id);
      expect(await auditCount(A.companyId, "contract_type", created.id, "delete")).toBe(1);
    });

    it("department create/update/delete ghi audit object_type 'org_unit' (regression — CHECK đã có)", async () => {
      const dept = await deptService.createDepartment(A.companyId, hrUserA, {
        name: `Audit Dept ${sfx}`,
        code: `AD-${sfx}`,
      });
      expect(await auditCount(A.companyId, "org_unit", dept.id, "create")).toBe(1);

      await deptService.updateDepartment(A.companyId, hrUserA, dept.id, {
        name: `Audit Dept Renamed ${sfx}`,
      });
      expect(await auditCount(A.companyId, "org_unit", dept.id, "update")).toBe(1);

      await deptService.deleteDepartment(A.companyId, hrUserA, dept.id);
      expect(await auditCount(A.companyId, "org_unit", dept.id, "delete")).toBe(1);
    });
  });

  // ── (b) 2-TENANT DENY RLS THẬT — service tenant B KHÔNG thấy dữ liệu tenant A ─────────────────────
  describe("(b) 2-tenant deny RLS thật (BẤT BIẾN #1 ép ở DB)", () => {
    let deptIdA: string;
    let jobLevelIdA: string;
    let contractTypeIdA: string;

    beforeAll(async () => {
      const dept = await deptService.createDepartment(A.companyId, hrUserA, {
        name: `A-only Dept ${sfx}`,
        code: `AOD-${sfx}`,
      });
      deptIdA = dept.id;
      const jl = await masterService.createJobLevel(A.companyId, hrUserA, {
        code: `AOJL-${sfx}`,
        name: `A-only Level ${sfx}`,
      });
      jobLevelIdA = jl.id;
      const ct = await masterService.createContractType(A.companyId, hrUserA, {
        code: `AOCT-${sfx}`,
        name: `A-only Contract ${sfx}`,
        requiresEndDate: false,
      });
      contractTypeIdA = ct.id;
    });

    it("tenant B listDepartments KHÔNG chứa department của A", async () => {
      const rows = await deptService.listDepartments(B.companyId);
      expect(rows.some((r) => r.id === deptIdA)).toBe(false);
    });

    it("tenant B getDepartment(deptA) → NotFound (RLS 0 row, KHÔNG rò)", async () => {
      await expect(deptService.getDepartment(B.companyId, deptIdA)).rejects.toThrow(/not found/i);
    });

    it("tenant B listJobLevels / listContractTypes KHÔNG chứa master-data của A", async () => {
      const jls = await masterService.listJobLevels(B.companyId);
      expect(jls.some((r) => r.id === jobLevelIdA)).toBe(false);
      const cts = await masterService.listContractTypes(B.companyId);
      expect(cts.some((r) => r.id === contractTypeIdA)).toBe(false);
    });

    it("tenant B update/delete master-data của A → NotFound (RLS 0 row affected, KHÔNG ghi đè chéo)", async () => {
      await expect(
        masterService.updateJobLevel(B.companyId, hrUserA, jobLevelIdA, { name: "hijack" }),
      ).rejects.toThrow(/not found/i);
      await expect(
        masterService.deleteContractType(B.companyId, hrUserA, contractTypeIdA),
      ).rejects.toThrow(/not found/i);
      // A's rows still intact (B's mutations were filtered out by RLS, not applied).
      const stillThere = await direct.query(`SELECT deleted_at FROM contract_types WHERE id = $1`, [
        contractTypeIdA,
      ]);
      expect(stillThere.rows[0].deleted_at).toBeNull();
    });

    it("RAW app-pool: tenant B KHÔNG SELECT được org_units/job_levels row của A (RLS USING)", async () => {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [B.companyId]);
        const ou = await c.query("SELECT id FROM org_units WHERE id = $1", [deptIdA]);
        const jl = await c.query("SELECT id FROM job_levels WHERE id = $1", [jobLevelIdA]);
        await c.query("COMMIT");
        expect(ou.rows).toHaveLength(0);
        expect(jl.rows).toHaveLength(0);
      } finally {
        c.release();
      }
    });
  });

  // ── (c) 403 THIẾU QUYỀN — PermissionGuard + engine 4-tầng THẬT trên Postgres ──────────────────────
  describe("(c) deny-path 403 (PermissionGuard + PermissionService thật, fail-closed)", () => {
    it("createDepartment (create:department) — user 'employee' thiếu grant ⇒ 403", async () => {
      await expect(
        guard.canActivate(ctxFor(HrDepartmentController, "createDepartment", employeeUserA)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("deleteDepartment (delete:department) — user 'employee' thiếu grant ⇒ 403", async () => {
      await expect(
        guard.canActivate(
          ctxFor(HrDepartmentController, "deleteDepartment", employeeUserA, A.companyId, {
            id: "00000000-0000-0000-0000-0000000000aa",
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("createJobLevel (manage:master-data) — user 'employee' thiếu grant ⇒ 403", async () => {
      await expect(
        guard.canActivate(ctxFor(HrMasterDataController, "createJobLevel", employeeUserA)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("listJobLevels (manage:master-data) — user KHÔNG role nào ⇒ 403 (fail-closed)", async () => {
      await expect(
        guard.canActivate(ctxFor(HrMasterDataController, "listJobLevels", noRoleUserA)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("listDepartments (read:department) — user KHÔNG role nào ⇒ 403 (route IS guarded)", async () => {
      await expect(
        guard.canActivate(ctxFor(HrDepartmentController, "listDepartments", noRoleUserA)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("'hr' ĐƯỢC create:department + manage:master-data — guard cho qua (sanity allow-path)", async () => {
      await expect(
        guard.canActivate(ctxFor(HrDepartmentController, "createDepartment", hrUserA)),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(ctxFor(HrMasterDataController, "createJobLevel", hrUserA)),
      ).resolves.toBe(true);
    });
  });

  // ── (d) CREATE DEPARTMENT parentId CROSS-TENANT BỊ CHẶN (pre-insert validate, KHÔNG no-op) ────────
  describe("(d) create department parentId cross-tenant bị chặn", () => {
    let parentDeptA: string;

    beforeAll(async () => {
      const parent = await deptService.createDepartment(A.companyId, hrUserA, {
        name: `Parent Dept ${sfx}`,
        code: `PD-${sfx}`,
      });
      parentDeptA = parent.id;
    });

    it("tenant B tạo department với parentId trỏ department của A ⇒ BadRequest (parentId không thuộc B)", async () => {
      await expect(
        deptService.createDepartment(B.companyId, hrUserA, {
          name: `B Child ${sfx}`,
          code: `BC-${sfx}`,
          parentId: parentDeptA,
        }),
      ).rejects.toThrow(/parent department does not exist/i);
    });

    it("tenant A tạo department với parentId hợp lệ (cùng company) ⇒ OK", async () => {
      const child = await deptService.createDepartment(A.companyId, hrUserA, {
        name: `A Child ${sfx}`,
        code: `AC-${sfx}`,
        parentId: parentDeptA,
      });
      expect(child.parentId).toBe(parentDeptA);
    });

    it("tạo department với parentId là UUID không tồn tại ⇒ BadRequest (KHÔNG no-op post-insert)", async () => {
      await expect(
        deptService.createDepartment(A.companyId, hrUserA, {
          name: `Orphan ${sfx}`,
          code: `OR-${sfx}`,
          parentId: "00000000-0000-0000-0000-0000000000ff",
        }),
      ).rejects.toThrow(/parent department does not exist/i);
    });
  });
});
