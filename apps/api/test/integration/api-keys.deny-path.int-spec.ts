/**
 * GUARD-PIPELINE REGRESSION — CLEAN-DECOUPLE-1 (Pha B de-media-fy).
 *
 * Bối cảnh: `ApiKeyAuthGuard` (đường PAT `mok_`) ĐÃ ĐƯỢC GỠ khỏi APP_GUARD (api-keys = out-of-scope,
 * module gỡ hẳn ở CLEAN-BE-2). File này từ "AC-5 PAT deny-path" thu về **regression cổng guard** chứng minh:
 *   (A) Đường JWT thường GIỮ NGUYÊN — vẫn auth + qua pipeline 3 guard (JwtAuthGuard→CompanyGuard→2FA).
 *   (B) Đường PAT ĐÓNG — Bearer `mok_<...>` (kể cả key HỢP LỆ, đúng scope+grant) → 401, KHÔNG còn lọt.
 *       (RED-first: trước khi gỡ guard, key hợp lệ trả 200; sau khi gỡ → token không-JWT rơi vào
 *        JwtAuthGuard.verifyAccessToken → ném → 401. Không có đường auth nào hở.)
 *
 * Các case PAT scope/revoke/expiry/cross-tenant/over-grant cũ đã XOÁ cùng việc gỡ guard (feature biến mất).
 * Supertest + Nest app thật → đi qua GLOBAL guard pipeline. skipIf(!hasDb): cần Postgres (verify DB cô lập).
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

/**
 * Seed 1 api_keys row HỢP LỆ DIRECT (bypass RLS). Trả plaintext token `mok_<...>`.
 * Dùng để chứng minh: kể cả PAT hợp lệ (scope+grant đúng) cũng KHÔNG còn auth sau khi gỡ ApiKeyAuthGuard.
 * (api_keys table còn tồn tại tới CLEAN-BE-2; seed direct không phụ thuộc guard.)
 */
async function seedValidApiKey(
  direct: Pool,
  opts: { companyId: string; userId: string; scopePermissionIds: string[] },
): Promise<string> {
  const random = randomUUID().replace(/-/g, "");
  const plaintext = `${API_KEY_TOKEN_PREFIX}${random}`;
  const tokenHash = createHash("sha256").update(plaintext).digest("hex");
  const tokenPrefix = plaintext.slice(0, 12);
  await direct.query(
    `INSERT INTO api_keys
       (company_id, user_id, name, token_prefix, token_hash, scope_permission_ids, expires_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6::uuid[], NULL, NULL)`,
    [opts.companyId, opts.userId, `key-${random.slice(0, 6)}`, tokenPrefix, tokenHash, opts.scopePermissionIds],
  );
  return plaintext;
}

describe.skipIf(!hasDb)("Guard pipeline regression — JWT giữ, PAT (mok_) đã gỡ (CLEAN-DECOUPLE-1)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let readTaskPermId: string;
  /** user A có grant read:task (qua role) — đủ điều kiện nếu PAT path còn sống. */
  let grantedUserA: string;
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
    companyIds.push(A.companyId);

    readTaskPermId = await permId(direct, "read", "task");
    const pw = await new PasswordService().hash(PASSWORD);

    // grantedUserA: role có read:task → user grant tồn tại (PAT hợp lệ vẫn nên bị chặn ở (B)).
    grantedUserA = await seedUser(direct, A.companyId, `pat-granted-${randomUUID().slice(0, 8)}@a.test`, pw);
    const roleWithRead = await seedRole(direct, A.companyId, `pat-role-read-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, roleWithRead, readTaskPermId, "ALLOW");
    await seedUserRole(direct, grantedUserA, roleWithRead, A.companyId);

    // JWT thường của grantedUserA (regression: đường JWT y nguyên).
    const grantedEmail = (await direct.query(`SELECT email FROM users WHERE id=$1`, [grantedUserA]))
      .rows[0].email as string;
    const realLogin = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email: grantedEmail, password: PASSWORD });
    expect(realLogin.status, JSON.stringify(realLogin.body)).toBe(200);
    jwtTokenA = realLogin.body.data.accessToken as string;
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // (A) regression — đường JWT KHÔNG bị ảnh hưởng bởi việc gỡ ApiKeyAuthGuard.
  it("(A) JWT thường (không mok_) vẫn gọi được GET /tasks/board → 200", async () => {
    const res = await api(app).get("/tasks/board").set("Authorization", `Bearer ${jwtTokenA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // (B) PAT đóng — kể cả key HỢP LỆ (scope read:task + user có grant) cũng → 401 sau khi gỡ guard.
  //     RED-first: với ApiKeyAuthGuard còn trong pipeline, key hợp lệ trả 200 → test ĐỎ; sau gỡ → 401 (XANH).
  it("(B) PAT mok_ HỢP LỆ → 401 (đường PAT đã gỡ — hệ quả CÓ CHỦ ĐÍCH, không lọt auth)", async () => {
    const token = await seedValidApiKey(direct, {
      companyId: A.companyId,
      userId: grantedUserA,
      scopePermissionIds: [readTaskPermId],
    });
    const res = await api(app).get("/tasks/board").set("Authorization", `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
