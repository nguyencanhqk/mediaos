import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool, PoolClient } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
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
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { ATT_PERMISSIONS } from "../../src/attendance/attendance-permissions.const";

/**
 * S3-ATT-DB-1 — ATT Core deny-path (RED before GREEN, mig 0452).
 *
 * 1. RLS cross-tenant deny trên 7 bảng MỚI: withTenant(A) KHÔNG thấy hàng B + INSERT company_id=B bị
 *    WITH CHECK chặn. (rls-tenant-isolation pattern.)
 * 2. UNIQUE anti-dup attendance_records: employee_id NON-NULL → 2 record cùng (company,employee,date,shift)
 *    vi phạm; biến thể shift_id NULL. (Guard LIVE hiện vẫn là user_id-uq cũ — index mới forward-looking.)
 * 3. Backfill assert: KHÔNG còn row có user_id mà employee_profiles tồn tại nhưng employee_id vẫn NULL.
 *
 * Gate: hasDb && LANE_DB — .env làm hasDb=true → thiếu LANE_DB thì chạy DB dev chung ⇒ đỏ-giả
 * (memory: integration-test-lane-db-gate). LANE_DB bắt buộc cho DB cô lập mediaos_<lane>.
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

async function asTenant<T>(
  app: Pool,
  companyId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Seed full FK-chain for B's rows on each of the 7 new tables (direct/superuser, bypass RLS). */
async function seedAttRowsForTenant(
  direct: Pool,
  companyId: string,
  userId: string,
  employeeId: string,
): Promise<Record<string, string>> {
  const shift = await direct.query(
    `INSERT INTO shifts (company_id, shift_code, name, required_working_minutes)
     VALUES ($1, $2, 'Ca test', 480) RETURNING id`,
    [companyId, `SH-${randomUUID().slice(0, 8)}`],
  );
  const shiftId = shift.rows[0].id as string;

  const assignment = await direct.query(
    `INSERT INTO shift_assignments
       (company_id, shift_id, assignment_scope, employee_id, effective_from)
     VALUES ($1, $2, 'Employee', $3, '2026-06-01') RETURNING id`,
    [companyId, shiftId, employeeId],
  );

  const rule = await direct.query(
    `INSERT INTO attendance_rules
       (company_id, rule_code, name, rule_scope, effective_from)
     VALUES ($1, $2, 'Rule test', 'Company', '2026-06-01') RETURNING id`,
    [companyId, `RU-${randomUUID().slice(0, 8)}`],
  );

  const log = await direct.query(
    `INSERT INTO attendance_logs
       (company_id, employee_id, work_date, log_type, source)
     VALUES ($1, $2, '2026-06-03', 'Check-in', 'WEB') RETURNING id`,
    [companyId, employeeId],
  );

  const req = await direct.query(
    `INSERT INTO attendance_adjustment_requests
       (company_id, user_id, employee_id, work_date, request_type, reason, status, requested_check_in_at)
     VALUES ($1, $2, $3, '2026-06-03', 'MISSING_CHECK_IN', 'reason', 'pending', '2026-06-03T02:00:00Z')
     RETURNING id`,
    [companyId, userId, employeeId],
  );
  const requestId = req.rows[0].id as string;

  const item = await direct.query(
    `INSERT INTO attendance_adjustment_items
       (company_id, request_id, field_name, new_value)
     VALUES ($1, $2, 'check_in_at', '"2026-06-03T01:00:00Z"'::jsonb) RETURNING id`,
    [companyId, requestId],
  );

  const rwr = await direct.query(
    `INSERT INTO remote_work_requests
       (company_id, employee_id, request_type, start_date, end_date, reason, requested_by, status)
     VALUES ($1, $2, 'Remote', '2026-06-03', '2026-06-03', 'remote', $3, 'Pending') RETURNING id`,
    [companyId, employeeId, userId],
  );
  const remoteRequestId = rwr.rows[0].id as string;

  const appr = await direct.query(
    `INSERT INTO remote_work_request_approvals
       (company_id, remote_work_request_id, step_order, approver_user_id, action)
     VALUES ($1, $2, 1, $3, 'Submitted') RETURNING id`,
    [companyId, remoteRequestId, userId],
  );

  return {
    shifts: shiftId,
    shift_assignments: assignment.rows[0].id as string,
    attendance_rules: rule.rows[0].id as string,
    attendance_logs: log.rows[0].id as string,
    attendance_adjustment_items: item.rows[0].id as string,
    remote_work_requests: remoteRequestId,
    remote_work_request_approvals: appr.rows[0].id as string,
  };
}

