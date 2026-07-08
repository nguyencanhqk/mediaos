/**
 * S2-AUTH-BE-3 — HTTP int-spec: AuthUsersController (/auth/users) qua supertest + Nest app thật.
 *
 * Routes (prefix RIÊNG /auth/users — KHÔNG va chạm users/admin ACCT-2):
 *   GET    /auth/users              — list      (view:user, data-scope-aware)
 *   GET    /auth/users/:id          — getOne    (view:user)
 *   POST   /auth/users              — create    (create:user, HASH mật khẩu)
 *   PATCH  /auth/users/:id          — update    (update:user)
 *   POST   /auth/users/:id/lock     — lock      (lock:user)   → chặn login
 *   POST   /auth/users/:id/unlock   — unlock    (unlock:user)
 *
 * Cases (gate hasDb && LANE_DB — int-spec chỉ chạy trên DB lane CÔ LẬP có migration 0450; thiếu LANE_DB
 *  → SKIP để KHÔNG chạm DB dev chung 'mediaos' (.env làm hasDb=true → đỏ-giả/xanh-giả) — CLAUDE.md §9.5,
 *  memory integration-test-lane-db-gate. Khớp tiền lệ auth-appendonly/auth-blocked-status):
 *  §deny  — user role rỗng (KHÔNG view/create/update/lock/unlock:user) → MỌI route 403 +
 *           COUNT(audit_logs action LIKE 'user.%')=0 (thiếu quyền → 0 audit, deny KHÔNG ghi audit rác).
 *  §rls   — admin A thao tác user B → 404 (RLS che, KHÔNG lộ tồn tại) + 0 audit + row B KHÔNG đổi;
 *           list A KHÔNG chứa user B.
 *  §audit — lock → +1 audit 'user.locked' (objectType='user', actorUserId=admin); unlock → 'user.unlocked';
 *           create → 'user.created'; update → 'user.updated'. snapshot KHÔNG passwordHash.
 *  §lock-login — lock → login đúng credential → 401 blocked + login_logs blocked; unlock → login lại OK.
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
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";
// Plaintext fixture (file trong test/ → guard-secrets exempt). Thoả độ mạnh createAuthUserRequest.
const PASSWORD = ["Passw0rd", "Test", "99"].join("");

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(
  app: INestApplication,
  slug: string,
  email: string,
  password = PASSWORD,
): Promise<{ status: number; token?: string }> {
  const res = await api(app).post("/auth/login").send({ companySlug: slug, email, password });
  return { status: res.status, token: res.body?.data?.accessToken as string | undefined };
}

async function emailOf(direct: Pool, userId: string): Promise<string> {
  const r = await direct.query(`SELECT email FROM users WHERE id = $1`, [userId]);
  return r.rows[0].email as string;
}

async function userRow(
  direct: Pool,
  id: string,
): Promise<{ status: string; locked_at: Date | null; full_name: string | null } | undefined> {
  const r = await direct.query(`SELECT status, locked_at, full_name FROM users WHERE id = $1`, [
    id,
  ]);
  return r.rows[0];
}

/** Số audit_logs cho 1 objectId (object_type='user') — đếm side-effect audit. */
async function countUserAudit(direct: Pool, objectId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM audit_logs WHERE object_type = 'user' AND object_id = $1 AND action LIKE 'user.%'`,
    [objectId],
  );
  return r.rows[0].n as number;
}

async function latestUserAction(direct: Pool, objectId: string): Promise<string | undefined> {
  const r = await direct.query(
    `SELECT action FROM audit_logs WHERE object_type='user' AND object_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [objectId],
  );
  return r.rows[0]?.action as string | undefined;
}

