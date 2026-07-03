/**
 * S2-FND-SEED-2 — HrMasterDataSeeder qua ĐƯỜNG THẬT (MasterDataSeedRunner.reconcileCompany) + smoke
 * choreography (reconcile → tạo employee → EMP0001) + PATCH-sync (EmployeeCodeConfigService.updateConfig
 * đồng bộ sequence_counters TRONG CÙNG tx, GIỮ NGUYÊN current_value).
 *
 * Real NestJS app (AppModule) — cần boot thật để chứng minh wiring: EmployeesModule import SeedModule +
 * HrSeedRegistrar tự đăng ký HrMasterDataSeeder vào ĐÚNG registry instance mà MasterDataSeedRunner dùng
 * (KHÔNG hand-build registry riêng — mirror att-master-data-seeder.int.spec.ts NHƯNG qua app thật vì G3/G4
 * cần supertest cho create-employee + PATCH config với permission engine thật).
 *
 * Colocated trong src/employees → vitest gom qua include glob `src/**\/*.spec.ts`. Gate cứng
 * `hasDb && LANE_DB` (memory integration-test-lane-db-gate).
 *
 * Phủ (WO S2-FND-SEED-2 RED items):
 *   G1 — reconcileCompany seed ĐÚNG 8 job_levels + 5 contract_types + 1 employee_code_config (DB-10 §14.1);
 *        seed_items track 14 row Success.
 *   I2 — chạy lại idempotent tầng ROW: vẫn 8/5/1, KHÔNG dup, row admin đã sửa (raw SQL) KHÔNG bị ghi đè
 *        (ON CONFLICT DO NOTHING bỏ qua TOÀN BỘ row đã tồn tại).
 *   G3 — smoke: company mới → reconcileCompany → POST /hr/employees → 201 employeeCode='EMP0001' (counter
 *        được ensure-on-miss lười từ employee_code_config vừa seed, KHÔNG cần seed counter tay).
 *   G4 — PATCH-sync: PATCH /hr/employee-code-config {prefix:'STAFF'} → sequence_counters đồng bộ NGAY
 *        (GIỮ current_value) → preview == mã sẽ được cấp thật (cùng state) → tạo employee tiếp theo →
 *        'STAFF0002' (số TIẾP NỐI, KHÔNG quay về 0001).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../auth/password.service";
import { MasterDataSeedRunner } from "../foundation/seed/master-data-seed-runner.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const SEED_KEY = "hr.master-data";
// Test fixture login credential (mirror LOGIN_PW convention, vd attendance-be1.int.spec.ts) — KHÔNG phải
// secret vận hành thật, chỉ dùng để hash + login trong Postgres cô lập theo lane (LANE_DB).
const LOGIN_PW = "Passw0rd!test99";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(LOGIN_PW);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: LOGIN_PW });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Grant a fresh company-scoped role carrying the given write pairs (Company scope) to `userId`. */
async function grantPairs(
  direct: Pool,
  companyId: string,
  userId: string,
  pairs: Array<[string, string]>,
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `qa-seed2-${userId.slice(0, 8)}`);
  for (const [action, resourceType] of pairs) {
    const permId = await seedPermissionCatalog(direct, action, resourceType, false);
    await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

async function countJobLevels(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM job_levels WHERE company_id=$1 AND deleted_at IS NULL",
    [companyId],
  );
  return r.rows[0].n as number;
}

async function countContractTypes(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM contract_types WHERE company_id=$1 AND deleted_at IS NULL",
    [companyId],
  );
  return r.rows[0].n as number;
}

