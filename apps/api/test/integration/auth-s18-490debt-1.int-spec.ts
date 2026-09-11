/**
 * S18-AUTH-490DEBT-1 — trả ba nợ FULL-gate còn lại của #490 (plan `docs/plans/S18-AUTH-490DEBT-1.md`).
 *
 *  • §8.2 — nhánh `account_gone` của `enroll`/`confirmEnable` ghi MỘT hàng `audit_logs` vĩnh viễn mỗi
 *    lượt mà KHÔNG counter nào chặn (`enroll` không có limiter; `confirmEnable` chỉ `recordFailure` ở
 *    nhánh `bad_code`). `audit_logs` append-only ⇒ trần lưu trữ mỗi cửa sổ là VÔ HẠN. Bản vá dựng nốt
 *    cái khoá: trần = `LOGIN_MAX_ATTEMPTS` (5) hàng / `LOGIN_LOCKOUT_SEC` (900s) / (company,user).
 *  • §8.7 — `restoreUser` gỡ yếu tố thứ hai của nạn nhân mà KHÔNG phát `user_security_events`, trong
 *    khi đường anh em `resetTwoFactor` (cùng mutation) CÓ phát `TOTP_RESET`.
 *  • §2.2 — hệ quả của chính bản vá §8.2: khoá mới chặn ĐÚNG đường khắc phục mà #490 dựng (A2 ép nạn
 *    nhân enroll, `clearLoginLocks` cố ý không gỡ họ post-auth) ⇒ `restoreUser` phải tự gỡ khoá.
 *
 * ⚠️ ĐI QUA HTTP THẬT — gọi thẳng service thì spec tự truyền `meta`, và ca `§restore-totpreset` đo
 * `ip`/`userAgent` sẽ xanh-RỖNG với dây controller.
 *
 * ⚠️ CÔ LẬP BUCKET (plan §5). Mỗi ca khoá đốt cặp `(companyId,userId)` trong 900s và KHÔNG có teardown
 * Valkey — `cleanupTenants` chỉ dọn DB. Mọi ca dưới đây dùng `seedTarget(<prefix RIÊNG>)`; TUYỆT ĐỐI
 * không dùng lại user giữa hai ca khoá, kể cả khi "trông như vẫn còn hạn mức"
 * (memory `flake-rate-tracks-lane-db-dirtiness`).
 *
 * ⚠️ `app.listen(0)`: `getHttpServer()` chưa listen thì supertest đóng server ngay khi response ĐẦU về
 * (memory `supertest-closes-shared-server-on-first-response`).
 */
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/** Seed role admin công ty (mig 0001) — mirror `auth-s18-restore2fa-1.int-spec.ts:59`. */
const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";

const PASSWORD = "Passw0rd!s18d490";

/** UA của lượt ĐO (hàng phải mang đúng chuỗi này), tách khỏi UA của các bước DỰNG trạng thái. */
const ACT_UA = "s18d490-act/1.0";
const PREP_UA = "s18d490-prep/1.0";

/**
 * `env.schema.ts:115` — ngưỡng khoá. Đọc từ hằng chứ không gõ số trần vào assert: WO nào đổi env sẽ
 * làm ca đỏ ở ĐÚNG chỗ (ngưỡng), chứ không đỏ rải rác ở sáu chỗ đếm.
 */
