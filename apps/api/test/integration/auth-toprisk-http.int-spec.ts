/**
 * S10-QA-ROUTEHTTP-1 (lane FIX-ROUTEHTTP-A-TOPRISK) — test HTTP THẬT (supertest) cho ĐÚNG BA route đứng
 * đầu bảng xếp hạng rủi ro của `test/foundation/route-http-coverage.e2e-spec.ts` mà vòng trước bỏ trống:
 *
 *   risk 7 · POST /auth/reset-password       — @Public, GHI (đổi mật khẩu + thu hồi phiên)
 *   risk 7 · POST /users/activation/accept   — @Public SESSIONLESS (token LÀ auth), GHI
 *   risk 6 · POST /auth/2fa/disable          — authenticated NHƯNG UNGATED (không @RequirePermission)
 *
 * VÌ SAO KHÔNG TRÙNG với spec đã có. `auth-reset-deny-path.int-spec.ts`, `user-invites-flow.int-spec.ts`
 * và `auth-coverage.int-spec.ts` gọi THẲNG service (`new AuthService(...)`, `service.accept(...)`), nên
 * ba lớp CHỈ tồn tại trên đường HTTP chưa từng chạy cho các route này:
 *   (1) guard chain toàn cục (JwtAuthGuard → CompanyGuard → TwoFactorEnforcementGuard),
 *   (2) `ZodValidationPipe` (nestjs-zod) — DTO chặn ở BIÊN, trước khi service thấy dữ liệu,
 *   (3) `ResponseEnvelopeInterceptor` + `AllExceptionsFilter` — hình dạng body và ánh xạ mã HTTP.
 * App test dựng ĐÚNG như `main.ts` (pipe + interceptor + filter) — thiếu `ZodValidationPipe` thì mọi ca
 * "sai DTO → 400" sẽ xanh-giả vì service tự ném 400 vì lý do khác.
 *
 * LUẬT CHỐNG DENY-XANH-RỖNG. Mỗi route có ÍT NHẤT một ca ALLOW 2xx THẬT đặt TRƯỚC các ca DENY, và ca
 * ALLOW được chứng minh bằng HỆ QUẢ quan sát được qua HTTP (đăng nhập được bằng mật khẩu mới / trạng thái
 * 2FA đổi), không chỉ bằng status code. Không có ca ALLOW thì "403/401" không chứng minh được gì —
 * route chết cũng cho cùng kết quả (bài học: deny-cases-vacuous-without-allow-case).
 *
 * BẪY RATE-LIMIT (per-user) — xử lý bằng CÁCH LY, không bằng nới ngưỡng. `AuthService.disableTwoFactor`
 * khoá theo key `2fa-disable|{companyId}|{userId}` và `forgot-password` khoá theo
 * `rl:forgot:*|{slug}|{email}|{ip}`. Nếu mọi ca dùng CHUNG một user thì chính int-spec tự bóp cổ mình
 * (429 giả, đỏ ngẫu nhiên theo thứ tự chạy). Ở đây MỖI ca dùng USER RIÊNG (email ngẫu nhiên/ca) và mỗi
 * lần mint reset-token dùng EMAIL RIÊNG ⇒ mỗi bucket rate-limit chỉ bị chạm 1-2 lần, không bao giờ chạm
 * ngưỡng. Không đụng tới env ngưỡng ⇒ spec đo đúng cấu hình PROD, không đo một cấu hình nới lỏng.
 *
 * GATE CỨNG `hasDb && LANE_DB` — cần Postgres cô lập theo lane (withTenant/RLS thật). Thiếu LANE_DB →
 * SKIP (CLAUDE.md §9.5) để không chạm DB dev chung.
 *
 * FIXTURE GIỐNG-SECRET: mọi mật khẩu test được GHÉP CHUỖI qua `pw()` (CLAUDE.md §5) — không literal
 * high-entropy nào trong file này (literal sẽ trip rule `generic-api-key` của gitleaks ⇒ đỏ oan CI).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AuthService } from "../../src/auth/auth.service";
import { PasswordService } from "../../src/auth/password.service";
import { TokenService } from "../../src/auth/token.service";
import { TotpService } from "../../src/auth/totp.service";
import { ERROR_CODES } from "../../src/common/errors/error-codes";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { generateInviteToken } from "../../src/user-invites/user-invite-token.util";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

/** Mật khẩu fixture GHÉP CHUỖI (CLAUDE.md §5) — đủ hoa/thường/số/ký-tự-đặc-biệt, ≥ 8 ký tự. */
const pw = (tag: string): string => ["Fixture", tag, "Pw9"].join("-").concat("!");

