/**
 * AC-5 — PAT (Personal Access Token) HTTP deny-path on a NON-ADMIN route (GET /tasks/board, gate read:task).
 * Supertest + Nest app thật → đi qua GLOBAL guard pipeline (ApiKeyAuthGuard → JwtAuthGuard → CompanyGuard →
 * 2FA → SaaS → PermissionGuard). RED-first: ApiKeyAuthGuard/api_keys chưa tồn tại tới khi AC-5 GREEN.
 *
 * 6 chốt fail-closed (rủi ro #1–#4 micro-plan):
 *  (1) in-scope + user-grant → 200 (PAT gọi được route trong scope).
 *  (2) out-of-scope (key scope thiếu read:task) → 403 (deny-out-of-scope).
 *  (3) sau revoke (revoked_at set) → 401 (key bị thu hồi không auth được).
 *  (4) sau expiry (expires_at quá khứ) → 401.
 *  (5) cross-tenant: PAT của tenant A KHÔNG đọc data tenant B (RLS scope theo company_id của KEY).
 *  (6) PAT KHÔNG vượt grant user: key scope CÓ read:task nhưng USER thiếu grant → 403.
 *
 * Pass-through: token JWT thường (không mok_) vẫn auth bình thường (regression — đường JWT y nguyên).
 */

import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_KEY_TOKEN_PREFIX } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const PASSWORD = "Passw0rd!test99";

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function permId(direct: Pool, action: string, resourceType: string): Promise<string> {
  const r = await direct.query(
    `SELECT id FROM permissions WHERE action = $1 AND resource_type = $2 LIMIT 1`,
    [action, resourceType],
  );
  return r.rows[0].id as string;
}

/** Seed 1 api_keys row DIRECT (bypass RLS). Trả plaintext token (mok_<...>) để gọi qua header. */
async function seedApiKey(
  direct: Pool,
  opts: {
    companyId: string;
    userId: string;
    scopePermissionIds: string[];
    expiresAt?: Date | null;
    revokedAt?: Date | null;
  },
): Promise<string> {
  const random = randomUUID().replace(/-/g, "");
  const plaintext = `${API_KEY_TOKEN_PREFIX}${random}`;
  const tokenHash = createHash("sha256").update(plaintext).digest("hex");
  const tokenPrefix = plaintext.slice(0, 12);
  await direct.query(
    `INSERT INTO api_keys
       (company_id, user_id, name, token_prefix, token_hash, scope_permission_ids, expires_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7, $8)`,
    [
      opts.companyId,
      opts.userId,
      `key-${random.slice(0, 6)}`,
      tokenPrefix,
      tokenHash,
      opts.scopePermissionIds,
      opts.expiresAt ?? null,
      opts.revokedAt ?? null,
    ],
  );
  return plaintext;
}