const MAX_ATTEMPTS = 5;

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function secretFromUri(uri: string): string {
  return new URL(uri).searchParams.get("secret") ?? "";
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

describe.skipIf(!hasDb)(
  "S18-AUTH-490DEBT-1 — trần ghi nhánh từ chối 2FA + TOTP_RESET khi restore",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let twoFactor: TwoFactorService;
    let totp: TotpService;
    let secrets: SecretEncryptionService;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let adminToken: string;

    async function seedTarget(
      prefix: string,
      asAdminRole = false,
    ): Promise<{ id: string; email: string }> {
      const email = `s18d490-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
      const id = await seedUser(direct, A.companyId, email, await hashedPw());
      if (asAdminRole) await seedUserRole(direct, id, COMPANY_ADMIN_ROLE_ID, A.companyId);
      return { id, email };
    }

    /** Login KHI 2FA CÒN TẮT → access token (JWT stateless, sống qua cả lượt xoá mềm). */
    async function loginToken(email: string, ua = PREP_UA): Promise<string> {
      const res = await api(app)
        .post("/auth/login")
        .set("User-Agent", ua)
        .send({ companySlug: A.slug, email, password: PASSWORD });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** Bật 2FA THẬT qua service (dựng trạng thái — không phải hàng đo). */
    async function enable2fa(userId: string, companyId: string): Promise<void> {
      const { otpauthUri } = await twoFactor.enroll(userId, companyId, {});
      const secret = secretFromUri(otpauthUri);
      await twoFactor.confirmEnable(userId, companyId, totp.generate(secret), {});
      expect(await twoFactor.isEnabled(userId, companyId)).toBe(true);
    }

    async function softDelete(id: string): Promise<void> {
      await direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [id]);
    }

    function postEnroll(token: string, ua = ACT_UA) {
      return api(app)
        .post("/auth/2fa/enroll")
        .set("Authorization", `Bearer ${token}`)
        .set("User-Agent", ua)
        .send();
    }

    function postEnable(token: string, code: string, ua = ACT_UA) {
      return api(app)
        .post("/auth/2fa/enable")
        .set("Authorization", `Bearer ${token}`)
        .set("User-Agent", ua)
        .send({ token: code });
    }

    function postRestore(id: string, ua = ACT_UA) {
      return api(app)
        .post(`/auth/users/${id}/restore`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("User-Agent", ua)
        .send();
    }

    async function auditCount(userId: string, action: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE object_id = $1 AND action = $2`,
        [userId, action],
      );
      return r.rows[0].n as number;
    }

    async function securityEventCount(userId: string, eventType: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM user_security_events WHERE user_id = $1 AND event_type = $2`,
        [userId, eventType],
      );
      return r.rows[0].n as number;
    }

    async function securityEventRow(
      userId: string,
      eventType: string,
    ): Promise<{ actorUserId: string | null; ip: string | null; userAgent: string | null }> {
      const r = await direct.query(
        `SELECT actor_user_id, ip_address, user_agent FROM user_security_events
         WHERE user_id = $1 AND event_type = $2 ORDER BY created_at DESC LIMIT 1`,
        [userId, eventType],
      );
      expect(r.rows.length, `không tìm thấy security event '${eventType}' cho ${userId}`).toBe(1);
      return {
        actorUserId: r.rows[0].actor_user_id as string | null,
        ip: r.rows[0].ip_address as string | null,
        userAgent: r.rows[0].user_agent as string | null,
      };
    }

    async function enabledAt(userId: string): Promise<Date | null> {
      const r = await direct.query(`SELECT enabled_at FROM user_totp WHERE user_id = $1`, [userId]);
      return (r.rows[0]?.enabled_at as Date | null) ?? null;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.listen(0);
      direct = directPool();
      twoFactor = app.get(TwoFactorService);
      totp = app.get(TotpService);
      // Lấy SAU `app.listen(0)` — instance thật trong container, đúng cái `TwoFactorService` đang cầm.
      secrets = app.get(SecretEncryptionService);

      A = await seedCompany(direct, "s18d490");
      companyIds.push(A.companyId);

      const admin = await seedTarget("adm", true);
      adminToken = await loginToken(admin.email);
    });

    afterAll(async () => {
      await app?.close();
      await cleanupTenants(direct, companyIds);
    });

    // ══ §8.2 — `enroll` (bề mặt MỚI: trước WO này không có limiter nào) ══════════════════════════

    /**
     * §enroll-allow — ĐỐI CHỨNG DƯƠNG, ca này phải đứng TRƯỚC mọi ca 429 bên dưới về mặt lập luận:
     * thiếu nó thì một bản vá "khoá tất cả" cũng làm mọi ca deny xanh
     * (memory `deny-cases-vacuous-without-allow-case`).
     *
     * Đo tính chất KHÁC `§allow-enroll` của `auth-s18-restore2fa-1.int-spec.ts:235` (ca đó đo "enroll +
     * enable được"): ở đây là "lặp QUÁ ngưỡng mà KHÔNG bị khoá", tức `recordFailure` không được đặt
     * nhầm vào đường thành công.
     */
    it("§enroll-allow: user BÌNH THƯỜNG enroll 6 lượt liên tiếp ⇒ cả 6 đều 200, KHÔNG 429", async () => {
      const target = await seedTarget("enrollallow");
      const token = await loginToken(target.email);

      for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
        const res = await postEnroll(token);
        expect(res.status, `lượt ${i}: ${JSON.stringify(res.body)}`).toBe(200);
      }
    });

    /**
     * §enroll-rl-lock — 🔴 ĐỎ TRƯỚC VÁ (hôm nay `enroll` không có limiter ⇒ lượt thứ 6 vẫn 401).
     * Đột biến: bỏ `recordFailure` ở nhánh `account_gone` ⇒ không bao giờ khoá ⇒ ca ĐỎ.
     */
    it("§enroll-rl-lock: user xoá mềm + token sống ⇒ 5 lượt 401, lượt thứ 6 là 429 kèm Retry-After", async () => {
      const target = await seedTarget("enrolllock");
      const token = await loginToken(target.email);
      await softDelete(target.id);

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const res = await postEnroll(token);
        expect(res.status, `lượt ${i}: ${JSON.stringify(res.body)}`).toBe(401);
      }
      const locked = await postEnroll(token);
      expect(locked.status, JSON.stringify(locked.body)).toBe(429);
      expect(locked.headers["retry-after"], "429 phải mang Retry-After").toBeTruthy();
    });

    /**
     * §enroll-rl-ceiling — BẤT BIẾN THẬT của §8.2 (429 chỉ là hệ quả): trần hàng append-only.
     *
     * ⚠️ `=== MAX_ATTEMPTS`, KHÔNG `<=`. `<=` xanh cả khi đếm = 0 — tức xanh cả khi nhánh từ chối NGỪNG
     * ghi vết, giết đúng nửa quan sát của luật `lock-observability-rule` ("đường DỰNG NÊN khoá phải để
     * lại vết"). Đẳng thức còn bắt được "recordFailure gọi hai lần mỗi lượt" và "đọc nhầm env ngưỡng".
     */
    it("§enroll-rl-ceiling: 10 lượt ⇒ ĐÚNG 5 hàng auth.2fa_enroll_denied (trần, không phải vô hạn)", async () => {
      const target = await seedTarget("enrollceil");
      const token = await loginToken(target.email);
      await softDelete(target.id);

      for (let i = 0; i < 10; i++) await postEnroll(token);

      expect(await auditCount(target.id, "auth.2fa_enroll_denied")).toBe(MAX_ATTEMPTS);
    });

    /**
     * §enroll-rl-before-kms — `isLocked` phải đứng TRƯỚC `encryptSecret` (plan §4 D1 bước 2). Để sau
     * thì khoá chỉ chặn đường ghi DB mà vẫn để KMS bị gọi miễn phí — đúng nửa lỗ mà #490 §8.2 câu 1 ghi.
     *
     * ⚠️ Assert là "KHÔNG TĂNG", không phải "không được gọi": muốn tới trạng thái đang-khoá thì phải
     * chạy `MAX_ATTEMPTS` lượt trước, mà mỗi lượt đó CÓ gọi `encryptSecret`.
     */
    it("§enroll-rl-before-kms: đang khoá ⇒ encryptSecret KHÔNG được gọi thêm và KHÔNG ghi thêm hàng audit", async () => {
      const target = await seedTarget("enrollkms");
      const token = await loginToken(target.email);
      await softDelete(target.id);

      for (let i = 0; i < MAX_ATTEMPTS; i++) await postEnroll(token);

      const spy = vi.spyOn(secrets, "encryptSecret");
      const auditBefore = await auditCount(target.id, "auth.2fa_enroll_denied");
      try {
        const locked = await postEnroll(token);
        expect(locked.status, JSON.stringify(locked.body)).toBe(429);
        expect(
          spy,
          "lượt đang-khoá vẫn gọi KMS ⇒ isLocked đang nằm SAU encryptSecret",
        ).not.toHaveBeenCalled();
        expect(await auditCount(target.id, "auth.2fa_enroll_denied")).toBe(auditBefore);
      } finally {
        spy.mockRestore();
      }
    });

    /**
     * §enroll-rl-noreauth — RANH GIỚI NHÃN, assert RIÊNG (plan §4 D2): `recordFailure` là bộ ĐẾM nên
     * được phép ở nhánh `account_gone`; `recordReauthFailure` là NHÃN "xác thực lại thất bại" và D1.d
     * của #490 CẤM nó ở nhánh này — lượt đó không phải "nhập sai mã".
     *
     * Bằng chứng bộ đếm `REAUTH_FAILED` CÓ THỂ tăng (chống xanh-rỗng cho một assert-0): `§meta-enable`
     * ở `auth-s18-restore2fa-1.int-spec.ts:572`.
     */
    it("§enroll-rl-noreauth: chuỗi enroll bị từ chối KHÔNG đẻ REAUTH_FAILED nào", async () => {
      const target = await seedTarget("enrollnoreauth");
      const token = await loginToken(target.email);
      await softDelete(target.id);

      for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await postEnroll(token);

      expect(await securityEventCount(target.id, "REAUTH_FAILED")).toBe(0);
    });

    // ══ §8.2 — `confirmEnable` ══════════════════════════════════════════════════════════════════

    /**
     * §enable-deny-rl — 🔴 ĐỎ TRƯỚC VÁ. Kế thừa hai vế của ca cũ `§enable-deny-norl`:
     *  • mỗi lượt dùng mã TOTP ĐÚNG ⇒ ghim "401 đến từ `deleted_at`, KHÔNG phải `bad_code`";
     *  • `enabled_at` vẫn NULL ⇒ lặp bao nhiêu lượt cũng không bật được.
     * Cộng vế MỚI: lượt thứ 6 đổi hình thành 429, và trần audit = 5.
     *
     * ⚠️ `REAUTH_FAILED` = 0 phải đo TRONG CÙNG ca này, không tách ra ca khác: 429 ở đây có thể đến từ
     * `recordFailure` MỚI của `account_gone` HOẶC `recordFailure` sẵn có của `bad_code` (`:322`). Vế
     * assert-0 là thứ quy 429 về đúng nhánh (`overdetermined-gate-makes-deny-spec-vacuous`).
     */
    it("§enable-deny-rl: enroll hợp lệ → xoá mềm → enable mã ĐÚNG lặp ⇒ 5×401 rồi 429, enabled_at NULL, REAUTH_FAILED 0", async () => {
      const target = await seedTarget("enablerl");
      const token = await loginToken(target.email);

      const enroll = await postEnroll(token, PREP_UA);
      expect(enroll.status, JSON.stringify(enroll.body)).toBe(200);
      const secret = secretFromUri(enroll.body.data.otpauthUri as string);
      await softDelete(target.id);

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const res = await postEnable(token, totp.generate(secret));
        expect(res.status, `lượt ${i}: ${JSON.stringify(res.body)}`).toBe(401);
      }
      const locked = await postEnable(token, totp.generate(secret));
      expect(locked.status, JSON.stringify(locked.body)).toBe(429);
      expect(locked.headers["retry-after"]).toBeTruthy();

      expect(await auditCount(target.id, "auth.2fa_enable_denied")).toBe(MAX_ATTEMPTS);
      expect(await enabledAt(target.id), "lặp tới khoá vẫn KHÔNG được bật 2FA").toBeNull();
      expect(
        await securityEventCount(target.id, "REAUTH_FAILED"),
        "nhánh account_gone bị gắn nhãn REAUTH_FAILED — sai nhãn, đảo D1.d của #490",
      ).toBe(0);
    });

    /**
     * §enable-allow — ĐỐI CHỨNG DƯƠNG cho khoá `2fa-enable`: user CÒN SỐNG sai mã vài lượt (dưới
     * ngưỡng) rồi nhập ĐÚNG ⇒ vẫn bật được. Thiếu ca này thì `§enable-deny-rl` xanh cả với một bản vá
     * khoá-tất-cả.
     */
    it("§enable-allow: user còn sống sai mã 2 lượt rồi nhập ĐÚNG ⇒ bật được, KHÔNG 429", async () => {
      const target = await seedTarget("enableallow");
      const token = await loginToken(target.email);

      const enroll = await postEnroll(token, PREP_UA);
      expect(enroll.status, JSON.stringify(enroll.body)).toBe(200);
      const secret = secretFromUri(enroll.body.data.otpauthUri as string);

      for (let i = 0; i < 2; i++) {
        const bad = await postEnable(token, "000000");
        expect(
          bad.status,
          `mã sai DƯỚI ngưỡng KHÔNG được khoá — lượt ${i}: ${JSON.stringify(bad.body)}`,
        ).toBe(401);
      }
      const ok = await postEnable(token, totp.generate(secret));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(await enabledAt(target.id)).not.toBeNull();
    });

    // ══ §8.7 + §2.2 — `restoreUser` ═════════════════════════════════════════════════════════════

    /**
     * §restore-totpreset — 🔴 ĐỎ TRƯỚC VÁ. `restoreUser` gỡ yếu tố thứ hai của nạn nhân; dòng thời gian
     * bảo mật của CHÍNH nạn nhân phải thấy điều đó, không chỉ `audit_logs.after.twoFactorReset` (thứ
     * người dùng cuối không đọc). Đường anh em `resetTwoFactor` đã phát `TOTP_RESET` cho cùng mutation.
     *
     * `actorUserId` = ADMIN (người thực hiện), `userId` = nạn nhân — mirror `USER_RESTORED` ngay dưới nó.
     */
    it("§restore-totpreset: user từng BẬT 2FA → xoá mềm → restore ⇒ đúng 1 hàng TOTP_RESET mang actor+ip+UA", async () => {
      const target = await seedTarget("restotp");
      await enable2fa(target.id, A.companyId);
      await softDelete(target.id);

      const res = await postRestore(target.id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expect(await securityEventCount(target.id, "TOTP_RESET")).toBe(1);
      const row = await securityEventRow(target.id, "TOTP_RESET");
      expect(row.userAgent, "TOTP_RESET: userAgent").toBe(ACT_UA);
      expect(row.ip, "TOTP_RESET: ip").toBeTruthy();
      expect(
        row.actorUserId,
        "actor phải là ADMIN thực hiện restore, không phải nạn nhân",
      ).not.toBe(target.id);
      // Hàng cũ vẫn phải còn — bản vá THÊM một hàng, không thay thế hàng nào.
      expect(await securityEventCount(target.id, "USER_RESTORED")).toBe(1);
    });

    /**
     * §restore-totpreset-neg — CA ÂM BẮT BUỘC. Owner chốt "CHỈ KHI `twoFactorWasEnabled`". Không có ca
     * này thì một bản vá phát VÔ ĐIỀU KIỆN vẫn xanh ⇒ ca dương một mình không chứng minh được điều
     * đã chốt.
     */
    it("§restore-totpreset-neg: user CHƯA TỪNG bật 2FA → restore ⇒ 0 hàng TOTP_RESET (USER_RESTORED vẫn có)", async () => {
      const target = await seedTarget("restotpneg");
      await softDelete(target.id);

      const res = await postRestore(target.id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expect(await securityEventCount(target.id, "TOTP_RESET")).toBe(0);
      expect(await securityEventCount(target.id, "USER_RESTORED")).toBe(1);
    });

    /**
     * §restore-unlocks-enroll — §2.2: khoá `2fa-enroll` do CHÍNH bản vá §8.2 dựng nên chặn đúng đường
     * khắc phục. Sau A2 của #490, `require_two_factor=true` ⇒ `TwoFactorEnforcementGuard` ÉP nạn nhân
     * enroll; `clearLoginLocks` cố ý KHÔNG gỡ bucket post-auth ⇒ nếu `restoreUser` không tự gỡ thì nạn
     * nhân kẹt 900s và admin bất lực.
     *
     * 🔴 CA NÀY TỪNG MÙ MỘT NỬA — security-reviewer FULL gate 11/09 (HIGH). Bản đầu chỉ đo tới vế
     * `enroll` trả 200 rồi dừng, nên nó XANH trong khi nạn nhân vẫn kẹt: kẻ tấn công khoá được CẢ
     * bucket `2fa-enable` (nhánh `account_gone` của `confirmEnable` đứng TRƯỚC `loadTotp` ⇒ không cần
     * hàng enroll nào), mà `confirmEnable` là nơi DUY NHẤT set `enabled_at` — đúng cờ mà
     * `TwoFactorEnforcementGuard` đòi. Enroll được mà không bật được thì vẫn 403 mọi route.
     * ⇒ Ca phải đi HẾT đường thoát: enroll **và** enable.
     *
     * Đột biến: bỏ `2fa-enroll` khỏi `TWO_FACTOR_SETUP_BUCKETS` ⇒ vế enroll ĐỎ; bỏ `2fa-enable` ⇒ vế
     * enable ĐỎ. Mỗi bucket một vế — không vế nào che vế nào.
     */
    it("§restore-unlocks-enroll: kẻ tấn công khoá CẢ HAI bucket → admin restore ⇒ nạn nhân enroll VÀ enable lại được", async () => {
      const target = await seedTarget("resunlock");
      const token = await loginToken(target.email);
      await enable2fa(target.id, A.companyId);
      await softDelete(target.id);

      // Kẻ tấn công giữ access token cũ, bồi CẢ HAI bucket cho tới khi khoá dựng xong.
      for (let i = 0; i < MAX_ATTEMPTS; i++) await postEnroll(token);
      expect(
        (await postEnroll(token)).status,
        "tiền đề: khoá `2fa-enroll` phải THẬT SỰ dựng được",
      ).toBe(429);
      // `postEnable` với mã bất kỳ — nhánh `account_gone` chặn TRƯỚC khi đọc mã, nên không cần secret.
      for (let i = 0; i < MAX_ATTEMPTS; i++) await postEnable(token, "000000");
      expect(
        (await postEnable(token, "000000")).status,
        "tiền đề: khoá `2fa-enable` phải THẬT SỰ dựng được",
      ).toBe(429);

      const res = await postRestore(target.id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      // Nạn nhân đăng nhập lại (hàng đã sống) rồi đi HẾT đường thoát khỏi guard ép-2FA.
      const freshToken = await loginToken(target.email);
      const enroll = await postEnroll(freshToken);
      expect(
        enroll.status,
        `restore KHÔNG gỡ khoá 2fa-enroll: ${JSON.stringify(enroll.body)}`,
      ).toBe(200);
      const secret = secretFromUri(enroll.body.data.otpauthUri as string);
      const enable = await postEnable(freshToken, totp.generate(secret));
      expect(
        enable.status,
        `restore KHÔNG gỡ khoá 2fa-enable ⇒ nạn nhân enroll được nhưng KHÔNG BẬT được, và ` +
          `TwoFactorEnforcementGuard đòi đúng cờ enabled_at ⇒ 403 mọi route: ${JSON.stringify(enable.body)}`,
      ).toBe(200);
      expect(await enabledAt(target.id), "đi hết đường thoát thì 2FA phải BẬT được").not.toBeNull();
    });
  },
);
