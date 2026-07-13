/**
 * S5-HR-IMPORT-BE-1 — HR bulk employee import integration (CROWN-JEWEL, BẤT BIẾN #1/#2/#3).
 *
 * Real NestJS app (AppModule) + supertest → POST /hr/employees/import runs the FULL guard chain
 * (JwtAuthGuard → CompanyGuard → 2FA → PermissionGuard(import:employee, isSensitive) → HrImportController →
 * HrEmployeeImportService) with the REAL permission engine. No mocks. Verified at the DB layer:
 *   - DENY: a caller WITHOUT import:employee → 403 BEFORE any side effect (0 employee_profiles, 0 audit).
 *   - cross-tenant: an actor of company A importing a reference that only exists in company B resolves it
 *     under withTenant(A) → NOT FOUND → the row fails; company B is never read/written.
 *   - dryRun (the SAFE default): validates the whole file WITHOUT writing — no insert, no SequenceService
 *     allocation (sequence_counters.current_value unchanged), zero audit.
 *   - bad MIME/extension → 400 (never a raw 500), zero writes.
 *   - duplicate IN-FILE (same employeeCode) → BOTH rows flagged; duplicate vs a non-soft-deleted DB row →
 *     flagged (the partial unique index employee_profiles_company_code_active_uq is the DB backstop).
 *   - apply happy-path: N valid rows → N employee_profiles UNLINKED (user_id NULL), COUNT(users) unchanged,
 *     0 outbox activation event, employee codes monotonic via SequenceService, N 'create' audit rows
 *     (object_type='employee') + EXACTLY ONE 'employee_import' session audit ({fileName, ok, fail}).
 *   - partial-success: a mixed file creates the valid rows (each in its own tx) + reports the bad rows; the
 *     session audit ok/fail is exact.
 *   - legacy media-era /employees/import stays DENY-gated (403) for a non-privileged caller → no bypass.
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env points DATABASE_URL at the shared dev
 * DB (hasDb=true) → only run on an ISOLATED lane DB (LANE_DB set), else the DB assertions are false-red.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
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
const EMPLOYEE_CODE_SEQUENCE_KEY = "EMPLOYEE_CODE";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// ── CSV builder (positional — mirrors IMPORT_COLUMN_ORDER; the parser maps by POSITION, not label) ──
type RowFields = {
  employeeCode?: string;
  email?: string;
  orgUnitName?: string;
  positionName?: string;
  jobLevelName?: string;
  contractTypeName?: string;
  workType?: string;
  employmentType?: string;
  salaryType?: string;
  startDate?: string;
  endDate?: string;
};
const COLS: (keyof RowFields)[] = [
  "employeeCode",
  "email",
  "orgUnitName",
  "positionName",
  "jobLevelName",
  "contractTypeName",
  "workType",
  "employmentType",
  "salaryType",
  "startDate",
  "endDate",
];
const HEADER = COLS.join(",");
function dataRow(f: RowFields): string {
  return COLS.map((c) => f[c] ?? "").join(",");
}
function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\r\n") + "\r\n";
}
function attachCsv(
  req: request.Test,
  body: string,
  opts: { filename?: string; contentType?: string } = {},
): request.Test {
  return req.attach("file", Buffer.from(body, "utf8"), {
    filename: opts.filename ?? "employees.csv",
    contentType: opts.contentType ?? "text/csv",
  });
}

// ── DB probes (direct pool = superuser, bypass RLS) ────────────────────────────────────────────────
async function seedEmployeeCodeCounter(direct: Pool, companyId: string): Promise<void> {
  await direct.query(
    `INSERT INTO sequence_counters
       (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
        increment_by, reset_policy, current_value, status)
     VALUES ($1, 'HR', $2, 'Company', 'EMP', 4, 1, 'Never', 0, 'Active')`,
    [companyId, EMPLOYEE_CODE_SEQUENCE_KEY],
  );
}

/** Grant import:employee (is_sensitive=true, parity with mig 0496) to `userId` via a company-scoped role. */
async function grantImport(direct: Pool, companyId: string, userId: string): Promise<void> {
  const roleId = await seedRole(direct, companyId, `qa-hr-import-${userId.slice(0, 8)}`);
  // is_sensitive TRUE — the catalog pair is sensitive after mig 0496; keep it true so re-seed does not
  // flip it back (seedPermissionCatalog upserts is_sensitive) and the sensitive gate stays exact-only.
  const permId = await seedPermissionCatalog(direct, "import", "employee", true);
  await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
  await seedUserRole(direct, userId, roleId, companyId);
}

