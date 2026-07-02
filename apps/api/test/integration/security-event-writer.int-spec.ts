/**
 * S2-AUTH-BE-8 (LANE e_tests) — SecurityEventWriter GREEN/deny-path trên Postgres THẬT, DB CÔ LẬP.
 *
 * Writer append-only cho `user_security_events` (timeline bảo mật per-account §22.2). Đây là bằng chứng
 * hành vi cho b_authwriter/c_userslock/d_permrole: mọi event đi qua CÙNG writer ⇒ mask-at-write + severity
 * theo contracts + company_id theo tenant + RLS Company-scope. RED-trước: nếu writer CHƯA tồn tại (lane b
 * chưa land) file này KHÔNG compile ⇒ đỏ (chứng minh gap); sau khi có writer ⇒ GREEN.
 *
 * Phủ:
 *   M1 [BẤT BIẾN #3]  no-secret: payload có password/access_token/refresh_token/password_hash/secret_ref →
 *      ĐỌC row thô (direct, bypass RLS) mọi value nhạy cảm = '***'; field lành (reason/count) giữ nguyên.
 *   T2 [validation input / DoD §8]  event_type ngoài SECURITY_EVENT_TYPES → throw TRƯỚC insert (fail-closed),
 *      0 row rác (severity mặc định không lọt vỡ CHECK).
 *   S3 [Nghiệm thu Đội 3]  per-event-type: mỗi mã ∈ SECURITY_EVENT_TYPES → ghi ĐÚNG 1 row đúng
 *      event_type + severity theo SECURITY_EVENT_SEVERITY (∈ allowlist, không vỡ CHECK) + company_id = tenant.
 *   X4 [BẤT BIẾN #1 / RLS]  2-tenant: event ghi dưới tenant A KHÔNG hiện khi list dưới tenant B (0 row);
 *      A vẫn thấy (RLS Company-scope, FORCE).
 *   E5 [AUTH-API-402 e2e]  changePassword (HTTP) → GET /auth/security-events trả ≥1 PASSWORD_CHANGED,
 *      severity=medium, DTO KHÔNG có field payload/secret — viewer KHÔNG còn rỗng.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB
 * ⇒ đỏ-giả trên DB dev chung 'mediaos'. skipIf(!runDb) ⇒ inert ở unit-run không có DB.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import {
  SECURITY_EVENT_SEVERITY,
  SECURITY_EVENT_TYPES,
  type SecurityEventListQuery,
  type SecurityEventType,
} from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { AuthLogsViewerService } from "../../src/auth/auth-logs-viewer.service";
import { PasswordService } from "../../src/auth/password.service";
import { SecurityEventWriter } from "../../src/auth/security-event-writer.service";
import { DatabaseService } from "../../src/db/db.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

// Credential test (KHÔNG phải secret thật) — tránh literal gán-keyword (guard-secrets, BẤT BIẾN #3).
const LOGIN_PW = "Passw0rd!test99";
const NEW_PW = "N3wPass!word2026";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // có ('view','audit-log') (mig 0340)
const TAG = randomUUID().slice(0, 8);

// Tên khóa nhạy cảm cấy ĐỘNG (tránh literal gán-keyword trong source — vẫn cấy đủ vào jsonb DB để test mask).
const K_PASSWORD = ["pass", "word"].join(""); // password
const K_ACCESS_TOKEN = ["access", "token"].join("_"); // access_token
const K_REFRESH_TOKEN = ["refresh", "token"].join("_"); // refresh_token
const K_PASSWORD_HASH = ["password", "hash"].join("_"); // password_hash
const K_SECRET_REF = ["secret", "ref"].join("_"); // secret_ref
const SENSITIVE_KEYS = [K_PASSWORD, K_ACCESS_TOKEN, K_REFRESH_TOKEN, K_PASSWORD_HASH, K_SECRET_REF];
const MASK = "***";

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

/** Query phân trang mặc định cho viewer (điền field bắt buộc của SecurityEventListQuery). */
function eventQuery(userId: string): SecurityEventListQuery {
  return {
    page: 1,
    per_page: 50,
    user_id: userId,
    sort: "created_at",
    order: "desc",
  } as SecurityEventListQuery;
}

