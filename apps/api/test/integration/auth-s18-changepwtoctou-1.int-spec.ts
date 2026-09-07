/**
 * S18-AUTH-CHANGEPWTOCTOU-1 — `changePassword` không được ghi `password_hash` lên hàng đã XOÁ MỀM.
 *
 * Trước WO này, câu UPDATE trong `changePassword` chỉ có `eq(users.id, …)`; vế `deleted_at IS NULL`
 * nằm ở câu SELECT phía trên, TRONG CÙNG tx. PostgreSQL chạy READ COMMITTED — **mỗi câu lệnh một ảnh
 * chụp** — nên một `UPDATE users SET deleted_at = now()` commit **xen giữa** hai câu đó sẽ hiện ra với
 * câu UPDATE, và hash bị ghi đè lên một hàng đã xoá. Unique email là PARTIAL
 * (`WHERE deleted_at IS NULL`) ⇒ email đó CÓ THỂ đã được cấp lại cho người khác.
 *
 * ⚠️ VÌ SAO KHÔNG THỂ TEST BẰNG CÁCH "gọi thẳng service với hàng đã xoá" (công thức trong done_when
 * bản đầu). Làm vậy thì câu SELECT bắt trước ⇒ nhánh `!row` ⇒ **câu UPDATE không bao giờ chạy**. Bài
 * đó xanh y hệt nhau TRƯỚC và SAU bản vá — đúng họ `overdetermined-gate-makes-deny-spec-vacuous`:
 * cổng chồng nhau phải đột biến TỪNG VẾ, không đo cả cụm.
 *
 * §race giải bằng cách bọc `DbService.withTenant` **call-through** và cho câu SELECT (và CHỈ nó) thấy
 * một hàng "còn sống" — đúng thứ mà READ COMMITTED cho phép — trong khi câu UPDATE chạy THẬT lên hàng
 * THẬT SỰ đã xoá. Đó là mô phỏng trung thực của "soft-delete xen giữa".
 *
 * Ca:
 *  §allow    — 🟢 đối chứng DƯƠNG qua HTTP thật: user sống vẫn đổi được (ca deny không xanh-RỖNG).
 *  §race     — 🔴 ĐỎ trước vá: cửa sổ TOCTOU ⇒ 401, hash KHÔNG đổi, KHÔNG side-effect nào, có vết.
 *  §reachable— 🟢 neo hành vi CŨ: user xoá mềm gọi thẳng ⇒ vẫn 401 'mật khẩu sai' (quyết bởi SELECT).
 *
 * ⚠️ `app.listen(0)`: `getHttpServer()` chưa listen thì supertest đóng server ngay khi response ĐẦU
 * về (memory `supertest-closes-shared-server-on-first-response` · nợ đã đóng ở `S18-QA-SUPERTESTLISTEN-1`).
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
import { users } from "../../src/db/schema";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const PASSWORD = "Passw0rd!s18toc";
const NEW_PASSWORD = "N3wPassw0rd!s18toc";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

/** Chữ ký `DatabaseService.withTenant` thu hẹp về đúng thứ §race cần bọc (tránh phụ thuộc kiểu DI). */
type TenantRunner = (companyId: string, fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

describe.skipIf(!hasDb)("S18-AUTH-CHANGEPWTOCTOU-1 — đổi mật khẩu trên hàng đã xoá mềm", () => {
  let app: INestApplication;
  let direct: Pool;
  let auth: AuthService;
  let dbsvc: { withTenant: TenantRunner };
  let A: SeededTenant;
  const companyIds: string[] = [];

  async function seedTarget(prefix: string): Promise<{ id: string; email: string }> {
    const email = `s18toc-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
    const id = await seedUser(direct, A.companyId, email, await hashedPw());
    // `must_change_password = true` để §race đo được rằng câu UPDATE (clear cờ CÙNG statement với
    // hash) đã KHÔNG chạy — không chỉ đo mỗi cột hash.
    await direct.query(`UPDATE users SET must_change_password = true WHERE id = $1`, [id]);
    return { id, email };
  }

  async function login(email: string, password: string) {
    return api(app).post("/auth/login").send({ companySlug: A.slug, email, password });
  }
  async function softDelete(id: string): Promise<void> {
    await direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [id]);
  }
  async function userRow(id: string): Promise<{ hash: string; mustChange: boolean }> {
    const r = await direct.query(
      `SELECT password_hash, must_change_password FROM users WHERE id = $1`,
      [id],
    );
    return { hash: r.rows[0].password_hash as string, mustChange: r.rows[0].must_change_password };
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
  async function liveCount(table: "refresh_tokens" | "user_sessions", id: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1 AND revoked_at IS NULL`,
      [id],
    );
    return r.rows[0].n as number;
  }

  /**
   * Bọc một `TenantTx` THẬT: câu `select().from(users)` ĐẦU TIÊN trả `fakeRows` (ảnh chụp cũ của READ
   * COMMITTED); MỌI lệnh khác — đặc biệt câu UPDATE — forward nguyên vẹn sang tx thật.
   *
   * ⚠️ Chặn ĐÚNG MỘT câu và `counter` được assert `=== 1`: hôm nay "select `users` đầu tiên" chính là
   * câu ở `auth.service.ts:750`; ai thêm một select sớm hơn (probe/policy) sau này sẽ khiến proxy
   * chặn NHẦM câu khác trong im lặng, và bài test sẽ nói dối thay vì đỏ.
   */
  function proxyTx<T extends object>(realTx: T, fakeRows: unknown[], counter: { n: number }): T {
    return new Proxy(realTx, {
      get(target, prop, receiver) {
        if (prop !== "select") {
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (...args: unknown[]) => {
          const builder = (target as Record<string, (...a: unknown[]) => object>).select(...args);
          return new Proxy(builder, {
            get(b, p) {
              if (p !== "from") {
                const v = Reflect.get(b, p);
                return typeof v === "function" ? v.bind(b) : v;
              }
              return (table: unknown) => {
                if (table !== users || counter.n > 0) {
                  return (b as Record<string, (...a: unknown[]) => unknown>).from(table);
                }
                counter.n += 1;
                const chain = {
                  where: () => chain,
                  limit: () => Promise.resolve(fakeRows),
                };
                return chain;
              };
            },
          });
        };
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    direct = directPool();
    auth = app.get(AuthService);
    // Lấy ĐÚNG instance mà AuthService đang giữ, không qua DI container: `DbService` không resolve
    // được từ context gốc (DbModule không global), và quan trọng hơn — thứ §race cần bọc là chính
    // object mà `changePassword` gọi, không phải "một" DbService nào đó.
    dbsvc = (auth as unknown as { dbsvc: { withTenant: TenantRunner } }).dbsvc;

    A = await seedCompany(direct, "s18toc");
    companyIds.push(A.companyId);
  });

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, companyIds);
  });

  // ── §allow — đối chứng DƯƠNG. Thiếu ca này thì §race xanh-RỖNG ───────────────
  it("user BÌNH THƯỜNG vẫn đổi được mật khẩu: 200, hash ĐỔI, cờ ép-đổi clear, phiên bị thu hồi", async () => {
    const target = await seedTarget("allow");
    const before = await userRow(target.id);

    const session = await login(target.email, PASSWORD);
    expect(session.status, JSON.stringify(session.body)).toBe(200);
    expect(await liveCount("refresh_tokens", target.id)).toBeGreaterThan(0);

    const res = await api(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${session.body.data.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const after = await userRow(target.id);
    expect(after.hash).not.toBe(before.hash);
    expect(after.mustChange).toBe(false);
    expect(await auditCount(target.id, "auth.password_changed")).toBe(1);
    expect(await auditCount(target.id, "auth.password_change_denied")).toBe(0);
    // Đổi mật khẩu = đăng xuất MỌI phiên.
    expect(await liveCount("refresh_tokens", target.id)).toBe(0);
    expect(await liveCount("user_sessions", target.id)).toBe(0);
  });

  // ── §race — ca ĐỎ của WO. Đây là bằng chứng DUY NHẤT cho vế mới ──────────────
  it("soft-delete XEN GIỮA read và write ⇒ 401, hash KHÔNG đổi, KHÔNG side-effect nào, có vết từ chối", async () => {
    const target = await seedTarget("race");
    const session = await login(target.email, PASSWORD);
    expect(session.status, JSON.stringify(session.body)).toBe(200);
    // Phải có phiên SỐNG trước khi xoá: không có thì assert "phiên không bị thu hồi" đúng một cách
    // TRỐNG RỖNG (0 hàng) cả trước lẫn sau bản vá.
    expect(await liveCount("refresh_tokens", target.id)).toBeGreaterThan(0);
    expect(await liveCount("user_sessions", target.id)).toBeGreaterThan(0);

    const before = await userRow(target.id);
    await softDelete(target.id);

    const counter = { n: 0 };
    const original = dbsvc.withTenant.bind(dbsvc);
    // CALL-THROUGH, không thay thế: tự mở `db.transaction()` thì GUC `app.current_company_id` không
    // được set ⇒ FORCE RLS trả 0 hàng ⇒ câu UPDATE khớp 0 hàng vì lý do SAI ⇒ bài xanh mà chứng minh
    // nhầm thứ.
    const spy = vi.spyOn(dbsvc, "withTenant").mockImplementation((companyId, fn) =>
      // Chỉ bọc tx của ĐÚNG công ty test: `withTenant` là điểm vào dùng chung của cả app, và một
      // job/scheduler do AppModule khởi động có thể mở tx trong cửa sổ này và ăn mất suất chặn duy
      // nhất. Lọc theo companyId thu hẹp cửa đó (bài vẫn ĐỎ ồn ào chứ không xanh giả nếu trượt).
      companyId === A.companyId
        ? original(companyId, (tx) =>
            fn(proxyTx(tx as object, [{ passwordHash: before.hash }], counter)),
          )
        : original(companyId, fn),
    );
    try {
      await expect(
        auth.changePassword({ id: target.id, companyId: A.companyId }, PASSWORD, NEW_PASSWORD, {}),
      ).rejects.toSatisfy((err: unknown) => {
        const e = err as { status?: number; message?: string };
        // 401 như mọi nhánh hỏng khác (không đẻ status mới), nhưng KHÔNG được nói dối là sai mật
        // khẩu — người dùng vừa đưa ĐÚNG mật khẩu hiện tại.
        return e.status === 401 && e.message !== "Mật khẩu hiện tại không đúng.";
      });
    } finally {
      spy.mockRestore();
    }

    // Proxy phải chặn ĐÚNG câu SELECT hash hiện tại — không hơn, không kém.
    expect(counter.n).toBe(1);

    const after = await userRow(target.id);
    expect(after.hash).toBe(before.hash); // ⟵ ĐIỂM CHỐT: hash KHÔNG bị ghi đè
    expect(after.mustChange).toBe(true); // cờ ép-đổi nằm CÙNG statement ⇒ cũng không được clear

    // `return` đứng TRƯỚC mọi lệnh ghi còn lại ⇒ 0 side-effect:
    expect(await auditCount(target.id, "auth.password_changed")).toBe(0);
    expect(await securityEventCount(target.id, "PASSWORD_CHANGED")).toBe(0);
    expect(await liveCount("refresh_tokens", target.id)).toBeGreaterThan(0);
    expect(await liveCount("user_sessions", target.id)).toBeGreaterThan(0);
    // D4 — KHÔNG phạt người dùng hợp lệ: không có vết "re-auth thất bại".
    expect(await securityEventCount(target.id, "REAUTH_FAILED")).toBe(0);
    // …nhưng nhánh từ chối vùng đỏ PHẢI để lại vết BỀN (mirror `auth.password_reset_denied` #480).
    expect(await auditCount(target.id, "auth.password_change_denied")).toBe(1);
    // Nhãn phải TRUNG THỰC với thứ probe THẤY (mirror `auth.password_reset_denied` của #480): hàng
    // vẫn nhìn thấy được trong tenant và `deleted_at` có giá trị ⇒ đúng `user_deleted`, không phải
    // một hằng đoán trước.
    const denied = await direct.query(
      `SELECT after FROM audit_logs WHERE object_id = $1 AND action = 'auth.password_change_denied'`,
      [target.id],
    );
    expect(denied.rows[0].after?.reason).toBe("user_deleted");
  });

  // ── §reachable — neo hành vi CŨ (plan D1) ───────────────────────────────────
  it("user xoá mềm gọi thẳng (KHÔNG proxy) ⇒ vẫn 401 'mật khẩu hiện tại không đúng', hash không đổi", async () => {
    // ⚠️ Ca này XANH cả TRƯỚC lẫn SAU bản vá. Nó được quyết bởi câu SELECT `:753` (vốn ĐÃ lọc
    // `deleted_at`), KHÔNG phải bởi vế mới ở câu UPDATE — đừng đọc màu xanh của nó thành bằng chứng
    // cho WO này (§race mới là bằng chứng). Nó ghim QUYẾT ĐỊNH D1: WO này CHỦ Ý không gộp nhánh
    // `!row` vào outcome mới, vì nhánh đó đang để lại vết bền `REAUTH_FAILED` và gộp = xoá vết đó.
    const target = await seedTarget("reachable");
    const before = await userRow(target.id);
    await softDelete(target.id);

    await expect(
      auth.changePassword({ id: target.id, companyId: A.companyId }, PASSWORD, NEW_PASSWORD, {}),
    ).rejects.toSatisfy(
      (err: unknown) => (err as { message?: string }).message === "Mật khẩu hiện tại không đúng.",
    );
    expect((await userRow(target.id)).hash).toBe(before.hash);
    expect(await securityEventCount(target.id, "REAUTH_FAILED")).toBe(1);
  });
});
