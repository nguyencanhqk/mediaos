/**
 * S3-ATT-BE-3 — Integration (Postgres THẬT, DB CÔ LẬP). Shift/rule/assignment CRUD (minimum) +
 * GET /attendance/rules/effective over the REAL HTTP path (JwtAuthGuard → CompanyGuard →
 * PermissionGuard → AttendanceShiftController → AttendanceShiftService). KHÔNG mock permission —
 * proves fail-closed 403 (no grant) and cross-tenant isolation.
 *
 * getEffectiveShiftRule reuses AttendanceService.resolveShiftAndRule (S3-ATT-BE-1) — this suite pins
 * that GET /attendance/rules/effective resolves the SAME seeded shift/rule the Today/check-in flow
 * would (proven in attendance-be1.int.spec.ts); it does NOT re-derive the priority order here.
 *
 * NO audit assertions here (KNOWN GAP, see attendance-shift.service.ts class doc): audit_logs
 * object_type CHECK doesn't (yet) allow 'shift'/'attendance_rule'/'shift_assignment' — wiring
 * AuditService is carry-over for lane db-migration (adds the CHECK values first).
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
import { ATT_PERMISSIONS } from "./attendance-permissions.const";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";

describe.skipIf(!runDb)(
  "S3-ATT-BE-3 shift/rule/assignment CRUD + effective resolve (DB cô lập)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let adminUser = "";
    let seededShiftId = "";

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      pairs: Array<[string, string]>,
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `attshift-${label}-${userId.slice(0, 8)}`);
      for (const [action, resourceType] of pairs) {
        // is_sensitive MUST mirror the REAL catalog (attendance-permissions.const, synced with
        // mig 0454) — `permissions` is a GLOBAL table (no company_id); seeding the wrong value here
        // would upsert-corrupt it for every other suite sharing this DB (att-permissions-seed.int.spec
        // asserts the exact is_sensitive per pair).
        const pair = ATT_PERMISSIONS.find(
          (p) => p.action === action && p.resourceType === resourceType,
        );
        if (!pair)
          throw new Error(`Unknown ATT permission pair in test: ${action}:${resourceType}`);
        const permId = await seedPermissionCatalog(direct, action, resourceType, pair.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
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

    function withAuth(method: "get" | "post" | "patch", token: string, url: string) {
      return request(app.getHttpServer())[method](url).set("Authorization", `Bearer ${token}`);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "attbe3a");
      B = await seedCompany(direct, "attbe3b");
      companyIds.push(A.companyId, B.companyId);

      adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
      await seedUser(direct, A.companyId, `nogrant@${A.slug}.test`, hash);
      await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, direct_manager_id, status)
       VALUES ($1,$2,NULL,NULL,'active')`,
        [A.companyId, adminUser],
      );

      await grant(A.companyId, adminUser, "admin", [
        ["view", "shift"],
        ["create", "shift"],
        ["update", "shift"],
        ["view", "shift-assignment"],
        ["update", "shift-assignment"],
        ["view", "attendance-rule"],
        ["config", "attendance-rule"],
      ]);

      // Tenant B — cross-tenant deny: its own shift must never leak into A's list.
      const bAdmin = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
      await grant(B.companyId, bAdmin, "badmin", [["view", "shift"]]);
      await direct.query(
        `INSERT INTO shifts (company_id, shift_code, name, shift_type, required_working_minutes, is_default)
       VALUES ($1, 'B_SHIFT', 'B ca hanh chinh', 'Fixed', 480, true)`,
        [B.companyId],
      );
    });

    afterAll(async () => {
      await direct
        ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── shifts ──────────────────────────────────────────────────────────────────

    it("GET /attendance/shifts → 403 without view:shift grant", async () => {
      const token = await login(A.slug, `nogrant@${A.slug}.test`);
      const res = await withAuth("get", token, "/attendance/shifts");
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("POST /attendance/shifts → 201 with grant", async () => {
      const token = await login(A.slug, `admin@${A.slug}.test`);
      const res = await withAuth("post", token, "/attendance/shifts").send({
        shiftCode: "OFFICE_9H",
        name: "Ca hanh chinh 9h",
        shiftType: "Fixed",
        startTime: "09:00",
        endTime: "18:00",
        requiredWorkingMinutes: 480,
        // isDefault=true — no shift_assignment seeded in this suite, so the "effective shift" resolve
        // (Employee≻Department≻Company assignment → company default, DB-04 §10) falls back to it.
        isDefault: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.shiftCode).toBe("OFFICE_9H");
      seededShiftId = res.body.data.id as string;
    });

    it("GET /attendance/shifts (with grant) → includes the seeded shift, EXCLUDES tenant B's shift", async () => {
      const token = await login(A.slug, `admin@${A.slug}.test`);
      const res = await withAuth("get", token, "/attendance/shifts");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const codes = (res.body.data.items as Array<{ shiftCode: string }>).map((r) => r.shiftCode);
      expect(codes).toContain("OFFICE_9H");
      expect(codes).not.toContain("B_SHIFT");
    });

    it("PATCH /attendance/shifts/:id → 200 updates", async () => {
      const token = await login(A.slug, `admin@${A.slug}.test`);
      const res = await withAuth("patch", token, `/attendance/shifts/${seededShiftId}`).send({
        name: "Ca hanh chinh 9h (renamed)",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.name).toBe("Ca hanh chinh 9h (renamed)");
    });

    it("PATCH /attendance/shifts/:id → 403 without update:shift grant", async () => {
      const token = await login(A.slug, `nogrant@${A.slug}.test`);
      const res = await withAuth("patch", token, `/attendance/shifts/${seededShiftId}`).send({
        name: "should not apply",
      });
      expect(res.status).toBe(403);
    });

    // ── attendance_rules ─────────────────────────────────────────────────────────

    it("GET /attendance/rules/effective → 403 without view:attendance-rule grant", async () => {
      const token = await login(A.slug, `nogrant@${A.slug}.test`);
      const res = await withAuth("get", token, "/attendance/rules/effective");
      expect(res.status).toBe(403);
    });

    it("POST /attendance/rules → 201 with grant", async () => {
      const token = await login(A.slug, `admin@${A.slug}.test`);
      const res = await withAuth("post", token, "/attendance/rules").send({
        ruleCode: "OFFICE_RULE_9H",
        name: "Rule 9h",
        ruleScope: "Company",
        effectiveFrom: "2024-01-01",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.ruleCode).toBe("OFFICE_RULE_9H");
    });

    it("GET /attendance/rules/effective (self, with grant) → resolves the seeded shift+rule", async () => {
      const token = await login(A.slug, `admin@${A.slug}.test`);
      const res = await withAuth("get", token, "/attendance/rules/effective");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.shift?.shiftCode).toBe("OFFICE_9H");
      expect(res.body.data.rule?.ruleCode).toBe("OFFICE_RULE_9H");
      expect(res.body.data.workDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("GET /attendance/rules/effective?employeeId=<unknown> → 404 (no cross-tenant existence leak)", async () => {
      const token = await login(A.slug, `admin@${A.slug}.test`);
      const res = await withAuth(
        "get",
        token,
        "/attendance/rules/effective?employeeId=00000000-0000-0000-0000-000000000000",
      );
      expect(res.status).toBe(404);
    });

    // ── shift_assignments ────────────────────────────────────────────────────────

    it("POST /attendance/shift-assignments → 403 without update:shift-assignment grant", async () => {
      const token = await login(A.slug, `nogrant@${A.slug}.test`);
      const res = await withAuth("post", token, "/attendance/shift-assignments").send({
        shiftId: seededShiftId,
        assignmentScope: "Company",
        effectiveFrom: "2024-01-01",
      });
      expect(res.status).toBe(403);
    });

    it("POST /attendance/shift-assignments → 201 with grant", async () => {
      const token = await login(A.slug, `admin@${A.slug}.test`);
      const res = await withAuth("post", token, "/attendance/shift-assignments").send({
        shiftId: seededShiftId,
        assignmentScope: "Company",
        effectiveFrom: "2024-01-01",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.shiftId).toBe(seededShiftId);
    });
  },
);
