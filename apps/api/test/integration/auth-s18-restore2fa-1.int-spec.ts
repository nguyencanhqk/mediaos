/**
 * S18-AUTH-RESTORE2FA-1 — khôi phục user PHẢI soát lại 2FA, và `enroll`/`confirmEnable` PHẢI lọc
 * `deleted_at`.
 *
 * Ba lỗ mà bộ ca dưới đây ghim (plan `docs/plans/S18-AUTH-RESTORE2FA-1.md` §1):
 *
 *  • (L1) `TwoFactorService.enroll` + `confirmEnable` không đụng bảng `users` ⇒ người giữ access
 *    token của một tài khoản vừa bị xoá mềm (JWT stateless, `deleteUser` chỉ thu hồi *refresh*)
 *    CÀI được yếu tố thứ hai DO CHÍNH HỌ kiểm soát. `TwoFactorEnforcementGuard` chỉ ép enroll khi
 *    `!isEnabled` ⇒ hàng của kẻ tấn công **đã** enabled nên guard thấy "đủ 2FA" và cho qua. Đường
 *    ĐI THẲNG, không cần trúng race.
 *  • (L3) `restoreUser` không đụng `user_totp`/`user_recovery_codes`. Vì `disable()` HARD-DELETE,
 *    2FA bị tắt trong cửa sổ đã-xoá là không phục hồi được ⇒ tài khoản khôi phục về với 2FA TẮT.
 *  • (L4/L5) nợ quan sát: `auth.2fa_disabled` · `auth.2fa_disable_denied` · `REAUTH_FAILED` (CẢ
 *    hai ngữ cảnh 2FA) đều vô danh — thiếu `ip`/`userAgent`.
 *
 * ⚠️ ĐI QUA HTTP THẬT (`api(app).post(...)`), KHÔNG gọi thẳng service. Gọi thẳng service thì spec
 * tự truyền `meta` ⇒ ba ca §meta-* thành xanh-RỖNG với dây controller — đúng cái chúng tồn tại để đo.
 *
 * ⚠️ THỨ TỰ DỰNG BẮT BUỘC (mirror `auth-s18-2fadeleted-1.int-spec.ts`): user đã bật 2FA thì
 * `POST /auth/login` trả `{twoFactorRequired, challengeToken}` chứ KHÔNG phải access token. Phải
 * login KHI 2FA CÒN TẮT để lấy token, RỒI mới bật 2FA (access token là JWT stateless).
 *
 * ⚠️ CỔNG CHỒNG NHAU — GỠ MÙ (plan §5). Sau bản vá, D1 chặn `enroll` của user xoá mềm, còn D3 xoá
 * sạch 2FA lúc restore. `§restore-wipe`/`§restore-flag` KHÔNG chồng cổng vì chúng dựng 2FA **khi
 * user còn sống** rồi mới xoá mềm ⇒ D1 không can thiệp. ĐỪNG "tối ưu" bằng cách enroll SAU khi xoá:
 * làm thế thì D1 chặn từ đầu, hàng 2FA vốn đã 0, và ca thành xanh-RỖNG
 * (`overdetermined-gate-makes-deny-spec-vacuous`).
 *
 * ⚠️ KHÔNG chép lại `§rls-shape` — tiền đề "hàng xoá mềm CÙNG tenant vẫn SELECT được trong
 * withTenant" đã được ghim ở `auth-s18-2fadeleted-1.int-spec.ts:201`. Hai bản sao của cùng một tiền
 * đề sẽ trôi; TRỎ VỀ đó.
 *
 * ⚠️ `app.listen(0)`: `getHttpServer()` chưa listen thì supertest đóng server ngay khi response ĐẦU
 * về (memory `supertest-closes-shared-server-on-first-response`).
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
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { TokenService } from "../../src/auth/token.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/** Seed role admin công ty (mig 0001) — hằng cục bộ, mirror `auth-s18-seceventrest-1.int-spec.ts:75`. */
const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";

const PASSWORD = "Passw0rd!s18r2fa";

/** UA riêng cho hàng ĐO của ba ca §meta-* — tách khỏi UA của các bước DỰNG trạng thái. */
const ACT_UA = "s18r2fa-act/1.0";
const PREP_UA = "s18r2fa-prep/1.0";

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