describe.skipIf(!hasLaneDb)("S3-ATT-DB-1 ATT Core deny-path + anti-dup + backfill", () => {
  const direct = directPool();
  const app = appPool(2);

  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  let empA: string;
  let empB: string;
  let bRows: Record<string, string>;

  beforeAll(async () => {
    A = await seedCompany(direct, "att-deny-a");
    B = await seedCompany(direct, "att-deny-b");
    userA = await seedUser(direct, A.companyId, `att-a-${A.slug}@x.test`);
    userB = await seedUser(direct, B.companyId, `att-b-${B.slug}@x.test`);

    empA = (
      await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [A.companyId, userA],
      )
    ).rows[0].id as string;
    empB = (
      await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [B.companyId, userB],
      )
    ).rows[0].id as string;

    bRows = await seedAttRowsForTenant(direct, B.companyId, userB, empB);
  });

  afterAll(async () => {
    // Clean ATT-new tables before cleanupTenants (which doesn't know about them).
    for (const companyId of [A.companyId, B.companyId]) {
      await direct.query("DELETE FROM remote_work_request_approvals WHERE company_id = $1", [
        companyId,
      ]);
      await direct.query("DELETE FROM remote_work_requests WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM attendance_adjustment_items WHERE company_id = $1", [
        companyId,
      ]);
      await direct.query("DELETE FROM attendance_logs WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM shift_assignments WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM attendance_rules WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM shifts WHERE company_id = $1", [companyId]);
    }
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  // ── 1. RLS cross-tenant deny on 7 new tables ──────────────────────────────
  const NEW_TABLES = [
    "shifts",
    "shift_assignments",
    "attendance_rules",
    "attendance_logs",
    "attendance_adjustment_items",
    "remote_work_requests",
    "remote_work_request_approvals",
  ] as const;

  for (const table of NEW_TABLES) {
    describe(`${table} (RLS cross-tenant)`, () => {
      it(`withTenant(A): cannot SELECT B's ${table} row (RLS USING)`, async () => {
        const rows = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query(`SELECT id FROM ${table} WHERE id = $1`, [bRows[table]]);
          return r.rows;
        });
        expect(rows).toHaveLength(0);
      });
    });
  }

  it("withTenant(A): INSERT shifts with company_id = B is rejected by RLS WITH CHECK", async () => {
    await expect(
      asTenant(app, A.companyId, async (c) => {
        await c.query(
          `INSERT INTO shifts (company_id, shift_code, name, required_working_minutes)
           VALUES ($1, $2, 'forge', 480)`,
          [B.companyId, `forge-${randomUUID().slice(0, 8)}`],
        );
      }),
    ).rejects.toThrow();
  });

  it("withTenant(A): INSERT attendance_logs with company_id = B is rejected by RLS WITH CHECK", async () => {
    await expect(
      asTenant(app, A.companyId, async (c) => {
        await c.query(
          `INSERT INTO attendance_logs (company_id, employee_id, work_date, log_type, source)
           VALUES ($1, $2, '2026-06-03', 'Check-in', 'WEB')`,
          [B.companyId, empB],
        );
      }),
    ).rejects.toThrow();
  });

  // ── 2. UNIQUE anti-dup (employee_id NON-NULL) ─────────────────────────────
  describe("attendance_records anti-dup (employee_id NOT NULL — forward-looking unique)", () => {
    it("2 records same (company, employee, date, shift) with shift_id NOT NULL → unique violation", async () => {
      const shift = await direct.query(
        `INSERT INTO shifts (company_id, shift_code, name, required_working_minutes)
         VALUES ($1, $2, 'dup-shift', 480) RETURNING id`,
        [A.companyId, `DUP-${randomUUID().slice(0, 8)}`],
      );
      const shiftId = shift.rows[0].id as string;
      const dupUser = await seedUser(direct, A.companyId, `dup-${randomUUID().slice(0, 8)}@x.test`);

      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, employee_id, work_date, shift_id, status)
         VALUES ($1, $2, $3, '2026-07-01', $4, 'present')`,
        [A.companyId, dupUser, empA, shiftId],
      );
      // Second insert: same employee/date/shift → violates uq_attendance_records_employee_date_shift.
      const dupUser2 = await seedUser(
        direct,
        A.companyId,
        `dup2-${randomUUID().slice(0, 8)}@x.test`,
      );
      await expect(
        direct.query(
          `INSERT INTO attendance_records (company_id, user_id, employee_id, work_date, shift_id, status)
           VALUES ($1, $2, $3, '2026-07-01', $4, 'present')`,
          [A.companyId, dupUser2, empA, shiftId],
        ),
      ).rejects.toThrow(/uq_attendance_records_employee_date_shift|duplicate key/);
    });

    it("2 records same (company, employee, date) with shift_id NULL → unique violation", async () => {
      const dupUser = await seedUser(
        direct,
        A.companyId,
        `dupn-${randomUUID().slice(0, 8)}@x.test`,
      );
      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, employee_id, work_date, status)
         VALUES ($1, $2, $3, '2026-07-02', 'present')`,
        [A.companyId, dupUser, empA],
      );
      const dupUser2 = await seedUser(
        direct,
        A.companyId,
        `dupn2-${randomUUID().slice(0, 8)}@x.test`,
      );
      await expect(
        direct.query(
          `INSERT INTO attendance_records (company_id, user_id, employee_id, work_date, status)
           VALUES ($1, $2, $3, '2026-07-02', 'present')`,
          [A.companyId, dupUser2, empA],
        ),
      ).rejects.toThrow(/uq_attendance_records_employee_date_no_shift|duplicate key/);
    });
  });

  // ── 3. Backfill assert ────────────────────────────────────────────────────
  describe("backfill attendance_records.employee_id from employee_profiles", () => {
    it("a record seeded for a user WITH an employee_profile has employee_id backfilled (re-run idempotent)", async () => {
      // Seed a fresh attendance_records row WITHOUT employee_id (legacy media-era shape: user_id only).
      const bfUser = await seedUser(direct, A.companyId, `bf-${randomUUID().slice(0, 8)}@x.test`);
      const bfEmp = (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
          [A.companyId, bfUser],
        )
      ).rows[0].id as string;
      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, work_date, status)
         VALUES ($1, $2, '2026-08-01', 'present')`,
        [A.companyId, bfUser],
      );

      // Run the SAME backfill statement as mig 0452 §5 (idempotent — sets only where employee_id IS NULL).
      await direct.query(
        `UPDATE attendance_records ar
            SET employee_id = ep.id
           FROM employee_profiles ep
          WHERE ep.user_id = ar.user_id
            AND ep.company_id = ar.company_id
            AND ep.deleted_at IS NULL
            AND ar.employee_id IS NULL`,
      );

      const { rows } = await direct.query(
        `SELECT employee_id FROM attendance_records WHERE company_id = $1 AND user_id = $2`,
        [A.companyId, bfUser],
      );
      expect(rows[0].employee_id).toBe(bfEmp);
    });

    it("NO row where employee_profiles exists for user_id but employee_id stayed NULL (post-backfill invariant)", async () => {
      const { rows } = await direct.query(
        `SELECT ar.id
           FROM attendance_records ar
           JOIN employee_profiles ep
             ON ep.user_id = ar.user_id
            AND ep.company_id = ar.company_id
            AND ep.deleted_at IS NULL
          WHERE ar.company_id = $1
            AND ar.employee_id IS NULL
            AND ar.deleted_at IS NULL`,
        [A.companyId],
      );
      expect(rows).toHaveLength(0);
    });
  });
});

/**
 * S3-ATT-BE-3-FIX-AUDIT-WIRE — WRITE-path audit-in-tx + QA-06 2-tenant WRITE deny, over the REAL HTTP
 * path (JwtAuthGuard → CompanyGuard → PermissionGuard → AttendanceShiftController → service).
 *
 * Proves:
 *   (a) each config mutation (create/update shift, create/update rule, create assignment) writes an
 *       append-only audit_logs row with the CORRECT object_type ('shift'/'attendance_rule'/
 *       'shift_assignment' — requires mig 0457's CHECK) and NO secret/PII in before/after (BẤT BIẾN #3);
 *   (b) tenant B using tenant A's shiftId/ruleId to PATCH → 404 (NO leak, NO cross-tenant write, NO
 *       cross-tenant audit row). Complements the DB-level RLS deny above with the application write path.
 */
const LOGIN_PW = "Passw0rd!test99";
const SECRET_PII_KEYS = [
  "password",
  "password_hash",
  "passwordHash",
  "token",
  "secret",
  "secret_ref",
  "identity_number",
  "identityNumber",
  "bank_account",
  "bankAccount",
  "salary",
];

describe.skipIf(!hasLaneDb)(
  "S3-ATT-BE-3 WRITE-path audit-in-tx + 2-tenant WRITE deny (HTTP)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];
    let tokenA = "";
    let tokenB = "";
    let shiftIdA = "";
    let ruleIdA = "";

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      pairs: Array<[string, string]>,
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `attbe3fix-${label}-${userId.slice(0, 8)}`);
      for (const [action, resourceType] of pairs) {
        const pair = ATT_PERMISSIONS.find(
          (p) => p.action === action && p.resourceType === resourceType,
        );
        if (!pair) throw new Error(`Unknown ATT permission pair: ${action}:${resourceType}`);
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

    function auth(method: "get" | "post" | "patch", token: string, url: string) {
      return request(app.getHttpServer())[method](url).set("Authorization", `Bearer ${token}`);
    }

    async function auditRows(companyId: string, objectType: string, objectId: string) {
      const { rows } = await direct.query(
        `SELECT action, object_type, object_id, actor_user_id, before, after
         FROM audit_logs
        WHERE company_id = $1 AND object_type = $2 AND object_id = $3`,
        [companyId, objectType, objectId],
      );
      return rows as Array<Record<string, unknown>>;
    }

    function assertNoSecretPii(...snapshots: unknown[]) {
      for (const snap of snapshots) {
        if (!snap || typeof snap !== "object") continue;
        for (const k of Object.keys(snap)) {
          expect(SECRET_PII_KEYS).not.toContain(k);
        }
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "attbe3fixa");
      B = await seedCompany(direct, "attbe3fixb");
      companyIds.push(A.companyId, B.companyId);

      const adminA = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
      await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, direct_manager_id, status)
       VALUES ($1,$2,NULL,NULL,'active')`,
        [A.companyId, adminA],
      );
      await grant(A.companyId, adminA, "adminA", [
        ["create", "shift"],
        ["update", "shift"],
        ["view", "shift"],
        ["update", "shift-assignment"],
        ["config", "attendance-rule"],
        ["view", "attendance-rule"],
      ]);

      // Tenant B admin has the SAME write grants — proving the 404 is tenant isolation, NOT missing perms.
      const adminB = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
      await grant(B.companyId, adminB, "adminB", [
        ["update", "shift"],
        ["config", "attendance-rule"],
      ]);

      tokenA = await login(A.slug, `admin@${A.slug}.test`);
      tokenB = await login(B.slug, `admin@${B.slug}.test`);
    });

    afterAll(async () => {
      if (direct && companyIds.length) {
        for (const companyId of companyIds) {
          await direct
            .query("DELETE FROM shift_assignments WHERE company_id = $1", [companyId])
            .catch(() => undefined);
          await direct
            .query("DELETE FROM attendance_rules WHERE company_id = $1", [companyId])
            .catch(() => undefined);
          await direct
            .query("DELETE FROM shifts WHERE company_id = $1", [companyId])
            .catch(() => undefined);
          await direct
            .query("DELETE FROM employee_profiles WHERE company_id = $1", [companyId])
            .catch(() => undefined);
        }
        await cleanupTenants(direct, companyIds);
      }
      await direct?.end();
      await app?.close();
    });

    // ── (a) audit-in-tx per config mutation ─────────────────────────────────────
    it("POST /attendance/shifts → 201 + append-only audit ShiftCreated (config-only, no PII)", async () => {
      const res = await auth("post", tokenA, "/attendance/shifts").send({
        shiftCode: "OFFICE_AUDIT",
        name: "Ca audit",
        shiftType: "Fixed",
        startTime: "09:00",
        endTime: "18:00",
        requiredWorkingMinutes: 480,
        isDefault: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      shiftIdA = res.body.data.id as string;

      const rows = await auditRows(A.companyId, "shift", shiftIdA);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("ShiftCreated");
      expect((rows[0].after as Record<string, unknown>).shiftCode).toBe("OFFICE_AUDIT");
      assertNoSecretPii(rows[0].before, rows[0].after);
    });

    it("PATCH /attendance/shifts/:id → 200 + audit ShiftUpdated with before+after", async () => {
      const res = await auth("patch", tokenA, `/attendance/shifts/${shiftIdA}`).send({
        name: "Ca audit (renamed)",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const rows = await auditRows(A.companyId, "shift", shiftIdA);
      const updated = rows.find((r) => r.action === "ShiftUpdated");
      expect(updated, "ShiftUpdated audit row").toBeTruthy();
      expect((updated!.before as Record<string, unknown>).name).toBe("Ca audit");
      expect((updated!.after as Record<string, unknown>).name).toBe("Ca audit (renamed)");
      assertNoSecretPii(updated!.before, updated!.after);
    });

    it("POST /attendance/rules → 201 + audit RuleCreated object_type=attendance_rule", async () => {
      const res = await auth("post", tokenA, "/attendance/rules").send({
        ruleCode: "RULE_AUDIT",
        name: "Rule audit",
        ruleScope: "Company",
        effectiveFrom: "2024-01-01",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      ruleIdA = res.body.data.id as string;

      const rows = await auditRows(A.companyId, "attendance_rule", ruleIdA);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("RuleCreated");
      assertNoSecretPii(rows[0].before, rows[0].after);
    });

    it("POST /attendance/shift-assignments → 201 + audit ShiftAssignmentCreated", async () => {
      const res = await auth("post", tokenA, "/attendance/shift-assignments").send({
        shiftId: shiftIdA,
        assignmentScope: "Company",
        effectiveFrom: "2024-01-01",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const asgId = res.body.data.id as string;

      const rows = await auditRows(A.companyId, "shift_assignment", asgId);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("ShiftAssignmentCreated");
      assertNoSecretPii(rows[0].before, rows[0].after);
    });

    // ── (b) QA-06 2-tenant WRITE deny ───────────────────────────────────────────
    it("tenant B PATCH tenant A's shiftId → 404, A row unchanged, NO cross-tenant audit/write", async () => {
      const res = await auth("patch", tokenB, `/attendance/shifts/${shiftIdA}`).send({
        name: "HACKED BY B",
      });
      expect(res.status).toBe(404);

      // A's shift name is untouched (no cross-tenant overwrite).
      const shift = await direct.query(`SELECT name FROM shifts WHERE id = $1`, [shiftIdA]);
      expect(shift.rows[0].name).toBe("Ca audit (renamed)");

      // No audit row was written under B's tenant for A's shift (no false trail).
      const bRows = await auditRows(B.companyId, "shift", shiftIdA);
      expect(bRows).toHaveLength(0);
    });

    it("tenant B PATCH tenant A's ruleId → 404, NO cross-tenant audit row", async () => {
      const res = await auth("patch", tokenB, `/attendance/rules/${ruleIdA}`).send({
        name: "HACKED RULE",
      });
      expect(res.status).toBe(404);

      const rule = await direct.query(`SELECT name FROM attendance_rules WHERE id = $1`, [ruleIdA]);
      expect(rule.rows[0].name).toBe("Rule audit");

      const bRows = await auditRows(B.companyId, "attendance_rule", ruleIdA);
      expect(bRows).toHaveLength(0);
    });
  },
);
