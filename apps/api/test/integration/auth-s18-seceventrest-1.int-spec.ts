/**
 * S18-AUTH-SECEVENTREST-1 — 9 điểm ghi `user_security_events` NGOÀI đường mật khẩu phải mang
 * `ip_address` + `user_agent` (và hàng `audit_logs` ANH EM cùng tx cũng vậy).
 *
 * `S18-AUTH-SECEVENTMETA-1` (#486) đã nối `RequestMeta` cho 9 hàng của **đường mật khẩu**. Phần còn
 * lại của HAI file `auth/auth.service.ts` + `users/auth-users.service.ts` — *quản lý phiên* và *thao
 * tác admin trên tài khoản* — vẫn VÔ DANH: bảng có sẵn cột (`migrations/0443_…:146-147`), writer đã
 * nhận `ip?`/`userAgent?` (`security-event-writer.service.ts:18-19`), nhưng không method nào nhận
 * `RequestMeta`.
 *
 * Hai điểm đáng giá nhất là hai NÚT ADMIN CHẠY MỖI NGÀY: `unlockUser` («Mở khoá tài khoản») và
 * `clearLoginThrottle` («Gỡ khoá đăng nhập»). Sau #486, bảng có BA họ `USER_UNLOCKED` mà chỉ họ
 * `payload.reason='password_reset'` (nhánh degraded, hiếm khi chạy) mang ip/UA.
 *
 * ⚠️ BẪY TRUNG TÂM — VÌ SAO PHẢI ĐI QUA HTTP (plan §3 D5.1).
 * Khiếm khuyết nằm ở **dây nối controller→service**. `security-event-emit-sites.int-spec.ts` gọi
 * THẲNG service cho 5/9 method (`:284, :304, :326, :379, :399`); sau khi `meta` thành tham số bắt
 * buộc, spec đó **tự truyền meta** ⇒ xanh kể cả khi controller quên nối dây. Mọi ca dưới đây bắt đầu
 * từ một request supertest thật rồi đọc thẳng bảng qua `directPool`.
 *
 * ⚠️ `logout` có BỐN điểm gọi ở controller, không phải một (plan §2g).
 * `auth.controller.ts:141` là đường **cookie** (production web dùng nó) và `:143` là đường **body**.
 * supertest không tự mang cookie ⇒ một ca chỉ gửi body sẽ chỉ chạm `:143`, và nối dây `:143` mà quên
 * `:141` cho ra ca XANH trong khi đường thật vẫn NULL. Nên điểm #1 có **hai** ca.
 *
 * ⚠️ NHIỀU WRITER CHUNG MỘT `event_type` / `action` (plan §2b + §5).
 * `SESSION_REVOKED` có 3 writer (`family`/`single`/`others`), `USER_UNLOCKED` có 3 họ,
 * `USER_LOCKED` có 2 writer (`lockUser` admin · `emitAccountLocked` tự động),
 * `auth.session_revoked` có 2 writer với `object_id` KHÁC NGỮ NGHĨA. ⇒ mọi truy vấn khoá
 * `user_id`/`object_id` của chính ca đó + lọc họ + `rowCount === 1`, và mỗi ca dùng USER RIÊNG.
 *
 * ⚠️ `audit_logs` của `revokeSession` ghi `objectId: SESSIONID`, không phải userId
 * (`auth.service.ts:1355`) ⇒ helper `auditRow` nhận `objectId`, KHÔNG nhận `userId`.
 *
 * ⚠️ `revokeOtherSessions` THOÁT SỚM khi không có phiên nào khác (`auth.service.ts:1386`
 * `if (targets.length === 0) return 0;`) ⇒ ca `§revoke-others` phải login HAI lần, nếu không nó đỏ
 * vĩnh viễn vì 0 hàng được ghi.
 *
 * ⚠️ NEO CHỐNG-NHIỄU `PREP_UA` (plan §3 D5.4 — vai trò tương đương `MINT_IP` của #486). Mọi request
 * DỰNG TRẠNG THÁI (login, lock-trước-khi-unlock, delete-trước-khi-restore) gửi `PREP_UA`; hàng đo
 * assert `user_agent === UA của request ĐANG ĐO`. Thiếu neo này, một ca vẫn xanh khi giá trị được
 * chép từ request TRƯỚC đó.
 *
 * ⚠️ NEO "CỦA ADMIN, KHÔNG PHẢI CỦA NẠN NHÂN" (#486 D6). Trong int-spec cả admin lẫn nạn nhân đều
 * 127.0.0.1 ⇒ `ip` KHÔNG phân biệt được ai. Nên 6 ca đường admin cho nạn nhân đăng nhập trước bằng
 * `VICTIM_UA` rồi assert hàng đo `!== VICTIM_UA` + `actor_user_id === admin.id`.
 *
 * ⚠️ MỖI CA MỘT USER RIÊNG — vừa để `rowCount === 1` đứng vững, vừa tránh bucket rate-limit per-user
 * (memory `per-user-rate-limit-throttles-own-int-spec`). Admin đăng nhập ĐÚNG MỘT LẦN ở `beforeAll`.
 *
 * ⚠️ `app.listen(0)` + `app.close()` (memory `supertest-closes-shared-server-on-first-response` +
 * ratchet `supertest-listen-census.ts:268-272`).
 */
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, REFRESH_COOKIE_NAME } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";
const PASSWORD = "Passw0rd!s18rest";

