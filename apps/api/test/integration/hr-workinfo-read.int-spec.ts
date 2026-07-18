/**
 * S5-HR-WORKINFO-1 — khối "Thông tin công việc" bổ sung trên GET /hr/employees/:id đọc qua đường HTTP
 * THẬT (JwtAuthGuard → CompanyGuard → PermissionGuard → HrReadController → HrReadService → PermissionService).
 * KHÔNG mock permission engine.
 *
 * Bề mặt kiểm chứng (additive, KHÔNG đổi masking cũ):
 *   - DIRECTORY-CLASS (không gate): jobLevelName · directManagerName · directManagerEmployeeId ·
 *     indirectManagerName — hiện cho MỌI caller có read:employee (kể cả thiếu view-sensitive).
 *   - PII (view-sensitive): contractTypeName — đi CÙNG gate `contractType` legacy. Thiếu view-sensitive →
 *     null + body JSON KHÔNG chứa GIÁ TRỊ tên loại HĐ (chống rò — BẤT BIẾN #3).
 *   - resignationReason (view-sensitive, chỉ resigned/terminated): thiếu view-sensitive → null + không rò.
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): CHỈ chạy trên DB cô lập.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
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

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!test99";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

type DataScope = "Own" | "Team" | "Department" | "Company" | "System";

// Marker độc nhất để dò rò rỉ contractTypeName trong body khi bị mask.
const CONTRACT_TYPE_NAME = "HDLD-CHINHTHUC-MARKER-XZ";
const JOB_LEVEL_NAME = "CapBac-Senior-QW";
const RESIGN_REASON = "LyDoNghi-ChuyenCongTac-KP";
const MANAGER_NAME = "QuanLyTrucTiep-Manager-AA";
const DIRECTOR_NAME = "QuanLyGianTiep-Director-BB";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe.skipIf(!hasLaneDb)(
  "S5-HR-WORKINFO-1 work-info additive read (HTTP, real permission engine)",
  () => {
    const direct = directPool();
    let app: INestApplication;

    let A: SeededTenant;
    let B: SeededTenant;

    let hrUserId = ""; // read + view-sensitive Company → reveal contractTypeName + resignationReason
    let viewerUserId = ""; // read Company (NO view-sensitive) → directory only, contractTypeName masked

    let directorUserId = ""; // đỉnh chuỗi (indirect manager)
    let managerUserId = ""; // quản lý trực tiếp của target
    let managerProfileId = "";

    let targetProfileId = ""; // active, có job_level_id + contract_type_id + direct_manager_id
    let resignedProfileId = ""; // resigned + status history reason

    let bUserId = "";

    async function insertJobLevel(companyId: string, name: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO job_levels (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [companyId, name],
      );
      return r.rows[0].id as string;
    }

    async function insertContractType(companyId: string, name: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO contract_types (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [companyId, name],
      );
      return r.rows[0].id as string;
    }

    async function insertEmployee(
      companyId: string,
      opts: {
        userId?: string | null;
        status?: string;
        jobLevelId?: string | null;
        contractTypeId?: string | null;
        directManagerId?: string | null;
        endDate?: string | null;
      },
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles
           (company_id, user_id, status, job_level_id, contract_type_id, direct_manager_id, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          companyId,
          opts.userId ?? null,
          opts.status ?? "active",
          opts.jobLevelId ?? null,
          opts.contractTypeId ?? null,
          opts.directManagerId ?? null,
          opts.endDate ?? null,
        ],
      );
      return r.rows[0].id as string;
    }

    async function insertStatusHistory(
      companyId: string,
      employeeId: string,
      newStatus: string,
      reason: string,
    ): Promise<void> {
      await direct.query(
        `INSERT INTO employee_status_histories (company_id, employee_id, old_status, new_status, reason)
         VALUES ($1, $2, 'active', $3, $4)`,
        [companyId, employeeId, newStatus, reason],
      );
    }

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      grants: Array<{
        action: string;
        resourceType: string;
        sensitive: boolean;
        scope?: DataScope;
      }>,
    ): Promise<void> {
      const roleId = await seedRole(
        direct,
        companyId,
        `qa-workinfo-${label}-${userId.slice(0, 8)}`,
      );
      for (const g of grants) {
        const permId = await seedPermissionCatalog(direct, g.action, g.resourceType, g.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", g.scope ?? "Company");
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    beforeAll(async () => {
      const hash = await hashedPw();

      A = await seedCompany(direct, "wiA");
      B = await seedCompany(direct, "wiB");

      hrUserId = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
      viewerUserId = await seedUser(direct, A.companyId, `viewer@${A.slug}.test`, hash);
      directorUserId = await seedUser(direct, A.companyId, `director@${A.slug}.test`, hash);
      managerUserId = await seedUser(direct, A.companyId, `manager@${A.slug}.test`, hash);
      // seedUser để full_name NULL → set tên tường minh cho quản lý để assert reporting-line join.
      await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [
        managerUserId,
        MANAGER_NAME,
      ]);
      await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [
        directorUserId,
        DIRECTOR_NAME,
      ]);

      const jobLevelId = await insertJobLevel(A.companyId, JOB_LEVEL_NAME);
      const contractTypeId = await insertContractType(A.companyId, CONTRACT_TYPE_NAME);

      // Chuỗi báo cáo: manager (director là quản lý của manager) ← target (manager là quản lý của target).
      managerProfileId = await insertEmployee(A.companyId, {
        userId: managerUserId,
        directManagerId: directorUserId,
      });
      targetProfileId = await insertEmployee(A.companyId, {
        status: "active",
        jobLevelId,
        contractTypeId,
        directManagerId: managerUserId,
      });
      resignedProfileId = await insertEmployee(A.companyId, {
        status: "resigned",
        endDate: "2026-06-30",
      });
      await insertStatusHistory(A.companyId, resignedProfileId, "resigned", RESIGN_REASON);

      await grant(A.companyId, hrUserId, "hr", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "view-sensitive", resourceType: "employee", sensitive: true, scope: "Company" },
      ]);
      await grant(A.companyId, viewerUserId, "viewer", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
      ]);

      bUserId = await seedUser(direct, B.companyId, `b@${B.slug}.test`, hash);
      await grant(B.companyId, bUserId, "b-viewer", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "view-sensitive", resourceType: "employee", sensitive: true, scope: "Company" },
      ]);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
    });

    afterAll(async () => {
      await direct
        .query("DELETE FROM employee_status_histories WHERE company_id = ANY($1::uuid[])", [
          [A.companyId, B.companyId],
        ])
        .catch(() => undefined);
      await direct
        .query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [
          [A.companyId, B.companyId],
        ])
        .catch(() => undefined);
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      if (app) await app.close();
    });

    async function getDetail(token: string, profileId: string) {
      return api(app).get(`/hr/employees/${profileId}`).set(bearer(token));
    }

    // ── DIRECTORY-CLASS (không gate): hiện cả khi thiếu view-sensitive ─────────────────
    it("viewer (read, NO view-sensitive) → jobLevelName + reporting-line hiện (directory-class)", async () => {
      const token = await login(app, A.slug, `viewer@${A.slug}.test`);
      const res = await getDetail(token, targetProfileId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.jobLevelName).toBe(JOB_LEVEL_NAME);
      expect(d.directManagerName).toBe(MANAGER_NAME);
      expect(d.directManagerEmployeeId).toBe(managerProfileId);
      // indirect = director (quản lý của manager) — join 1 cấp qua managerProfile.direct_manager_id.
      expect(d.indirectManagerName).toBe(DIRECTOR_NAME);
    });

    // ── PII (view-sensitive): contractTypeName đi cùng gate contractType legacy ────────
    it("viewer thiếu view-sensitive → contractTypeName null + body KHÔNG lộ tên loại HĐ", async () => {
      const token = await login(app, A.slug, `viewer@${A.slug}.test`);
      const res = await getDetail(token, targetProfileId);
      expect(res.status).toBe(200);
      expect(res.body.data.contractTypeName).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain(CONTRACT_TYPE_NAME);
    });

    it("hr có view-sensitive → contractTypeName lộ tên chuẩn hoá + jobLevelName vẫn hiện", async () => {
      const token = await login(app, A.slug, `hr@${A.slug}.test`);
      const res = await getDetail(token, targetProfileId);
      expect(res.status).toBe(200);
      expect(res.body.data.contractTypeName).toBe(CONTRACT_TYPE_NAME);
      expect(res.body.data.jobLevelName).toBe(JOB_LEVEL_NAME);
    });

    // ── resignationReason (view-sensitive, chỉ resigned/terminated) ────────────────────
    it("hr xem hồ sơ resigned → resignationReason từ lịch sử trạng thái gần nhất", async () => {
      const token = await login(app, A.slug, `hr@${A.slug}.test`);
      const res = await getDetail(token, resignedProfileId);
      expect(res.status).toBe(200);
      expect(res.body.data.resignationReason).toBe(RESIGN_REASON);
    });

    it("viewer (thiếu view-sensitive) xem hồ sơ resigned → resignationReason null + không lộ lý do", async () => {
      const token = await login(app, A.slug, `viewer@${A.slug}.test`);
      const res = await getDetail(token, resignedProfileId);
      expect(res.status).toBe(200);
      expect(res.body.data.resignationReason).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain(RESIGN_REASON);
    });

    // ── CROSS-TENANT (BẤT BIẾN #1) ─────────────────────────────────────────────────────
    it("cross-tenant: viewer tenant B xem hồ sơ tenant A → 404 (RLS che)", async () => {
      const token = await login(app, B.slug, `b@${B.slug}.test`);
      const res = await getDetail(token, targetProfileId);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(CONTRACT_TYPE_NAME);
      void bUserId;
    });
  },
);
