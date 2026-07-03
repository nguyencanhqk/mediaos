/**
 * S3-QA-1 — Integration (Postgres THẬT, DB CÔ LẬP). Lấp khoảng trống của attendance-be2.int.spec.ts:
 * scope/mask/pagination-clamp ĐÃ có test đầy đủ ở đó, nhưng CHƯA có test nào gọi qua các query-param
 * filter mà `AttendanceReadRepository.buildWhere` đã hỗ trợ — fromDate/toDate/status/attendanceStatus/
 * shiftId/departmentId — trên /attendance/my-records + /attendance/records. File này KHÔNG lặp lại
 * scope/mask/clamp (đã có be2) — chỉ chứng minh filter thật sự lọc đúng qua đường HTTP thật.
 *
 * Data (company A, KHÔNG cần cross-tenant — đã có be2):
 *   empUser (org Engineering, view-own:Own)  — 4 record R1..R4 trải fromDate/status/attendanceStatus/shiftId.
 *   otherUser (org Sales)                    — 1 record R5 (khác dept + khác user) — dùng cho departmentId probe.
 *   hrUser (view-company:Company)            — xem CẢ 2 dept qua /records.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/attendance →
 * vitest include src/**\/*.spec.ts.
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
const LOGIN_PW = "Passw0rd!test99";

type Scope = "Own" | "Team" | "Department" | "Company" | "System";

describe.skipIf(!runDb)(
  "S3-QA-1 records filters (fromDate/toDate/status/attendanceStatus/shiftId/departmentId)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let empUser = "";
    let hrUser = "";
    let otherUser = "";

    let ouEng = "";
    let ouSales = "";
    let shiftX = "";
    let shiftY = "";

    // R1..R4 = empUser (Engineering); R5 = otherUser (Sales).
    let R1 = "";
    let R2 = "";
    let R3 = "";
    let R4 = "";
    let R5 = "";

    async function seedOrgUnit(companyId: string, name: string): Promise<string> {
      const r = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
        [companyId, name],
      );
      return r.rows[0].id as string;
    }

    async function seedEmp(companyId: string, userId: string, orgUnitId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
        [companyId, userId, orgUnitId],
      );
      return r.rows[0].id as string;
    }

    async function insertShift(companyId: string, code: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO shifts (company_id, shift_code, name, shift_type, required_working_minutes, is_default)
       VALUES ($1, $2, $2, 'Fixed', 480, false) RETURNING id`,
        [companyId, code],
      );
      return r.rows[0].id as string;
    }

    async function plantRecord(
      companyId: string,
      userId: string,
      opts: {
        workDate: string;
        status: string;
        attendanceStatus: string;
        shiftId?: string | null;
      },
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO attendance_records
         (company_id, user_id, work_date, status, attendance_status, shift_id, check_in_at,
          late_minutes, early_leave_minutes, working_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,480) RETURNING id`,
        [
          companyId,
          userId,
          opts.workDate,
          opts.status,
          opts.attendanceStatus,
          opts.shiftId ?? null,
          `${opts.workDate}T01:00:00Z`,
        ],
      );
      return r.rows[0].id as string;
    }

    /** Custom company-scoped role with EXACT ATT (action, scope) pairs (mirror mig 0454) — pattern be2. */
    async function grantAtt(
      companyId: string,
      userId: string,
      label: string,
      pairs: Array<[string, Scope]>,
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `qa1filt-${label}-${userId.slice(0, 8)}`);
      for (const [action, scope] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, "attendance", true);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    function get(token: string, url: string) {
      return request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "qa1filt");
      companyIds.push(A.companyId);

      ouEng = await seedOrgUnit(A.companyId, "Engineering");
      ouSales = await seedOrgUnit(A.companyId, "Sales");
      shiftX = await insertShift(A.companyId, "QA1_X");
      shiftY = await insertShift(A.companyId, "QA1_Y");

      empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
      hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
      otherUser = await seedUser(direct, A.companyId, `other@${A.slug}.test`, hash);

      await seedEmp(A.companyId, empUser, ouEng);
      await seedEmp(A.companyId, otherUser, ouSales);

      await grantAtt(A.companyId, empUser, "emp", [["view-own", "Own"]]);
      await grantAtt(A.companyId, hrUser, "hr", [["view-company", "Company"]]);

      // Engineering (empUser) — 4 records trải date/status/attendanceStatus/shift.
      R1 = await plantRecord(A.companyId, empUser, {
        workDate: "2024-07-01",
        status: "present",
        attendanceStatus: "Present",
        shiftId: shiftX,
      });
      R2 = await plantRecord(A.companyId, empUser, {
        workDate: "2024-07-05",
        status: "late",
        attendanceStatus: "Late",
        shiftId: shiftX,
      });
      R3 = await plantRecord(A.companyId, empUser, {
        workDate: "2024-07-10",
        status: "present",
        attendanceStatus: "Present",
        shiftId: shiftY,
      });
      R4 = await plantRecord(A.companyId, empUser, {
        workDate: "2024-07-15",
        status: "absent",
        attendanceStatus: "Absent",
        shiftId: null,
      });

      // Sales (otherUser) — 1 record, dùng cho departmentId probe trên /records (my-records bỏ qua departmentId).
      R5 = await plantRecord(A.companyId, otherUser, {
        workDate: "2024-07-05",
        status: "present",
        attendanceStatus: "Present",
        shiftId: shiftY,
      });
    });

    afterAll(async () => {
      await direct
        ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ═══════════════════════════ /attendance/my-records (empUser, Own) ═══════════════════════════

    it("my-records: fromDate/toDate half-open [from,to) → chỉ R2,R3 (07-05..07-10)", async () => {
      const token = await login(A.slug, `emp@${A.slug}.test`);
      const res = await get(
        token,
        "/attendance/my-records?fromDate=2024-07-05&toDate=2024-07-11&pageSize=100",
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const dates = (res.body.data.items as Array<{ id: string; workDate: string }>)
        .map((r) => r.workDate)
        .sort();
      expect(dates).toEqual(["2024-07-05", "2024-07-10"]);
    });

    it("my-records: status=late (legacy lowercase) → chỉ R2", async () => {
      const token = await login(A.slug, `emp@${A.slug}.test`);
      const res = await get(token, "/attendance/my-records?status=late&pageSize=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as Array<{ id: string }>;
      expect(items.map((r) => r.id)).toEqual([R2]);
    });

    it("my-records: attendanceStatus=Absent (TitleCase DB-04) → chỉ R4", async () => {
      const token = await login(A.slug, `emp@${A.slug}.test`);
      const res = await get(token, "/attendance/my-records?attendanceStatus=Absent&pageSize=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as Array<{ id: string }>;
      expect(items.map((r) => r.id)).toEqual([R4]);
    });

    it("my-records: shiftId=shiftX → R1,R2 (loại R3 shiftY, R4 shift null)", async () => {
      const token = await login(A.slug, `emp@${A.slug}.test`);
      const res = await get(token, `/attendance/my-records?shiftId=${shiftX}&pageSize=100`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = new Set((res.body.data.items as Array<{ id: string }>).map((r) => r.id));
      expect(ids).toEqual(new Set([R1, R2]));
    });

    it("my-records: shiftId + pagination(pageSize=1) → đúng trang, meta chính xác qua 2 trang", async () => {
      const token = await login(A.slug, `emp@${A.slug}.test`);
      // Sort mặc định workDate desc: R2 (07-05) trước R1 (07-01).
      const p1 = await get(token, `/attendance/my-records?shiftId=${shiftX}&pageSize=1&page=1`);
      expect(p1.status, JSON.stringify(p1.body)).toBe(200);
      expect((p1.body.data.items as Array<{ id: string }>)[0].id).toBe(R2);
      expect(p1.body.data.meta).toMatchObject({
        page: 1,
        pageSize: 1,
        total: 2,
        totalPages: 2,
        hasNext: true,
        hasPrev: false,
      });

      const p2 = await get(token, `/attendance/my-records?shiftId=${shiftX}&pageSize=1&page=2`);
      expect((p2.body.data.items as Array<{ id: string }>)[0].id).toBe(R1);
      expect(p2.body.data.meta).toMatchObject({ hasNext: false, hasPrev: true });
    });

    it("my-records: case rỗng — attendanceStatus không khớp bản ghi nào → items=[], total=0", async () => {
      const token = await login(A.slug, `emp@${A.slug}.test`);
      const res = await get(
        token,
        "/attendance/my-records?attendanceStatus=NoSuchStatus123&pageSize=100",
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.meta.total).toBe(0);
    });

    // ═══════════════════════════ /attendance/records (hrUser, Company) ═══════════════════════════

    it("records: fromDate/toDate xuyên suốt cả 2 dept → R2,R3,R5 (07-05..07-10)", async () => {
      const token = await login(A.slug, `hr@${A.slug}.test`);
      const res = await get(
        token,
        "/attendance/records?fromDate=2024-07-05&toDate=2024-07-11&pageSize=100",
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = new Set((res.body.data.items as Array<{ id: string }>).map((r) => r.id));
      expect(ids).toEqual(new Set([R2, R3, R5]));
    });

    it("records: status=present → R1,R3,R5", async () => {
      const token = await login(A.slug, `hr@${A.slug}.test`);
      const res = await get(token, "/attendance/records?status=present&pageSize=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = new Set((res.body.data.items as Array<{ id: string }>).map((r) => r.id));
      expect(ids).toEqual(new Set([R1, R3, R5]));
    });

    it("records: attendanceStatus=Absent → chỉ R4", async () => {
      const token = await login(A.slug, `hr@${A.slug}.test`);
      const res = await get(token, "/attendance/records?attendanceStatus=Absent&pageSize=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as Array<{ id: string }>;
      expect(items.map((r) => r.id)).toEqual([R4]);
    });

    it("records: shiftId=shiftY → R3 (Eng) + R5 (Sales)", async () => {
      const token = await login(A.slug, `hr@${A.slug}.test`);
      const res = await get(token, `/attendance/records?shiftId=${shiftY}&pageSize=100`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = new Set((res.body.data.items as Array<{ id: string }>).map((r) => r.id));
      expect(ids).toEqual(new Set([R3, R5]));
    });

    it("records: departmentId=Engineering → R1..R4, loại R5 (Sales)", async () => {
      const token = await login(A.slug, `hr@${A.slug}.test`);
      const res = await get(token, `/attendance/records?departmentId=${ouEng}&pageSize=100`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = new Set((res.body.data.items as Array<{ id: string }>).map((r) => r.id));
      expect(ids).toEqual(new Set([R1, R2, R3, R4]));
    });

    it("records: departmentId=Sales → chỉ R5", async () => {
      const token = await login(A.slug, `hr@${A.slug}.test`);
      const res = await get(token, `/attendance/records?departmentId=${ouSales}&pageSize=100`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as Array<{ id: string }>;
      expect(items.map((r) => r.id)).toEqual([R5]);
    });

    it("records: departmentId=Engineering + pagination(pageSize=2) → đúng trang, meta chính xác qua 2 trang", async () => {
      const token = await login(A.slug, `hr@${A.slug}.test`);
      // Sort mặc định workDate desc trong dept Eng: R4(07-15), R3(07-10), R2(07-05), R1(07-01).
      const p1 = await get(token, `/attendance/records?departmentId=${ouEng}&pageSize=2&page=1`);
      expect(p1.status, JSON.stringify(p1.body)).toBe(200);
      expect((p1.body.data.items as Array<{ id: string }>).map((r) => r.id)).toEqual([R4, R3]);
      expect(p1.body.data.meta).toMatchObject({
        page: 1,
        pageSize: 2,
        total: 4,
        totalPages: 2,
        hasNext: true,
        hasPrev: false,
      });

      const p2 = await get(token, `/attendance/records?departmentId=${ouEng}&pageSize=2&page=2`);
      expect((p2.body.data.items as Array<{ id: string }>).map((r) => r.id)).toEqual([R2, R1]);
      expect(p2.body.data.meta).toMatchObject({ hasNext: false, hasPrev: true });
    });

    it("records: case rỗng — shiftId không tồn tại → items=[], total=0", async () => {
      const token = await login(A.slug, `hr@${A.slug}.test`);
      const res = await get(
        token,
        "/attendance/records?shiftId=00000000-0000-0000-0000-000000000000&pageSize=100",
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.meta.total).toBe(0);
    });
  },
);