async function countEmployeeCodeConfigs(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM employee_code_configs WHERE company_id=$1 AND deleted_at IS NULL",
    [companyId],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!runDb)("S2-FND-SEED-2 HrMasterDataSeeder (DB cô lập, app thật)", () => {
  const direct = directPool();
  let app: INestApplication;
  let runner: MasterDataSeedRunner;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    runner = app.get(MasterDataSeedRunner);
  });

  afterAll(async () => {
    await direct.end();
    if (app) await app.close();
  });

  describe("G1/I2 — seeder correctness + idempotency (row-level)", () => {
    let C1: SeededTenant;

    beforeAll(async () => {
      C1 = await seedCompany(direct, "hrseed-g1");
    });

    afterAll(async () => {
      await cleanupTenants(direct, [C1.companyId]);
    });

    it("G1 — reconcileCompany seeds ĐÚNG 8 job_levels + 5 contract_types + 1 employee_code_config", async () => {
      const outcomes = await runner.reconcileCompany(C1.companyId);
      const hr = outcomes.find((o) => o.seedKey === SEED_KEY);
      expect(hr?.ok, "batch hr.master-data phải ok").toBe(true);
      expect(hr?.status).toBe("Success");

      expect(await countJobLevels(direct, C1.companyId)).toBe(8);
      expect(await countContractTypes(direct, C1.companyId)).toBe(5);
      expect(await countEmployeeCodeConfigs(direct, C1.companyId)).toBe(1);

      const senior = await direct.query(
        "SELECT name, rank_order, status FROM job_levels WHERE company_id=$1 AND code='SENIOR'",
        [C1.companyId],
      );
      expect(senior.rows[0]).toMatchObject({ name: "Senior", rank_order: 50, status: "active" });

      const indefinite = await direct.query(
        "SELECT name, requires_end_date FROM contract_types WHERE company_id=$1 AND code='INDEFINITE_TERM'",
        [C1.companyId],
      );
      expect(indefinite.rows[0].requires_end_date).toBe(false);

      const cfg = await direct.query(
        `SELECT prefix, number_length, allow_manual_override, status
           FROM employee_code_configs WHERE company_id=$1 AND deleted_at IS NULL`,
        [C1.companyId],
      );
      expect(cfg.rows[0]).toMatchObject({
        prefix: "EMP",
        number_length: 4,
        allow_manual_override: false,
        status: "active",
      });

      const items = await direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM seed_items si
           JOIN seed_batches sb ON sb.id = si.seed_batch_id
          WHERE sb.company_id=$1 AND sb.seed_key=$2
            AND si.target_table IN ('job_levels','contract_types','employee_code_configs')
            AND si.status='Success'`,
        [C1.companyId, SEED_KEY],
      );
      expect(items.rows[0].n, "8 job_levels + 5 contract_types + 1 employee_code_config = 14").toBe(
        14,
      );
    });

    it("I2 — chạy lại idempotent: vẫn 8/5/1, KHÔNG dup, row admin đã sửa KHÔNG bị ghi đè", async () => {
      // Giả lập admin sửa tay 2 row (raw SQL, bypass API) — ON CONFLICT DO NOTHING của seeder phải BỎ QUA
      // hoàn toàn row đã tồn tại (KHÔNG có nhánh "update nếu khác"), dù nội dung không còn khớp seed default.
      await direct.query(
        "UPDATE job_levels SET name='Senior (Admin Edited)' WHERE company_id=$1 AND code='SENIOR'",
        [C1.companyId],
      );
      await direct.query(
        "UPDATE employee_code_configs SET prefix='CUSTOM' WHERE company_id=$1 AND deleted_at IS NULL",
        [C1.companyId],
      );

      const outcomes = await runner.reconcileCompany(C1.companyId);
      expect(outcomes.find((o) => o.seedKey === SEED_KEY)?.ok).toBe(true);

      expect(await countJobLevels(direct, C1.companyId)).toBe(8);
      expect(await countContractTypes(direct, C1.companyId)).toBe(5);
      expect(await countEmployeeCodeConfigs(direct, C1.companyId)).toBe(1);

      const senior = await direct.query(
        "SELECT name FROM job_levels WHERE company_id=$1 AND code='SENIOR'",
        [C1.companyId],
      );
      expect(senior.rows[0].name, "admin edit KHÔNG bị seeder ghi đè").toBe(
        "Senior (Admin Edited)",
      );

      const cfg = await direct.query(
        "SELECT prefix FROM employee_code_configs WHERE company_id=$1 AND deleted_at IS NULL",
        [C1.companyId],
      );
      expect(cfg.rows[0].prefix, "admin edit KHÔNG bị seeder ghi đè").toBe("CUSTOM");
    });
  });

  describe("G3/G4 — smoke choreography (ensure-on-miss) + PATCH-sync (HTTP, permission engine thật)", () => {
    let C2: SeededTenant;
    let hrEmail: string;

    beforeAll(async () => {
      C2 = await seedCompany(direct, "hrseed-g34");
      const hash = await hashedPw();
      hrEmail = `hr@${C2.slug}.test`;
      const hrUserId = await seedUser(direct, C2.companyId, hrEmail, hash);
      await grantPairs(direct, C2.companyId, hrUserId, [
        ["create", "employee"],
        ["create", "user"],
        ["update", "employee-code-config"],
        ["preview", "employee-code"],
      ]);

      // reconcile TRƯỚC (mirror smoke choreography): seeder tạo employee_code_config nhưng KHÔNG chạm
      // sequence_counters — counter được ensure-on-miss lười khi allocateEmployeeCode() chạy lần đầu.
      await runner.reconcileCompany(C2.companyId);
    });

    afterAll(async () => {
      await direct
        .query("DELETE FROM employee_profiles WHERE company_id = $1", [C2.companyId])
        .catch(() => undefined);
      await cleanupTenants(direct, [C2.companyId]);
    });

    it("G3 — company → reconcileCompany → POST /hr/employees → 201 EMP0001 (ensure-on-miss lười)", async () => {
      const counterBefore = await direct.query(
        "SELECT count(*)::int AS n FROM sequence_counters WHERE company_id=$1 AND sequence_key='EMPLOYEE_CODE'",
        [C2.companyId],
      );
      expect(counterBefore.rows[0].n, "counter CHƯA tồn tại trước employee đầu tiên").toBe(0);

      const token = await login(app, C2.slug, hrEmail);
      const res = await api(app)
        .post("/hr/employees")
        .set(bearer(token))
        .send({ email: `e1@${C2.slug}.test`, fullName: "Emp One" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.employeeCode).toBe("EMP0001");

      const counter = await direct.query(
        `SELECT module_code, prefix, padding_length, current_value, status, reset_policy
           FROM sequence_counters WHERE company_id=$1 AND sequence_key='EMPLOYEE_CODE'`,
        [C2.companyId],
      );
      expect(counter.rows).toHaveLength(1);
      expect(counter.rows[0]).toMatchObject({
        module_code: "HR",
        prefix: "EMP",
        padding_length: 4,
        current_value: "1",
        status: "Active",
        reset_policy: "Never",
      });
    });

    it("G4 — PATCH prefix EMP→STAFF đồng bộ counter NGAY; preview == mã cấp thật; số TIẾP NỐI (0002)", async () => {
      const token = await login(app, C2.slug, hrEmail);

      const patch = await api(app)
        .patch("/hr/employee-code-config")
        .set(bearer(token))
        .send({ prefix: "STAFF" });
      expect(patch.status, JSON.stringify(patch.body)).toBe(200);
      expect(patch.body.data.prefix).toBe("STAFF");

      // current_value GIỮ NGUYÊN (1, từ G3) — PATCH-sync KHÔNG reset số đã cấp.
      const afterPatch = await direct.query(
        `SELECT prefix, padding_length, current_value, status
           FROM sequence_counters WHERE company_id=$1 AND sequence_key='EMPLOYEE_CODE'`,
        [C2.companyId],
      );
      expect(afterPatch.rows[0]).toMatchObject({
        prefix: "STAFF",
        padding_length: 4,
        current_value: "1",
        status: "Active",
      });

      // preview == mã sẽ được cấp thật TRÊN CÙNG state (KHÔNG mutate).
      const preview = await api(app).post("/hr/employee-code/preview").set(bearer(token)).send({});
      expect(preview.status, JSON.stringify(preview.body)).toBe(201);
      expect(preview.body.data.code).toBe("STAFF0002");

      const created = await api(app)
        .post("/hr/employees")
        .set(bearer(token))
        .send({ email: `e2@${C2.slug}.test`, fullName: "Emp Two" });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      // Số TIẾP NỐI (0002, KHÔNG quay về 0001) — khớp CHÍNH XÁC preview ở trên (cùng state).
      expect(created.body.data.employeeCode).toBe("STAFF0002");

      const finalCounter = await direct.query(
        "SELECT current_value FROM sequence_counters WHERE company_id=$1 AND sequence_key='EMPLOYEE_CODE'",
        [C2.companyId],
      );
      expect(finalCounter.rows[0].current_value).toBe("2");
    });
  });
});
