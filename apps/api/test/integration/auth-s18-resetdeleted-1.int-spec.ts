/**
 * S18-AUTH-RESETDELETED-1 — `resetPassword` phải TỪ CHỐI user đã XOÁ MỀM.
 *
 * Trước WO này, câu UPDATE trong `resetPassword` không có `deleted_at IS NULL` ⇒ ai cầm một token
 * reset còn hạn của user đã xoá mềm vẫn ghi đè được hash mật khẩu hàng đó, và API trả 200. Vế làm nó
 * nguy hiểm hơn "dữ liệu chết": unique email là PARTIAL (`WHERE deleted_at IS NULL`) nên email của
 * user đã xoá CÓ THỂ đã được cấp lại cho người khác.
 *
 * ⚠️ VÌ SAO PHẢI LÀ INT-SPEC, KHÔNG PHẢI UNIT SPEC. `auth.service.spec.ts` mock `.returning()` trả
 * CỨNG một hàng và MÙ với predicate `.where()` ⇒ thêm `isNull(users.deletedAt)` vào WHERE không làm
 * nó đổi màu. Bằng chứng cho WO này chỉ có thể đến từ DB thật
 * (memory `tests-can-pin-a-hole-open` · `same-builder-twice-makes-unit-spec-vacuous`).
 *
 * Ca:
 *  §deny    — 🔴 ĐỎ trước vá: user xoá mềm + token hợp lệ ⇒ 401, hash KHÔNG đổi, token chết, có audit.
 *  §allow   — 🟢 đối chứng DƯƠNG bắt buộc: user bình thường vẫn đặt lại được (ca deny không xanh-RỖNG).
 *  §revive  — 🟢 khôi phục user rồi dùng LẠI token ⇒ vẫn 401.
 *  §atomic  — 🔴 ĐỎ trước vá: 5 request SONG SONG cùng một token ⇒ đúng 1 × 200 + 4 × 401.
 *  §admin   — 🟢 neo hành vi ĐÃ đúng: đường admin lên user xoá mềm ⇒ 404 (hình lỗi khác public — chủ ý).
 *
 * ⚠️ `app.listen(0)` là BẮT BUỘC (không chỉ `app.init()`): §atomic bắn 5 request song song, mà
 * supertest trên server chưa listen sẽ đóng server ngay khi response ĐẦU về
 * (memory `supertest-closes-shared-server-on-first-response` · nợ `S18-QA-SUPERTESTLISTEN-1`).
 *
 * ⚠️ Mỗi ca một EMAIL mới: `rl:forgot:*` khoá theo (slug,email) — mint 1 token/email nên không ca nào
 * chạm trần, và không ca nào đầu độc ca khác.
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
const PASSWORD = "Passw0rd!s18del";
const NEW_PASSWORD = "N3wPassw0rd!s18del";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

describe.skipIf(!hasDb)("S18-AUTH-RESETDELETED-1 — reset mật khẩu của user đã xoá mềm", () => {
  let app: INestApplication;
  let direct: Pool;
  let auth: AuthService;
  let A: SeededTenant;
  let adminToken: string;
  const companyIds: string[] = [];

  async function seedTarget(prefix: string): Promise<{ id: string; email: string }> {
    const email = `s18d-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
    const id = await seedUser(direct, A.companyId, email, await hashedPw());
    return { id, email };
  }

  /** Plaintext reset token cho `email` — qua outbox + JIT decrypt (khuôn auth-s18-resetclears-e2e). */
  async function requestResetToken(email: string): Promise<string> {
    await auth.forgotPassword({ companySlug: A.slug, email }, { ip: "198.51.100.201" });
    const ev = await direct.query(
      `SELECT payload FROM outbox_events
       WHERE company_id = $1 AND event_type = 'auth.password_reset_requested'
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    const payload = ev.rows[0].payload as { userId: string; resetTokenEnc: unknown };
    return auth.decryptResetToken(A.companyId, payload.resetTokenEnc, payload.userId);
  }

  async function softDelete(id: string): Promise<void> {
    await direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [id]);
  }
  async function restore(id: string): Promise<void> {
    await direct.query(`UPDATE users SET deleted_at = NULL WHERE id = $1`, [id]);
  }
  async function passwordHashOf(id: string): Promise<string> {
    const r = await direct.query(`SELECT password_hash FROM users WHERE id = $1`, [id]);
    return r.rows[0].password_hash as string;
  }
  async function tokenUsedAt(id: string): Promise<Date | null> {
    const r = await direct.query(
      `SELECT used_at FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    return (r.rows[0]?.used_at as Date | null) ?? null;
  }
  async function auditCount(userId: string, action: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE object_id = $1 AND action = $2`,
      [userId, action],
    );
    return r.rows[0].n as number;
  }
  function post(token: string) {
    return api(app).post("/auth/reset-password").send({ token, newPassword: NEW_PASSWORD });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    // Xem docblock đầu file: §atomic bắn song song ⇒ cần cổng TCP thật, không chỉ `init()`.
    await app.listen(0);
    direct = directPool();
    auth = app.get(AuthService);

    A = await seedCompany(direct, "s18d");
    companyIds.push(A.companyId);

    const adminEmail = `s18d-admin-${randomUUID().slice(0, 8)}@a.test`;
    const adminId = await seedUser(direct, A.companyId, adminEmail, await hashedPw());
    await seedUserRole(direct, adminId, COMPANY_ADMIN_ROLE_ID, A.companyId);
    const adminRes = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email: adminEmail, password: PASSWORD });
    expect(adminRes.status, JSON.stringify(adminRes.body)).toBe(200);
    adminToken = adminRes.body.data.accessToken as string;
  });

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, companyIds);
  });

  // ── §deny — ca ĐỎ của WO ────────────────────────────────────────────────────
  it("user XOÁ MỀM ⇒ 401 y hệt token hỏng, hash KHÔNG đổi, token bị đốt, có vết audit", async () => {
    const target = await seedTarget("deny");
    const token = await requestResetToken(target.email);
    const before = await passwordHashOf(target.id);
    await softDelete(target.id);

    const res = await post(token);
    expect(res.status).toBe(401);

    // BYTE-GIỐNG NHAU (done_when #2): so envelope với một token RÁC — so hai phản hồi VỚI NHAU chứ
    // không hard-code chuỗi, nên đổi lời văn sau này không làm ca này đỏ oan mà vẫn ghim "không có
    // oracle 'tài khoản này từng tồn tại'". So cả `code` lẫn `message` (tiền lệ auth-toprisk-http).
    const garbage = await post(`${A.companyId}.khong-phai-token-that`);
    expect(garbage.status).toBe(401);
    expect(res.body.error?.code).toBe(garbage.body.error?.code);
    expect(res.body.error?.message).toBe(garbage.body.error?.message);

    // Điểm chốt: hash KHÔNG bị ghi đè.
    expect(await passwordHashOf(target.id)).toBe(before);
    // Token phải CHẾT (xem §revive — nếu để sống thì khôi phục user làm nó sống lại).
    expect(await tokenUsedAt(target.id)).not.toBeNull();
    // Vết forensics: ai đó đã cầm token của một tài khoản đã xoá.
    expect(await auditCount(target.id, "auth.password_reset_denied")).toBe(1);
    // Và TUYỆT ĐỐI không được ghi vết "đã đặt lại thành công".
    expect(await auditCount(target.id, "auth.password_reset")).toBe(0);
  });

  // ── §allow — đối chứng DƯƠNG (done_when #3): thiếu ca này thì §deny xanh-RỖNG ─
  it("user BÌNH THƯỜNG vẫn đặt lại được: 200, hash ĐỔI, token đốt, phiên bị thu hồi", async () => {
    const target = await seedTarget("allow");
    const token = await requestResetToken(target.email);
    const before = await passwordHashOf(target.id);

    const res = await post(token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(await passwordHashOf(target.id)).not.toBe(before);
    expect(await tokenUsedAt(target.id)).not.toBeNull();
    expect(await auditCount(target.id, "auth.password_reset")).toBe(1);
    expect(await auditCount(target.id, "auth.password_reset_denied")).toBe(0);

    const login = await api(app)
      .post("/auth/login")
      .send({ companySlug: A.slug, email: target.email, password: NEW_PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
  });

  // ── §revive — TỰ CHỨA (không ăn side-effect của §deny) ───────────────────────
  it("khôi phục user rồi dùng LẠI token cũ ⇒ vẫn 401 (token đã chết ở lượt bị từ chối)", async () => {
    // ⚠️ Ca này XANH cả TRƯỚC lẫn SAU bản vá — hôm nay `used_at` đã được set vô điều kiện. Nó KHÔNG
    // bắt hồi quy; nó ghim LỰA CHỌN TRIỂN KHAI ở plan §3.2: ai đó bỏ `used_at` khỏi nhánh từ chối
    // (nghĩ rằng "UPDATE không khớp hàng nào" là đủ) sẽ làm ca này ĐỎ, vì `restoreTx` set
    // `deleted_at = NULL` và token cũ sẽ sống lại trong TTL.
    const target = await seedTarget("revive");
    const token = await requestResetToken(target.email);
    const before = await passwordHashOf(target.id);

    await softDelete(target.id);
    expect((await post(token)).status).toBe(401);

    await restore(target.id);
    expect((await post(token)).status).toBe(401);
    expect(await passwordHashOf(target.id)).toBe(before);
  });

  // ── §atomic — single-use phải do CODE ép, không phải do may mắn ──────────────
  it("5 request SONG SONG cùng một token ⇒ đúng 1 × 200 + 4 × 401, và đúng 1 vết reset", async () => {
    // ĐỎ trước vá: SELECT token không FOR UPDATE và UPDATE `used_at` không có `AND used_at IS NULL`
    // ⇒ ở READ COMMITTED cả 5 đều đọc `used_at = null`, đều đi tiếp, đều ghi. Đó là bề mặt sinh-hàng
    // do KẺ CẦM TOKEN điều khiển — chính là lý do khiến việc thêm một lệnh ghi ở nhánh từ chối
    // (§deny) chỉ an toàn SAU khi single-use được ép thật.
    const target = await seedTarget("atomic");
    const token = await requestResetToken(target.email);

    const results = await Promise.all(Array.from({ length: 5 }, () => post(token)));
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 401, 401, 401, 401]);
    expect(await auditCount(target.id, "auth.password_reset")).toBe(1);
  });

  // ── §admin — neo hành vi ĐÃ đúng (done_when #4) ──────────────────────────────
  it("đường ADMIN lên user xoá mềm ⇒ 404, KHÁC hình lỗi public 401 — và khác là ĐÚNG", async () => {
    // Public không xác thực ⇒ mọi nhánh hỏng phải hội tụ về MỘT phản hồi (chống dò danh tính).
    // Admin đã xác thực + qua PermissionGuard cặp `reset-password:user` ⇒ không phải kênh dò, nên
    // 404 "không thấy user" là câu trả lời đúng và hữu ích hơn.
    const target = await seedTarget("admin");
    await softDelete(target.id);
    const before = await passwordHashOf(target.id);

    const res = await api(app)
      .post(`/auth/users/${target.id}/password/reset`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(await passwordHashOf(target.id)).toBe(before);
  });
});
