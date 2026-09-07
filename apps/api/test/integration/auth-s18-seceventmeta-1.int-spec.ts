/**
 * S18-AUTH-SECEVENTMETA-1 — các hàng `user_security_events` của đường mật khẩu phải mang
 * `ip_address` + `user_agent`.
 *
 * `S18-AUTH-RESETMETA-1` (#484) đã nối `RequestMeta` xuyên `resetPassword`/`changePassword` và điền
 * ip/UA cho 5 hàng **`audit_logs`**. Nhưng cùng những tx đó còn **dual-write** sang bảng thứ hai —
 * `user_security_events` — và KHÔNG hàng nào được điền, dù bảng CÓ SẴN cột
 * (`db/schema/auth-logs.ts:81-82`) và cùng file đã có tiền lệ nối dây (`refresh` `:1063`,
 * `forgotPasswordImpl` `:1605`, `emitAccountLocked` `:2396`).
 *
 * Nặng nhất là `REAUTH_FAILED` (`recordReauthFailure`): vết BỀN duy nhất của nhánh `bad_credentials`
 * — nơi KẺ CHIẾM PHIÊN đang dò mật khẩu hiện tại rơi vào. `actor_user_id` ở đó là CHỦ TÀI KHOẢN, nên
 * nếu không có ip/UA thì vết KHÔNG trả lời được câu "AI".
 *
 * ⚠️ VÌ SAO PHẢI ĐI QUA HTTP, KHÔNG GỌI THẲNG SERVICE (plan §3 D4 — bẫy trung tâm).
 * Khiếm khuyết nằm ở **dây nối controller→service**. `account-self-service.int-spec.ts:113-206` gọi
 * thẳng `auth.changePassword(...)`; một spec viết theo khuôn đó sẽ **tự truyền meta** ⇒ xanh kể cả khi
 * controller quên — đúng hình dạng xanh-RỖNG. Nên mọi ca dưới đây bắt đầu từ một request supertest
 * thật rồi đọc thẳng `user_security_events` qua `directPool`.
 *
 * ⚠️ NEO CHỐNG CHÉP NHẦM HÀNG (plan §2g). Bước mint token gọi `forgotPassword(..., { ip: MINT_IP })`,
 * và `forgotPasswordImpl` ghi `PASSWORD_RESET_REQUESTED` **CÓ ip** cho **CÙNG `user_id`**
 * (`auth.service.ts:1605-1611`). ⇒ mọi truy vấn lọc theo `event_type` VÀ khoá `rowCount === 1` VÀ
 * assert `ip_address !== MINT_IP` — chứng minh giá trị đến từ đúng request đang đo.
 *
 * ⚠️ NEO "CỦA ADMIN, KHÔNG PHẢI CỦA NẠN NHÂN" (plan §3 D6). Trong int-spec cả admin lẫn nạn nhân đều
 * 127.0.0.1 ⇒ `ip` KHÔNG phân biệt được ai. UA của admin chỉ "đúng" nếu nạn nhân cũng đã từng gửi
 * request với UA KHÁC — nếu không, ca chỉ đang assert "vũ trụ này có đúng một UA". Nên `§admin-reset`
 * cho nạn nhân đăng nhập trước bằng `VICTIM_UA` rồi assert hàng đo `!== VICTIM_UA`.
 *
 * ⚠️ MỖI CA MỘT USER RIÊNG (plan §5). `§change-ok` và `§reauth-failed` chia chung bucket rate-limit
 * per-user `change-pw:{companyId}|{userId}` (`auth.service.ts:795-800`); dùng chung một user thì ca
 * sau có thể ăn 429 thay vì đường đang đo (memory `per-user-rate-limit-throttles-own-int-spec`).
 *
 * ⚠️ `app.listen(0)` chứ không chỉ `app.init()` (memory `supertest-closes-shared-server-on-first-response`).
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
import { AuthService } from "../../src/auth/auth.service";
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
const PASSWORD = "Passw0rd!s18sec";
const NEW_PASSWORD = "N3wPassw0rd!s18sec";

/** ip dùng ở bước MINT token. Hàng đo PHẢI KHÁC giá trị này (xem docblock). */
const MINT_IP = "198.51.100.202";
/**
 * `trust proxy` chỉ được bật ở `main.ts:34`, mà int-spec dựng app bằng `Test.createTestingModule()`
 * ⇒ `main.ts` KHÔNG BAO GIỜ chạy ⇒ `req.ip` là loopback thô. Assert theo TẬP loopback (không hard-code
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

describe.skipIf(!hasDb)("S18-AUTH-SECEVENTMETA-1 — ip/userAgent trong user_security_events", () => {
  let app: INestApplication;
  let direct: Pool;
  let auth: AuthService;
  let A: SeededTenant;
  const companyIds: string[] = [];

  async function seedTarget(prefix: string): Promise<{ id: string; email: string }> {
    const email = `s18sec-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
    const id = await seedUser(direct, A.companyId, email, await hashedPw());
    await seedUserRole(direct, id, COMPANY_ADMIN_ROLE_ID, A.companyId);
    return { id, email };
  }

  /** Access token thật qua HTTP (2FA đang TẮT nên login trả thẳng token). */
  async function loginToken(email: string, ua?: string): Promise<string> {
    const req = api(app).post("/auth/login");
    if (ua) req.set("User-Agent", ua);
    const res = await req.send({ companySlug: A.slug, email, password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Plaintext reset token cho `email` — qua outbox + JIT decrypt (khuôn auth-s18-resetmeta-1). */
  async function requestResetToken(email: string): Promise<string> {
    await auth.forgotPassword({ companySlug: A.slug, email }, { ip: MINT_IP });
    const ev = await direct.query(
      `SELECT payload FROM outbox_events
       WHERE company_id = $1 AND event_type = 'auth.password_reset_requested'
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    const payload = ev.rows[0].payload as { userId: string; resetTokenEnc: unknown };
    return auth.decryptResetToken(A.companyId, payload.resetTokenEnc, payload.userId);
  }

  type SecRow = {
    ip: string | null;
    userAgent: string | null;
    actorUserId: string | null;
    context: string | null;
  };

  /**
   * Hàng `user_security_events` DUY NHẤT khớp (user_id, event_type) + các cột đang đo.
   *
   * Khoá `rowCount === 1` là MỘT PHẦN của phép đo, không phải tiện tay: bước mint ghi
   * `PASSWORD_RESET_REQUESTED` (đã có ip) cho CÙNG `user_id`, nên một truy vấn ăn nhiều hàng có thể
   * trả `rows[0]` là hàng khác ⇒ ca xanh mà chứng minh nhầm thứ.
   */
  async function secRow(userId: string, eventType: string): Promise<SecRow> {
    const r = await direct.query(
      `SELECT ip_address, user_agent, actor_user_id, payload->>'context' AS context
         FROM user_security_events WHERE user_id = $1 AND event_type = $2`,
      [userId, eventType],
    );
    expect(r.rowCount, `mong ĐÚNG 1 hàng '${eventType}' cho ${userId}`).toBe(1);
    return {
      ip: r.rows[0].ip_address as string | null,
      userAgent: r.rows[0].user_agent as string | null,
      actorUserId: r.rows[0].actor_user_id as string | null,
      context: r.rows[0].context as string | null,
    };
  }

  /** Hàng audit DUY NHẤT khớp (object_id, action) — dùng cho vế `audit_logs` của `§admin-reset`. */
  async function auditRow(
    userId: string,
    action: string,
  ): Promise<{ ip: string | null; userAgent: string | null; actorUserId: string | null }> {
    const r = await direct.query(
      `SELECT ip, user_agent, actor_user_id FROM audit_logs WHERE object_id = $1 AND action = $2`,
      [userId, action],
    );
    expect(r.rowCount, `mong ĐÚNG 1 hàng '${action}' cho ${userId}`).toBe(1);
    return {
      ip: r.rows[0].ip as string | null,
      userAgent: r.rows[0].user_agent as string | null,
      actorUserId: r.rows[0].actor_user_id as string | null,
    };
  }

  /** Ba vế của phép đo, gom lại để mỗi ca đọc như nhau. */
  function expectMeta(
    row: { ip: string | null; userAgent: string | null },
    ua: string,
    what: string,
  ): void {
    expect(row.userAgent, what).toBe(ua); // giá trị của ĐÚNG request này (supertest không tự gửi UA)
    expect(row.ip, what).toMatch(LOOPBACK);
    expect(row.ip, what).not.toBe(MINT_IP); // không phải chép từ hàng mint
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    direct = directPool();
    auth = app.get(AuthService);

    A = await seedCompany(direct, "s18sec");
    companyIds.push(A.companyId);
  });

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, companyIds);
  });

  // ── §reset-ok ────────────────────────────────────────────────────────────────
  it("§reset-ok — reset thành công ⇒ CẢ `PASSWORD_RESET_COMPLETED` LẪN `ALL_SESSIONS_REVOKED` mang ip + userAgent", async () => {
    const UA = "s18sec-reset-ok/1.0";
    const target = await seedTarget("rok");
    const token = await requestResetToken(target.email);

    const res = await api(app)
      .post("/auth/reset-password")
      .set("User-Agent", UA)
      .send({ token, newPassword: NEW_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // Hai hàng RIÊNG BIỆT, cùng tx — đo cả hai vì chúng là hai điểm ghi khác nhau (plan §1 #2 và #3);
    // đo một cái rồi suy ra cái kia là đúng cách để một điểm ghi bị bỏ quên đi qua cổng.
    expectMeta(await secRow(target.id, "PASSWORD_RESET_COMPLETED"), UA, "PASSWORD_RESET_COMPLETED");
    expectMeta(await secRow(target.id, "ALL_SESSIONS_REVOKED"), UA, "ALL_SESSIONS_REVOKED");
  });

  // ── §change-ok ───────────────────────────────────────────────────────────────
  it("§change-ok — đổi mật khẩu thành công ⇒ `PASSWORD_CHANGED` mang ip + userAgent", async () => {
    const UA = "s18sec-change-ok/1.0";
    const target = await seedTarget("cok"); // user RIÊNG — xem docblock (bucket rate-limit per-user)
    const accessToken = await loginToken(target.email);

    const res = await api(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("User-Agent", UA)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expectMeta(await secRow(target.id, "PASSWORD_CHANGED"), UA, "PASSWORD_CHANGED");
  });

  // ── §reauth-failed ───────────────────────────────────────────────────────────
  it("§reauth-failed — mật khẩu hiện tại SAI ⇒ 401 và `REAUTH_FAILED` mang ip + userAgent của kẻ bấm nút", async () => {
    const UA = "s18sec-reauth-failed/1.0";
    const target = await seedTarget("rfail"); // user RIÊNG — xem docblock
    const accessToken = await loginToken(target.email);

    const res = await api(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("User-Agent", UA)
      .send({ currentPassword: "Sai-Mat-Khau-Hien-Tai!1", newPassword: NEW_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(401);

    const row = await secRow(target.id, "REAUTH_FAILED");
    expectMeta(row, UA, "REAUTH_FAILED");
    // Neo họ: `REAUTH_FAILED` có BA writer (change_password · 2fa_disable · 2fa_enable — plan §2c).
    // Không neo `context` thì ca này vẫn xanh nếu một ngày nào đó hàng đo đến từ họ khác.
    expect(row.context).toBe("change_password");
  });

  // ── §admin-reset ─────────────────────────────────────────────────────────────
  it("§admin-reset — admin đặt lại mật khẩu ⇒ `PASSWORD_RESET_BY_ADMIN` + audit mang ip/UA của ADMIN (không phải của nạn nhân)", async () => {
    const ADMIN_UA = "s18sec-admin-reset/1.0";
    const VICTIM_UA = "s18sec-victim-browser/9.9";
    const admin = await seedTarget("adm");
    const victim = await seedTarget("vic");

    // NẠN NHÂN gửi request THẬT trước, với UA KHÁC. Thiếu bước này thì assert "UA của admin" chỉ đúng
    // vì nạn nhân chưa từng gửi gì — tức đang chứng minh "vũ trụ có đúng một UA" (plan §3 D6).
    await loginToken(victim.email, VICTIM_UA);
    const adminToken = await loginToken(admin.email, ADMIN_UA);

    const res = await api(app)
      .post(`/auth/users/${victim.id}/password/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("User-Agent", ADMIN_UA)
      .send();
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const ev = await secRow(victim.id, "PASSWORD_RESET_BY_ADMIN");
    expectMeta(ev, ADMIN_UA, "PASSWORD_RESET_BY_ADMIN");
    expect(ev.userAgent).not.toBe(VICTIM_UA); // vết là của NGƯỜI BẤM NÚT
    expect(ev.actorUserId).toBe(admin.id);

    const au = await auditRow(victim.id, "user.password_reset_by_admin");
    expectMeta(au, ADMIN_UA, "user.password_reset_by_admin");
    expect(au.userAgent).not.toBe(VICTIM_UA);
    expect(au.actorUserId).toBe(admin.id);
  });
});
