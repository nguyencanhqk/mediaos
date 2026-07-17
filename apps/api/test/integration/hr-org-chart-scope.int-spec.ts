/**
 * S5-HR-ORGCHART-BE-1 — GET /hr/org-chart/employees ↔ data-scope (CROWN-JEWEL).
 *
 * Boots the REAL NestJS app (AppModule) + supertest so the endpoint runs the full stack JwtAuthGuard →
 * CompanyGuard → PermissionGuard → HrOrgChartService → DataScopeService → DB. Proves the INTEGRATION
 * end-to-end against the REAL scope predicate (not a hand-built set):
 *
 *   - deny-path: no read:employee grant → 403 + 0 data.
 *   - Own/Team/Department/Company scope boundaries (Option A: scoped subtree ONLY, no upward path).
 *   - IN-TENANT upward-leak (risk #1): an in-scope (EMR-managed) employee whose direct_manager_id points
 *     to an in-tenant ACTIVE OUT-OF-SCOPE user → that node is a ROOT and its real manager is ABSENT from
 *     the whole (flattened) tree. This is the proof the org-chart never appends an edge upward.
 *   - orphan: a resigned (status≠active) manager is not a node → its report becomes a root.
 *   - cross-tenant deny (BẤT BIẾN #1); cycle A↔B → no hang, cyclesDetected=true.
 *   - node allowlist: response nodes carry ONLY directory-class fields (no PII/salary/identity).
 *   - employeeCount additive on /org/units/tree (active only, no cross-tenant bleed).
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env pointing at the shared dev DB makes
 * hasDb=true, so these DB assertions only run under an isolated LANE_DB.
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

const ALLOWED_NODE_KEYS = new Set([
  "employeeId",
  "userId",
  "displayName",
  "positionName",
  "orgUnitName",
  "jobLevelName",
  "avatarUrl",
  "employeeCode",
  "children",
]);

interface OrgNode {
  employeeId: string;
  userId: string | null;
  children: OrgNode[];
  [k: string]: unknown;
}
interface OrgUnitNode {
  id: string;
  employeeCount?: number;
  children: OrgUnitNode[];
}

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

function flattenNodes(nodes: OrgNode[]): OrgNode[] {
  const out: OrgNode[] = [];
  const walk = (n: OrgNode) => {
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}
function flattenUserIds(nodes: OrgNode[]): (string | null)[] {
  return flattenNodes(nodes).map((n) => n.userId);
}
function flattenUnits(nodes: OrgUnitNode[]): OrgUnitNode[] {
  const out: OrgUnitNode[] = [];
  const walk = (n: OrgUnitNode) => {
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

describe.skipIf(!hasLaneDb)(
  "S5-HR-ORGCHART-BE-1 org-chart ↔ data-scope (HTTP, real engine)",
  () => {
    const direct = directPool();
    let app: INestApplication;

    let A: SeededTenant;
    let B: SeededTenant;

    // org units (tenant A)
    let ouEng = "";
    let ouSales = "";
    let ouOther = "";

    // tenant A users
    let uBoss = "";
    let uMgr = ""; // Team grant; manages uRep1 (direct) + uEmp (EMR)
    let uRep1 = "";
    let uEmp = ""; // EMR-managed by uMgr, but direct_manager = uOutsider (in-tenant, active, OUT of mgr scope)
    let uOutsider = ""; // in-tenant ACTIVE, NOT in mgr scope — the upward-leak trap
    let uStranger = "";
    let uOwn = ""; // Own grant
    let uCompany = ""; // Company grant
    let uHead = ""; // Department grant — heads ouEng
    let uResigned = ""; // status='resigned' — not a node
    let uOrphanRep = ""; // direct_manager = uResigned → root under Company
    let uNoGrant = ""; // no read:employee grant → 403
    let uCycA = "";
    let uCycB = "";

    // tenant B
    let uB = "";

    async function seedOrgUnit(
      companyId: string,
      name: string,
      headUserId?: string,
    ): Promise<string> {
      const r = await direct.query(
        "INSERT INTO org_units (company_id, name, type, head_user_id) VALUES ($1, $2, 'department', $3) RETURNING id",
        [companyId, name, headUserId ?? null],
      );
      return r.rows[0].id as string;
    }

    async function seedEmployee(opts: {
      companyId: string;
      userId: string | null;
      orgUnitId: string | null;
      directManagerUserId?: string | null;
      status?: string;
      deleted?: boolean;
    }): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, direct_manager_id, status, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          opts.companyId,
          opts.userId,
          opts.orgUnitId,
          opts.directManagerUserId ?? null,
          opts.status ?? "active",
          opts.deleted ? new Date() : null,
        ],
      );
      return r.rows[0].id as string;
    }

    async function seedEmr(
      companyId: string,
      managerUserId: string,
      employeeUserId: string,
    ): Promise<void> {
      await direct.query(
        `INSERT INTO employee_manager_relations (company_id, manager_user_id, employee_user_id, relation_type, status)
       VALUES ($1, $2, $3, 'project_manager', 'active')`,
        [companyId, managerUserId, employeeUserId],
      );
    }

    async function grantReadEmployee(
      companyId: string,
      userId: string,
      scope: DataScope,
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `oc-read-${scope}-${userId.slice(0, 8)}`);
      const permId = await seedPermissionCatalog(direct, "read", "employee", false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      await seedUserRole(direct, userId, roleId, companyId);
    }

    async function orgChart(
      token: string,
    ): Promise<{ roots: OrgNode[]; warnings: { cyclesDetected: boolean } }> {
      const res = await api(app).get("/hr/org-chart/employees").set(bearer(token));
      expect(res.status, `org-chart failed: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data;
    }

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "ocA");
      B = await seedCompany(direct, "ocB");

      // users
      uBoss = await seedUser(direct, A.companyId, `boss@${A.slug}.test`, hash);
      uMgr = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
      uRep1 = await seedUser(direct, A.companyId, `rep1@${A.slug}.test`, hash);
      uEmp = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
      uOutsider = await seedUser(direct, A.companyId, `outsider@${A.slug}.test`, hash);
      uStranger = await seedUser(direct, A.companyId, `stranger@${A.slug}.test`, hash);
      uOwn = await seedUser(direct, A.companyId, `own@${A.slug}.test`, hash);
      uCompany = await seedUser(direct, A.companyId, `company@${A.slug}.test`, hash);
      uHead = await seedUser(direct, A.companyId, `head@${A.slug}.test`, hash);
      uResigned = await seedUser(direct, A.companyId, `resigned@${A.slug}.test`, hash);
      uOrphanRep = await seedUser(direct, A.companyId, `orphanrep@${A.slug}.test`, hash);
      uNoGrant = await seedUser(direct, A.companyId, `nogrant@${A.slug}.test`, hash);
      uCycA = await seedUser(direct, A.companyId, `cyca@${A.slug}.test`, hash);
      uCycB = await seedUser(direct, A.companyId, `cycb@${A.slug}.test`, hash);
      uB = await seedUser(direct, B.companyId, `b@${B.slug}.test`, hash);

      ouEng = await seedOrgUnit(A.companyId, "Engineering", uHead); // uHead heads Engineering
      ouSales = await seedOrgUnit(A.companyId, "Sales");
      ouOther = await seedOrgUnit(A.companyId, "Other");

      // profiles (tenant A)
      await seedEmployee({
        companyId: A.companyId,
        userId: uBoss,
        orgUnitId: ouSales,
        directManagerUserId: null,
      });
      await seedEmployee({
        companyId: A.companyId,
        userId: uMgr,
        orgUnitId: ouSales,
        directManagerUserId: uBoss,
      });
      await seedEmployee({
        companyId: A.companyId,
        userId: uRep1,
        orgUnitId: ouSales,
        directManagerUserId: uMgr,
      });
      // uEmp: EMR-managed by uMgr, but its DIRECT manager is uOutsider (in-tenant, active, OUT of mgr scope)
      await seedEmployee({
        companyId: A.companyId,
        userId: uEmp,
        orgUnitId: ouEng,
        directManagerUserId: uOutsider,
      });
      await seedEmployee({
        companyId: A.companyId,
        userId: uOutsider,
        orgUnitId: ouEng,
        directManagerUserId: uBoss,
      });
      await seedEmployee({
        companyId: A.companyId,
        userId: uStranger,
        orgUnitId: ouSales,
        directManagerUserId: uBoss,
      });
      await seedEmployee({
        companyId: A.companyId,
        userId: uOwn,
        orgUnitId: ouSales,
        directManagerUserId: uBoss,
      });
      await seedEmployee({
        companyId: A.companyId,
        userId: uCompany,
        orgUnitId: ouOther,
        directManagerUserId: null,
      });
      await seedEmployee({
        companyId: A.companyId,
        userId: uHead,
        orgUnitId: ouSales,
        directManagerUserId: uBoss,
      });
      // resigned manager (not a node) + its report → report becomes a root under Company scope
      await seedEmployee({
        companyId: A.companyId,
        userId: uResigned,
        orgUnitId: ouOther,
        status: "resigned",
      });
      await seedEmployee({
        companyId: A.companyId,
        userId: uOrphanRep,
        orgUnitId: ouOther,
        directManagerUserId: uResigned,
      });
      await seedEmployee({
        companyId: A.companyId,
        userId: uNoGrant,
        orgUnitId: ouOther,
        directManagerUserId: null,
      });
      // cycle A↔B
      await seedEmployee({
        companyId: A.companyId,
        userId: uCycA,
        orgUnitId: ouOther,
        directManagerUserId: uCycB,
      });
      await seedEmployee({
        companyId: A.companyId,
        userId: uCycB,
        orgUnitId: ouOther,
        directManagerUserId: uCycA,
      });
      // soft-deleted employee in ouEng → must NOT count in employeeCount
      await seedEmployee({ companyId: A.companyId, userId: null, orgUnitId: ouEng, deleted: true });

      // EMR: uMgr manages uEmp (project_manager — NOT via direct_manager_id shortcut)
      await seedEmr(A.companyId, uMgr, uEmp);

      // grants
      await grantReadEmployee(A.companyId, uMgr, "Team");
      await grantReadEmployee(A.companyId, uOwn, "Own");
      await grantReadEmployee(A.companyId, uCompany, "Company");
      await grantReadEmployee(A.companyId, uHead, "Department");
      // uNoGrant: intentionally NO grant

      // tenant B
      await seedEmployee({
        companyId: B.companyId,
        userId: uB,
        orgUnitId: null,
        directManagerUserId: null,
      });
      await grantReadEmployee(B.companyId, uB, "Company");

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
    });

    afterAll(async () => {
      await direct
        .query("DELETE FROM employee_manager_relations WHERE company_id = ANY($1::uuid[])", [
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

    // ── deny-path (RED-first) ────────────────────────────────────────────────────────

    it("deny: a user without read:employee grant gets 403 + no data", async () => {
      const token = await login(app, A.slug, `nogrant@${A.slug}.test`);
      const res = await api(app).get("/hr/org-chart/employees").set(bearer(token));
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.data).toBeFalsy();
    });

    // ── scope boundaries ──────────────────────────────────────────────────────────────

    it("Own: the tree contains ONLY the caller's own node", async () => {
      const token = await login(app, A.slug, `own@${A.slug}.test`);
      const { roots } = await orgChart(token);
      const ids = flattenUserIds(roots);
      expect(ids).toEqual([uOwn]); // exactly self, as a single root
    });

    it("Team: caller sees self + direct report + EMR-managed, NOT a stranger", async () => {
      const token = await login(app, A.slug, `mgr@${A.slug}.test`);
      const { roots } = await orgChart(token);
      const ids = flattenUserIds(roots);
      expect(ids).toContain(uMgr); // self
      expect(ids).toContain(uRep1); // direct report
      expect(ids).toContain(uEmp); // EMR-managed
      expect(ids).not.toContain(uStranger);
      // rep1 nests under mgr; mgr is a root (its own manager uBoss is out of scope)
      const mgrNode = roots.find((r) => r.userId === uMgr)!;
      expect(mgrNode.children.map((c) => c.userId)).toContain(uRep1);
    });

    it("IN-TENANT upward-leak: EMR-managed emp with a direct_manager OUTSIDE scope → node is a root, real manager ABSENT", async () => {
      const token = await login(app, A.slug, `mgr@${A.slug}.test`);
      const { roots } = await orgChart(token);
      // (i) uEmp is a ROOT — its direct manager (uOutsider) is not in the visible set, so no upward edge.
      expect(roots.map((r) => r.userId)).toContain(uEmp);
      // (ii) the real manager uOutsider is fully ABSENT from the flattened tree (no upward disclosure).
      const ids = flattenUserIds(roots);
      expect(ids).not.toContain(uOutsider);
      expect(ids).not.toContain(uBoss);
    });

    it("Department: unit head sees headed-unit employees, not another unit's", async () => {
      const token = await login(app, A.slug, `head@${A.slug}.test`);
      const { roots } = await orgChart(token);
      const ids = flattenUserIds(roots);
      expect(ids).toContain(uEmp); // Engineering (headed unit) — head's own profile is in Sales
      expect(ids).toContain(uHead); // own unit (Sales)
      expect(ids).not.toContain(uOrphanRep); // ouOther — neither owned nor headed
    });

    it("Company: sees whole tenant; a resigned manager's report is a root (orphan); cycle does not hang", async () => {
      const token = await login(app, A.slug, `company@${A.slug}.test`);
      const { roots, warnings } = await orgChart(token);
      const flat = flattenNodes(roots);
      const ids = flat.map((n) => n.userId);
      // orphan: uOrphanRep's manager (uResigned) is not active → not a node → orphanRep is a root.
      expect(roots.map((r) => r.userId)).toContain(uOrphanRep);
      expect(ids).not.toContain(uResigned); // resigned = not a node
      // cycle A↔B present exactly once each, flagged, no hang (the response returning is the proof).
      expect(warnings.cyclesDetected).toBe(true);
      expect(ids.filter((x) => x === uCycA)).toHaveLength(1);
      expect(ids.filter((x) => x === uCycB)).toHaveLength(1);
    });

    it("allowlist: every response node carries ONLY directory-class fields (no PII/salary/identity)", async () => {
      const token = await login(app, A.slug, `company@${A.slug}.test`);
      const { roots } = await orgChart(token);
      for (const node of flattenNodes(roots)) {
        for (const key of Object.keys(node)) {
          expect(ALLOWED_NODE_KEYS.has(key), `leaked field in org-chart node: ${key}`).toBe(true);
        }
      }
    });

    // ── cross-tenant (BẤT BIẾN #1) ─────────────────────────────────────────────────────

    it("cross-tenant: tenant B Company user never sees any tenant A node", async () => {
      const token = await login(app, B.slug, `b@${B.slug}.test`);
      const { roots } = await orgChart(token);
      const ids = flattenUserIds(roots);
      expect(ids).toContain(uB);
      for (const aUser of [uBoss, uMgr, uRep1, uEmp, uOutsider, uOrphanRep, uCycA, uCycB]) {
        expect(ids).not.toContain(aUser);
      }
    });

    // ── employeeCount additive on /org/units/tree ──────────────────────────────────────

    it("employeeCount: active headcount per unit, resigned/soft-deleted excluded, no cross-tenant bleed", async () => {
      const token = await login(app, A.slug, `company@${A.slug}.test`);
      const res = await api(app).get("/org/units/tree").set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const units = flattenUnits(res.body.data as OrgUnitNode[]);
      const byId = new Map(units.map((u) => [u.id, u]));
      // ouEng: uEmp + uOutsider = 2 (soft-deleted employee NOT counted).
      expect(byId.get(ouEng)?.employeeCount).toBe(2);
      // ouSales: uBoss,uMgr,uRep1,uStranger,uOwn,uHead = 6.
      expect(byId.get(ouSales)?.employeeCount).toBe(6);
      // ouOther: uCompany,uOrphanRep,uNoGrant,uCycA,uCycB = 5 (uResigned resigned → NOT counted).
      expect(byId.get(ouOther)?.employeeCount).toBe(5);
    });
  },
);
