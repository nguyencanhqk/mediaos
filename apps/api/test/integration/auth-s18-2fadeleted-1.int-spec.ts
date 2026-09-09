/**
 * S18-AUTH-2FADELETED-1 — KHÔNG được tắt 2FA của một tài khoản đã XOÁ MỀM.
 *
 * Trước WO này, câu SELECT re-auth của `AuthService.disableTwoFactor` (`auth.service.ts:715`) là
 * `where(eq(users.id, user.id))` **trần** — không `deleted_at`, không `company_id`. Ba APP_GUARD đều
 * stateless với `users.deleted_at`, nên user vừa bị xoá mềm mà access token còn trong TTL đưa ĐÚNG mật
 * khẩu thì **tắt được 2FA và nhận 200**. Đây là đường ĐI THẲNG — khác `S18-AUTH-CHANGEPWTOCTOU-1`, nó
 * KHÔNG cần trúng khe race nào, nên ca §direct dưới đây không cần proxy tx.
 *
 * Hậu quả không dừng ở "dữ liệu chết": `TwoFactorService.disable` **hard-delete** `user_totp` +
 * `user_recovery_codes`, còn `AuthUsersService.restoreUser` **không đụng** trạng thái 2FA ⇒ tài khoản
 * được khôi phục quay lại với **2FA đã TẮT**, không ai duyệt.
 *
 * ⚠️ HAI CỔNG CHỒNG NHAU (plan §2b). Bản vá đóng cả (L1) câu SELECT re-auth lẫn (L2) chính
 * `TwoFactorService.disable` — nên một ca "user xoá mềm gọi endpoint" bị chặn bởi CẢ HAI và **không cô
 * lập được vế nào** (`overdetermined-gate-makes-deny-spec-vacuous`). Vì thế §direct assert bằng **SỐ
 * ĐẾM chữ ký riêng của L1** (`auth.2fa_disable_denied` = 1 **và** `REAUTH_FAILED` = 1): nếu chỉ (B) còn
 * sống thì request cũng 401 và `user_totp` cũng còn nguyên, nhưng vết sẽ do (B) ghi — khác chữ ký.
 * Vế L2 được cô lập riêng ở `two-factor.service.spec.ts` (§inner-unit, gọi thẳng callee).
 *
 * ⚠️ THỨ TỰ DỰNG BẮT BUỘC: user đã bật 2FA thì `POST /auth/login` trả `{twoFactorRequired,
 * challengeToken}` chứ KHÔNG phải access token (`auth.service.ts:418-421`, `:479-481`). Nên phải login
 * khi 2FA còn TẮT để lấy token, RỒI mới bật 2FA (access token là JWT stateless, bật 2FA không thu hồi nó).
 *
 * ⚠️ `app.listen(0)`: `getHttpServer()` chưa listen thì supertest đóng server ngay khi response ĐẦU về
 * (memory `supertest-closes-shared-server-on-first-response`; nợ đã đóng ở `S18-QA-SUPERTESTLISTEN-1`).
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
import { eq } from "drizzle-orm";
import type { TenantTx } from "../../src/db/db.service";
import { users } from "../../src/db/schema";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const PASSWORD = "Passw0rd!s18tfd";

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

describe.skipIf(!hasDb)("S18-AUTH-2FADELETED-1 — tắt 2FA trên hàng đã xoá mềm", () => {
  let app: INestApplication;
  let direct: Pool;
  let twoFactor: TwoFactorService;
  let totp: TotpService;
  let A: SeededTenant;
  let D: SeededTenant;
  const companyIds: string[] = [];

  async function seedTarget(prefix: string): Promise<{ id: string; email: string }> {
    const email = `s18tfd-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
    const id = await seedUser(direct, A.companyId, email, await hashedPw());
    return { id, email };
  }

  /** Login KHI 2FA CÒN TẮT → access token (xem ghi chú "thứ tự dựng" ở đầu file). */
  async function loginToken(email: string): Promise<string> {
    const res = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Bật 2FA thật (enroll + confirmEnable bằng mã TOTP hợp lệ) — sau khi đã có token. */
  async function enable2fa(userId: string, companyId: string): Promise<void> {
    const { otpauthUri } = await twoFactor.enroll(userId, companyId, {});
    await twoFactor.confirmEnable(userId, companyId, totp.generate(secretFromUri(otpauthUri)), {});
    expect(await twoFactor.isEnabled(userId, companyId)).toBe(true);
  }

  async function softDelete(id: string): Promise<void> {
    await direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [id]);
  }
  async function rowCount(table: "user_totp" | "user_recovery_codes", id: string): Promise<number> {
    const r = await direct.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [
      id,
    ]);
    return r.rows[0].n as number;
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    direct = directPool();
    twoFactor = app.get(TwoFactorService);
    totp = app.get(TotpService);

    A = await seedCompany(direct, "s18tfd");
    D = await seedCompany(direct, "s18tfdx");
    companyIds.push(A.companyId, D.companyId);
  });

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, companyIds);
  });

  // ── §allow — đối chứng DƯƠNG. Thiếu ca này thì mọi ca deny là xanh-RỖNG ─────────────────────────
  it("§allow: user BÌNH THƯỜNG vẫn tắt được 2FA — 200, totp + recovery codes bị xoá", async () => {
    const target = await seedTarget("allow");
    const token = await loginToken(target.email);
    await enable2fa(target.id, A.companyId);
    expect(await rowCount("user_totp", target.id)).toBe(1);

    const res = await api(app)
      .post("/auth/2fa/disable")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: PASSWORD });

    expect(res.status).toBe(200);
    expect(await rowCount("user_totp", target.id)).toBe(0);
    expect(await rowCount("user_recovery_codes", target.id)).toBe(0);
    expect(await auditCount(target.id, "auth.2fa_disabled")).toBe(1);
    // Đường thành công KHÔNG được đẻ vết từ chối.
    expect(await auditCount(target.id, "auth.2fa_disable_denied")).toBe(0);
  });

  // ── §direct — 🔴 ĐỎ TRƯỚC VÁ. Đường ĐI THẲNG, không cần race ────────────────────────────────────
  it("§direct: user XOÁ MỀM + access token còn sống + ĐÚNG mật khẩu ⇒ 401, 2FA CÒN NGUYÊN", async () => {
    const target = await seedTarget("direct");
    const token = await loginToken(target.email);
    await enable2fa(target.id, A.companyId);
    await softDelete(target.id);

    const res = await api(app)
      .post("/auth/2fa/disable")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: PASSWORD });

    expect(res.status).toBe(401);
    // Điều WO này mua được: hàng 2FA KHÔNG bị hard-delete ⇒ khôi phục tài khoản không mất yếu tố thứ hai.
    expect(await rowCount("user_totp", target.id)).toBe(1);
    expect(await rowCount("user_recovery_codes", target.id)).toBeGreaterThan(0);
    expect(await auditCount(target.id, "auth.2fa_disabled")).toBe(0);

    // ⚠️ CHỮ KÝ RIÊNG CỦA VẾ L1 (xem ghi chú "hai cổng chồng nhau" ở đầu file): request bị chặn NGAY ở
    // câu SELECT re-auth, nên vết phải là cặp {auth.2fa_disable_denied, REAUTH_FAILED} do
    // `AuthService.disableTwoFactor` ghi. Nếu chỉ (B) còn sống thì cũng 401 và totp cũng còn — nhưng
    // KHÔNG có REAUTH_FAILED (nhánh (B) không phạt re-auth) ⇒ hai assert dưới đây tách được hai vế.
    expect(await auditCount(target.id, "auth.2fa_disable_denied")).toBe(1);
    expect(await securityEventCount(target.id, "REAUTH_FAILED")).toBe(1);
  });

  /**
   * §rls-shape — CHỐT TIỀN ĐỀ mà tính đúng đắn của vế L2 đang ngồi lên.
   *
   * `TwoFactorService.disable` phân biệt hai nhánh bằng việc hàng `users` có NHÌN THẤY ĐƯỢC hay không:
   * thấy + `deleted_at != null` ⇒ ném; KHÔNG thấy ⇒ no-op im lặng (đường cross-tenant, hợp đồng ca (f)).
   * Phép phân biệt đó CHỈ đúng chừng nào policy `users_tenant_isolation`
   * (`migrations/0002_companies_users.sql:65-67`) lọc **mỗi `company_id`** và KHÔNG lọc `deleted_at`.
   *
   * ⚠️ Nếu một migration sau này siết policy đó thêm `deleted_at IS NULL` — một bước hardening rất
   * hợp lý — thì hàng xoá mềm CÙNG tenant sẽ hoá vô hình ⇒ rơi vào nhánh `!alive` ⇒ no-op ⇒ hai câu
   * DELETE bên dưới VẪN CHẠY và VẪN KHỚP (policy của `user_totp`/`user_recovery_codes` là company-only,
   * `migrations/0120_g16_two_factor.sql:41-43`) ⇒ **lỗ này mở lại**. Và KHÔNG ca nào ở trên đỏ được:
   * §direct bị L1 chặn sớm hơn, §crosstenant vẫn xanh, §inner-unit chạy trên stub.
   *
   * Ca này biến hồi quy-âm-thầm đó thành một test ĐỎ. Nếu nó đỏ: đừng "sửa" nó — hãy đọc lại thiết
   * kế nhánh `!alive` của `disable()` trước (plan §3.0 D3).
   */
  it("§rls-shape: hàng xoá mềm CÙNG tenant vẫn SELECT được trong withTenant — tiền đề của nhánh !alive", async () => {
    const target = await seedTarget("rlsshape");
    await softDelete(target.id);

    // Lấy đúng instance DbService mà `disable()` đang dùng (DbModule không global ⇒ app.get() không ra).
    const dbsvc = (
      twoFactor as unknown as {
        dbsvc: {
          withTenant: <T>(companyId: string, fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
        };
      }
    ).dbsvc;

    const rows = await dbsvc.withTenant(A.companyId, (tx) =>
      tx.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, target.id)).limit(1),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).not.toBeNull();
  });

  // ── §crosstenant — giữ HỢP ĐỒNG no-op im lặng (two-factor.int-spec ca (f)) ──────────────────────
  it("§crosstenant: disable từ tenant KHÁC ⇒ KHÔNG ném, 2FA của tenant gốc còn nguyên, KHÔNG audit", async () => {
    const target = await seedTarget("xtenant");
    await enable2fa(target.id, A.companyId);

    // Nhánh `!alive` (RLS ẩn hàng). Biến nó thành 401 sẽ làm đỏ ca (f) của two-factor.int-spec VÀ ghi
    // một hàng audit append-only gán company_id của D cho actor_user_id của A (`audit_logs.actor_user_id`
    // FK về `users(id)`, KHÔNG composite tenant) — xem plan §2f.
    await expect(twoFactor.disable(target.id, D.companyId, {})).resolves.toBeUndefined();

    expect(await twoFactor.isEnabled(target.id, A.companyId)).toBe(true);
    expect(await rowCount("user_totp", target.id)).toBe(1);
    expect(await auditCount(target.id, "auth.2fa_disable_denied")).toBe(0);
    expect(await securityEventCount(target.id, "TOTP_DISABLED")).toBe(0);
  });
});
