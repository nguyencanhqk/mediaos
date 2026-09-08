/**
 * S18-AUTH-RESETFLOOR-1 — `resetPassword` phải có SÀN thời gian phản hồi như `forgotPassword`.
 *
 * VẤN ĐỀ. `/auth/reset-password` là đường CÔNG KHAI không xác thực và các nhánh 401 của nó làm lượng
 * việc KHÁC HẲN nhau:
 *   • `malformed`  — `splitScopedToken` trả null ⇒ ném NGAY, KHÔNG chạm DB (0 round-trip).
 *   • `unknown`    — token parse được nhưng không có hàng ⇒ 401 sau ĐÚNG 1 SELECT.
 *   • `deleted`    — token THẬT của user đã xoá mềm ⇒ đốt `used_at`, chạy argon2id 19 MiB, UPDATE khớp
 *                    0 hàng, SELECT probe, GHI audit ⇒ 401 sau ~6 round-trip + một lần băm.
 * Thân phản hồi của cả ba BYTE-GIỐNG NHAU (S18-AUTH-RESETMETA-1 §shape đã ghim). Nhưng THỜI GIAN thì
 * không, và chênh lệch đó trả lời đúng câu mà thân phản hồi cố tình giấu: "token này có THẬT không".
 *
 * ⚠️ ĐO TRƯỚC, ĐỪNG VÁ THEO LÝ THUYẾT (done_when[1]). Mô tả gốc của WO nói argon2 tốn "hàng trăm ms";
 * đo thật trên máy ký WO thì tham số OWASP hiện hành (19 MiB · timeCost 2 · p=1) chỉ tốn **p50 12ms**.
 * Nên KHÔNG phải argon2 mà TỔNG của (băm + 5 round-trip thừa) mới là tín hiệu — xem số liệu §measure.
 *
 * ⚠️ TRẦN NGUYÊN TỬ LÀM GIẢM MỨC ĐỘ, KHÔNG XOÁ LỖ (done_when[3]). `UPDATE … WHERE used_at IS NULL`
 * (S18-AUTH-RESETDELETED-1) ép mỗi token chỉ đi qua nhánh `deleted` **một lần duy nhất**; lần hai rơi
 * xuống `unknown` (nhanh). Nên kẻ tấn công lấy được ĐÚNG MỘT mẫu cho mỗi token — không gom được phân
 * phối. Ngược lại, nhánh `unknown` KHÔNG bị rate-limit ở route (`auth.controller.ts:184-193` không có
 * decorator nào) nên đường CƠ SỞ thì đo bao nhiêu lượt cũng được. Một mẫu so với một đường cơ sở đã
 * biết rõ = cập nhật Bayes, không phải chắc chắn ⇒ MEDIUM, đúng như security-reviewer chấm.
 *
 * CỔNG NÀO THẬT SỰ ĐỎ KHI GỠ BẢN VÁ. Ba assert không cùng sức nặng, nói thẳng ra để người đọc sau
 * không tưởng cả ba đều là cổng:
 *   (1)  `median(malformed) ≥ sàn` và `median(unknown) ≥ sàn` — ĐÂY là cổng. Gỡ bản vá ⇒ hai số này
 *        rơi từ ~250ms xuống ~1ms/~4ms ⇒ đỏ chắc chắn, không phụ thuộc nhiễu.
 *   (1b) TRẦN — vì `applyUniformResponseFloor` ngủ tới MỐC TUYỆT ĐỐI nên (1) một mình KHÔNG THỂ đỏ khi
 *        thân hàm chậm đi; trần bắt ca "việc thật đã TRÀN RA NGOÀI sàn" (mượn khuôn §floor của
 *        `auth-s18-retryafter-e2e.int-spec.ts`).
 *   (2)  `|median(deleted) − median(unknown)| < jitter` — vế NỘI DUNG của WO, nhưng nó là cổng YẾU:
 *        chênh lệch TRƯỚC bản vá (~15–25ms) vốn đã nhỏ hơn jitter 80ms, nên assert này một mình sẽ
 *        xanh cả khi chưa vá. Giữ lại vì nó ghim đúng thứ ta tuyên bố, KHÔNG vì nó bắt được lỗi.
 *
 * ⚠️ File chạy SONG SONG với int-spec khác (`vitest.config.ts` không đặt `fileParallelism:false`) ⇒
 * đây KHÔNG phải đồng hồ chính xác. Chịu nhiễu bằng p50 của N lượt XEN KẼ (nhiễu rơi đều lên mọi nhóm)
 * + ngưỡng thô. Muốn số sạch đọc tay thì chạy riêng file này.
 *
 * ⚠️ `app.listen(0)` chứ không chỉ `app.init()` (memory `supertest-closes-shared-server-on-first-response`).
 */
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { AuthService } from "../../src/auth/auth.service";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const PASSWORD = "Passw0rd!s18floor";
const NEW_PASSWORD = "N3wPassw0rd!s18floor";

