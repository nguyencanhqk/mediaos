/**
 * S2-AUTH-BE-12 — HTTP int-spec (RED-trước): admin reset 2FA của user khác + cờ ép 2FA per-user.
 *
 * Routes MỚI (prefix /auth/users, gate PermissionGuard per-resource):
 *   POST /auth/users/:id/2fa/reset  — reset:  @RequirePermission('reset-2fa','user',{isSensitive:true})
 *   PATCH /auth/users/:id           — update: nhận thêm requireTwoFactor (mig 0466) — gate update:user (đã có)
 *   GET   /auth/users/:id           — getOne: trả AuthUserDetailDto.twoFactor{enabled,requiredByRole,requiredByUser}
 *
 * Cases (gate hasDb && LANE_DB — chỉ chạy trên DB lane CÔ LẬP có mig 0466; thiếu LANE_DB → SKIP để KHÔNG
 *  chạm DB dev chung 'mediaos' (.env → hasDb=true → đỏ-giả) — CLAUDE.md §9.5, memory integration-test-lane-db-gate):
 *   (a) deny  — user thiếu grant reset-2fa:user → POST reset 403 + user_totp/user_recovery_codes/user_sessions
 *               bất biến + 0 audit user.2fa_reset.
 *   (b) rls   — cross-tenant (admin A → target B) → 404 no-op + 0 audit + user_totp B nguyên vẹn.
 *   (c) happy — reset thành công (company-admin, grant Company) → user_totp+user_recovery_codes rỗng + refresh
 *               token CŨ → /auth/refresh 401 + user_sessions revoked + audit user.2fa_reset (revoked_session_count,
 *               KHÔNG secret) + user_security_events TOTP_RESET.
 *   (d) patch — PATCH requireTwoFactor=true → users.require_two_factor=true + GET detail twoFactor.requiredByUser=true
 *               + audit user.updated diff cờ (before=false/after=true). twoFactor 3 nguồn TÁCH BIỆT.
 *   (e) noop  — PATCH body rỗng {} HOẶC requireTwoFactor==giá trị cũ → 200 nhưng 0 audit MỚI (no-op).
 *   (f) self  — self-reset (actor==target, company-admin role ép 2FA) CHO PHÉP → 200 + me().mustSetupTwoFactor=true;
 *               + cross-tenant NGƯỢC (admin B → target A) → 404 (cô lập 2 chiều).
 *
 * BẤT BIẾN #3: DTO detail KHÔNG chứa secret TOTP (secret_ciphertext/encrypted_dek/iv_nonce/auth_tag).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
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
  seedRole,
  seedTwoFactorEnabled,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001"; // grant reset-2fa:user (mig 0466) + requires_two_factor (mig 0120)
const PASSWORD = ["Passw0rd", "Reset2fa", "88"].join("");

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function emailOf(direct: Pool, userId: string): Promise<string> {
  const r = await direct.query(`SELECT email FROM users WHERE id = $1`, [userId]);
  return r.rows[0].email as string;
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

/** Login THẬT trả cả access + refresh (dual-write refresh_tokens + user_sessions). Gọi TRƯỚC khi bật 2FA. */
async function loginFull(
  app: INestApplication,
  slug: string,
  email: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return {
    accessToken: res.body.data.accessToken as string,
    refreshToken: res.body.data.refreshToken as string,
  };
}

/** Seed n mã khôi phục (chỉ hash — KHÔNG plaintext) cho user (mirror enroll). */
async function seedRecoveryCodes(
  direct: Pool,
  companyId: string,
  userId: string,
  n = 3,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await direct.query(
      `INSERT INTO user_recovery_codes (company_id, user_id, code_hash) VALUES ($1, $2, $3)`,
      [companyId, userId, `seed-hash-${i}-${randomUUID()}`],
    );
  }
}

async function countTotp(direct: Pool, userId: string): Promise<number> {
  const r = await direct.query(`SELECT count(*)::int AS n FROM user_totp WHERE user_id = $1`, [
    userId,
  ]);
  return r.rows[0].n as number;
}