type MetaRow = { ip: string | null; userAgent: string | null };

describe.skipIf(!hasDb)(
  "S18-AUTH-RESTORE2FA-1 — restore soát lại 2FA + enroll/enable lọc deleted_at",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let twoFactor: TwoFactorService;
    let totp: TotpService;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let adminToken: string;

    async function seedTarget(
      prefix: string,
      asAdminRole = false,
    ): Promise<{ id: string; email: string }> {
      const email = `s18r2fa-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
      const id = await seedUser(direct, A.companyId, email, await hashedPw());
      if (asAdminRole) await seedUserRole(direct, id, COMPANY_ADMIN_ROLE_ID, A.companyId);
      return { id, email };
    }

    /** Login KHI 2FA CÒN TẮT → access token (xem ghi chú "thứ tự dựng" ở đầu file). */
    async function loginToken(email: string, ua = PREP_UA): Promise<string> {
      const res = await api(app)
        .post("/auth/login")
        .set("User-Agent", ua)
        .send({ companySlug: A.slug, email, password: PASSWORD });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.accessToken as string;
    }

    function asAdmin(req: request.Test, ua = PREP_UA): request.Test {
      return req.set("Authorization", `Bearer ${adminToken}`).set("User-Agent", ua);
    }

    /** Bật 2FA THẬT qua service (dựng trạng thái — không phải hàng đo). */
    async function enable2fa(userId: string, companyId: string): Promise<string> {
      const { otpauthUri } = await twoFactor.enroll(userId, companyId, {});
      const secret = secretFromUri(otpauthUri);
      await twoFactor.confirmEnable(userId, companyId, totp.generate(secret), {});
      expect(await twoFactor.isEnabled(userId, companyId)).toBe(true);
      return secret;
    }

    async function softDelete(id: string): Promise<void> {
      await direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [id]);
    }

    async function rowCount(
      table: "user_totp" | "user_recovery_codes",
      id: string,
    ): Promise<number> {
      const r = await direct.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [
        id,
      ]);
      return r.rows[0].n as number;
    }

    async function enabledAt(userId: string): Promise<Date | null> {
      const r = await direct.query(`SELECT enabled_at FROM user_totp WHERE user_id = $1`, [userId]);
      return (r.rows[0]?.enabled_at as Date | null) ?? null;
    }

    async function requireTwoFactorFlag(userId: string): Promise<boolean> {
      const r = await direct.query(`SELECT require_two_factor FROM users WHERE id = $1`, [userId]);
      return r.rows[0]?.require_two_factor === true;
    }

    async function auditCount(userId: string, action: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE object_id = $1 AND action = $2`,
        [userId, action],
      );
      return r.rows[0].n as number;
    }

    async function auditRow(
      userId: string,
      action: string,
    ): Promise<{ after: Record<string, unknown> | null; actorUserId: string | null } & MetaRow> {
      const r = await direct.query(
        `SELECT after, actor_user_id, ip, user_agent FROM audit_logs
       WHERE object_id = $1 AND action = $2 ORDER BY created_at DESC LIMIT 1`,
        [userId, action],
      );
      expect(r.rows.length, `không tìm thấy audit '${action}' cho ${userId}`).toBe(1);
      return {
        after: r.rows[0].after as Record<string, unknown> | null,
        actorUserId: r.rows[0].actor_user_id as string | null,
        ip: r.rows[0].ip as string | null,
        userAgent: r.rows[0].user_agent as string | null,
      };
    }

    async function securityEventCount(userId: string, eventType: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM user_security_events WHERE user_id = $1 AND event_type = $2`,
        [userId, eventType],
      );
      return r.rows[0].n as number;
    }

    async function securityEventRow(userId: string, eventType: string): Promise<MetaRow> {
      const r = await direct.query(
        `SELECT ip_address, user_agent FROM user_security_events
       WHERE user_id = $1 AND event_type = $2 ORDER BY created_at DESC LIMIT 1`,
        [userId, eventType],
      );
      expect(r.rows.length, `không tìm thấy security event '${eventType}' cho ${userId}`).toBe(1);
      return {
        ip: r.rows[0].ip_address as string | null,
        userAgent: r.rows[0].user_agent as string | null,
      };
    }

    /** Hàng ĐO phải mang ip + ĐÚNG UA của lượt gọi — `{}` hoặc quên nối dây đều đỏ ở đây. */
    function expectMeta(row: MetaRow, label: string): void {
      expect(row.userAgent, `${label}: userAgent`).toBe(ACT_UA);
      expect(row.ip, `${label}: ip`).toBeTruthy();
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

      A = await seedCompany(direct, "s18r2fa");
      companyIds.push(A.companyId);

      const admin = await seedTarget("adm", true);
      adminToken = await loginToken(admin.email);
    });

    afterAll(async () => {
      await app?.close();
      await cleanupTenants(direct, companyIds);
    });

    // ══ D1 — `enroll` / `confirmEnable` lọc `deleted_at` ═════════════════════════════════════════

    /**
     * §allow-enroll — ĐỐI CHỨNG DƯƠNG. Thiếu ca này thì mọi ca deny bên dưới là xanh-RỖNG: một bản vá
     * "từ chối vô điều kiện" cũng làm chúng xanh (`deny-cases-vacuous-without-allow-case`).
     */
    it("§allow-enroll: user BÌNH THƯỜNG vẫn enroll + enable được — 200, enabled_at != NULL", async () => {
      const target = await seedTarget("allow");
      const token = await loginToken(target.email);

      const enroll = await api(app)
        .post("/auth/2fa/enroll")
        .set("Authorization", `Bearer ${token}`)
        .send();
      expect(enroll.status, JSON.stringify(enroll.body)).toBe(200);
      expect(await rowCount("user_totp", target.id)).toBe(1);

      const secret = secretFromUri(enroll.body.data.otpauthUri as string);
      const enable = await api(app)
        .post("/auth/2fa/enable")
        .set("Authorization", `Bearer ${token}`)
        .send({ token: totp.generate(secret) });
      expect(enable.status, JSON.stringify(enable.body)).toBe(200);
      expect(await enabledAt(target.id)).not.toBeNull();
      // Đường thành công KHÔNG được đẻ vết từ chối.
      expect(await auditCount(target.id, "auth.2fa_enroll_denied")).toBe(0);
      expect(await auditCount(target.id, "auth.2fa_enable_denied")).toBe(0);
    });

    /** §enroll-deny — 🔴 ĐỎ TRƯỚC VÁ. Đường ĐI THẲNG: token còn sống + hàng đã xoá mềm. */
    it("§enroll-deny: user XOÁ MỀM + access token còn sống ⇒ 401, user_totp 0 hàng, vết reason=user_deleted", async () => {
      const target = await seedTarget("enrolldeny");
      const token = await loginToken(target.email);
      await softDelete(target.id);

      const res = await api(app)
        .post("/auth/2fa/enroll")
        .set("Authorization", `Bearer ${token}`)
        .send();

      expect(res.status, JSON.stringify(res.body)).toBe(401);
      // Điều ca này mua được: KHÔNG có yếu tố thứ hai nào được CÀI vào tài khoản sẽ được khôi phục.
      expect(await rowCount("user_totp", target.id)).toBe(0);
      expect(await rowCount("user_recovery_codes", target.id)).toBe(0);
      expect(await auditCount(target.id, "auth.2fa_enrolled")).toBe(0);

      const row = await auditRow(target.id, "auth.2fa_enroll_denied");
      expect(row.after?.reason).toBe("user_deleted");
    });

    /**
     * §enable-deny — 🔴 ĐỎ TRƯỚC VÁ. Enroll hợp lệ KHI CÒN SỐNG, xoá mềm, rồi enable bằng mã ĐÚNG.
     * Mã đúng là chủ ý: nó chứng minh cổng chặn vì `deleted_at`, KHÔNG phải vì mã sai.
     */
    it("§enable-deny: enroll hợp lệ → xoá mềm → enable mã ĐÚNG ⇒ 401, enabled_at vẫn NULL", async () => {
      const target = await seedTarget("enabledeny");
      const token = await loginToken(target.email);

      const enroll = await api(app)
        .post("/auth/2fa/enroll")
        .set("Authorization", `Bearer ${token}`)
        .send();
      expect(enroll.status).toBe(200);
      const secret = secretFromUri(enroll.body.data.otpauthUri as string);
      await softDelete(target.id);

      const res = await api(app)
        .post("/auth/2fa/enable")
        .set("Authorization", `Bearer ${token}`)
        .send({ token: totp.generate(secret) });

      expect(res.status, JSON.stringify(res.body)).toBe(401);
      expect(await enabledAt(target.id)).toBeNull();
      expect(await auditCount(target.id, "auth.2fa_enabled")).toBe(0);

      const row = await auditRow(target.id, "auth.2fa_enable_denied");
      expect(row.after?.reason).toBe("user_deleted");
    });

    /**
     * §enable-deny-norl — nhánh `account_gone` KHÔNG phạt rate-limit và KHÔNG đẻ `REAUTH_FAILED`.
     * Phạt + gắn nhãn "xác thực lại thất bại" cho một lượt KHÔNG PHẢI "nhập sai mã" là sai nhãn
     * (lập luận D4 ở `auth.service.ts`). Đột biến: trả `"bad_code"` thay `"account_gone"` ⇒ ca này ĐỎ.
     */
    it("§enable-deny-norl: nhánh account_gone KHÔNG đẻ REAUTH_FAILED và KHÔNG khoá rate-limit", async () => {
      const target = await seedTarget("enablenorl");
      const token = await loginToken(target.email);

      const enroll = await api(app)
        .post("/auth/2fa/enroll")
        .set("Authorization", `Bearer ${token}`)
        .send();
      expect(enroll.status).toBe(200);
      const secret = secretFromUri(enroll.body.data.otpauthUri as string);
      await softDelete(target.id);

      // Gọi LẶP: nếu nhánh này phạt rate-limit thì một trong các lượt sau sẽ đổi hình thành 429.
      for (let i = 0; i < 6; i++) {
        const res = await api(app)
          .post("/auth/2fa/enable")
          .set("Authorization", `Bearer ${token}`)
          .send({ token: totp.generate(secret) });
        expect(res.status, `lượt ${i}: ${JSON.stringify(res.body)}`).toBe(401);
      }
      expect(await securityEventCount(target.id, "REAUTH_FAILED")).toBe(0);
      expect(await enabledAt(target.id)).toBeNull();
    });

    /**
     * §absent-label — nhãn phải phân biệt "đo được là ĐÃ XOÁ" với "0 hàng". Trong tenant-tx, FORCE RLS
     * làm "khác tenant" trông y hệt "không tồn tại"
     * (`rls-makes-cross-tenant-look-nonexistent-in-audit-labels`) ⇒ nhãn `user_absent`, KHÔNG được
     * khẳng định "đã xoá".
     *
     * ⚠️ `actor_user_id` của hàng vết này PHẢI là NULL. `audit_logs` có FK `actor_user_id → users(id)`
     * **và** composite `(company_id, actor_user_id) → users(company_id, id)` (đo trực tiếp trên lane
     * DB). Gán một id vừa đo được là VẮNG vào cột đó ⇒ 23503 ⇒ 500, và rollback nuốt luôn chính hàng
     * vết đang ghi. Assert NULL ở đây để không ai "sửa cho đẹp" thành `actorUserId: userId`.
     */
    it("§absent-label: hàng user VẮNG (id lạ trong tenant) ⇒ 401 reason=user_absent, actor_user_id NULL, KHÔNG 500", async () => {
      // ⚠️ KHÔNG dùng hard-delete để dựng ca này. Một user ĐÃ login để lại `login_logs`/`audit_logs`
      // trỏ về `users(id)` ⇒ `DELETE FROM users` nổ FK ở chính bước DỰNG, trước khi đo được gì.
      // Token KÝ TAY cho một id CHƯA TỪNG tồn tại trong tenant A là đường sạch, và đúng là hình dạng
      // mà nhãn `user_absent` nói tới: trong tenant-tx, FORCE RLS làm "khác tenant" trông y hệt
      // "không tồn tại" nên `.limit(1)` rỗng KHÔNG phân biệt được hai thứ đó.
      const ghostId = randomUUID();
      const token = app.get(TokenService).signAccessToken({
        sub: ghostId,
        companyId: A.companyId,
        email: `s18r2fa-ghost-${ghostId.slice(0, 8)}@a.test`,
      });

      const res = await api(app)
        .post("/auth/2fa/enroll")
        .set("Authorization", `Bearer ${token}`)
        .send();

      expect(res.status, JSON.stringify(res.body)).toBe(401);
      const row = await auditRow(ghostId, "auth.2fa_enroll_denied");
      expect(row.after?.reason).toBe("user_absent");
      // Cột này PHẢI NULL — xem docblock ở đầu ca. Gán `ghostId` vào đây thì INSERT nổ 23503 và
      // rollback xoá luôn hàng vết, tức ca này sẽ đỏ ở `auditRow` chứ không phải ở dòng này.
      expect(row.actorUserId).toBeNull();
    });

    // ══ D3 — `restoreUser` soát lại 2FA ══════════════════════════════════════════════════════════

    /**
     * §restore-wipe — A1: sau restore, `user_totp` + `user_recovery_codes` của user đó 0 hàng, VÔ ĐIỀU
     * KIỆN. Đây là vế defence-in-depth CỐ Ý: mọi yếu tố cài trong cửa sổ đã-xoá biến mất **kể cả khi
     * D1 hồi quy về sau**.
     */
    it("§restore-wipe: user có 2FA BẬT → xoá mềm → restore ⇒ user_totp + recovery codes 0 hàng", async () => {
      const target = await seedTarget("wipe");
      await loginToken(target.email);
      await enable2fa(target.id, A.companyId);
      expect(await rowCount("user_totp", target.id)).toBe(1);
      expect(await rowCount("user_recovery_codes", target.id)).toBeGreaterThan(0);

      const del = await asAdmin(api(app).delete(`/auth/users/${target.id}`)).send();
      expect(del.status, JSON.stringify(del.body)).toBe(200);
      const res = await asAdmin(api(app).post(`/auth/users/${target.id}/restore`)).send();
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expect(await rowCount("user_totp", target.id)).toBe(0);
      expect(await rowCount("user_recovery_codes", target.id)).toBe(0);
    });

    /**
     * §restore-flag — A2 + B2. Ba assert, mỗi assert một đột biến khác nhau:
     *  • cột DB `require_two_factor` = true         ⟵ bỏ A2
     *  • `after.twoFactorWasEnabled === true`       ⟵ đọc trạng thái SAU khi đã xoá (luôn false)
     *  • `after.requireTwoFactor === true`          ⟵ snapshot row CŨ (audit append-only NÓI DỐI)
     * Vế thứ ba là lý do bước set-cờ phải chạy TRƯỚC bước audit và `after` phải dùng row TRẢ VỀ của
     * `updateProfileTx`, không phải `restored`.
     */
    it("§restore-flag: user từng BẬT 2FA → restore ⇒ require_two_factor=true VÀ audit after nói ĐÚNG", async () => {
      const target = await seedTarget("flag");
      await loginToken(target.email);
      await enable2fa(target.id, A.companyId);

      const del = await asAdmin(api(app).delete(`/auth/users/${target.id}`)).send();
      expect(del.status).toBe(200);
      const res = await asAdmin(api(app).post(`/auth/users/${target.id}/restore`)).send();
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expect(await requireTwoFactorFlag(target.id)).toBe(true);
      const row = await auditRow(target.id, "user.restored");
      expect(row.after?.twoFactorWasEnabled).toBe(true);
      expect(row.after?.twoFactorReset).toBe(true);
      // Snapshot phải là row SAU cập nhật — nếu dùng `restored` thì đây là false trong khi DB là true.
      expect(row.after?.requireTwoFactor).toBe(true);
    });

    /** §restore-noflag — A2 CÓ ĐIỀU KIỆN: restore không được siết chính sách của user chưa từng bật 2FA. */
    it("§restore-noflag: user CHƯA TỪNG bật 2FA → restore ⇒ require_two_factor vẫn false", async () => {
      const target = await seedTarget("noflag");
      const del = await asAdmin(api(app).delete(`/auth/users/${target.id}`)).send();
      expect(del.status).toBe(200);
      const res = await asAdmin(api(app).post(`/auth/users/${target.id}/restore`)).send();
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expect(await requireTwoFactorFlag(target.id)).toBe(false);
      const row = await auditRow(target.id, "user.restored");
      expect(row.after?.twoFactorWasEnabled).toBe(false);
    });

    /**
     * §restore-pending — RANH GIỚI của A2: hàng enroll PENDING (`enabled_at IS NULL`) bị xoá (A1 vô
     * điều kiện) NHƯNG cờ KHÔNG được set. Đột biến "dùng `có hàng` thay `đã bật`" ⇒ ca này ĐỎ.
     */
    it("§restore-pending: hàng enroll PENDING → restore ⇒ hàng bị XOÁ nhưng cờ KHÔNG set", async () => {
      const target = await seedTarget("pending");
      const token = await loginToken(target.email);
      const enroll = await api(app)
        .post("/auth/2fa/enroll")
        .set("Authorization", `Bearer ${token}`)
        .send();
      expect(enroll.status).toBe(200);
      expect(await enabledAt(target.id)).toBeNull();

      const del = await asAdmin(api(app).delete(`/auth/users/${target.id}`)).send();
      expect(del.status).toBe(200);
      const res = await asAdmin(api(app).post(`/auth/users/${target.id}/restore`)).send();
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expect(await rowCount("user_totp", target.id)).toBe(0);
      expect(await rowCount("user_recovery_codes", target.id)).toBe(0);
      expect(await requireTwoFactorFlag(target.id)).toBe(false);
    });

    /**
     * §restore-enforced — D3 KHÔNG được tái dùng `TwoFactorService.disable()`. `disable()` mang chính
     * sách self-disable (`requiresTwoFactorTx` → 409 `TWO_FACTOR_ENFORCED`) ⇒ tái dùng nó sẽ GIẾT CẢ
     * LỆNH restore với đúng nhóm user bị ép 2FA. Đột biến "gọi `disable()` thay primitive repo" ⇒ ca
     * này ĐỎ với 409 (`reused-method-must-be-actor-scoped`).
     */
    it("§restore-enforced: user giữ role requires_two_factor → restore KHÔNG 409, vẫn xoá sạch 2FA", async () => {
      const target = await seedTarget("enforced");
      await loginToken(target.email);
      await enable2fa(target.id, A.companyId);
      // Ép 2FA qua cờ PER-USER (mig 0466) — cùng nhánh `requiresTwoFactorTx` mà `disable()` fail-closed.
      await direct.query(`UPDATE users SET require_two_factor = true WHERE id = $1`, [target.id]);

      const del = await asAdmin(api(app).delete(`/auth/users/${target.id}`)).send();
      expect(del.status).toBe(200);
      const res = await asAdmin(api(app).post(`/auth/users/${target.id}/restore`)).send();

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await rowCount("user_totp", target.id)).toBe(0);
      expect(await requireTwoFactorFlag(target.id)).toBe(true);
    });

    /**
     * §sticky-409 — HỆ QUẢ ĐÃ ĐƯỢC OWNER KÝ (plan §2), ghim ra để nó không im lặng: user từng TỰ
     * NGUYỆN bật 2FA, bị xoá mềm rồi khôi phục, VĨNH VIỄN mất quyền tự tắt 2FA (`require_two_factor`
     * không có đường tự clear; đường gỡ DUY NHẤT là admin `PATCH /auth/users/:id`).
     *
     * ⚠️ HAI ĐIỀU PHẢI ĐỌC ĐÚNG, kẻo ca này kể sai chuyện:
     *  (i) 409 nổ TRƯỚC khi mật khẩu được đọc — fail-fast ở đầu `AuthService.disableTwoFactor`, trước
     *      cả rate-limit lẫn re-auth ⇒ mật khẩu SAI cũng 409. Ca này KHÔNG chứng minh gì về re-auth.
     *  (ii) Bước "enroll lại" PHẢI được assert. Nếu không, enroll hỏng thì ca vẫn 409 và vẫn XANH,
     *      trong khi mệnh đề cần chứng minh — "user đã trở lại thế đứng bình thường mà VẪN không tự
     *      tắt được" — chưa được chứng minh.
     */
    it("§sticky-409: sau restore, user enroll lại được nhưng KHÔNG tự tắt được 2FA — 409 TWO_FACTOR_ENFORCED", async () => {
      const target = await seedTarget("sticky");
      await loginToken(target.email);
      await enable2fa(target.id, A.companyId);

      const del = await asAdmin(api(app).delete(`/auth/users/${target.id}`)).send();
      expect(del.status).toBe(200);
      const restore = await asAdmin(api(app).post(`/auth/users/${target.id}/restore`)).send();
      expect(restore.status).toBe(200);
      expect(await requireTwoFactorFlag(target.id)).toBe(true);

      // Token MỚI: 2FA đã bị xoá sạch nên login trả access token thẳng (không rẽ nhánh challenge).
      const token = await loginToken(target.email);
      const enroll = await api(app)
        .post("/auth/2fa/enroll")
        .set("Authorization", `Bearer ${token}`)
        .send();
      expect(enroll.status, JSON.stringify(enroll.body)).toBe(200);
      const secret = secretFromUri(enroll.body.data.otpauthUri as string);
      const enable = await api(app)
        .post("/auth/2fa/enable")
        .set("Authorization", `Bearer ${token}`)
        .send({ token: totp.generate(secret) });
      expect(enable.status, JSON.stringify(enable.body)).toBe(200);
      // (ii) — thế đứng bình thường ĐÃ được chứng minh, không phải giả định.
      expect(await enabledAt(target.id)).not.toBeNull();

      const res = await api(app)
        .post("/auth/2fa/disable")
        .set("Authorization", `Bearer ${token}`)
        .send({ password: PASSWORD });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error?.code).toBe("TWO_FACTOR_ENFORCED");
      expect(await enabledAt(target.id)).not.toBeNull();
    });

    // ══ D4 / D5 — ip + userAgent cho ba hàng vết 2FA ═════════════════════════════════════════════

    /** §meta-disable — D4 (`auth.2fa_disable_denied`) + D5 (`REAUTH_FAILED` context `2fa_disable`). */
    it("§meta-disable: disable SAI mật khẩu ⇒ auth.2fa_disable_denied VÀ REAUTH_FAILED mang ip+UA", async () => {
      const target = await seedTarget("metadis");
      const token = await loginToken(target.email);
      await enable2fa(target.id, A.companyId);
      // Xoá mềm để rơi vào nhánh `!row` — nhánh ghi CẢ HAI hàng vết trong một lượt.
      await softDelete(target.id);

      const res = await api(app)
        .post("/auth/2fa/disable")
        .set("Authorization", `Bearer ${token}`)
        .set("User-Agent", ACT_UA)
        .send({ password: PASSWORD });
      expect(res.status).toBe(401);

      expectMeta(await auditRow(target.id, "auth.2fa_disable_denied"), "auth.2fa_disable_denied");
      expectMeta(await securityEventRow(target.id, "REAUTH_FAILED"), "REAUTH_FAILED(2fa_disable)");
    });

    /** §meta-disable-ok — D4 đường THÀNH CÔNG: `auth.2fa_disabled` do `TwoFactorService` ghi. */
    it("§meta-disable-ok: disable THÀNH CÔNG ⇒ auth.2fa_disabled mang ip+UA", async () => {
      const target = await seedTarget("metaok");
      const token = await loginToken(target.email);
      await enable2fa(target.id, A.companyId);

      const res = await api(app)
        .post("/auth/2fa/disable")
        .set("Authorization", `Bearer ${token}`)
        .set("User-Agent", ACT_UA)
        .send({ password: PASSWORD });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await rowCount("user_totp", target.id)).toBe(0);

      expectMeta(await auditRow(target.id, "auth.2fa_disabled"), "auth.2fa_disabled");
    });

    /**
     * §meta-enable — D5 vế thứ hai: `TwoFactorService.recordReauthFailure` là writer RIÊNG, KHÔNG được
     * tham số bắt buộc của `AuthService` bảo vệ. Đột biến "chỉ nối dây writer của AuthService" ⇒ ĐỎ.
     */
    it("§meta-enable: enable mã SAI ⇒ REAUTH_FAILED (context 2fa_enable) mang ip+UA", async () => {
      const target = await seedTarget("metaen");
      const token = await loginToken(target.email);
      const enroll = await api(app)
        .post("/auth/2fa/enroll")
        .set("Authorization", `Bearer ${token}`)
        .send();
      expect(enroll.status).toBe(200);

      const res = await api(app)
        .post("/auth/2fa/enable")
        .set("Authorization", `Bearer ${token}`)
        .set("User-Agent", ACT_UA)
        .send({ token: "000000" });
      expect(res.status).toBe(401);

      expectMeta(await securityEventRow(target.id, "REAUTH_FAILED"), "REAUTH_FAILED(2fa_enable)");
    });
  },
);