/** UA của MỌI request dựng trạng thái. Hàng đo PHẢI KHÁC giá trị này (xem docblock). */
const PREP_UA = "s18rest-prep/0.0";
/** UA của nạn nhân ở 6 ca đường admin — chứng minh vết là của NGƯỜI BẤM NÚT. */
const VICTIM_UA = "s18rest-victim-browser/9.9";
/** UA của admin ở 6 ca đường admin. */
const ADMIN_UA = "s18rest-admin/1.0";

/**
 * `trust proxy` chỉ bật ở `main.ts:34`, mà int-spec dựng app bằng `Test.createTestingModule()` ⇒
 * `main.ts` KHÔNG BAO GIỜ chạy ⇒ `req.ip` là loopback thô. Assert theo TẬP loopback (không hard-code
 * một giá trị) để không giòn theo stack mạng của máy chạy.
 */
const LOOPBACK = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/;

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

/** Tách 1 cookie value (raw, chưa decode) từ mảng Set-Cookie — khuôn `auth-session.int-spec.ts:41-49`. */
function cookieValue(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined;
  for (const c of setCookie) {
    const m = c.match(new RegExp(`^${name}=([^;]*)`));
    if (m) return m[1];
  }
  return undefined;
}

type MetaRow = { ip: string | null; userAgent: string | null; actorUserId: string | null };