async function countRecoveryCodes(direct: Pool, userId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM user_recovery_codes WHERE user_id = $1`,
    [userId],
  );
  return r.rows[0].n as number;
}

async function countActiveSessions(direct: Pool, userId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return r.rows[0].n as number;
}

/** Số audit_logs cho 1 objectId với action cụ thể (object_type='user'). */
async function countAuditAction(direct: Pool, objectId: string, action: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM audit_logs WHERE object_type='user' AND object_id=$1 AND action=$2`,
    [objectId, action],
  );
  return r.rows[0].n as number;
}

async function latestAuditAfter(
  direct: Pool,
  objectId: string,
  action: string,
): Promise<Record<string, unknown> | null> {
  const r = await direct.query(
    `SELECT after FROM audit_logs WHERE object_type='user' AND object_id=$1 AND action=$2 ORDER BY created_at DESC LIMIT 1`,
    [objectId, action],
  );
  return (r.rows[0]?.after as Record<string, unknown> | undefined) ?? null;
}

async function latestUserUpdatedDiff(
  direct: Pool,
  objectId: string,
): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> } | null> {
  const r = await direct.query(
    `SELECT before, after FROM audit_logs WHERE object_type='user' AND object_id=$1 AND action='user.updated' ORDER BY created_at DESC LIMIT 1`,
    [objectId],
  );
  if (!r.rows[0]) return null;
  return {
    before: (r.rows[0].before as Record<string, unknown>) ?? {},
    after: (r.rows[0].after as Record<string, unknown>) ?? {},
  };
}