/** Seed an employee_profiles row DIRECTLY (bypass RLS) — used to plant a DB-duplicate code. */
async function seedEmployeeWithCode(
  direct: Pool,
  companyId: string,
  code: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, status, work_type, employee_code)
     VALUES ($1, NULL, 'active', 'offline', $2) RETURNING id`,
    [companyId, code],
  );
  return r.rows[0].id as string;
}

async function seedOrgUnit(direct: Pool, companyId: string, name: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO org_units (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [companyId, name],
  );
  return r.rows[0].id as string;
}

async function scalar(direct: Pool, sql: string, params: unknown[]): Promise<number> {
  const r = await direct.query(sql, params);
  return Number(r.rows[0].n);
}
const countProfiles = (d: Pool, c: string) =>
  scalar(d, `SELECT count(*)::int AS n FROM employee_profiles WHERE company_id=$1`, [c]);
const countUsers = (d: Pool, c: string) =>
  scalar(d, `SELECT count(*)::int AS n FROM users WHERE company_id=$1`, [c]);
const countAudit = (d: Pool, c: string, objectType: string, action: string) =>
  scalar(
    d,
    `SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND object_type=$2 AND action=$3`,
    [c, objectType, action],
  );
const countAllAudit = (d: Pool, c: string) =>
  scalar(d, `SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1`, [c]);
const countOutbox = (d: Pool, c: string) =>
  scalar(d, `SELECT count(*)::int AS n FROM outbox_events WHERE company_id=$1`, [c]);
const seqValue = (d: Pool, c: string) =>
  scalar(
    d,
    `SELECT current_value::int AS n FROM sequence_counters WHERE company_id=$1 AND sequence_key=$2`,
    [c, EMPLOYEE_CODE_SEQUENCE_KEY],
  );

describe.skipIf(!hasLaneDb)(
  "S5-HR-IMPORT-BE-1 HR bulk import (HTTP, real permission engine)",
  () => {
    const direct = directPool();
    let app: INestApplication;

    let A: SeededTenant; // actor tenant (has code counter + import grant)
    let B: SeededTenant; // cross-tenant target (its data must never be reachable from A)

    let hrEmail = ""; // has import:employee (Company)
    let noPermEmail = ""; // no grants — deny-path

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "hrimportA");
      B = await seedCompany(direct, "hrimportB");
      await seedEmployeeCodeCounter(direct, A.companyId);

      hrEmail = `hr@${A.slug}.test`;
      const hrUserId = await seedUser(direct, A.companyId, hrEmail, hash);
      await grantImport(direct, A.companyId, hrUserId);

      noPermEmail = `noperm@${A.slug}.test`;
      await seedUser(direct, A.companyId, noPermEmail, hash);

      // A reference that exists ONLY in tenant B — an actor of A must never resolve/reach it.
      await seedOrgUnit(direct, B.companyId, "SharedDept");

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
    });

    afterAll(async () => {
      for (const id of [A.companyId, B.companyId]) {
        await direct
          .query("DELETE FROM employee_status_histories WHERE company_id = $1", [id])
          .catch(() => undefined);
        await direct
          .query("DELETE FROM employee_manager_relations WHERE company_id = $1", [id])
          .catch(() => undefined);
        await direct
          .query("DELETE FROM employee_profiles WHERE company_id = $1", [id])
          .catch(() => undefined);
      }
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      if (app) await app.close();
    });

    // ── DENY-PATH (RED-first) ─────────────────────────────────────────────────────────────────────
    it("DENY: no import:employee grant → 403 and ZERO side effects (no profile, no audit)", async () => {
      const token = await login(app, A.slug, noPermEmail);
      const profilesBefore = await countProfiles(direct, A.companyId);
      const auditBefore = await countAllAudit(direct, A.companyId);

      const res = await attachCsv(
        api(app).post("/hr/employees/import?dryRun=false").set(bearer(token)),
        csv(dataRow({ workType: "offline" })),
      );
      expect(res.status).toBe(403);
      // Deny is at the guard, BEFORE the handler → nothing parsed, inserted, or audited.
      expect(await countProfiles(direct, A.companyId)).toBe(profilesBefore);
      expect(await countAllAudit(direct, A.companyId)).toBe(auditBefore);
    });

    it("cross-tenant: actor A importing a reference only in tenant B → row fails, B untouched", async () => {
      const token = await login(app, A.slug, hrEmail);
      const bProfilesBefore = await countProfiles(direct, B.companyId);
      const bAuditBefore = await countAllAudit(direct, B.companyId);

      const res = await attachCsv(
        api(app).post("/hr/employees/import?dryRun=false").set(bearer(token)),
        csv(dataRow({ orgUnitName: "SharedDept", workType: "offline" })),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      // "SharedDept" only exists in B → resolveRows under withTenant(A) does not find it → row rejected.
      expect(res.body.data.counts.fail).toBe(1);
      expect(res.body.data.counts.ok).toBe(0);
      // Tenant B is never read/written — no cross-tenant leak.
      expect(await countProfiles(direct, B.companyId)).toBe(bProfilesBefore);
      expect(await countAllAudit(direct, B.companyId)).toBe(bAuditBefore);
    });

    // ── dryRun (safe default) — validates, writes NOTHING ─────────────────────────────────────────
    it("dryRun (default) → 201 report, NO insert, NO sequence allocation, NO audit", async () => {
      const token = await login(app, A.slug, hrEmail);
      const seqBefore = await seqValue(direct, A.companyId);
      const profilesBefore = await countProfiles(direct, A.companyId);
      const auditBefore = await countAllAudit(direct, A.companyId);

      const res = await attachCsv(
        api(app).post("/hr/employees/import").set(bearer(token)), // dryRun defaults TRUE
        csv(dataRow({ workType: "offline" }), dataRow({ workType: "remote" })),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.counts).toMatchObject({ ok: 2, fail: 0 });

      expect(await seqValue(direct, A.companyId)).toBe(seqBefore); // NO code allocated
      expect(await countProfiles(direct, A.companyId)).toBe(profilesBefore);
      expect(await countAllAudit(direct, A.companyId)).toBe(auditBefore);
    });

    it("bad MIME/extension → 400 (not 500), zero writes", async () => {
      const token = await login(app, A.slug, hrEmail);
      const profilesBefore = await countProfiles(direct, A.companyId);

      // Wrong extension (.exe) → resolveFileKind rejects explicitly (400, never a raw 500).
      const extRes = await attachCsv(
        api(app).post("/hr/employees/import?dryRun=false").set(bearer(token)),
        "not a spreadsheet",
        { filename: "malware.exe", contentType: "application/octet-stream" },
      );
      expect(extRes.status).toBe(400);

      // Right extension, wrong MIME (.csv claiming image/png) → still 400.
      const mimeRes = await attachCsv(
        api(app).post("/hr/employees/import?dryRun=false").set(bearer(token)),
        csv(dataRow({ workType: "offline" })),
        { filename: "employees.csv", contentType: "image/png" },
      );
      expect(mimeRes.status).toBe(400);

      expect(await countProfiles(direct, A.companyId)).toBe(profilesBefore);
    });

    // ── Duplicate detection ───────────────────────────────────────────────────────────────────────
    it("duplicate IN-FILE (same employeeCode) → BOTH rows flagged, none created", async () => {
      const token = await login(app, A.slug, hrEmail);
      const profilesBefore = await countProfiles(direct, A.companyId);

      const res = await attachCsv(
        api(app).post("/hr/employees/import?dryRun=false").set(bearer(token)),
        csv(
          dataRow({ employeeCode: "DUPCODE1", workType: "offline" }),
          dataRow({ employeeCode: "DUPCODE1", workType: "remote" }),
        ),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.counts).toMatchObject({ ok: 0, fail: 2 });
      expect(res.body.data.skipped).toHaveLength(2);
      // Nothing created — both rows rejected before apply.
      expect(await countProfiles(direct, A.companyId)).toBe(profilesBefore);
    });

    it("duplicate vs DB (existing non-soft-deleted code) → flagged, no dup inserted (unique-index backstop)", async () => {
      const token = await login(app, A.slug, hrEmail);
      await seedEmployeeWithCode(direct, A.companyId, "EXISTCODE");

      // The partial unique index is the DB backstop behind the app-level dup check.
      const idx = await direct.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'employee_profiles_company_code_active_uq'`,
      );
      expect(idx.rows.length, "partial unique index must exist as the DB backstop").toBe(1);
      expect(idx.rows[0].indexdef).toContain("deleted_at IS NULL");
      expect(idx.rows[0].indexdef).toContain("employee_code IS NOT NULL");

      const codeCountBefore = await scalar(
        direct,
        `SELECT count(*)::int AS n FROM employee_profiles WHERE company_id=$1 AND employee_code=$2`,
        [A.companyId, "EXISTCODE"],
      );
      const res = await attachCsv(
        api(app).post("/hr/employees/import?dryRun=false").set(bearer(token)),
        csv(dataRow({ employeeCode: "EXISTCODE", workType: "offline" })),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.counts.fail).toBe(1);
      // No second row with that code — dup not inserted.
      const codeCountAfter = await scalar(
        direct,
        `SELECT count(*)::int AS n FROM employee_profiles WHERE company_id=$1 AND employee_code=$2`,
        [A.companyId, "EXISTCODE"],
      );
      expect(codeCountAfter).toBe(codeCountBefore);
    });

    // ── apply happy-path ──────────────────────────────────────────────────────────────────────────
    it("apply: N valid rows → N UNLINKED employees, users unchanged, 0 outbox, monotonic codes, N+1 audit", async () => {
      const token = await login(app, A.slug, hrEmail);
      const usersBefore = await countUsers(direct, A.companyId);
      const outboxBefore = await countOutbox(direct, A.companyId);
      const createAuditBefore = await countAudit(direct, A.companyId, "employee", "create");
      const importAuditBefore = await countAudit(direct, A.companyId, "employee_import", "import");

      const res = await attachCsv(
        api(app).post("/hr/employees/import?dryRun=false").set(bearer(token)),
        csv(
          dataRow({ workType: "offline" }),
          dataRow({ workType: "remote" }),
          dataRow({ workType: "hybrid" }),
        ),
        { filename: "roster.csv" },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.dryRun).toBe(false);
      expect(res.body.data.counts).toMatchObject({ ok: 3, fail: 0 });
      expect(res.body.data.created).toHaveLength(3);

      // Employee codes allocated via SequenceService → strictly monotonic, EMP####.
      const codes = (res.body.data.created as Array<{ employeeCode: string }>).map(
        (c) => c.employeeCode,
      );
      for (const code of codes) expect(code).toMatch(/^EMP\d{4}$/);
      const nums = codes.map((c) => Number(c.slice(3)));
      for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThan(nums[i - 1]);

      // UNLINKED: every imported profile has user_id NULL; COUNT(users) never changes (never provisions).
      const rows = await direct.query(
        `SELECT user_id FROM employee_profiles WHERE company_id=$1 AND employee_code = ANY($2::text[])`,
        [A.companyId, codes],
      );
      expect(rows.rows).toHaveLength(3);
      for (const r of rows.rows) expect(r.user_id).toBeNull();
      expect(await countUsers(direct, A.companyId)).toBe(usersBefore);

      // No activation/welcome outbox event for an unlinked import.
      expect(await countOutbox(direct, A.companyId)).toBe(outboxBefore);

      // N 'create' audit (object_type='employee') + EXACTLY ONE 'employee_import' session audit.
      expect(await countAudit(direct, A.companyId, "employee", "create")).toBe(
        createAuditBefore + 3,
      );
      expect(await countAudit(direct, A.companyId, "employee_import", "import")).toBe(
        importAuditBefore + 1,
      );
      expect(res.body.data.sessionAuditId).toMatch(UUID_RE);
      const sa = await direct.query(`SELECT after FROM audit_logs WHERE id = $1`, [
        res.body.data.sessionAuditId,
      ]);
      // Session audit carries ONLY run metadata (no PII/secret — BẤT BIẾN #3).
      expect(sa.rows[0].after).toMatchObject({ fileName: "roster.csv", ok: 3, fail: 0 });
    });

    it("partial-success: valid rows created (own tx), bad rows reported, session audit ok/fail exact", async () => {
      const token = await login(app, A.slug, hrEmail);
      const profilesBefore = await countProfiles(direct, A.companyId);
      const importAuditBefore = await countAudit(direct, A.companyId, "employee_import", "import");

      const res = await attachCsv(
        api(app).post("/hr/employees/import?dryRun=false").set(bearer(token)),
        csv(
          dataRow({ workType: "offline" }), // valid
          dataRow({ workType: "NOT_A_WORKTYPE" }), // invalid enum → validation error
          dataRow({ email: "not-an-email", workType: "offline" }), // invalid email → validation error
        ),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.counts).toMatchObject({ ok: 1, fail: 2 });
      expect(res.body.data.created).toHaveLength(1);
      expect(res.body.data.skipped).toHaveLength(2);

      // Exactly one new profile — the valid row committed in its OWN tx, the failures did NOT roll it back.
      expect(await countProfiles(direct, A.companyId)).toBe(profilesBefore + 1);
      // One session audit summarising the run.
      expect(await countAudit(direct, A.companyId, "employee_import", "import")).toBe(
        importAuditBefore + 1,
      );
      const sa = await direct.query(`SELECT after FROM audit_logs WHERE id = $1`, [
        res.body.data.sessionAuditId,
      ]);
      expect(sa.rows[0].after).toMatchObject({ ok: 1, fail: 2 });
    });

    // ── legacy media-era route stays deny-gated (no bypass) ───────────────────────────────────────
    it("legacy /employees/import stays DENY-gated (403) for a non-privileged caller → no bypass", async () => {
      const token = await login(app, A.slug, noPermEmail);
      const profilesBefore = await countProfiles(direct, A.companyId);
      const auditBefore = await countAllAudit(direct, A.companyId);

      const res = await attachCsv(
        api(app).post("/employees/import").set(bearer(token)),
        csv(dataRow({ workType: "offline" })),
      );
      // The media-era import must NOT be a bypass for a caller lacking import:employee.
      expect(res.status).toBe(403);
      expect(await countProfiles(direct, A.companyId)).toBe(profilesBefore);
      expect(await countAllAudit(direct, A.companyId)).toBe(auditBefore);
    });
  },
);
