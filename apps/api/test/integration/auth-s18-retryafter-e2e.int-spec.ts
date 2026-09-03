/**
 * S18-AUTH-RETRYAFTER-1 — 429 đăng nhập mang `retryAfterSec`: vòng end-to-end qua HTTP THẬT.
 *
 * Ca:
 *  §e2e     — 5 lần sai ⇒ 429 mang `error.details[0] = {retryAfterSec, <giây>, retry-after}` VÀ header
 *             `Retry-After` bằng ĐÚNG số đó (một nguồn ⇒ body/header không lệch).
 *  §uniform — email-MA vs email-THẬT, mỗi bên khoá ở CÙNG loại bucket (`ip`) với cùng lịch sử ⇒ hai body
 *             429 GIỐNG HỆT nhau. Đây là ca chống lộ "email này có tồn tại không".
 *             ⛔ KHÔNG so bucket `acct` với bucket `ip`: `retryAfterSec` là TTL CÒN LẠI (phụ thuộc khoá
 *             dựng lúc nào), KHÔNG phải trần `LOGIN_LOCKOUT_SEC` ⇒ ghim "hai bucket cùng số" là ghim một
 *             bất biến KHÔNG TỒN TẠI.
 *  §nolock  — lần sai đầu (401, chưa khoá) ⇒ KHÔNG có header `Retry-After`, KHÔNG có details.
 *  §floor   — `done_when[1]`: đọc TTL nằm TRONG sàn thời gian. Đo PHÂN PHỐI (p50 của N lượt), không đo
 *             một mẫu: (a) 429 slug ĐÚNG vs (b) 429 slug SAI phải KHÔNG tách được, và cả hai vẫn ≥ sàn.
 *
 * ⚠️ ĐÍNH CHÍNH (review e926f282): file này CHẠY SONG SONG với int-spec khác — `vitest.config.ts`
 *    KHÔNG đặt `fileParallelism:false`, và đặt sẽ làm chậm toàn bộ suite chỉ vì một ca. Nên §floor
 *    KHÔNG được thiết kế như một đồng hồ chính xác: nó chịu nhiễu bằng p50 của 15 lượt XEN KẼ hai
 *    nhóm (nhiễu rơi đều lên cả hai) và bằng các ngưỡng THÔ ở dưới. Muốn số sạch để đọc tay thì chạy
 *    riêng file này; muốn cổng thì đọc ba assert (1)(1b)(2).
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
import { loadEnv } from "../../src/config/env.schema";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const PASSWORD = "Passw0rd!s18retry";
const WRONG_PASSWORD = "Wr0ng!s18retry";
/** Sàn thời gian nhánh 429 của `login` (`auth.service.ts` BLOCKED_LOGIN_FLOOR_MS) — GIỮ ĐỒNG BỘ. */
const BLOCKED_LOGIN_FLOOR_MS = 250;
/** Jitter của sàn (`FORGOT_PW_JITTER_MS`). Ngưỡng "không tách được" chọn theo con số này. */
const FLOOR_JITTER_MS = 80;
/**
 * TRẦN ngân sách sàn = sàn + jitter + biên nhiễu 250ms (HTTP loopback + supertest + int-spec chạy
 * song song). Số đo thật khi ký WO: p50 314ms / 323ms — cách trần ~260ms, nên ca KHÔNG bám sát mép.
 * Trần tồn tại để bắt việc round-trip TTL TRÀN RA NGOÀI sàn (bậc nghìn ms), không để đo chục ms.
 */
const FLOOR_BUDGET_CEILING_MS = BLOCKED_LOGIN_FLOOR_MS + FLOOR_JITTER_MS + 250;

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