/** Mật khẩu ngắn hơn `min(8)` của contract — dùng để đo ĐÚNG nhánh Zod ở biên HTTP. */
const TOO_SHORT_PW = ["a", "b", "c"].join("");

interface TestUser {
  id: string;
  email: string;
  password: string;
}

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-1 — HTTP thật: 3 route top-risk (reset-password · activation/accept · 2fa/disable)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let auth: AuthService;
    let A: SeededTenant;
    let inviterId = "";
    const companyIds: string[] = [];
    const password = new PasswordService();
    const tokens = new TokenService();
    const totp = new TotpService();

    const http = () => request(app.getHttpServer());
    const bearer = (t: string, url: string) => http().post(url).set("Authorization", `Bearer ${t}`);

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // Mirror main.ts: Zod validate ở biên → envelope → filter. Thứ tự này quyết định mã HTTP trả về.
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      auth = app.get(AuthService);

      direct = directPool();
      A = await seedCompany(direct, "s10trh");
      companyIds.push(A.companyId);
      inviterId = (await newUser("inviter")).id;
    }, 120_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    /** User MỚI cho mỗi ca — cách ly bucket rate-limit per-user (xem docblock). */
    async function newUser(tag: string): Promise<TestUser> {
      const email = `${tag}-${randomUUID().slice(0, 8)}@s10trh.local`;
      const plain = pw(tag);
      const id = await seedUser(direct, A.companyId, email, await password.hash(plain));
      return { id, email, password: plain };
    }

    async function login(u: TestUser, plain = u.password): Promise<string> {
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email: u.email, password: plain });
      expect(res.status, `login ${u.email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /**
     * Mint reset-token qua ĐƯỜNG THẬT: POST /auth/forgot-password (HTTP) → outbox → JIT decrypt
     * (đúng việc mail consumer làm). Lọc outbox theo `userId` chứ KHÔNG chỉ ORDER BY created_at —
     * hai ca mint trong cùng mili-giây sẽ tráo token cho nhau, hỏng ngẫu nhiên theo thứ tự chạy.
     */
    async function mintResetToken(u: TestUser): Promise<string> {
      const res = await http()
        .post("/auth/forgot-password")
        .send({ companySlug: A.slug, email: u.email });
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const ev = await direct.query(
        `SELECT payload FROM outbox_events
          WHERE company_id = $1 AND event_type = 'auth.password_reset_requested'
            AND payload->>'userId' = $2
          ORDER BY created_at DESC LIMIT 1`,
        [A.companyId, u.id],
      );
      expect(ev.rows.length, "forgot-password phải sinh outbox event").toBe(1);
      const payload = ev.rows[0].payload as { userId: string; resetTokenEnc: unknown };
      return auth.decryptResetToken(A.companyId, payload.resetTokenEnc, payload.userId);
    }

    /** Reset-token HẾT HẠN không mint được qua HTTP → gieo thẳng row (giống auth-reset-deny-path). */
    async function seedExpiredResetToken(u: TestUser): Promise<string> {
      const plain = `${A.companyId}.${tokens.generateOpaqueToken()}`;
      await direct.query(
        `INSERT INTO password_reset_tokens (company_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() - interval '1 hour')`,
        [A.companyId, u.id, tokens.hashToken(plain)],
      );
      return plain;
    }

    /** Gieo 1 lời mời pending; trả token PLAINTEXT (DB chỉ giữ sha256). `ttl` là interval Postgres. */
    async function mintInvite(tag: string, ttl = "7 days"): Promise<{ token: string; id: string }> {
      const { token, tokenHash } = generateInviteToken();
      const res = await direct.query(
        `INSERT INTO user_invites (company_id, email, full_name, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + $6::interval) RETURNING id`,
        [
          A.companyId,
          `${tag}-${randomUUID().slice(0, 8)}@s10trh.local`,
          `Người ${tag}`,
          tokenHash,
          inviterId,
          ttl,
        ],
      );
      return { token, id: res.rows[0].id as string };
    }

    /** Bật 2FA cho user QUA HTTP (enroll → enable) — trả secret TOTP để sinh mã về sau. */
    async function enableTwoFactor(accessToken: string): Promise<string> {
      const enrolled = await bearer(accessToken, "/auth/2fa/enroll");
      expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(200);
      const secret = new URL(enrolled.body.data.otpauthUri).searchParams.get("secret") ?? "";
      expect(secret.length).toBeGreaterThan(0);
      const enabled = await bearer(accessToken, "/auth/2fa/enable").send({
        token: totp.generate(secret),
      });
      expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
      return secret;
    }

    /** Login trả challenge (2FA BẬT) hay tokens (2FA TẮT) — bằng chứng HTTP về trạng thái 2FA. */
    async function loginRequiresTwoFactor(u: TestUser): Promise<boolean> {
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email: u.email, password: u.password });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.twoFactorRequired === true;
    }

    function expectErrorEnvelope(body: unknown): { message: string; code: string } {
      const b = body as {
        success: boolean;
        data: unknown;
        error: { code: string; message: string };
        message: string;
      };
      expect(b.success).toBe(false);
      expect(b.data).toBeNull();
      expect(typeof b.error.code).toBe("string");
      return { message: b.message, code: b.error.code };
    }

    // ══ ROUTE 1 (risk 7) — POST /auth/reset-password · @Public · GHI ════════════════════════════
    describe("POST /auth/reset-password (@Public, risk 7)", () => {
      it("ALLOW: token hợp lệ → 200 + envelope chuẩn; HỆ QUẢ THẬT: mật khẩu MỚI đăng nhập được, mật khẩu CŨ thì không", async () => {
        const u = await newUser("reset-ok");
        const token = await mintResetToken(u);
        const nextPw = pw("reset-ok-2");

        const res = await http().post("/auth/reset-password").send({ token, newPassword: nextPw });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body).toMatchObject({ success: true, data: { ok: true }, error: null });
        expect(res.body.meta).toBeDefined();
        // Token KHÔNG được vọng lại trong response (BẤT BIẾN #3).
        expect(JSON.stringify(res.body)).not.toContain(token);

        // Hệ quả quan sát qua HTTP: mật khẩu mới dùng được, mật khẩu cũ chết.
        expect(await login({ ...u, password: nextPw })).toBeTruthy();
        const old = await http()
          .post("/auth/login")
          .send({ companySlug: A.slug, email: u.email, password: u.password });
        expect(old.status).toBe(401);
      });

      it("DENY: token ĐÃ DÙNG và token HẾT HẠN → CÙNG 401 + CÙNG message (không lộ used-vs-expired)", async () => {
        const u = await newUser("reset-reuse");
        const token = await mintResetToken(u);
        const first = await http()
          .post("/auth/reset-password")
          .send({ token, newPassword: pw("reset-reuse-2") });
        expect(first.status).toBe(200); // ALLOW trước — ca DENY dưới đây mới có nghĩa.

        const reused = await http()
          .post("/auth/reset-password")
          .send({ token, newPassword: pw("reset-reuse-3") });
        const expired = await http()
          .post("/auth/reset-password")
          .send({ token: await seedExpiredResetToken(u), newPassword: pw("reset-reuse-4") });

        expect(reused.status).toBe(401);
        expect(expired.status).toBe(401);
        const a = expectErrorEnvelope(reused.body);
        const b = expectErrorEnvelope(expired.body);
        expect(a.message).toBe(b.message);
        expect(a.code).toBe(b.code);
      });

      it("DENY: token rác (không scoped) → 401 CÙNG message (không phân biệt sai-định-dạng vs không-tồn-tại)", async () => {
        const garbage = await http()
          .post("/auth/reset-password")
          .send({ token: ["not", "scoped", "token"].join("-"), newPassword: pw("garbage") });
        const unknown = await http()
          .post("/auth/reset-password")
          .send({
            token: `${A.companyId}.${tokens.generateOpaqueToken()}`,
            newPassword: pw("nope"),
          });
        expect(garbage.status).toBe(401);
        expect(unknown.status).toBe(401);
        expect(expectErrorEnvelope(garbage.body).message).toBe(
          expectErrorEnvelope(unknown.body).message,
        );
      });

      it("400 ở BIÊN: newPassword < 8 ký tự bị Zod chặn TRƯỚC service — token KHÔNG bị tiêu (sau đó vẫn reset được)", async () => {
        const u = await newUser("reset-dto");
        const token = await mintResetToken(u);

        const bad = await http()
          .post("/auth/reset-password")
          .send({ token, newPassword: TOO_SHORT_PW });
        expect(bad.status, JSON.stringify(bad.body)).toBe(400);
        expect(expectErrorEnvelope(bad.body).code).toBe(ERROR_CODES.VALIDATION);

        const missing = await http().post("/auth/reset-password").send({ token });
        expect(missing.status).toBe(400);

        // BẰNG CHỨNG pipe chạy TRƯỚC service: token còn nguyên giá trị sử dụng.
        const nextPw = pw("reset-dto-2");
        const ok = await http().post("/auth/reset-password").send({ token, newPassword: nextPw });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        expect(await login({ ...u, password: nextPw })).toBeTruthy();
      });
    });

    // ══ ROUTE 2 (risk 7) — POST /users/activation/accept · @Public SESSIONLESS · GHI ════════════
    describe("POST /users/activation/accept (@Public sessionless, risk 7)", () => {
      it("ALLOW: token mời hợp lệ → 200 { status: 'accepted' }; DB ghi accepted_at + password_hash (KHÔNG plaintext)", async () => {
        const { token, id } = await mintInvite("acc-ok");
        const plain = pw("acc-ok");

        const res = await http()
          .post("/users/activation/accept")
          .send({ companySlug: A.slug, token, password: plain });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body).toMatchObject({
          success: true,
          data: { status: "accepted" },
          error: null,
        });
        expect(JSON.stringify(res.body)).not.toContain(plain);
        expect(JSON.stringify(res.body)).not.toContain(token);

        const row = await direct.query(
          `SELECT status, accepted_at, password_hash, token_hash FROM user_invites WHERE id = $1`,
          [id],
        );
        expect(row.rows[0].status).toBe("accepted");
        expect(row.rows[0].accepted_at).not.toBeNull();
        expect(row.rows[0].password_hash).not.toBeNull();
        expect(row.rows[0].password_hash).not.toBe(plain);
        expect(row.rows[0].token_hash).not.toContain(token);
      });

      it("DENY: token ĐÃ DÙNG · token HẾT HẠN · slug KHÔNG tồn tại → CÙNG 400 + CÙNG message (uniform, không enumeration)", async () => {
        const used = await mintInvite("acc-used");
        const firstUse = await http()
          .post("/users/activation/accept")
          .send({ companySlug: A.slug, token: used.token, password: pw("acc-used") });
        expect(firstUse.status).toBe(200); // ALLOW trước.

        const reuse = await http()
          .post("/users/activation/accept")
          .send({ companySlug: A.slug, token: used.token, password: pw("acc-used-2") });
        const expired = await mintInvite("acc-exp", "-1 hour");
        const expiredRes = await http()
          .post("/users/activation/accept")
          .send({ companySlug: A.slug, token: expired.token, password: pw("acc-exp") });
        const live = await mintInvite("acc-slug");
        const badSlug = await http()
          .post("/users/activation/accept")
          .send({
            companySlug: `ghost-${randomUUID().slice(0, 8)}`,
            token: live.token,
            password: pw("acc-slug"),
          });

        for (const r of [reuse, expiredRes, badSlug]) {
          expect(r.status, JSON.stringify(r.body)).toBe(400);
        }
        const msgs = [reuse, expiredRes, badSlug].map((r) => expectErrorEnvelope(r.body).message);
        expect(new Set(msgs).size, `message phải ĐỒNG NHẤT, nhận: ${JSON.stringify(msgs)}`).toBe(1);

        // Slug sai KHÔNG được tiêu token của tenant thật (chứng minh bằng ca ALLOW sau đó).
        const rescue = await http()
          .post("/users/activation/accept")
          .send({ companySlug: A.slug, token: live.token, password: pw("acc-slug-2") });
        expect(rescue.status, JSON.stringify(rescue.body)).toBe(200);
      });

      it("400 ở BIÊN: password < 8 ký tự bị Zod chặn TRƯỚC service — lời mời KHÔNG bị tiêu", async () => {
        const { token, id } = await mintInvite("acc-dto");
        const bad = await http()
          .post("/users/activation/accept")
          .send({ companySlug: A.slug, token, password: TOO_SHORT_PW });
        expect(bad.status, JSON.stringify(bad.body)).toBe(400);
        expect(expectErrorEnvelope(bad.body).code).toBe(ERROR_CODES.VALIDATION);

        const stillPending = await direct.query(
          `SELECT status, accepted_at FROM user_invites WHERE id = $1`,
          [id],
        );
        expect(stillPending.rows[0].status).toBe("pending");
        expect(stillPending.rows[0].accepted_at).toBeNull();

        const ok = await http()
          .post("/users/activation/accept")
          .send({ companySlug: A.slug, token, password: pw("acc-dto-2") });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      });
    });

    // ══ ROUTE 3 (risk 6) — POST /auth/2fa/disable · authenticated NHƯNG UNGATED ════════════════
    describe("POST /auth/2fa/disable (authenticated, ungated, risk 6)", () => {
      it("ALLOW: re-auth mật khẩu ĐÚNG → 200 { ok:true }; HỆ QUẢ THẬT: login hết đòi bước 2 + /auth/2fa/status = false", async () => {
        const u = await newUser("2fa-ok");
        const token = await login(u);
        await enableTwoFactor(token);
        expect(await loginRequiresTwoFactor(u), "2FA phải BẬT trước khi đo ca disable").toBe(true);

        const res = await bearer(token, "/auth/2fa/disable").send({ password: u.password });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body).toMatchObject({ success: true, data: { ok: true }, error: null });
        expect(JSON.stringify(res.body)).not.toContain(u.password);

        expect(await loginRequiresTwoFactor(u)).toBe(false);
        const status = await http().get("/auth/2fa/status").set("Authorization", `Bearer ${token}`);
        expect(status.status).toBe(200);
        expect(status.body.data.enabled).toBe(false);
      });

      it("DENY: thiếu Bearer → 401 (route KHÔNG @Public — JwtAuthGuard chặn trước khi chạm service)", async () => {
        const u = await newUser("2fa-nobearer");
        const res = await http().post("/auth/2fa/disable").send({ password: u.password });
        expect(res.status, JSON.stringify(res.body)).toBe(401);
        expectErrorEnvelope(res.body);
      });

      it("DENY: Bearer rác → 401", async () => {
        const res = await bearer(["not", "a", "jwt"].join("."), "/auth/2fa/disable").send({
          password: pw("2fa-badjwt"),
        });
        expect(res.status).toBe(401);
      });

      it("DENY: re-auth SAI mật khẩu → 401 và 2FA VẪN BẬT (user riêng ⇒ không tiêu rate-limit của ca khác)", async () => {
        const u = await newUser("2fa-badpw");
        const token = await login(u);
        await enableTwoFactor(token);

        const res = await bearer(token, "/auth/2fa/disable").send({
          password: pw("2fa-badpw-wrong"),
        });
        expect(res.status, JSON.stringify(res.body)).toBe(401);
        expect(await loginRequiresTwoFactor(u)).toBe(true);
      });

      it("400 ở BIÊN: thiếu/rỗng password bị Zod chặn TRƯỚC service (min(1)) — không tiêu lần thử rate-limit", async () => {
        const u = await newUser("2fa-dto");
        const token = await login(u);
        await enableTwoFactor(token);

        const missing = await bearer(token, "/auth/2fa/disable").send({});
        const empty = await bearer(token, "/auth/2fa/disable").send({ password: "" });
        expect(missing.status, JSON.stringify(missing.body)).toBe(400);
        expect(empty.status).toBe(400);
        expect(expectErrorEnvelope(missing.body).code).toBe(ERROR_CODES.VALIDATION);

        // Mật khẩu đúng vẫn dùng được ngay sau đó ⇒ hai request 400 KHÔNG đi vào bucket rate-limit.
        const ok = await bearer(token, "/auth/2fa/disable").send({ password: u.password });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      });

      it("UNGATED nhưng TỰ-PHẠM-VI: actor không quyền gì chỉ tắt được 2FA CỦA CHÍNH MÌNH — 2FA của user khác KHÔNG đổi", async () => {
        const victim = await newUser("2fa-victim");
        const victimToken = await login(victim);
        await enableTwoFactor(victimToken);
        expect(await loginRequiresTwoFactor(victim)).toBe(true);

        const attacker = await newUser("2fa-attacker");
        const attackerToken = await login(attacker);
        await enableTwoFactor(attackerToken);

        // Route KHÔNG nhận userId từ body/param → mọi cố gắng "nhắm" nạn nhân đều rơi vào chính actor.
        const res = await bearer(attackerToken, "/auth/2fa/disable").send({
          password: attacker.password,
          userId: victim.id,
          email: victim.email,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);

        expect(await loginRequiresTwoFactor(victim), "2FA của nạn nhân PHẢI còn bật").toBe(true);
        expect(await loginRequiresTwoFactor(attacker)).toBe(false);
      });
    });
  },
);