describe.skipIf(!hasDb)(
  "S18-AUTH-SECEVENTREST-1 — ip/userAgent cho 9 điểm ghi ngoài đường mật khẩu",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    /** Admin dùng chung cho 6 ca đường admin — login ĐÚNG MỘT LẦN (xem docblock). */
    let adminId: string;
    let adminToken: string;

    async function seedTarget(
      prefix: string,
      asAdmin = false,
    ): Promise<{ id: string; email: string }> {
      const email = `s18rest-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
      const id = await seedUser(direct, A.companyId, email, await hashedPw());
      if (asAdmin) await seedUserRole(direct, id, COMPANY_ADMIN_ROLE_ID, A.companyId);
      return { id, email };
    }

    /** Login qua HTTP THẬT. Trả access token + refresh token (body giữ nguyên) + cookie SSO. */
    async function login(
      email: string,
      ua: string,
    ): Promise<{ accessToken: string; refreshToken: string; refreshCookie: string; csrf: string }> {
      const res = await api(app)
        .post("/auth/login")
        .set("User-Agent", ua)
        .send({ companySlug: A.slug, email, password: PASSWORD });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
      return {
        accessToken: res.body.data.accessToken as string,
        refreshToken: res.body.data.refreshToken as string,
        refreshCookie: cookieValue(setCookie, REFRESH_COOKIE_NAME)!,
        csrf: cookieValue(setCookie, CSRF_COOKIE_NAME)!,
      };
    }

    /**
     * Hàng `user_security_events` DUY NHẤT khớp (user_id, event_type[, lọc họ]).
     *
     * `extra` là mảnh SQL HẰNG do chính spec viết (không có input người dùng) để phân biệt HỌ —
     * `SESSION_REVOKED` có 3 writer và `USER_UNLOCKED` có 3 họ, nên thiếu nó thì `rowCount === 1`
     * hoặc gãy, hoặc trả `rows[0]` là hàng của họ khác ⇒ ca xanh mà chứng minh nhầm thứ.
     */
    async function secRow(userId: string, eventType: string, extra = ""): Promise<MetaRow> {
      const r = await direct.query(
        `SELECT ip_address, user_agent, actor_user_id
           FROM user_security_events
          WHERE user_id = $1 AND event_type = $2 ${extra}`,
        [userId, eventType],
      );
      expect(r.rowCount, `mong ĐÚNG 1 hàng '${eventType}'${extra} cho user ${userId}`).toBe(1);
      return {
        ip: r.rows[0].ip_address as string | null,
        userAgent: r.rows[0].user_agent as string | null,
        actorUserId: r.rows[0].actor_user_id as string | null,
      };
    }

    /**
     * Hàng `audit_logs` DUY NHẤT khớp (object_id, action).
     *
     * ⚠️ Tham số đầu là `objectId`, KHÔNG phải userId: `revokeSession` ghi `objectId: sessionId`
     * (`auth.service.ts:1355`) trong khi 8 hàng còn lại ghi userId. Một helper `auditRow(userId, …)`
     * chép từ #486 sẽ trả 0 hàng ở đúng ca đó.
     */
    async function auditRow(objectId: string, action: string): Promise<MetaRow> {
      const r = await direct.query(
        `SELECT ip, user_agent, actor_user_id FROM audit_logs WHERE object_id = $1 AND action = $2`,
        [objectId, action],
      );
      expect(r.rowCount, `mong ĐÚNG 1 hàng audit '${action}' cho object ${objectId}`).toBe(1);
      return {
        ip: r.rows[0].ip as string | null,
        userAgent: r.rows[0].user_agent as string | null,
        actorUserId: r.rows[0].actor_user_id as string | null,
      };
    }

    /**
     * Ba vế của phép đo. `toBe(ua)` là assert GIÁ TRỊ (không `not.toBeNull()`): nó vừa chứng minh có
     * ip/UA, vừa chứng minh chúng đến từ ĐÚNG request đang đo — mọi UA khác trong file (PREP_UA,
     * VICTIM_UA) đều làm nó đỏ.
     */
    function expectMeta(row: MetaRow, ua: string, what: string): void {
      expect(row.userAgent, what).toBe(ua);
      expect(row.ip, what).toMatch(LOOPBACK);
      expect(row.userAgent, `${what} — không được chép từ request DỰNG TRẠNG THÁI`).not.toBe(
        PREP_UA,
      );
    }

    /** Neo riêng cho 6 ca đường admin: vết phải là của NGƯỜI BẤM NÚT, không phải của nạn nhân. */
    function expectAdminMeta(row: MetaRow, what: string): void {
      expectMeta(row, ADMIN_UA, what);
      expect(row.userAgent, `${what} — vết phải là của ADMIN`).not.toBe(VICTIM_UA);
      expect(row.actorUserId, `${what} — actor phải là admin`).toBe(adminId);
    }

    /** Nạn nhân MỚI đã đăng nhập thật bằng VICTIM_UA (xem docblock: neo "của admin"). */
    async function seedVictim(prefix: string): Promise<{ id: string; email: string }> {
      const victim = await seedTarget(prefix);
      await login(victim.email, VICTIM_UA);
      return victim;
    }

    function asAdmin(req: request.Test, ua = ADMIN_UA): request.Test {
      return req.set("Authorization", `Bearer ${adminToken}`).set("User-Agent", ua);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.listen(0);
      direct = directPool();

      A = await seedCompany(direct, "s18rest");
      companyIds.push(A.companyId);

      const admin = await seedTarget("adm", true);
      adminId = admin.id;
      adminToken = (await login(admin.email, PREP_UA)).accessToken;
    });

    afterAll(async () => {
      await app?.close();
      await cleanupTenants(direct, companyIds);
    });

    // ── #1 SESSION_REVOKED (family) — `logout`. HAI ca vì controller có HAI điểm gọi (§2g). ──────

    it("§logout-cookie — logout ĐƯỜNG COOKIE (đường production) ⇒ SESSION_REVOKED + auth.logout mang ip/UA", async () => {
      const UA = "s18rest-logout-cookie/1.0";
      const u = await seedTarget("logoutc");
      const { refreshCookie, csrf } = await login(u.email, PREP_UA);

      const res = await api(app)
        .post("/auth/logout")
        .set("Cookie", `${REFRESH_COOKIE_NAME}=${refreshCookie}; ${CSRF_COOKIE_NAME}=${csrf}`)
        .set(CSRF_HEADER_NAME, csrf)
        .set("User-Agent", UA)
        .send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expectMeta(
        await secRow(u.id, "SESSION_REVOKED", `AND payload->>'scope' = 'family'`),
        UA,
        "SESSION_REVOKED/family",
      );
      expectMeta(await auditRow(u.id, "auth.logout"), UA, "auth.logout");
    });

    it("§logout-body — logout ĐƯỜNG BODY (mobile/Bearer) ⇒ SESSION_REVOKED + auth.logout mang ip/UA", async () => {
      const UA = "s18rest-logout-body/1.0";
      const u = await seedTarget("logoutb"); // user RIÊNG — cùng user ⇒ 2 hàng, rowCount===1 gãy
      const { refreshToken } = await login(u.email, PREP_UA);

      const res = await api(app).post("/auth/logout").set("User-Agent", UA).send({ refreshToken });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expectMeta(
        await secRow(u.id, "SESSION_REVOKED", `AND payload->>'scope' = 'family'`),
        UA,
        "SESSION_REVOKED/family",
      );
      expectMeta(await auditRow(u.id, "auth.logout"), UA, "auth.logout");
    });

    // ── #2 SESSION_REVOKED (single) — `revokeSession` ────────────────────────────────────────────

    it("§revoke-one — thu hồi 1 phiên ⇒ SESSION_REVOKED + auth.session_revoked (object_id = SESSIONID) mang ip/UA", async () => {
      const UA = "s18rest-revoke-one/1.0";
      const u = await seedTarget("rvone");
      const first = await login(u.email, PREP_UA);
      const list = await api(app)
        .get("/auth/sessions")
        .set("Authorization", `Bearer ${first.accessToken}`)
        .set("User-Agent", PREP_UA);
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      // Gate review (LOW): `.find(...).id` trần ném TypeError thay vì AssertionError khi không thấy
      // phiên hiện tại ⇒ lượt đỏ tương lai khó chẩn đoán. Neo bằng assert TRƯỚC khi đọc `.id`.
      const current = list.body.data.find((s: { is_current: boolean }) => s.is_current) as
        | { id: string }
        | undefined;
      expect(current, JSON.stringify(list.body)).toBeTruthy();
      const sessionId = current!.id;

      // Phiên THỨ HAI để thu hồi phiên thứ nhất mà không tự khoá mình (khuôn
      // `auth-session-selfservice.int-spec.ts:160-170`).
      const second = await login(u.email, PREP_UA);
      const res = await api(app)
        .post(`/auth/sessions/${sessionId}/revoke`)
        .set("Authorization", `Bearer ${second.accessToken}`)
        .set("User-Agent", UA);
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expectMeta(
        await secRow(u.id, "SESSION_REVOKED", `AND payload->>'scope' = 'single'`),
        UA,
        "SESSION_REVOKED/single",
      );
      // ⚠️ object_id là sessionId, KHÔNG phải u.id.
      expectMeta(
        await auditRow(sessionId, "auth.session_revoked"),
        UA,
        "auth.session_revoked/single",
      );
    });

    // ── #3 SESSION_REVOKED (others) — `revokeOtherSessions` ──────────────────────────────────────

    it("§revoke-others — thu hồi phiên khác ⇒ SESSION_REVOKED + auth.session_revoked (object_id = userId) mang ip/UA", async () => {
      const UA = "s18rest-revoke-others/1.0";
      const u = await seedTarget("rvoth"); // user RIÊNG — tránh đụng hàng `scope='single'` của ca trên
      // HAI lần login: `revokeOtherSessions` thoát sớm khi targets rỗng (`auth.service.ts:1386`) ⇒
      // một phiên duy nhất ⇒ 0 hàng ghi ⇒ ca đỏ vĩnh viễn dù code đúng.
      await login(u.email, PREP_UA);
      const current = await login(u.email, PREP_UA);

      const res = await api(app)
        .post("/auth/sessions/revoke-others")
        .set("Authorization", `Bearer ${current.accessToken}`)
        .set("User-Agent", UA);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.revoked_count).toBeGreaterThanOrEqual(1);

      expectMeta(
        await secRow(u.id, "SESSION_REVOKED", `AND payload->>'scope' = 'others'`),
        UA,
        "SESSION_REVOKED/others",
      );
      expectMeta(await auditRow(u.id, "auth.session_revoked"), UA, "auth.session_revoked/others");
    });

    // ── #4 TOTP_RESET — `resetTwoFactor` ─────────────────────────────────────────────────────────

    it("§2fa-reset — admin gỡ 2FA ⇒ TOTP_RESET + user.2fa_reset mang ip/UA của ADMIN", async () => {
      const victim = await seedVictim("2fa");

      const res = await asAdmin(api(app).post(`/auth/users/${victim.id}/2fa/reset`)).send();
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expectAdminMeta(await secRow(victim.id, "TOTP_RESET"), "TOTP_RESET");
      expectAdminMeta(await auditRow(victim.id, "user.2fa_reset"), "user.2fa_reset");
    });

    // ── #5 USER_LOCKED — `lockUser` ──────────────────────────────────────────────────────────────

    it("§lock — admin khoá tài khoản ⇒ USER_LOCKED + user.locked mang ip/UA của ADMIN", async () => {
      const victim = await seedVictim("lock");

      const res = await asAdmin(api(app).post(`/auth/users/${victim.id}/lock`)).send({
        reason: "s18rest",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      // Neo `actorUserId` (trong expectAdminMeta) là BẮT BUỘC ở đây: `USER_LOCKED` có writer thứ hai
      // (`auth.service.ts:2451` `emitAccountLocked`, actor = CHÍNH user) — thiếu neo thì một hàng
      // auto-lock lọt vào vẫn cho ca xanh.
      expectAdminMeta(await secRow(victim.id, "USER_LOCKED"), "USER_LOCKED");
      expectAdminMeta(await auditRow(victim.id, "user.locked"), "user.locked");
    });

    // ── #6 USER_UNLOCKED (payload vắng) — `unlockUser` ───────────────────────────────────────────

    it("§unlock — admin mở khoá tài khoản ⇒ USER_UNLOCKED (reason vắng) + user.unlocked mang ip/UA của ADMIN", async () => {
      const victim = await seedVictim("unlock"); // user RIÊNG khỏi §throttle-clear (cùng event_type)

      // Dựng trạng thái BẰNG PREP_UA: hàng đo phải mang ADMIN_UA, không phải giá trị của lượt lock.
      const lock = await asAdmin(api(app).post(`/auth/users/${victim.id}/lock`), PREP_UA).send({});
      expect(lock.status, JSON.stringify(lock.body)).toBe(200);

      const res = await asAdmin(api(app).post(`/auth/users/${victim.id}/unlock`)).send();
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      // Lọc họ: BA họ `USER_UNLOCKED` cùng bảng (unlockUser payload vắng · clearLoginThrottle
      // reason='login_throttle' · recordFailedLockClear reason='password_reset').
      expectAdminMeta(
        await secRow(victim.id, "USER_UNLOCKED", `AND payload->>'reason' IS NULL`),
        "USER_UNLOCKED/unlockUser",
      );
      expectAdminMeta(await auditRow(victim.id, "user.unlocked"), "user.unlocked");
    });

    // ── #7 USER_UNLOCKED (reason='login_throttle') — `clearLoginThrottle` ────────────────────────

    it("§throttle-clear — admin gỡ khoá đăng nhập ⇒ USER_UNLOCKED (login_throttle) + user.login_throttle_cleared mang ip/UA của ADMIN", async () => {
      const victim = await seedVictim("thr");

      const res = await asAdmin(
        api(app).post(`/auth/users/${victim.id}/login-throttle/clear`),
      ).send();
      expect(res.status, JSON.stringify(res.body)).toBe(204);

      expectAdminMeta(
        await secRow(victim.id, "USER_UNLOCKED", `AND payload->>'reason' = 'login_throttle'`),
        "USER_UNLOCKED/login_throttle",
      );
      expectAdminMeta(
        await auditRow(victim.id, "user.login_throttle_cleared"),
        "user.login_throttle_cleared",
      );
    });

    // ── #8 USER_DELETED — `deleteUser` ───────────────────────────────────────────────────────────

    it("§delete — admin xoá mềm tài khoản ⇒ USER_DELETED + user.deleted mang ip/UA của ADMIN", async () => {
      const victim = await seedVictim("del");

      const res = await asAdmin(api(app).delete(`/auth/users/${victim.id}`)).send();
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expectAdminMeta(await secRow(victim.id, "USER_DELETED"), "USER_DELETED");
      expectAdminMeta(await auditRow(victim.id, "user.deleted"), "user.deleted");
    });

    // ── #9 USER_RESTORED — `restoreUser` ─────────────────────────────────────────────────────────

    it("§restore — admin khôi phục tài khoản ⇒ USER_RESTORED + user.restored mang ip/UA của ADMIN", async () => {
      // User RIÊNG khỏi §delete: ca này TỰ dựng trạng thái deleted nên KHÔNG phụ thuộc thứ tự it().
      const victim = await seedVictim("res");

      const del = await asAdmin(api(app).delete(`/auth/users/${victim.id}`), PREP_UA).send();
      expect(del.status, JSON.stringify(del.body)).toBe(200);

      const res = await asAdmin(api(app).post(`/auth/users/${victim.id}/restore`)).send();
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expectAdminMeta(await secRow(victim.id, "USER_RESTORED"), "USER_RESTORED");
      expectAdminMeta(await auditRow(victim.id, "user.restored"), "user.restored");
    });
  },
);