interface ErrorBody {
  message: string;
  error: { code: string; type: string; details: Array<Record<string, string>> | null };
  meta: Record<string, unknown>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe.skipIf(!hasDb)("S18-AUTH-RETRYAFTER-1 — 429 mang retryAfterSec", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  const env = loadEnv();

  function api() {
    return request(app.getHttpServer());
  }

  /** Một lượt đăng nhập SAI mật khẩu. `slug` mặc định là slug THẬT của tenant A. */
  function loginWrong(email: string, slug: string = A.slug) {
    return api().post("/auth/login").send({ companySlug: slug, email, password: WRONG_PASSWORD });
  }

  /** Mỗi ca dùng MỘT email mới: không gian khoá `rl:` dùng chung giữa các spec/môi trường (KI-067). */
  function freshEmail(prefix: string): string {
    return `s18ra-${prefix}-${randomUUID().slice(0, 8)}@a.test`;
  }

  /** Đẩy bucket per-IP của `email` tới ngưỡng khoá, rồi trả PHẢN HỒI 429 kế tiếp. */
  async function lockThenProbe(email: string) {
    for (let i = 0; i < env.LOGIN_MAX_ATTEMPTS; i++) {
      const res = await loginWrong(email);
      expect(res.status, `lượt ${i + 1} phải là 401, nhận ${res.status}`).toBe(401);
    }
    const blocked = await loginWrong(email);
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(429);
    return blocked;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "s18ra");
    companyIds.push(A.companyId);
  });

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, companyIds);
  });

  // ── §e2e ────────────────────────────────────────────────────────────────────
  it("§e2e — 429 mang retryAfterSec trong `error.details` VÀ header Retry-After bằng ĐÚNG số đó", async () => {
    const email = freshEmail("e2e");
    await seedUser(direct, A.companyId, email, await hashedPw());

    const res = await lockThenProbe(email);
    const body = res.body as ErrorBody;

    // Hợp đồng CŨ không đổi một ký tự: message + code + type y như trước WO này.
    expect(body.message).toBe("Quá nhiều lần thử. Vui lòng thử lại sau.");
    expect(body.error.code).toBe("SYSTEM-ERR-RATE-LIMIT");
    expect(body.error.type).toBe("HttpException");

    expect(body.error.details).toHaveLength(1);
    const detail = body.error.details![0]!;
    expect(detail.field).toBe("retryAfterSec");
    expect(detail.rule).toBe("retry-after");

    // Số giây phải là số nguyên THẬT trong dải khoá, không phải 0/âm/rác.
    expect(detail.message).toMatch(/^\d+$/);
    const sec = Number.parseInt(detail.message, 10);
    expect(sec).toBeGreaterThan(0);
    expect(sec).toBeLessThanOrEqual(env.LOGIN_LOCKOUT_SEC);

    // Header suy TỪ body ⇒ phải khớp TUYỆT ĐỐI. Lệch = hai nguồn sự thật.
    expect(res.headers["retry-after"]).toBe(detail.message);
  });

  // ── §uniform ────────────────────────────────────────────────────────────────
  it("§uniform — email-MA và email-THẬT (cùng bucket `ip`, cùng lịch sử) cho payload 429 GIỐNG HỆT", async () => {
    const realEmail = freshEmail("real");
    await seedUser(direct, A.companyId, realEmail, await hashedPw());
    const ghostEmail = freshEmail("ghost"); // KHÔNG seed — email không tồn tại.

    const ghost = await lockThenProbe(ghostEmail);
    const real = await lockThenProbe(realEmail);

    // `meta` mang request_id + timestamp (khác nhau theo bản chất) ⇒ bỏ ra trước khi so.
    const strip = (b: ErrorBody) => ({ message: b.message, error: b.error });
    const g = strip(ghost.body as ErrorBody);
    const r = strip(real.body as ErrorBody);

    const secOf = (x: typeof g) => Number.parseInt(x.error.details![0]!.message, 10);
    // Chênh lệch giây là ĐỒNG HỒ TRÔI giữa hai vòng khoá, không phải tín hiệu về sự tồn tại của email.
    expect(Math.abs(secOf(g) - secOf(r))).toBeLessThanOrEqual(2);

    // Ngoài con số giây ra, KHÔNG được khác một ký tự nào — kể cả tên bucket đang khoá.
    const blank = (x: typeof g) => JSON.stringify(x).replace(/"message":"\d+"/g, '"message":"N"');
    expect(blank(g)).toBe(blank(r));

    // Header cũng phải cùng hình dạng ở cả hai (chỉ khác con số).
    expect(ghost.headers["retry-after"]).toMatch(/^\d+$/);
    expect(real.headers["retry-after"]).toMatch(/^\d+$/);
  });

  // ── §nolock ─────────────────────────────────────────────────────────────────
  it("§nolock — lần sai ĐẦU (401, chưa khoá) ⇒ KHÔNG header Retry-After, KHÔNG details", async () => {
    const email = freshEmail("nolock");
    await seedUser(direct, A.companyId, email, await hashedPw());

    const res = await loginWrong(email);

    expect(res.status).toBe(401);
    expect(res.headers["retry-after"]).toBeUndefined();
    expect((res.body as ErrorBody).error.details).toBeNull();
  });

  // ── §floor — done_when[1]: đọc TTL nằm TRONG sàn thời gian ───────────────────
  it("§floor — round-trip TTL bị sàn NUỐT TRỌN: 429 slug-đúng vs slug-sai KHÔNG tách được", async () => {
    // ⚠️ Bucket rate-limit ĐƯỢC KHOÁ THEO SLUG (`LoginRateLimiter.key(slug,email,ip)`), nên KHÔNG thể
    // lấy 429 của slug-sai bằng cách đổi slug trên một bucket đã khoá — phải khoá RIÊNG một bucket cho
    // slug ma. Đây chính là ca mà sàn tồn tại để che: nhánh 429 gọi `resolveBlockedLogOwner`, và slug
    // có-thật (đi `withTenant`) vs slug ma (ra NULL) làm lượng việc DB khác nhau ⇒ oracle KI-044.
    const ghostSlug = `s18ra-ghost-${randomUUID().slice(0, 8)}`;
    const realEmail = freshEmail("floor-real");
    const ghostEmail = freshEmail("floor-ghost");
    await seedUser(direct, A.companyId, realEmail, await hashedPw());

    await lockThenProbe(realEmail); // khoá bucket của slug THẬT
    for (let i = 0; i < env.LOGIN_MAX_ATTEMPTS; i++) {
      expect((await loginWrong(ghostEmail, ghostSlug)).status).toBe(401);
    }
    expect((await loginWrong(ghostEmail, ghostSlug)).status).toBe(429); // khoá bucket của slug MA

    const N = 15;
    const sample = async (email: string, slug: string): Promise<number> => {
      const t0 = Date.now();
      const res = await loginWrong(email, slug);
      expect(res.status).toBe(429);
      return Date.now() - t0;
    };

    const correctSlug: number[] = [];
    const wrongSlug: number[] = [];
    // Xen kẽ hai nhóm: nhiễu của máy (GC, tải nền) rơi đều lên cả hai thay vì dồn vào nhóm chạy sau.
    for (let i = 0; i < N; i++) {
      correctSlug.push(await sample(realEmail, A.slug));
      wrongSlug.push(await sample(ghostEmail, ghostSlug));
    }

    const pCorrect = median(correctSlug);
    const pWrong = median(wrongSlug);

    // (1) SÀN CÒN TÁC DỤNG — đây mới là thứ WO này chịu trách nhiệm: round-trip TTL vừa thêm CHƯA ăn
    //     hết ngân sách 250ms. Nếu ca này đỏ, sàn đã hở và oracle KI-044 quay lại.
    expect(pCorrect).toBeGreaterThanOrEqual(BLOCKED_LOGIN_FLOOR_MS);
    expect(pWrong).toBeGreaterThanOrEqual(BLOCKED_LOGIN_FLOOR_MS);

    // (1b) TRẦN — assert (1) MỘT MÌNH KHÔNG THỂ ĐỎ, nên nó không ghim được điều ca này tuyên bố.
    //      `applyUniformResponseFloor` ngủ tới MỐC TUYỆT ĐỐI `startedAt+sàn+jitter`, nên "≥ sàn" vẫn
    //      xanh kể cả khi round-trip TTL ngốn 5 giây — tức đúng cái hỏng mà ta muốn bắt lại lọt.
    //      Trần này mới là vế "TTL CHƯA ăn hết ngân sách": vượt trần ⇒ TTL đã tràn RA NGOÀI sàn và
    //      thời gian Valkey bắt đầu cộng thẳng vào phản hồi (oracle KI-044 quay lại).
    //      Biên rộng có chủ đích (file chạy song song với int-spec khác — xem docblock đầu file): nó
    //      là cổng bắt sai KHÁC BẬC (round-trip nghìn ms), không phải đồng hồ đo chục ms.
    expect(pCorrect).toBeLessThan(FLOOR_BUDGET_CEILING_MS);
    expect(pWrong).toBeLessThan(FLOOR_BUDGET_CEILING_MS);

    // (2) KHÔNG TÁCH ĐƯỢC — ngưỡng chọn theo jitter THẬT của sàn: nhỏ hơn jitter thì đo được nhiễu,
    //     lớn hơn nhiều thì cổng vô dụng.
    expect(Math.abs(pCorrect - pWrong)).toBeLessThan(FLOOR_JITTER_MS);

    // Nhóm đối chứng (c): 401 sai-mật-khẩu. CHỈ GHI SỐ THAM CHIẾU, KHÔNG assert quan hệ với (a)/(b) —
    // 429 (không băm) và 401 (có argon2 burn) khác nhau THEO THIẾT KẾ; ghim chúng bằng nhau là ghim một
    // điều SAI. Khuôn `console.log`-làm-evidence mirror `chat-qa1-scale.int-spec.ts`.
    const controlEmail = freshEmail("floor-401");
    await seedUser(direct, A.companyId, controlEmail, await hashedPw());
    const control: number[] = [];
    for (let i = 0; i < env.LOGIN_MAX_ATTEMPTS - 1; i++) {
      const t0 = Date.now();
      expect((await loginWrong(controlEmail)).status).toBe(401);
      control.push(Date.now() - t0);
    }
    console.log(
      `[s18-retryafter §floor] p50 — 429 slug-đúng: ${pCorrect}ms · 429 slug-sai: ${pWrong}ms · ` +
        `401 đối chứng (KHÔNG assert): ${median(control)}ms · sàn=${BLOCKED_LOGIN_FLOOR_MS}ms`,
    );
  });
});