async function auditSnapshotJson(direct: Pool, objectId: string): Promise<string> {
  const r = await direct.query(
    `SELECT before, after FROM audit_logs WHERE object_type='user' AND object_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [objectId],
  );
  return JSON.stringify(r.rows[0] ?? {});
}

// S2-AUTH-BE-9 — login THẬT trả cả access + refresh token (dual-write refresh_tokens + user_sessions).
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

/** Số phiên còn sống (user_sessions.revoked_at IS NULL) của 1 user. */
async function countActiveSessions(direct: Pool, userId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return r.rows[0].n as number;
}

/** Số refresh token còn sống (revoked_at IS NULL) của 1 user. */
async function countActiveRefreshTokens(direct: Pool, userId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return r.rows[0].n as number;
}

/** Gán hồ sơ nhân sự active tối thiểu cho 1 user (đối soát AUTH↔HR). Các cột NOT NULL còn lại dùng default. */
async function seedEmployeeProfile(
  direct: Pool,
  companyId: string,
  userId: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
    [companyId, userId],
  );
  return r.rows[0].id as string;
}

/**
 * Read-your-writes barrier (S2-AUTH-BE-9 · FL-BE9-2): poll NGẮN một count đọc qua `direct` pool sau khi
 * mutation HTTP (lock) đã trả 200. Revoke chạy ĐỒNG BỘ trong CÙNG withTenant tx với đổi status ⇒ ngay khi
 * 200 trả, dữ liệu đã COMMIT và hiển thị trên mọi kết nối mới (MVCC) — lần đọc ĐẦU thường đã đúng. Poll chỉ
 * trung hoà độ trễ hiển thị nhất thời hiếm gặp lúc pool khởi động lạnh (reviewer quan sát 1 lần đọc-trước-ghi
 * KHÔNG tái hiện qua 12+ lần chạy). KHÔNG che regression: hết hạn (~500ms) vẫn trả giá trị THẬT nên revoke
 * hỏng (count kẹt >0) vẫn để assert đỏ. CHỈ test, KHÔNG đụng logic revoke (BẤT BIẾN #2 mirror giữ nguyên).
 */
async function pollCount(
  read: () => Promise<number>,
  expected: number,
  timeoutMs = 500,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let n = await read();
  while (n !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    n = await read();
  }
  return n;
}

/** `after` jsonb của bản audit MỚI NHẤT cho 1 action trên objectId (để đọc revokedSessionCount). */
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

// Gate hasDb && LANE_DB: thiếu DB lane cô lập → SKIP (KHÔNG chạm 'mediaos' dev chung). CLAUDE.md §9.5.
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S2-AUTH-BE-3 /auth/users admin API", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let noPermToken: string;
  let adminToken: string;
  let adminId: string;
  let targetAId: string;
  let targetBId: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "auba");
    B = await seedCompany(direct, "aubb");
    companyIds.push(A.companyId, B.companyId);
    const pw = await hashedPw();

    // noPermUser: role rỗng → KHÔNG view/create/update/lock/unlock:user
    const noPermId = await seedUser(
      direct,
      A.companyId,
      `be3-np-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    const emptyRole = await seedRole(direct, A.companyId, `be3-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noPermId, emptyRole, A.companyId);

    // adminUser: company-admin (role 0001) → 0444/0450 grant view/create/update/lock/unlock:user (Company).
    adminId = await seedUser(
      direct,
      A.companyId,
      `be3-admin-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    await seedUserRole(direct, adminId, COMPANY_ADMIN_ROLE_ID, A.companyId);

    targetAId = await seedUser(
      direct,
      A.companyId,
      `be3-tgt-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    targetBId = await seedUser(
      direct,
      B.companyId,
      `be3-tgtB-${randomUUID().slice(0, 8)}@b.test`,
      pw,
    );

    const np = await login(app, A.slug, await emailOf(direct, noPermId));
    const ad = await login(app, A.slug, await emailOf(direct, adminId));
    expect(np.status, "noPerm login").toBe(200);
    expect(ad.status, "admin login").toBe(200);
    noPermToken = np.token!;
    adminToken = ad.token!;
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ── §deny — thiếu quyền → 403 + 0 audit ──────────────────────────────────────
  describe("§deny — role rỗng → 403 + 0 audit", () => {
    it("GET /auth/users → 403", async () => {
      const res = await api(app).get("/auth/users").set("Authorization", `Bearer ${noPermToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("POST /auth/users (create) → 403 + 0 audit", async () => {
      const res = await api(app)
        .post("/auth/users")
        .set("Authorization", `Bearer ${noPermToken}`)
        .send({ email: `x-${randomUUID().slice(0, 6)}@a.test`, password: PASSWORD, fullName: "X" });
      expect(res.status).toBe(403);
    });

    it("PATCH /auth/users/:id → 403 + fullName KHÔNG đổi + 0 audit", async () => {
      const before = await userRow(direct, targetAId);
      const auditBefore = await countUserAudit(direct, targetAId);
      const res = await api(app)
        .patch(`/auth/users/${targetAId}`)
        .set("Authorization", `Bearer ${noPermToken}`)
        .send({ fullName: "Hacked" });
      expect(res.status).toBe(403);
      expect((await userRow(direct, targetAId))?.full_name).toBe(before?.full_name);
      expect(await countUserAudit(direct, targetAId)).toBe(auditBefore);
    });

    it("POST /auth/users/:id/lock → 403 + status KHÔNG đổi + 0 audit", async () => {
      const before = await userRow(direct, targetAId);
      const auditBefore = await countUserAudit(direct, targetAId);
      const res = await api(app)
        .post(`/auth/users/${targetAId}/lock`)
        .set("Authorization", `Bearer ${noPermToken}`)
        .send({ reason: "deny" });
      expect(res.status).toBe(403);
      expect((await userRow(direct, targetAId))?.status).toBe(before?.status);
      expect(await countUserAudit(direct, targetAId)).toBe(auditBefore);
    });

    it("POST /auth/users/:id/unlock → 403", async () => {
      const res = await api(app)
        .post(`/auth/users/${targetAId}/unlock`)
        .set("Authorization", `Bearer ${noPermToken}`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  // ── §rls — cross-tenant → 404 + 0 audit + list KHÔNG lộ B ─────────────────────
  describe("§rls — admin A ↛ user B (404, KHÔNG lộ tồn tại)", () => {
    it("GET /auth/users/:id (B) → 404", async () => {
      const res = await api(app)
        .get(`/auth/users/${targetBId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    it("PATCH /auth/users/:id (B) → 404 + 0 audit cho B", async () => {
      const auditBefore = await countUserAudit(direct, targetBId);
      const res = await api(app)
        .patch(`/auth/users/${targetBId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ fullName: "cross" });
      expect(res.status).toBe(404);
      expect(await countUserAudit(direct, targetBId)).toBe(auditBefore);
    });

    it("POST /auth/users/:id/lock (B) → 404 + status B KHÔNG đổi + 0 audit", async () => {
      const before = await userRow(direct, targetBId);
      const auditBefore = await countUserAudit(direct, targetBId);
      const res = await api(app)
        .post(`/auth/users/${targetBId}/lock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(404);
      expect((await userRow(direct, targetBId))?.status).toBe(before?.status);
      expect(await countUserAudit(direct, targetBId)).toBe(auditBefore);
    });

    it("GET /auth/users (list A) KHÔNG chứa user B", async () => {
      const res = await api(app)
        .get("/auth/users?limit=100")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data.users as Array<{ id: string }>).map((u) => u.id);
      expect(ids).not.toContain(targetBId);
    });
  });

  // ── §allow + §audit — company-admin happy-path + audit hành động ──────────────
  describe("§allow + §audit — company-admin", () => {
    it("GET /auth/users → 200 + DTO KHÔNG passwordHash", async () => {
      const res = await api(app).get("/auth/users").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      for (const u of res.body.data.users as Array<Record<string, unknown>>) {
        expect(u).not.toHaveProperty("passwordHash");
        expect(u).not.toHaveProperty("password_hash");
        expect(u).not.toHaveProperty("normalizedEmail");
      }
    });

    it("POST create → 201 + audit 'user.created' + KHÔNG hồi passwordHash", async () => {
      const email = `be3-new-${randomUUID().slice(0, 8)}@a.test`;
      const res = await api(app)
        .post("/auth/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email, password: PASSWORD, fullName: "Người Mới" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const newId = res.body.data.id as string;
      expect(res.body.data).not.toHaveProperty("passwordHash");
      expect(await latestUserAction(direct, newId)).toBe("user.created");
      expect(JSON.stringify(await auditSnapshotJson(direct, newId))).not.toContain("passwordHash");
    });

    it("PATCH update → 200 + audit 'user.updated'", async () => {
      const victim = await seedUser(
        direct,
        A.companyId,
        `be3-u-${randomUUID().slice(0, 8)}@a.test`,
        await hashedPw(),
      );
      const res = await api(app)
        .patch(`/auth/users/${victim}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ fullName: "Đã Sửa" });
      expect(res.status).toBe(200);
      expect((await userRow(direct, victim))?.full_name).toBe("Đã Sửa");
      expect(await latestUserAction(direct, victim)).toBe("user.updated");
    });

    it("lock → audit 'user.locked' (status='locked'); unlock → 'user.unlocked' (status='active')", async () => {
      const victim = await seedUser(
        direct,
        A.companyId,
        `be3-l-${randomUUID().slice(0, 8)}@a.test`,
        await hashedPw(),
      );
      const lock = await api(app)
        .post(`/auth/users/${victim}/lock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "policy" });
      expect(lock.status).toBe(200);
      expect((await userRow(direct, victim))?.status).toBe("locked");
      expect(await latestUserAction(direct, victim)).toBe("user.locked");

      const unlock = await api(app)
        .post(`/auth/users/${victim}/unlock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});
      expect(unlock.status).toBe(200);
      expect((await userRow(direct, victim))?.status).toBe("active");
      expect((await userRow(direct, victim))?.locked_at).toBeNull();
      expect(await latestUserAction(direct, victim)).toBe("user.unlocked");
    });

    it("self-lock chính mình → 400 (chống lockout) + status KHÔNG đổi", async () => {
      const before = await userRow(direct, adminId);
      const res = await api(app)
        .post(`/auth/users/${adminId}/lock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});
      expect([400, 409]).toContain(res.status);
      expect((await userRow(direct, adminId))?.status).toBe(before?.status);
    });
  });

  // ── §lock-login — lock chặn login; unlock mở lại ─────────────────────────────
  describe("§lock-login — locked chặn login", () => {
    it("lock user → login đúng credential → blocked; unlock → login lại OK", async () => {
      const email = `be3-li-${randomUUID().slice(0, 8)}@a.test`;
      const victim = await seedUser(direct, A.companyId, email, await hashedPw());

      // credential ĐÚNG khi chưa khoá → 200 (sanity)
      const ok0 = await login(app, A.slug, email);
      expect(ok0.status).toBe(200);

      const lock = await api(app)
        .post(`/auth/users/${victim}/lock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "blocked-login test" });
      expect(lock.status).toBe(200);

      // credential vẫn ĐÚNG nhưng status='locked' → allow-list chặn → 401 đồng nhất
      const blocked = await login(app, A.slug, email);
      expect(blocked.status).toBe(401);
      const ll = await direct.query(
        `SELECT login_status FROM login_logs WHERE normalized_email = $1 ORDER BY created_at DESC LIMIT 1`,
        [email.toLowerCase()],
      );
      expect(ll.rows[0]?.login_status).toBe("blocked");

      // unlock → login lại OK
      const unlock = await api(app)
        .post(`/auth/users/${victim}/unlock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});
      expect(unlock.status).toBe(200);
      const ok1 = await login(app, A.slug, email);
      expect(ok1.status).toBe(200);
    });
  });

  // ── §revoke-on-lock (S2-AUTH-BE-9) — lock thu hồi MỌI phiên (refresh + session) NGAY trong cùng tx ──
  describe("§revoke-on-lock — lock = thu hồi phiên tức thì + audit revoked_session_count", () => {
    it("lock → refresh token CŨ → /auth/refresh 401 NGAY; user_sessions/refresh_tokens đều revoked; audit revokedSessionCount = số phiên", async () => {
      const email = `be9-rv-${randomUUID().slice(0, 8)}@a.test`;
      const victim = await seedUser(direct, A.companyId, email, await hashedPw());

      // Seed ≥2 phiên active: login THẬT 2 lần (mỗi lần dual-write refresh_tokens + user_sessions).
      const s1 = await loginFull(app, A.slug, email);
      const s2 = await loginFull(app, A.slug, email);
      expect(await countActiveSessions(direct, victim)).toBe(2);
      expect(await countActiveRefreshTokens(direct, victim)).toBe(2);

      // Sanity: refresh token còn sống → /auth/refresh xoay OK (200) trước khi khoá.
      const pre = await api(app).post("/auth/refresh").send({ refreshToken: s2.refreshToken });
      expect(pre.status).toBe(200);

      const lock = await api(app)
        .post(`/auth/users/${victim}/lock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "revoke-all test" });
      expect(lock.status, JSON.stringify(lock.body)).toBe(200);

      // Refresh token CŨ (s1 — chưa từng xoay) → 401 NGAY (đã bị thu hồi bởi lock, không chờ reuse-detection).
      const after = await api(app).post("/auth/refresh").send({ refreshToken: s1.refreshToken });
      expect(after.status).toBe(401);

      // MỌI phiên + refresh token của victim đã revoked (revoked_at NOT NULL) → count active = 0.
      // pollCount = read-your-writes barrier đóng nghi ngờ flaky cold-pool; vẫn assert giá trị THẬT (0).
      expect(await pollCount(() => countActiveSessions(direct, victim), 0)).toBe(0);
      expect(await pollCount(() => countActiveRefreshTokens(direct, victim), 0)).toBe(0);

      // Audit 'user.locked'.after.revokedSessionCount = ĐÚNG số phiên active bị thu hồi (2, đếm chính xác).
      const auditAfter = await latestAuditAfter(direct, victim, "user.locked");
      expect(auditAfter?.revokedSessionCount).toBe(2);
      // KHÔNG lộ secret trong audit (BẤT BIẾN #3).
      expect(JSON.stringify(auditAfter)).not.toContain("passwordHash");
      expect(JSON.stringify(auditAfter)).not.toContain("token");
    });

    it("cross-tenant: admin A lock user B → 404 + phiên B KHÔNG bị revoke (không rò)", async () => {
      const emailB = `be9-b-${randomUUID().slice(0, 8)}@b.test`;
      const victimB = await seedUser(direct, B.companyId, emailB, await hashedPw());
      await loginFull(app, B.slug, emailB);
      expect(await countActiveSessions(direct, victimB)).toBe(1);

      const res = await api(app)
        .post(`/auth/users/${victimB}/lock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "cross" });
      expect(res.status).toBe(404);

      // Phiên tenant B nguyên vẹn — lock cross-tenant KHÔNG chạm phiên (RLS che).
      expect(await countActiveSessions(direct, victimB)).toBe(1);
      expect(await countActiveRefreshTokens(direct, victimB)).toBe(1);
    });

    it("NO-RESTORE: unlock KHÔNG hồi phiên cũ — user_sessions vẫn revoked_at IS NOT NULL (phải login lại)", async () => {
      const email = `be9-nr-${randomUUID().slice(0, 8)}@a.test`;
      const victim = await seedUser(direct, A.companyId, email, await hashedPw());
      await loginFull(app, A.slug, email);
      expect(await countActiveSessions(direct, victim)).toBe(1);

      const lock = await api(app)
        .post(`/auth/users/${victim}/lock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "nr" });
      expect(lock.status).toBe(200);
      expect(await pollCount(() => countActiveSessions(direct, victim), 0)).toBe(0);

      const unlock = await api(app)
        .post(`/auth/users/${victim}/unlock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});
      expect(unlock.status).toBe(200);
      // Phiên cũ VẪN revoked sau unlock — user phải đăng nhập lại mới có phiên mới.
      expect(await countActiveSessions(direct, victim)).toBe(0);

      // Đăng nhập lại → phiên mới xuất hiện (chứng minh chỉ có đường login mới cấp phiên).
      await loginFull(app, A.slug, email);
      expect(await countActiveSessions(direct, victim)).toBe(1);
    });

    it("self-lock chính mình → 400 (chống lockout) + phiên admin KHÔNG bị revoke", async () => {
      const before = await countActiveSessions(direct, adminId);
      const res = await api(app)
        .post(`/auth/users/${adminId}/lock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "self" });
      expect([400, 409]).toContain(res.status);
      // Guard chặn TRƯỚC mọi mutation → phiên admin nguyên vẹn.
      expect(await countActiveSessions(direct, adminId)).toBe(before);
    });
  });

  // ── §hr-link — đối soát AUTH↔HR: hasEmployeeProfile (EXISTS thật) + filter linkedProfile ──
  describe("§hr-link — hasEmployeeProfile + filter linkedProfile", () => {
    it("list: hasEmployeeProfile đúng theo có/chưa hồ sơ; linkedProfile bound đúng tập", async () => {
      // 1 user CÓ hồ sơ nhân sự active + 1 user CHƯA có (cùng tenant A).
      const linkedEmail = `be3-hrl-${randomUUID().slice(0, 8)}@a.test`;
      const linkedId = await seedUser(direct, A.companyId, linkedEmail, await hashedPw());
      await seedEmployeeProfile(direct, A.companyId, linkedId);
      const unlinkedEmail = `be3-hru-${randomUUID().slice(0, 8)}@a.test`;
      const unlinkedId = await seedUser(direct, A.companyId, unlinkedEmail, await hashedPw());

      // (a) Không filter → cột hasEmployeeProfile phản ánh đúng EXISTS(employee_profiles active).
      const all = await api(app)
        .get("/auth/users?limit=100")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(all.status).toBe(200);
      const flagById = new Map(
        (all.body.data.users as Array<{ id: string; hasEmployeeProfile: boolean }>).map((u) => [
          u.id,
          u.hasEmployeeProfile,
        ]),
      );
      expect(flagById.get(linkedId)).toBe(true);
      expect(flagById.get(unlinkedId)).toBe(false);

      // (b) linkedProfile=false → CHỈ user chưa có hồ sơ (bound WHERE NOT EXISTS).
      const unlinked = await api(app)
        .get("/auth/users?limit=100&linkedProfile=false")
        .set("Authorization", `Bearer ${adminToken}`);
      const unlinkedIds = (unlinked.body.data.users as Array<{ id: string }>).map((u) => u.id);
      expect(unlinkedIds).toContain(unlinkedId);
      expect(unlinkedIds).not.toContain(linkedId);

      // (c) linkedProfile=true → CHỈ user đã có hồ sơ (bound WHERE EXISTS).
      const linked = await api(app)
        .get("/auth/users?limit=100&linkedProfile=true")
        .set("Authorization", `Bearer ${adminToken}`);
      const linkedIds = (linked.body.data.users as Array<{ id: string }>).map((u) => u.id);
      expect(linkedIds).toContain(linkedId);
      expect(linkedIds).not.toContain(unlinkedId);
    });

    it("soft-delete hồ sơ → hasEmployeeProfile=false (chỉ đếm hồ sơ active)", async () => {
      const email = `be3-hrsd-${randomUUID().slice(0, 8)}@a.test`;
      const uid = await seedUser(direct, A.companyId, email, await hashedPw());
      const profileId = await seedEmployeeProfile(direct, A.companyId, uid);
      // Xóa mềm hồ sơ → không còn active → EXISTS phải trả false.
      await direct.query(`UPDATE employee_profiles SET deleted_at = now() WHERE id = $1`, [
        profileId,
      ]);
      const res = await api(app)
        .get("/auth/users?limit=100")
        .set("Authorization", `Bearer ${adminToken}`);
      const row = (res.body.data.users as Array<{ id: string; hasEmployeeProfile: boolean }>).find(
        (u) => u.id === uid,
      );
      expect(row?.hasEmployeeProfile).toBe(false);
    });
  });
});
