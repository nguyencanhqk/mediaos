/**
 * S18-AUTH-RESETMETA-1 — bốn hàng audit của `resetPassword`/`changePassword` phải mang `ip`+`userAgent`.
 *
 * Trước WO này `resetPassword(req)` và `changePassword(user, cur, next)` KHÔNG nhận `RequestMeta`, nên
 * cả nhánh thành công lẫn nhánh từ chối đều ghi `audit_logs.ip = NULL`, `user_agent = NULL`. Hai hàng
 * `_denied` tự nhận trong comment là "vết BỀN duy nhất" của một nhánh từ chối vùng đỏ, nhưng
 * `actorUserId` ở đó là CHỦ TÀI KHOẢN chứ không phải người bấm nút ⇒ vết **không trả lời được "AI"**.
 * `forgotPassword(req, meta)` — nửa kia của cùng cặp endpoint công khai — đã nhận meta từ lâu.
 *
 * ⚠️ VÌ SAO PHẢI ĐI QUA HTTP, KHÔNG GỌI THẲNG SERVICE (plan §3 D4 — bẫy trung tâm của WO).
 * Khiếm khuyết nằm ở **dây nối controller→service**. `account-self-service.int-spec.ts:113-206` gọi
 * thẳng `auth.changePassword(...)`; một spec viết theo khuôn đó sẽ **tự truyền meta** ⇒ xanh kể cả khi
 * controller quên `this.meta(req)` — đúng hình dạng xanh-RỖNG. Nên mọi ca dưới đây bắt đầu từ một
 * request supertest thật rồi đọc thẳng `audit_logs` qua `directPool`.
 *
 * ⚠️ VÌ SAO `§change-denied` PHẢI DÙNG CỬA SỔ `password.hash` (plan §3 D4b).
 * "User xoá mềm + access token còn sống" KHÔNG tới được hàng `auth.password_change_denied`: câu SELECT
 * re-auth (`auth.service.ts:750-754`) ĐÃ lọc `deleted_at` ⇒ hàng xoá mềm rơi vào `!row` →
 * `"bad_credentials"` → ném, và nhánh đó KHÔNG ghi `audit_logs` nào ⇒ truy vấn trả 0 hàng ⇒ ca xanh-RỖNG.
 * Hàng đó chỉ tới được khi câu UPDATE khớp 0 hàng, tức phải soft-delete XEN GIỮA SELECT và UPDATE.
 * Điểm chèn tất định là `this.password.hash()` — argon2id 19 MiB nằm đúng giữa hai câu.
 * (Đường `reset` thì khác: ở đó vế `deleted_at` nằm ở câu UPDATE, nên tới thẳng được. Đừng chép tiền đề
 * từ đường này sang đường kia — memory `sibling-wo-rationale-may-not-transfer`.)
 *
 * ⚠️ NEO CHỐNG CHÉP NHẦM HÀNG. Bước mint token gọi `forgotPassword(..., { ip: MINT_IP })`, và
 * `forgotPasswordImpl` ghi `auth.password_reset_requested` **CÓ ip** cho **cùng `object_id`**. Nên mọi
 * truy vấn phải lọc theo `action` VÀ khoá `rowCount === 1`, VÀ assert `ip !== MINT_IP` — chứng minh giá
 * trị đến từ đúng request đang đo, không bị chép từ hàng mint.
 *
 * ⚠️ `app.listen(0)` chứ không chỉ `app.init()` (memory `supertest-closes-shared-server-on-first-response`).
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
const PASSWORD = "Passw0rd!s18meta";
const NEW_PASSWORD = "N3wPassw0rd!s18meta";

/** ip dùng ở bước MINT token. Hàng audit của reset PHẢI KHÁC giá trị này (xem docblock). */
const MINT_IP = "198.51.100.201";
/**
 * `trust proxy` chỉ được bật ở `main.ts:34`, mà int-spec dựng app bằng `Test.createTestingModule()`
 * ⇒ `main.ts` KHÔNG BAO GIỜ chạy ⇒ `req.ip` là loopback thô. Assert theo tập loopback (không hard-code
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

describe.skipIf(!hasDb)("S18-AUTH-RESETMETA-1 — ip/userAgent trong vết đổi mật khẩu", () => {
  let app: INestApplication;
  let direct: Pool;
  let auth: AuthService;
  let A: SeededTenant;
  const companyIds: string[] = [];

  async function seedTarget(prefix: string): Promise<{ id: string; email: string }> {
    const email = `s18m-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
    const id = await seedUser(direct, A.companyId, email, await hashedPw());
    await seedUserRole(direct, id, COMPANY_ADMIN_ROLE_ID, A.companyId);
    return { id, email };
  }

  /** Access token thật qua HTTP (2FA đang TẮT nên login trả thẳng token). */
  async function loginToken(email: string, password = PASSWORD): Promise<string> {
    const res = await api(app).post("/auth/login").send({ companySlug: A.slug, email, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Plaintext reset token cho `email` — qua outbox + JIT decrypt (khuôn auth-s18-resetdeleted-1). */
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

  /**
   * Hàng audit DUY NHẤT khớp (object_id, action) + hai cột đang đo.
   * Khoá `rowCount === 1` là một phần của phép đo, không phải tiện tay: nếu truy vấn ăn nhiều hàng thì
   * `rows[0]` có thể là hàng của bước mint (đã có ip) ⇒ ca xanh mà chứng minh nhầm thứ.
   */
  async function auditRow(
    userId: string,
    action: string,
  ): Promise<{ ip: string | null; userAgent: string | null }> {
    const r = await direct.query(
      `SELECT ip, user_agent FROM audit_logs WHERE object_id = $1 AND action = $2`,
      [userId, action],
    );
    expect(r.rowCount, `mong ĐÚNG 1 hàng '${action}' cho ${userId}`).toBe(1);
    return { ip: r.rows[0].ip as string | null, userAgent: r.rows[0].user_agent as string | null };
  }

  /** Ba vế của phép đo, gom lại để mỗi ca đọc như nhau. */
  function expectMeta(row: { ip: string | null; userAgent: string | null }, ua: string): void {
    expect(row.userAgent).toBe(ua); // giá trị của ĐÚNG request này (supertest không tự gửi UA)
    expect(row.ip).toMatch(LOOPBACK);
    expect(row.ip).not.toBe(MINT_IP); // không phải chép từ hàng mint
  }

  async function softDelete(id: string): Promise<void> {
    await direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [id]);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    direct = directPool();
    auth = app.get(AuthService);

    A = await seedCompany(direct, "s18m");
    companyIds.push(A.companyId);
  });

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, companyIds);
  });

  // ── §reset-ok ────────────────────────────────────────────────────────────────
  it("§reset-ok — reset thành công ⇒ `auth.password_reset` mang ip + userAgent của request đó", async () => {
    const UA = "s18meta-reset-ok/1.0";
    const target = await seedTarget("rok");
    const token = await requestResetToken(target.email);

    const res = await api(app)
      .post("/auth/reset-password")
      .set("User-Agent", UA)
      .send({ token, newPassword: NEW_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expectMeta(await auditRow(target.id, "auth.password_reset"), UA);
  });

  // ── §reset-denied ────────────────────────────────────────────────────────────
  it("§reset-denied — user xoá mềm ⇒ 401 và `auth.password_reset_denied` mang ip + userAgent", async () => {
    const UA = "s18meta-reset-denied/1.0";
    const target = await seedTarget("rdeny");
    const token = await requestResetToken(target.email);
    await softDelete(target.id);

    const res = await api(app)
      .post("/auth/reset-password")
      .set("User-Agent", UA)
      .send({ token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);

    expectMeta(await auditRow(target.id, "auth.password_reset_denied"), UA);

    // §shape (D3) — thêm trường vào VẾT không được đẻ oracle ở PHẢN HỒI: 401 này phải giống hệt 401
    // của một token rác. So hai phản hồi VỚI NHAU (không hard-code chuỗi) để đổi lời văn sau này không
    // làm ca đỏ oan mà vẫn ghim "không lộ 'tài khoản này từng tồn tại'".
    const garbage = await api(app)
      .post("/auth/reset-password")
      .set("User-Agent", UA)
      .send({ token: `${A.companyId}.khong-phai-token-that`, newPassword: NEW_PASSWORD });
    expect(garbage.status).toBe(401);
    // Neo TUYỆT ĐỐI trước khi so tương đối: nếu envelope đổi tên khoá thì `error?.code` của CẢ HAI vế
    // thành `undefined` và phép so bằng dưới đây xanh RỖNG (security-reviewer 07/09, LOW).
    expect(res.body.error?.code).toBeTruthy();
    expect(res.body.error?.message).toBeTruthy();
    expect(res.body.error?.code).toBe(garbage.body.error?.code);
    expect(res.body.error?.message).toBe(garbage.body.error?.message);
  });

  // ── §change-ok ───────────────────────────────────────────────────────────────
  it("§change-ok — đổi mật khẩu thành công ⇒ `auth.password_changed` mang ip + userAgent", async () => {
    const UA = "s18meta-change-ok/1.0";
    const target = await seedTarget("cok");
    const accessToken = await loginToken(target.email);

    const res = await api(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("User-Agent", UA)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expectMeta(await auditRow(target.id, "auth.password_changed"), UA);
  });

  // ── §change-denied — D4b ─────────────────────────────────────────────────────
  it("§change-denied — soft-delete XEN GIỮA SELECT và UPDATE ⇒ `auth.password_change_denied` mang ip + userAgent", async () => {
    const UA = "s18meta-change-denied/1.0";
    const target = await seedTarget("cdeny");
    const accessToken = await loginToken(target.email);

    // Spy trên ĐÚNG instance mà AuthService đang giữ (không phải một singleton lấy qua `app.get`, để
    // không phụ thuộc vào việc hai thứ đó có trùng nhau hay không).
    const pw = (auth as unknown as { password: PasswordService }).password;
    const real = pw.hash.bind(pw);
    let fired = 0;
    const spy = vi.spyOn(pw, "hash").mockImplementation(async (plain: string) => {
      // Chỉ can thiệp LẦN ĐẦU: `hash` nằm giữa câu SELECT re-auth và câu UPDATE `users`.
      if (fired++ === 0) await softDelete(target.id);
      return real(plain);
    });

    try {
      const res = await api(app)
        .post("/auth/change-password")
        .set("Authorization", `Bearer ${accessToken}`)
        .set("User-Agent", UA)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(401);
      // Chứng minh đã vào ĐÚNG nhánh `account_gone`, không phải `bad_credentials` — hai nhánh CỐ Ý
      // khác câu (`auth.service.ts:867` vs `:872`); nếu ca này rơi nhầm sang `bad_credentials` thì
      // hàng audit sẽ KHÔNG tồn tại và phép đo trở nên rỗng.
      expect(res.body.error?.message).toBe("Phiên đăng nhập không còn hợp lệ.");
      expect(fired).toBe(1);

      expectMeta(await auditRow(target.id, "auth.password_change_denied"), UA);
    } finally {
      // Khôi phục SAU khi đã assert xong (memory `mockrestore-wipes-mock-calls`).
      spy.mockRestore();
    }
  });

  // ── §shape (vế changePassword) ───────────────────────────────────────────────
  it("§shape — hai câu 401 của changePassword vẫn KHÁC nhau (không gộp khi thêm trường vào vết)", async () => {
    const target = await seedTarget("shape");
    const accessToken = await loginToken(target.email);

    const res = await api(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("User-Agent", "s18meta-shape/1.0")
      .send({ currentPassword: "sai-mat-khau-hien-tai", newPassword: NEW_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error?.message).toBe("Mật khẩu hiện tại không đúng.");
    // …và KHÁC câu của nhánh `account_gone` ở §change-denied. Người dùng đưa ĐÚNG mật khẩu mà bị nói
    // là sai thì đó là nói dối họ; ghim ở đây để lần vá sau không gộp hai nhánh.
    expect(res.body.error?.message).not.toBe("Phiên đăng nhập không còn hợp lệ.");
    // Nhánh `bad_credentials` KHÔNG ghi audit_logs (nó để vết ở `user_security_events.REAUTH_FAILED`
    // — món nợ N2 của plan §7). Ghim để bản vá N2 sau này không lặng lẽ đổi nơi ghi vết.
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE object_id = $1 AND action = 'auth.password_change_denied'`,
      [target.id],
    );
    expect(r.rows[0].n).toBe(0);
  });
});