/** Seed 1 office task DIRECT để board có dữ liệu xác minh RLS scope. */
async function seedTask(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
     VALUES ($1, 'office', $2, 'not_started', 'initial', 0) RETURNING id`,
    [companyId, `pat-task-${randomUUID().slice(0, 8)}`],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!hasDb)("AC-5 PAT deny-path on non-admin route (GET /tasks/board)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let readTaskPermId: string;
  let readNotificationPermId: string;
  /** user A có grant read:task (qua role). */
  let grantedUserA: string;
  /** user A KHÔNG có grant read:task (role rỗng). */
  let noGrantUserA: string;
  let jwtTokenA: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "patA");
    B = await seedCompany(direct, "patB");
    companyIds.push(A.companyId, B.companyId);

    readTaskPermId = await permId(direct, "read", "task");
    readNotificationPermId = await permId(direct, "read", "notification");

    const pw = await new PasswordService().hash(PASSWORD);

    // grantedUserA: role có read:task → user grant tồn tại.
    grantedUserA = await seedUser(
      direct,
      A.companyId,
      `pat-granted-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    const roleWithRead = await seedRole(
      direct,
      A.companyId,
      `pat-role-read-${randomUUID().slice(0, 8)}`,
    );
    await seedRolePermission(direct, roleWithRead, readTaskPermId, "ALLOW");
    await seedUserRole(direct, grantedUserA, roleWithRead, A.companyId);

    // noGrantUserA: role rỗng → KHÔNG có read:task grant.
    noGrantUserA = await seedUser(
      direct,
      A.companyId,
      `pat-nogrant-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    const emptyRole = await seedRole(
      direct,
      A.companyId,
      `pat-role-empty-${randomUUID().slice(0, 8)}`,
    );
    await seedUserRole(direct, noGrantUserA, emptyRole, A.companyId);

    // JWT thường của grantedUserA (regression: đường JWT y nguyên).
    const login = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email: `pat-granted`, password: PASSWORD });
    // login bằng email thật:
    const grantedEmail = (await direct.query(`SELECT email FROM users WHERE id=$1`, [grantedUserA]))
      .rows[0].email as string;
    const realLogin = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email: grantedEmail, password: PASSWORD });
    expect(realLogin.status, JSON.stringify(realLogin.body)).toBe(200);
    void login;
    jwtTokenA = realLogin.body.data.accessToken as string;

    await seedTask(direct, A.companyId);
    await seedTask(direct, B.companyId);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // (regression) JWT thường vẫn auth bình thường — đường JWT KHÔNG bị ApiKeyAuthGuard nuốt.
  it("JWT thường (không mok_) vẫn gọi được GET /tasks/board → 200", async () => {
    const res = await api(app).get("/tasks/board").set("Authorization", `Bearer ${jwtTokenA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // (1) in-scope + user-grant → 200.
  it("(1) PAT scope read:task + user có grant → 200", async () => {
    const token = await seedApiKey(direct, {
      companyId: A.companyId,
      userId: grantedUserA,
      scopePermissionIds: [readTaskPermId],
    });
    const res = await api(app).get("/tasks/board").set("Authorization", `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // (2) out-of-scope → 403.
  it("(2) PAT scope thiếu read:task (chỉ read:notification) → 403 deny-out-of-scope", async () => {
    const token = await seedApiKey(direct, {
      companyId: A.companyId,
      userId: grantedUserA,
      scopePermissionIds: [readNotificationPermId],
    });
    const res = await api(app).get("/tasks/board").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // (3) revoked → 401.
  it("(3) PAT đã revoke → 401", async () => {
    const token = await seedApiKey(direct, {
      companyId: A.companyId,
      userId: grantedUserA,
      scopePermissionIds: [readTaskPermId],
      revokedAt: new Date(Date.now() - 1000),
    });
    const res = await api(app).get("/tasks/board").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // (4) expired → 401.
  it("(4) PAT hết hạn → 401", async () => {
    const token = await seedApiKey(direct, {
      companyId: A.companyId,
      userId: grantedUserA,
      scopePermissionIds: [readTaskPermId],
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await api(app).get("/tasks/board").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // (5) cross-tenant: PAT của A không thấy data B (RLS scope theo company_id của KEY).
  it("(5) PAT của tenant A KHÔNG thấy task của tenant B (RLS theo company_id của key)", async () => {
    const token = await seedApiKey(direct, {
      companyId: A.companyId,
      userId: grantedUserA,
      scopePermissionIds: [readTaskPermId],
    });
    const res = await api(app).get("/tasks/board").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ companyId?: string }>;
    // Mọi row trả về thuộc tenant A (không có row B). board trả task của company hiện tại (RLS=A).
    const bTaskCount = await direct.query(
      `SELECT count(*)::int AS n FROM tasks WHERE company_id = $1`,
      [B.companyId],
    );
    expect(bTaskCount.rows[0].n).toBeGreaterThan(0); // B có task
    // Không thể khẳng định shape companyId trong DTO, nên xác minh gián tiếp: total ≤ số task của A.
    const aTaskCount = await direct.query(
      `SELECT count(*)::int AS n FROM tasks WHERE company_id = $1`,
      [A.companyId],
    );
    expect(rows.length).toBeLessThanOrEqual(aTaskCount.rows[0].n as number);
  });

  // (6) PAT không vượt grant user: key scope có read:task nhưng USER thiếu grant → 403.
  it("(6) PAT scope read:task nhưng USER thiếu grant read:task → 403 (không vượt quyền user)", async () => {
    const token = await seedApiKey(direct, {
      companyId: A.companyId,
      userId: noGrantUserA,
      scopePermissionIds: [readTaskPermId],
    });
    const res = await api(app).get("/tasks/board").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
