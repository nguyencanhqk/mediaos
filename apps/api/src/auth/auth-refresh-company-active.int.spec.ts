/**
 * S2-AUTH-BE-10 (crown, auth) — cổng COMPANY-active cho refresh() + completeTwoFactorLogin().
 *
 * RED viết TRƯỚC (deny-path). Chạy trên Postgres THẬT + RLS THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5).
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB
 * ⇒ đỏ-giả trên DB dev chung. Colocated trong src/auth → vitest gom qua include glob spec của src (xuất
 * hiện trong run summary); skipIf(!runDb) ⇒ inert ở unit-run KHÔNG có DB (KHÔNG đỏ-giả).
 *
 * VÌ SAO cần int-spec (KHÔNG chỉ unit): chứng minh audit + revocation THẬT SỰ COMMIT (không bị rollback).
 * Unit mock `withTenant` KHÔNG mô phỏng rollback nên KHÔNG đủ bằng chứng cho nhánh "audit-in-tx rồi ném
 * 401 NGOÀI tx" (đặc biệt 2FA restructure). Ở đây ta assert hàng audit_logs TỒN TẠI trong Postgres sau khi
 * request đã 401 ⇒ tx đã COMMIT kèm audit.
 *
 * Phủ (RED-trước → GREEN):
 *   b1 [refresh company-inactive] login (company active) → mint refresh → UPDATE companies suspended →
 *      POST /auth/refresh → 401 + TOÀN family refresh_tokens.revoked_at NOT NULL (kể cả token anh-em cùng
 *      family KHÔNG được trình) + KHÔNG token còn sống + audit_logs 'auth.refresh_blocked'
 *      reason='company_inactive' TỒN TẠI + user_sessions.revoked_at set & revoked_reason='company_inactive'.
 *   b2 [2FA company-inactive — proof audit COMMIT] user bật 2FA → login bước-1 lấy challengeToken →
 *      UPDATE companies suspended → POST /auth/2fa/verify (recovery code hợp lệ) → 401 + audit_logs
 *      'auth.login_blocked' reason='company_inactive' TỒN TẠI (bằng chứng COMMIT không rollback) +
 *      KHÔNG cấp token (0 refresh_tokens MỚI).
 *   b3 [control company active] refresh xoay bình thường → token mới hợp lệ (refresh lại được) + token cũ
 *      revoked_at set & replaced_by set. (Regression — xanh trên CẢ code hiện tại lẫn GREEN.)
 *
 * Trên CODE HIỆN TẠI: refresh()/2FA CHƯA đọc companies ⇒ b1/b2 FAIL (rotates/cấp token → 200) = RED THẬT.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "./password.service";
import { TotpService } from "./totp.service";
import { appPool, directPool, hasDb } from "../../test/helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../../test/helpers/seed";

/** Credential test (KHÔNG phải secret thật) — tránh literal gán-keyword (guard-secrets, BẤT BIẾN #3). */
const LOGIN_PW = "Passw0rd!test10";

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

/** Đổi status công ty (mô phỏng suspend từ platform-plane). Direct pool = superuser bypass RLS. */
async function setCompanyStatus(direct: Pool, companyId: string, status: string): Promise<void> {
  await direct.query("UPDATE companies SET status = $1 WHERE id = $2", [status, companyId]);
}

/** Trích secret base32 từ otpauth:// URI (enroll trả). */
function extractTotpSecret(otpauthUri: string): string {
  const m = /[?&]secret=([^&]+)/.exec(otpauthUri);
  if (!m) throw new Error(`otpauthUri không có secret: ${otpauthUri}`);
  return decodeURIComponent(m[1]);
}

