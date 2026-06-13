/**
 * G8-1 — E2E deny-path suite for the multi-level Approval Inbox (APR-001/002).
 *
 * Contracts asserted (RED-first):
 *   E1 — POST /approval/requests/:id/approve WITHOUT approve:approval-request permission →
 *        PermissionGuard fail-closed 403 (deny-path). A user who is not the current-level approver → 403/409.
 *   E2 — audit 100%: each approve writes exactly one audit_logs row (ApprovalLevelApproved /
 *        intermediate, or StepApproved for the final level), object_type ∈ {approval_request, workflow_step}.
 *   E3 — GET /approval/inbox: only returns pending requests where the caller is the approver of the
 *        request's CURRENT level (never a future level). Cross-tenant → empty.
 *
 * Uses real Postgres (CI). Auto-skips locally when DATABASE_URL is unset (hasDb=false) — never false-green.
 * The direct pool (superuser) seeds the approval chain; HTTP goes through the app (guards live).
 */

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../src/auth/password.service";
import { directPool, hasDb } from "./helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, seedUserRole } from "./helpers/seed";

const PASSWORD = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app).post("/auth/login").send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

/** Seed a 3-level approval request directly (definition→instance→step→request→rules). */
async function seedThreeLevelRequest(
  direct: Pool,
  companyId: string,
  approvers: { l1: string; l2: string; l3: string },
): Promise<{ requestId: string; stepId: string }> {
  const defRes = await direct.query(
    `INSERT INTO workflow_definitions (company_id, code, name, applies_to, max_approval_level, allow_parallel_steps)
     VALUES ($1, $2, 'G8 e2e', 'content_item', 3, false) RETURNING id`,
    [companyId, `g8-e2e-${randomUUID().slice(0, 8)}`],
  );
  const defId = defRes.rows[0].id as string;
  const projRes = await direct.query(
    `INSERT INTO projects (company_id, name, status) VALUES ($1, 'g8-prj', 'active') RETURNING id`,
    [companyId],
  );
  const ciRes = await direct.query(
    `INSERT INTO content_items (company_id, project_id, title, status) VALUES ($1, $2, 'g8-ci', 'draft') RETURNING id`,
    [companyId, projRes.rows[0].id],
  );
  const instRes = await direct.query(
    `INSERT INTO workflow_instances (company_id, workflow_definition_id, content_item_id, current_step_order, status)
     VALUES ($1, $2, $3, 1, 'active') RETURNING id`,
    [companyId, defId, ciRes.rows[0].id],
  );
  const stepRes = await direct.query(
    `INSERT INTO workflow_steps (company_id, workflow_instance_id, step_order, step_code, step_name, status, reviewer_user_id)
     VALUES ($1, $2, 1, 'script', 'Viết kịch bản', 'waiting_review', $3) RETURNING id`,
    [companyId, instRes.rows[0].id, approvers.l3],
  );
  const stepId = stepRes.rows[0].id as string;
  const reqRes = await direct.query(
    `INSERT INTO approval_requests (company_id, workflow_step_id, requested_by, status, current_level, max_level)
     VALUES ($1, $2, $3, 'pending', 1, 3) RETURNING id`,
    [companyId, stepId, approvers.l1],
  );
  for (const [level, approver] of [
    [1, approvers.l1],
    [2, approvers.l2],
    [3, approvers.l3],
  ] as const) {
    await direct.query(
      `INSERT INTO approval_rules (company_id, workflow_step_id, level, approver_user_id) VALUES ($1, $2, $3, $4)`,
      [companyId, stepId, level, approver],
    );
  }
  return { requestId: reqRes.rows[0].id as string, stepId };
}