async function countSecurityEvents(
  direct: Pool,
  userId: string,
  eventType: string,
): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM user_security_events WHERE user_id = $1 AND event_type = $2`,
    [userId, eventType],
  );
  return r.rows[0].n as number;
}

// Gate hasDb && LANE_DB: thiếu DB lane cô lập → SKIP (KHÔNG chạm 'mediaos' dev chung). CLAUDE.md §9.5.
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S2-AUTH-BE-12 /auth/users 2FA reset + require-2fa flag", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let noPermToken: string;
  let adminToken: string;
  let adminId: string;
  let adminBToken: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "rst2fa");
    B = await seedCompany(direct, "rst2fb");
    companyIds.push(A.companyId, B.companyId);
    const pw = await hashedPw();

    // admin A: company-admin (role 0001) → grant reset-2fa:user Company (mig 0466) + view/update:user.
    adminId = await seedUser(direct, A.companyId, `r-adm-${randomUUID().slice(0, 8)}@a.test`, pw);
    await seedUserRole(direct, adminId, COMPANY_ADMIN_ROLE_ID, A.companyId);
    adminToken = await login(app, A.slug, await emailOf(direct, adminId));

    // admin B (tenant B): company-admin → chứng minh cô lập NGƯỢC chiều (B → target A) = 404.
    const adminBId = await seedUser(
      direct,
      B.companyId,
      `r-admB-${randomUUID().slice(0, 8)}@b.test`,
      pw,
    );
    await seedUserRole(direct, adminBId, COMPANY_ADMIN_ROLE_ID, B.companyId);
    adminBToken = await login(app, B.slug, await emailOf(direct, adminBId));

    // noPerm A: role rỗng → KHÔNG có reset-2fa:user.
    const noPermId = await seedUser(
      direct,
      A.companyId,
      `r-np-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    const emptyRole = await seedRole(direct, A.companyId, `r-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noPermId, emptyRole, A.companyId);
    noPermToken = await login(app, A.slug, await emailOf(direct, noPermId));
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── (a) deny — thiếu grant reset-2fa:user → 403 + 0 thay đổi + 0 audit ──────────
  it("(a) deny — user thiếu grant reset-2fa:user → 403 + user_totp/recovery/sessions bất biến + 0 audit", async () => {
    const email = `r-denyv-${randomUUID().slice(0, 8)}@a.test`;
    const victim = await seedUser(direct, A.companyId, email, await hashedPw());
    await loginFull(app, A.slug, email); // 1 phiên active TRƯỚC khi bật 2FA
    await seedTwoFactorEnabled(direct, A.companyId, victim);
    await seedRecoveryCodes(direct, A.companyId, victim, 3);

    const res = await api(app)
      .post(`/auth/users/${victim}/2fa/reset`)
      .set("Authorization", `Bearer ${noPermToken}`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(403);

    // Không có gì bị chạm.
    expect(await countTotp(direct, victim)).toBe(1);
    expect(await countRecoveryCodes(direct, victim)).toBe(3);
    expect(await countActiveSessions(direct, victim)).toBe(1);
    expect(await countAuditAction(direct, victim, "user.2fa_reset")).toBe(0);
    expect(await countSecurityEvents(direct, victim, "TOTP_RESET")).toBe(0);
  });

  // ── (b) rls — cross-tenant admin A → target B → 404 no-op ──────────────────────
  it("(b) rls — admin A reset target tenant B → 404 + user_totp B nguyên vẹn + 0 audit", async () => {
    const victimB = await seedUser(
      direct,
      B.companyId,
      `r-b-${randomUUID().slice(0, 8)}@b.test`,
      await hashedPw(),
    );
    await seedTwoFactorEnabled(direct, B.companyId, victimB);
    await seedRecoveryCodes(direct, B.companyId, victimB, 2);

    const res = await api(app)
      .post(`/auth/users/${victimB}/2fa/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(404);

    expect(await countTotp(direct, victimB)).toBe(1);
    expect(await countRecoveryCodes(direct, victimB)).toBe(2);
    expect(await countAuditAction(direct, victimB, "user.2fa_reset")).toBe(0);
    expect(await countSecurityEvents(direct, victimB, "TOTP_RESET")).toBe(0);
  });

  // ── (c) happy — reset thành công (company-admin grant Company) ──────────────────
  it("(c) happy — reset → totp+recovery rỗng + refresh cũ 401 + sessions revoked + audit + TOTP_RESET", async () => {
    const email = `r-hv-${randomUUID().slice(0, 8)}@a.test`;
    const victim = await seedUser(direct, A.companyId, email, await hashedPw());
    // 2 phiên THẬT TRƯỚC khi bật 2FA (login trả tokens vì chưa enroll).
    const s1 = await loginFull(app, A.slug, email);
    await loginFull(app, A.slug, email);
    expect(await countActiveSessions(direct, victim)).toBe(2);
    // Bật 2FA (enrolled + enabled) + recovery codes.
    await seedTwoFactorEnabled(direct, A.companyId, victim);
    await seedRecoveryCodes(direct, A.companyId, victim, 4);
    expect(await countTotp(direct, victim)).toBe(1);
    expect(await countRecoveryCodes(direct, victim)).toBe(4);

    const res = await api(app)
      .post(`/auth/users/${victim}/2fa/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.revokedSessionCount).toBe(2);

    // 2FA rows xoá sạch.
    expect(await countTotp(direct, victim)).toBe(0);
    expect(await countRecoveryCodes(direct, victim)).toBe(0);
    // Phiên bị thu hồi.
    expect(await countActiveSessions(direct, victim)).toBe(0);
    // Refresh token CŨ trình lại → 401 NGAY.
    const refreshed = await api(app).post("/auth/refresh").send({ refreshToken: s1.refreshToken });
    expect(refreshed.status).toBe(401);
    // Audit user.2fa_reset kèm revoked_session_count (KHÔNG secret).
    const after = await latestAuditAfter(direct, victim, "user.2fa_reset");
    expect(after?.revokedSessionCount).toBe(2);
    const auditJson = JSON.stringify(after);
    expect(auditJson).not.toContain("secret_ciphertext");
    expect(auditJson).not.toContain("encrypted_dek");
    expect(auditJson).not.toContain("iv_nonce");
    // 1 security-event TOTP_RESET.
    expect(await countSecurityEvents(direct, victim, "TOTP_RESET")).toBe(1);
  });

  // ── (d) patch — requireTwoFactor=true → detail.requiredByUser=true + audit diff ─
  it("(d) patch — PATCH requireTwoFactor=true → GET detail twoFactor.requiredByUser=true + audit user.updated diff cờ", async () => {
    const email = `r-pv-${randomUUID().slice(0, 8)}@a.test`;
    const victim = await seedUser(direct, A.companyId, email, await hashedPw());

    const patch = await api(app)
      .patch(`/auth/users/${victim}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ requireTwoFactor: true });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    // DB cột set.
    const dbRow = await direct.query(`SELECT require_two_factor FROM users WHERE id=$1`, [victim]);
    expect(dbRow.rows[0].require_two_factor).toBe(true);

    // GET detail → twoFactor 3 nguồn TÁCH BIỆT: requiredByUser=true; requiredByRole=false (plain user);
    // enabled=false (chưa enroll). KHÔNG secret trong response.
    const detail = await api(app)
      .get(`/auth/users/${victim}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.twoFactor).toEqual({
      enabled: false,
      requiredByRole: false,
      requiredByUser: true,
    });
    const detailJson = JSON.stringify(detail.body.data);
    expect(detailJson).not.toContain("secret_ciphertext");
    expect(detailJson).not.toContain("passwordHash");

    // Audit user.updated diff cờ.
    const diff = await latestUserUpdatedDiff(direct, victim);
    expect(diff?.before.requireTwoFactor).toBe(false);
    expect(diff?.after.requireTwoFactor).toBe(true);
  });

  // ── (e) noop — PATCH không đổi field → 0 audit MỚI ─────────────────────────────
  it("(e) noop — PATCH body rỗng {} và requireTwoFactor==giá trị cũ → 200 + 0 audit user.updated MỚI", async () => {
    const email = `r-nv-${randomUUID().slice(0, 8)}@a.test`;
    const victim = await seedUser(direct, A.companyId, email, await hashedPw());

    // (i) body rỗng → no-op.
    const before0 = await countAuditAction(direct, victim, "user.updated");
    const empty = await api(app)
      .patch(`/auth/users/${victim}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(empty.status).toBe(200);
    expect(await countAuditAction(direct, victim, "user.updated")).toBe(before0);

    // (ii) requireTwoFactor==giá trị cũ (mặc định false) → no-op.
    const same = await api(app)
      .patch(`/auth/users/${victim}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ requireTwoFactor: false });
    expect(same.status).toBe(200);
    expect(await countAuditAction(direct, victim, "user.updated")).toBe(before0);
  });

  // ── (f) self + cross-tenant ngược ──────────────────────────────────────────────
  it("(f) self-reset (company-admin role ép 2FA) CHO PHÉP → 200 + me().mustSetupTwoFactor=true", async () => {
    // admin có company-admin role (requires_two_factor=true) — enroll 2FA rồi tự reset.
    await seedTwoFactorEnabled(direct, A.companyId, adminId);
    await seedRecoveryCodes(direct, A.companyId, adminId, 2);

    const res = await api(app)
      .post(`/auth/users/${adminId}/2fa/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await countTotp(direct, adminId)).toBe(0);
    expect(await countRecoveryCodes(direct, adminId)).toBe(0);
    expect(await countSecurityEvents(direct, adminId, "TOTP_RESET")).toBe(1);

    // Access token stateless còn hiệu lực → me() đọc DB: role ép 2FA + không còn enabled → mustSetupTwoFactor=true.
    const me = await api(app).get("/auth/me").set("Authorization", `Bearer ${adminToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.mustSetupTwoFactor).toBe(true);
  });

  it("(f2) cross-tenant NGƯỢC — admin B reset target A → 404 (cô lập 2 chiều)", async () => {
    const email = `r-av-${randomUUID().slice(0, 8)}@a.test`;
    const victimA = await seedUser(direct, A.companyId, email, await hashedPw());
    await seedTwoFactorEnabled(direct, A.companyId, victimA);

    const res = await api(app)
      .post(`/auth/users/${victimA}/2fa/reset`)
      .set("Authorization", `Bearer ${adminBToken}`)
      .send({});
    expect(res.status).toBe(404);
    expect(await countTotp(direct, victimA)).toBe(1);
    expect(await countAuditAction(direct, victimA, "user.2fa_reset")).toBe(0);
  });
});