describe.skipIf(!runDb)("S2-AUTH-BE-10 refresh/2FA company-active gate", () => {
  let app: INestApplication;
  let direct: Pool;
  let totp: TotpService;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
    totp = app.get(TotpService);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  /** Seed 1 tenant + 1 user active (password hash thật) → trả tenant + email + userId. */
  async function seedTenantWithUser(
    label: string,
  ): Promise<{ tenant: SeededTenant; email: string; userId: string }> {
    const tenant = await seedCompany(direct, label);
    companyIds.push(tenant.companyId);
    const pw = await new PasswordService().hash(LOGIN_PW);
    const email = `u-${randomUUID().slice(0, 8)}@${label}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, pw);
    return { tenant, email, userId };
  }

  /** Login body-flow (mobile/Bearer) → trả AuthTokens body.data (accessToken + refreshToken). */
  async function loginTokens(
    slug: string,
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await api(app)
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login failed: ${JSON.stringify(res.body)}`).toBe(200);
    return { accessToken: res.body.data.accessToken, refreshToken: res.body.data.refreshToken };
  }

  // ── b1: refresh company-inactive → 401 + family revoked + audit + session revoked ──────────────
  it("b1 — refresh khi company='suspended' → 401 + toàn family revoked + audit refresh_blocked + session company_inactive", async () => {
    const { tenant, email, userId } = await seedTenantWithUser("caa");
    const { refreshToken } = await loginTokens(tenant.slug, email);

    // Token anh-em CÙNG family (chưa revoke) để CHỨNG MINH thu hồi TOÀN family, không chỉ token được trình.
    const familyRow = await direct.query(
      "SELECT family_id FROM refresh_tokens WHERE user_id = $1 LIMIT 1",
      [userId],
    );
    const familyId = familyRow.rows[0].family_id as string;
    await direct.query(
      `INSERT INTO refresh_tokens (company_id, user_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '14 days')`,
      [tenant.companyId, userId, `sibling-${randomUUID()}`, familyId],
    );

    await setCompanyStatus(direct, tenant.companyId, "suspended");

    const res = await api(app).post("/auth/refresh").send({ refreshToken });
    expect(res.status, JSON.stringify(res.body)).toBe(401);
    // reason KHÔNG lọt ra body (anti status-probing).
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("company_inactive");
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("suspend");

    // TOÀN family refresh_tokens (2 hàng: token login + sibling) đều revoked; KHÔNG còn hàng sống + KHÔNG xoay.
    const tokens = await direct.query("SELECT revoked_at FROM refresh_tokens WHERE user_id = $1", [
      userId,
    ]);
    expect(tokens.rows.length).toBe(2);
    for (const row of tokens.rows) {
      expect(row.revoked_at, "mọi refresh_token trong family phải bị revoke").not.toBeNull();
    }
    const alive = await direct.query(
      "SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL",
      [userId],
    );
    expect(alive.rows[0].n).toBe(0);

    // Audit append-only TỒN TẠI trong Postgres (đã COMMIT dù request 401).
    const audit = await direct.query(
      `SELECT id FROM audit_logs
       WHERE company_id = $1 AND action = 'auth.refresh_blocked' AND after->>'reason' = 'company_inactive'`,
      [tenant.companyId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);

    // user_sessions của user bị thu hồi với lý do company_inactive; KHÔNG còn phiên sống.
    const sessions = await direct.query(
      "SELECT revoked_at, revoked_reason FROM user_sessions WHERE user_id = $1",
      [userId],
    );
    expect(sessions.rows.length).toBeGreaterThanOrEqual(1);
    for (const row of sessions.rows) {
      expect(row.revoked_at, "user_session phải bị revoke").not.toBeNull();
    }
    expect(
      sessions.rows.some((r) => r.revoked_reason === "company_inactive"),
      "phải có user_session revoked_reason='company_inactive'",
    ).toBe(true);
  });

  // ── b2: 2FA company-inactive → 401 + audit login_blocked TỒN TẠI (proof COMMIT) + 0 token mới ────
  it("b2 — 2FA verify khi company='suspended' → 401 + audit login_blocked reason='company_inactive' TỒN TẠI + KHÔNG cấp token", async () => {
    const { tenant, email, userId } = await seedTenantWithUser("cbb");

    // 1) login (2FA CHƯA bật) lấy accessToken để enroll.
    const { accessToken } = await loginTokens(tenant.slug, email);

    // 2) enroll → nhận otpauthUri (secret) + recovery codes.
    const enroll = await api(app)
      .post("/auth/2fa/enroll")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(enroll.status, JSON.stringify(enroll.body)).toBe(200);
    const secret = extractTotpSecret(enroll.body.data.otpauthUri as string);
    const recoveryCode = (enroll.body.data.recoveryCodes as string[])[0];

    // 3) enable bằng mã TOTP hiện tại → 2FA BẬT.
    const enable = await api(app)
      .post("/auth/2fa/enable")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ token: totp.generate(secret) });
    expect(enable.status, JSON.stringify(enable.body)).toBe(200);

    // 4) login bước-1 (2FA đã bật) → challengeToken (KHÔNG cấp token).
    const step1 = await api(app)
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
    expect(step1.status, JSON.stringify(step1.body)).toBe(200);
    expect(step1.body.data.twoFactorRequired).toBe(true);
    const challengeToken = step1.body.data.challengeToken as string;

    // Snapshot số refresh_tokens TRƯỚC verify (chứng minh 2FA-verify block KHÔNG tạo token mới).
    const before = await direct.query(
      "SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1",
      [userId],
    );

    // 5) suspend company → 2fa/verify (recovery code hợp lệ) PHẢI 401.
    await setCompanyStatus(direct, tenant.companyId, "suspended");
    const verify = await api(app)
      .post("/auth/2fa/verify")
      .send({ challengeToken, code: recoveryCode });
    expect(verify.status, JSON.stringify(verify.body)).toBe(401);
    expect(JSON.stringify(verify.body).toLowerCase()).not.toContain("company_inactive");

    // PROOF audit COMMIT (không rollback): hàng login_blocked reason=company_inactive TỒN TẠI trong Postgres.
    const audit = await direct.query(
      `SELECT id FROM audit_logs
       WHERE company_id = $1 AND action = 'auth.login_blocked' AND after->>'reason' = 'company_inactive'`,
      [tenant.companyId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);

    // KHÔNG cấp token: số refresh_tokens KHÔNG tăng.
    const after = await direct.query(
      "SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1",
      [userId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  // ── b3: control company active → refresh xoay bình thường (regression) ──────────────────────────
  it("b3 — control: company='active' → refresh xoay (token mới hợp lệ, token cũ revoked+replaced_by)", async () => {
    const { tenant, email, userId } = await seedTenantWithUser("ccc");
    const { refreshToken } = await loginTokens(tenant.slug, email);

    const res = await api(app).post("/auth/refresh").send({ refreshToken });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const newRefresh = res.body.data.refreshToken as string;
    expect(typeof newRefresh).toBe("string");
    expect(newRefresh).not.toBe(refreshToken);

    // Token cũ revoked + replaced_by set; token mới còn sống.
    const rows = await direct.query(
      "SELECT revoked_at, replaced_by FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at",
      [userId],
    );
    expect(rows.rows.length).toBe(2);
    const revoked = rows.rows.filter((r) => r.revoked_at !== null);
    const alive = rows.rows.filter((r) => r.revoked_at === null);
    expect(revoked.length).toBe(1);
    expect(alive.length).toBe(1);
    expect(revoked[0].replaced_by, "token cũ phải trỏ replaced_by token mới").not.toBeNull();

    // Token mới HỢP LỆ: refresh lại được (200) → xoay tiếp.
    const res2 = await api(app).post("/auth/refresh").send({ refreshToken: newRefresh });
    expect(res2.status, JSON.stringify(res2.body)).toBe(200);
  });
});