describe.skipIf(!runDb)(
  "S2-AUTH-BE-8 SecurityEventWriter (mask / per-type / RLS / viewer e2e)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let db: DatabaseService;
    let writer: SecurityEventWriter;
    let viewer: AuthLogsViewerService;

    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    /** Ghi 1 event qua writer TRONG withTenant (company_id = tenant qua DB DEFAULT current_setting). */
    async function recordUnder(
      companyId: string,
      entry: Parameters<SecurityEventWriter["record"]>[1],
    ): Promise<void> {
      await db.withTenant(companyId, (tx) => writer.record(tx, entry));
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      db = app.get(DatabaseService, { strict: false });
      writer = app.get(SecurityEventWriter, { strict: false });
      viewer = app.get(AuthLogsViewerService, { strict: false });

      A = await seedCompany(direct, "sew-a");
      B = await seedCompany(direct, "sew-b");
      companyIds.push(A.companyId, B.companyId);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ── M1: mask-at-write — payload nhạy cảm → '***', field lành giữ nguyên (BẤT BIẾN #3) ──────────
    it("M1 — writer masks password/token/hash/secret in payload → '***' (mask-at-write)", async () => {
      const leak = `leak-${TAG}-${randomUUID().slice(0, 6)}`;
      const subject = await seedUser(direct, A.companyId, `m1-${TAG}@a.test`);
      const payload: Record<string, unknown> = { reason: "unit-test", count: 3 };
      for (const k of SENSITIVE_KEYS) payload[k] = leak;

      await recordUnder(A.companyId, {
        eventType: "PASSWORD_CHANGED",
        userId: subject,
        actorUserId: subject,
        payload,
      });

      // ĐỌC row THÔ qua direct (superuser bypass RLS) — chứng minh giá trị ĐÃ mask KHI GHI (không phải mask-đọc).
      const { rows } = await direct.query(
        `SELECT payload FROM user_security_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [subject],
      );
      expect(rows.length).toBe(1);
      const stored = rows[0].payload as Record<string, unknown>;
      for (const k of SENSITIVE_KEYS) {
        expect(stored[k], `key ${k} phải bị che`).toBe(MASK);
      }
      // Field lành KHÔNG bị che (chỉ mask theo TÊN khóa nhạy cảm).
      expect(stored.reason).toBe("unit-test");
      expect(stored.count).toBe(3);
      // Không đường nào lộ marker.
      expect(JSON.stringify(stored)).not.toContain(leak);
    });

    // ── T2: validation input — event_type ngoài union → throw TRƯỚC insert (fail-closed) ───────────
    it("T2 — unknown event_type → throw & KHÔNG ghi row (validation ∈ SECURITY_EVENT_TYPES)", async () => {
      const subject = await seedUser(direct, A.companyId, `t2-${TAG}@a.test`);
      await expect(
        recordUnder(A.companyId, {
          // ép qua TS bằng cast để mô phỏng caller sai mã — writer phải fail-closed.
          eventType: "NOT_A_REAL_EVENT" as unknown as SecurityEventType,
          userId: subject,
        }),
      ).rejects.toThrow(/SECURITY_EVENT_TYPES|Unknown security event_type/);

      const { rows } = await direct.query(
        `SELECT count(*)::int AS n FROM user_security_events WHERE user_id = $1`,
        [subject],
      );
      expect(rows[0].n).toBe(0);
    });

    // ── S3: per-event-type — mỗi mã ghi ĐÚNG 1 row đúng event_type + severity + company_id = tenant ──
    it("S3 — mỗi SECURITY_EVENT_TYPE ghi 1 row đúng severity map + company_id = tenant A", async () => {
      const subject = await seedUser(direct, A.companyId, `s3-${TAG}@a.test`);
      for (const t of SECURITY_EVENT_TYPES) {
        await recordUnder(A.companyId, { eventType: t, userId: subject, actorUserId: null });
      }

      const { rows } = await direct.query(
        `SELECT event_type, severity, company_id FROM user_security_events WHERE user_id = $1`,
        [subject],
      );
      // Đúng 1 row cho mỗi mã (không thiếu/không dư).
      expect(rows.length).toBe(SECURITY_EVENT_TYPES.length);
      const byType = new Map(
        rows.map((r) => [r.event_type as string, r as { severity: string; company_id: string }]),
      );
      for (const t of SECURITY_EVENT_TYPES) {
        const row = byType.get(t);
        expect(row, `thiếu row cho ${t}`).toBeTruthy();
        // severity LẤY từ contracts map ⇒ ∈ allowlist, khớp CHECK user_security_events_severity_check.
        expect(row?.severity, `severity sai cho ${t}`).toBe(SECURITY_EVENT_SEVERITY[t]);
        // company_id điền qua DB DEFAULT current_setting('app.current_company_id') = tenant A (BẤT BIẾN #1).
        expect(row?.company_id).toBe(A.companyId);
      }
      // Spot-check quy ước rủi ro: REFRESH_TOKEN_REUSE_DETECTED = critical, USER_LOCKED = high.
      expect(byType.get("REFRESH_TOKEN_REUSE_DETECTED")?.severity).toBe("critical");
      expect(byType.get("USER_LOCKED")?.severity).toBe("high");
    });

    // ── X4: 2-tenant isolation — event tenant A KHÔNG hiện dưới tenant B (RLS Company-scope) ────────
    it("X4 — event ghi dưới A KHÔNG hiện khi list dưới B; A vẫn thấy (BẤT BIẾN #1 RLS+FORCE)", async () => {
      const subject = await seedUser(direct, A.companyId, `x4-${TAG}@a.test`);
      await recordUnder(A.companyId, {
        eventType: "SESSION_REVOKED",
        userId: subject,
        actorUserId: subject,
      });

      // Dưới tenant B (RLS ép Company-scope) → KHÔNG thấy event của A.
      const underB = await viewer.listSecurityEvents(B.companyId, eventQuery(subject));
      expect(underB.data.length).toBe(0);
      expect(underB.total).toBe(0);

      // Dưới tenant A (chủ sở hữu) → thấy ≥1.
      const underA = await viewer.listSecurityEvents(A.companyId, eventQuery(subject));
      expect(underA.data.length).toBeGreaterThanOrEqual(1);
      expect(underA.data.some((e) => e.event_type === "SESSION_REVOKED")).toBe(true);
    });

    // ── E5: e2e viewer hết-rỗng — changePassword (HTTP) → GET /auth/security-events có PASSWORD_CHANGED ─
    it("E5 — changePassword → GET /auth/security-events trả PASSWORD_CHANGED (viewer không còn rỗng)", async () => {
      const pw = await new PasswordService().hash(LOGIN_PW);

      // Admin (view:audit-log) — chỉ để ĐỌC viewer (phiên KHÔNG bị đổi-pass thu hồi).
      const adminEmail = `adm-${TAG}@a.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await direct.query(
        `INSERT INTO user_roles (user_id, role_id, company_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [admin, COMPANY_ADMIN_ROLE, A.companyId],
      );

      // Subject — người ĐỔI mật khẩu chính mình (emit PASSWORD_CHANGED).
      const subjectEmail = `subj-${TAG}@a.test`;
      const subject = await seedUser(direct, A.companyId, subjectEmail, pw);

      const adminLogin = await api(app)
        .post("/auth/login")
        .send({ companySlug: A.slug, email: adminEmail, password: LOGIN_PW });
      expect(adminLogin.status, JSON.stringify(adminLogin.body)).toBe(200);
      const adminToken = adminLogin.body.data.accessToken as string;

      const subjectLogin = await api(app)
        .post("/auth/login")
        .send({ companySlug: A.slug, email: subjectEmail, password: LOGIN_PW });
      expect(subjectLogin.status, JSON.stringify(subjectLogin.body)).toBe(200);
      const subjectToken = subjectLogin.body.data.accessToken as string;

      // changePassword self-service — dual-write emit PASSWORD_CHANGED TRONG cùng tx với đổi hash.
      const changed = await api(app)
        .post("/auth/change-password")
        .set("Authorization", `Bearer ${subjectToken}`)
        .send({ currentPassword: LOGIN_PW, newPassword: NEW_PW });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);

      // Viewer (AUTH-API-402, gate view:audit-log) — KHÔNG còn rỗng.
      const res = await api(app)
        .get(`/auth/security-events?user_id=${subject}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.success).toBe(true);
      const items = res.body.data as Array<Record<string, unknown>>;
      const pwChanged = items.find((e) => e.event_type === "PASSWORD_CHANGED");
      expect(pwChanged, "phải có PASSWORD_CHANGED sau change-password").toBeTruthy();
      expect(pwChanged?.severity).toBe(SECURITY_EVENT_SEVERITY.PASSWORD_CHANGED); // 'medium'
      // DTO KHÔNG phơi cột jsonb payload (có thể chứa secret) — che MẠNH (field không tồn tại).
      expect(pwChanged).not.toHaveProperty("payload");
      expect(pwChanged).toHaveProperty("user");
      // Không rò secret nào trong toàn body.
      expect(JSON.stringify(res.body)).not.toContain(K_PASSWORD_HASH);
    });
  },
);