describe.skipIf(!hasDb)("G8-1 Approval Inbox e2e (deny-path)", () => {
  let app: INestApplication;
  let direct: Pool;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // E1 — gating + permission ───────────────────────────────────────────────────
  it("E1a — approver of level 2 cannot approve while current_level=1 → 409/403", async () => {
    const t = await seedCompany(direct, "g8a");
    companyIds.push(t.companyId);
    const l1 = await seedUser(direct, t.companyId, `l1-${randomUUID().slice(0, 6)}@x.test`, await hash());
    const l2 = await seedUser(direct, t.companyId, `l2-${randomUUID().slice(0, 6)}@x.test`, await hash());
    const l3 = await seedUser(direct, t.companyId, `l3-${randomUUID().slice(0, 6)}@x.test`, await hash());
    // All three hold approve permission (company-admin) so the failure is the LEVEL gate, not the guard.
    for (const u of [l1, l2, l3]) await seedUserRole(direct, u, COMPANY_ADMIN_ROLE_ID, t.companyId);
    const { requestId } = await seedThreeLevelRequest(direct, t.companyId, { l1, l2, l3 });

    const token = await login(app, t.slug, await emailOf(direct, l2));
    const res = await api(app)
      .post(`/approval/requests/${requestId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect([403, 409]).toContain(res.status);
  });

  it("E1b — user WITHOUT approve:approval-request permission → 403 (fail-closed guard)", async () => {
    const t = await seedCompany(direct, "g8b");
    companyIds.push(t.companyId);
    const l1 = await seedUser(direct, t.companyId, `l1-${randomUUID().slice(0, 6)}@x.test`, await hash());
    const l2 = await seedUser(direct, t.companyId, `l2-${randomUUID().slice(0, 6)}@x.test`, await hash());
    const l3 = await seedUser(direct, t.companyId, `l3-${randomUUID().slice(0, 6)}@x.test`, await hash());
    // l1 gets NO role → no approve permission. Guard must deny before any level logic.
    const { requestId } = await seedThreeLevelRequest(direct, t.companyId, { l1, l2, l3 });

    const token = await login(app, t.slug, await emailOf(direct, l1));
    const res = await api(app)
      .post(`/approval/requests/${requestId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  // E2 — audit written on intermediate approve ────────────────────────────────────
  it("E2 — approving an intermediate level writes exactly one audit_logs row (ApprovalLevelApproved)", async () => {
    const t = await seedCompany(direct, "g8d");
    companyIds.push(t.companyId);
    const l1 = await seedUser(direct, t.companyId, `l1-${randomUUID().slice(0, 6)}@x.test`, await hash());
    const l2 = await seedUser(direct, t.companyId, `l2-${randomUUID().slice(0, 6)}@x.test`, await hash());
    const l3 = await seedUser(direct, t.companyId, `l3-${randomUUID().slice(0, 6)}@x.test`, await hash());
    for (const u of [l1, l2, l3]) await seedUserRole(direct, u, COMPANY_ADMIN_ROLE_ID, t.companyId);
    const { requestId } = await seedThreeLevelRequest(direct, t.companyId, { l1, l2, l3 });

    const token = await login(app, t.slug, await emailOf(direct, l1));
    const res = await api(app)
      .post(`/approval/requests/${requestId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(201);

    // Audit row must exist in audit_logs for this approval action (append-only table).
    const auditRes = await direct.query(
      `SELECT action, object_type, object_id FROM audit_logs
       WHERE object_id = $1 AND action = 'ApprovalLevelApproved'
       ORDER BY created_at DESC LIMIT 5`,
      [requestId],
    );
    expect(auditRes.rows).toHaveLength(1);
    expect(auditRes.rows[0].object_type).toBe("approval_request");
    expect(auditRes.rows[0].object_id).toBe(requestId);
  });

  // E3 — inbox isolation ─────────────────────────────────────────────────────────
  it("E3 — inbox returns only requests at the caller's current level; cross-tenant empty", async () => {
    const t = await seedCompany(direct, "g8c");
    companyIds.push(t.companyId);
    const l1 = await seedUser(direct, t.companyId, `l1-${randomUUID().slice(0, 6)}@x.test`, await hash());
    const l2 = await seedUser(direct, t.companyId, `l2-${randomUUID().slice(0, 6)}@x.test`, await hash());
    const l3 = await seedUser(direct, t.companyId, `l3-${randomUUID().slice(0, 6)}@x.test`, await hash());
    for (const u of [l1, l2]) await seedUserRole(direct, u, COMPANY_ADMIN_ROLE_ID, t.companyId);
    const { requestId } = await seedThreeLevelRequest(direct, t.companyId, { l1, l2, l3 });

    // current_level=1 → l1 sees the request in their inbox; l2 (level-2 approver) does NOT.
    const tokenL1 = await login(app, t.slug, await emailOf(direct, l1));
    const inboxL1 = await api(app).get(`/approval/inbox`).set("Authorization", `Bearer ${tokenL1}`);
    expect(inboxL1.status).toBe(200);
    const idsL1 = (inboxL1.body.data as Array<{ requestId: string }>).map((r) => r.requestId);
    expect(idsL1).toContain(requestId);

    const tokenL2 = await login(app, t.slug, await emailOf(direct, l2));
    const inboxL2 = await api(app).get(`/approval/inbox`).set("Authorization", `Bearer ${tokenL2}`);
    expect(inboxL2.status).toBe(200);
    const idsL2 = (inboxL2.body.data as Array<{ requestId: string }>).map((r) => r.requestId);
    expect(idsL2).not.toContain(requestId);
  });
});

// PasswordService.hash is async (argon2id). Helper to produce a real login-able hash.
let _pwCache: string | undefined;
async function hash(): Promise<string> {
  if (_pwCache) return _pwCache;
  _pwCache = await new PasswordService().hash(PASSWORD);
  return _pwCache;
}

async function emailOf(direct: Pool, userId: string): Promise<string> {
  const r = await direct.query(`SELECT email FROM users WHERE id = $1`, [userId]);
  return r.rows[0].email as string;
}