/** Sàn thời gian dùng chung với `forgotPassword` (`auth.service.ts` FORGOT_PW_FLOOR_MS) — GIỮ ĐỒNG BỘ. */
const RESET_PW_FLOOR_MS = 250;
/** Jitter của sàn (`FORGOT_PW_JITTER_MS`). Ngưỡng "không tách được" chọn theo con số này. */
const FLOOR_JITTER_MS = 80;
/**
 * TRẦN ngân sách sàn = sàn + jitter + biên nhiễu 250ms (HTTP loopback + supertest + int-spec chạy song
 * song). Trần bắt sai KHÁC BẬC (việc thật tràn ra ngoài sàn), KHÔNG phải đồng hồ đo chục ms.
 */
const FLOOR_BUDGET_CEILING_MS = RESET_PW_FLOOR_MS + FLOOR_JITTER_MS + 250;
/** Số lượt mỗi nhóm. Mỗi lượt `deleted` đốt MỘT user + MỘT token (single-use) ⇒ đây cũng là số user gieo. */
const N = 12;

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe.skipIf(!hasDb)("S18-AUTH-RESETFLOOR-1 — sàn thời gian cho /auth/reset-password", () => {
  let app: INestApplication;
  let direct: Pool;
  let auth: AuthService;
  let A: SeededTenant;
  const companyIds: string[] = [];

  function api() {
    return request(app.getHttpServer());
  }

  /** Plaintext reset token của `email` — outbox + JIT decrypt là đường DUY NHẤT lấy được (DB chỉ giữ hash). */
  async function mintToken(email: string): Promise<string> {
    await auth.forgotPassword({ companySlug: A.slug, email }, { ip: "198.51.100.7" });
    const ev = await direct.query(
      `SELECT payload FROM outbox_events
       WHERE company_id = $1 AND event_type = 'auth.password_reset_requested'
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    const payload = ev.rows[0].payload as { userId: string; resetTokenEnc: unknown };
    return auth.decryptResetToken(A.companyId, payload.resetTokenEnc, payload.userId);
  }

  async function seedTarget(prefix: string): Promise<{ id: string; email: string }> {
    const email = `s18f-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
    const id = await seedUser(direct, A.companyId, email, await hashedPw());
    return { id, email };
  }

  /** Một cặp (user đã xoá mềm, token THẬT còn hạn) — nhiên liệu dùng-một-lần của nhánh `deleted`. */
  async function armedDeletedToken(prefix: string): Promise<{ token: string; userId: string }> {
    const target = await seedTarget(prefix);
    const token = await mintToken(target.email);
    // XOÁ MỀM SAU khi mint: `forgotPassword` không cấp token cho hàng đã xoá, nên đây là ca THẬT —
    // "xoá nhân viên nghỉ việc trong lúc họ đang giữ mail đặt lại mật khẩu".
    await direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [target.id]);
    return { token, userId: target.id };
  }

  /** Một lượt đo: bấm giờ quanh POST thật, khẳng định 401, trả về ms. */
  async function sample(token: string): Promise<number> {
    const t0 = Date.now();
    const res = await api().post("/auth/reset-password").send({ token, newPassword: NEW_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(401);
    return Date.now() - t0;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    direct = directPool();
    auth = app.get(AuthService);

    A = await seedCompany(direct, "s18f");
    companyIds.push(A.companyId);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, companyIds);
  });

  // ── §measure — done_when[1] + [2] + [4] ─────────────────────────────────────
  it("§measure — ba nhánh 401 (malformed · unknown · deleted) đều ≥ sàn và KHÔNG tách được", async () => {
    // Nhiên liệu gieo TRƯỚC vòng đo: `armedDeletedToken` gọi `forgotPassword`, mà hàm đó CÓ sàn 250ms
    // ⇒ gieo xen kẽ trong vòng đo sẽ nhét ~300ms công việc vào giữa các phép đo.
    const fuel: Array<{ token: string; userId: string }> = [];
    for (let i = 0; i < N; i++) fuel.push(await armedDeletedToken(`del${i}`));

    const malformed: number[] = [];
    const unknown: number[] = [];
    const deleted: number[] = [];
    // Xen kẽ ba nhóm: nhiễu của máy (GC, tải nền, int-spec song song) rơi đều lên cả ba thay vì dồn
    // vào nhóm chạy sau.
    for (let i = 0; i < N; i++) {
      malformed.push(await sample(`not-a-uuid.${randomBytes(24).toString("hex")}`));
      unknown.push(await sample(`${A.companyId}.${randomBytes(24).toString("hex")}`));
      deleted.push(await sample(fuel[i]!.token));
    }

    // NEO DƯƠNG (security-reviewer FULL gate, MEDIUM) — cả ba nhóm đều trả 401, nên nếu nhóm `deleted`
    // thoái hoá thành BẢN SAO THỨ HAI của `unknown` (ví dụ về sau câu tra token lọc luôn user đã xoá,
    // hoặc trần nguyên tử dịch chỗ), mọi assert thời gian bên dưới VẪN XANH trong khi tuyên bố "ba
    // nhánh KHÁC lượng việc mà không tách được" đã rỗng — đúng hình dạng `tests-can-pin-a-hole-open`.
    // Hàng `auth.password_reset_denied` chỉ được ghi ở CUỐI nhánh đắt (sau argon2 + UPDATE khớp 0
    // hàng + probe), nên đếm đủ N là bằng chứng DƯƠNG rằng N lượt đó đã đi hết nhánh đắt thật.
    const denied = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE action = 'auth.password_reset_denied' AND object_id = ANY($1::uuid[])`,
      [fuel.map((f) => f.userId)],
    );
    expect(denied.rows[0].n, "mong ĐỦ N vết từ chối — nhóm `deleted` phải đã chạy NHÁNH ĐẮT").toBe(
      N,
    );

    const pMalformed = median(malformed);
    const pUnknown = median(unknown);
    const pDeleted = median(deleted);
    console.log(
      `[s18-resetfloor §measure] p50 — malformed(0 round-trip): ${pMalformed}ms · ` +
        `unknown(1 SELECT): ${pUnknown}ms · deleted(argon2+audit): ${pDeleted}ms · ` +
        `sàn=${RESET_PW_FLOOR_MS}ms · Δ(deleted−unknown)=${pDeleted - pUnknown}ms`,
    );

    // (1) CỔNG THẬT — gỡ bản vá ⇒ hai số đầu rơi xuống hàng đơn vị ms ⇒ đỏ chắc chắn.
    expect(pMalformed).toBeGreaterThanOrEqual(RESET_PW_FLOOR_MS);
    expect(pUnknown).toBeGreaterThanOrEqual(RESET_PW_FLOOR_MS);
    expect(pDeleted).toBeGreaterThanOrEqual(RESET_PW_FLOOR_MS);

    // (1b) TRẦN — (1) một mình KHÔNG THỂ đỏ khi thân hàm chậm đi (sàn ngủ tới mốc TUYỆT ĐỐI). Trần là
    //      vế bắt "việc thật đã tràn ra ngoài sàn" ⇒ chênh lệch cộng thẳng vào phản hồi trở lại.
    expect(pMalformed).toBeLessThan(FLOOR_BUDGET_CEILING_MS);
    expect(pUnknown).toBeLessThan(FLOOR_BUDGET_CEILING_MS);
    expect(pDeleted).toBeLessThan(FLOOR_BUDGET_CEILING_MS);

    // (2) KHÔNG TÁCH ĐƯỢC — vế nội dung. Cổng YẾU theo thiết kế (xem docblock đầu file): Δ trước bản vá
    //     vốn đã < jitter. Giữ vì nó ghim đúng thứ ta tuyên bố.
    expect(Math.abs(pDeleted - pUnknown)).toBeLessThan(FLOOR_JITTER_MS);
    expect(Math.abs(pUnknown - pMalformed)).toBeLessThan(FLOOR_JITTER_MS);
  }, 180_000);

  // ── §success — sàn KHÔNG được làm hỏng đường thành công ──────────────────────
  it("§success — reset HỢP LỆ vẫn 200 và mật khẩu mới dùng được (sàn chỉ trì hoãn, không đổi kết quả)", async () => {
    const target = await seedTarget("ok");
    const token = await mintToken(target.email);

    const t0 = Date.now();
    const res = await api().post("/auth/reset-password").send({ token, newPassword: NEW_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Đường thành công CŨNG đi qua `finally` ⇒ cũng bị sàn. Không phải yêu cầu bảo mật (200 vs 401 đã
    // tách sẵn), mà là hệ quả của việc đặt sàn ở BIÊN CÔNG KHAI phủ mọi return-path; ghim lại để lần
    // sau ai đó thu hẹp sàn xuống chỉ nhánh lỗi thì ca này nói cho họ biết họ đang đổi cái gì.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(RESET_PW_FLOOR_MS);

    const login = await api()
      .post("/auth/login")
      .send({ companySlug: A.slug, email: target.email, password: NEW_PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
  }, 60_000);
});
