/**
 * S10-QA-COLDSTART500-1 — BẢN ĐỒ BỀ MẶT TRƯỚC-PIPE: tầng nào biến một request biên thành 500?
 *
 * ─── VÌ SAO SPEC NÀY TỒN TẠI ───────────────────────────────────────────────────────────────────
 * `S10-FND-PARAMUUID-2` quan sát được MỘT lần ca DENY `PATCH /leave/types/:id` trả **500** thay vì
 * 400 trên lane DB vừa chain-migrate, rồi ba lần chạy sau đều xanh. `ParseUUIDPipe` là TẤT ĐỊNH ⇒
 * 500 đó chỉ có thể đến từ tầng chạy TRƯỚC pipe. Spec này ĐO bề mặt đó thay vì suy luận về nó.
 *
 * ─── SỐ ĐO (28/08/2026 · `LANE_DB=mediaos_coldstart`) ──────────────────────────────────────────
 * Một request `PATCH /leave/types/khong-phai-uuid` chạm `DatabaseService.withTenant` **2 lần TRƯỚC**
 * khi pipe kịp từ chối — stack thật, không phải đọc code:
 *   #1  TwoFactorEnforcementGuard.canActivate:77 → isCompany2faEnforced:105 → withTenant
 *   #2  PermissionGuard.canActivate:128 → PermissionService.can:273 → …getCompanyRoleGrants → withTenant
 * Hai chỗ đó xử lỗi hạ tầng KHÁC NHAU:
 *   #2 fail-CLOSED có phân loại → 403 `AUTH-ERR-FORBIDDEN` (PermissionGuard tự bắt, ca 4).
 *   #1 KHÔNG có try/catch quanh vỏ transaction → lỗi thoát nguyên trạng → `AllExceptionsFilter`
 *      map thành **500 `SYSTEM-ERR-001` · `error.type:"Error"`** (ca 2) — đúng chữ ký của flake.
 *
 * ⚠️ `SecurityPolicyService.getEffectiveTwoFactorRequired` CÓ try/catch, nhưng nó nằm BÊN TRONG
 * callback của `withTenant`. Cái hỏng được là VỎ transaction (lấy connection · BEGIN · set_config ·
 * COMMIT) — phần KHÔNG ai bọc. Đọc lướt rất dễ kết luận nhầm là "đã fail-to-floor rồi".
 *
 * ⚠️ Ở PROD `TWO_FACTOR_ENFORCEMENT_ENABLED` mặc định `'true'` (env.schema:102) ⇒ nhánh
 * `roleRequired` (guard:78 → `twoFactor.requiresTwoFactor` → `withTenant`) chạy MỌI request và
 * KHÔNG có cache nào — cache 30s ở nhánh L77 KHÔNG che được nó (ca 5).
 *
 * ─── ĐÃ VÁ (31/08/2026 · `S10-AUTH-2FAGUARD-FAILMODE-1`, owner chốt fail-mode (b)) ───────────────
 * Ca (2) và (5) TRƯỚC ĐÂY ghim cái lỗ (500 vô danh). WO vá đã sửa CHÚNG CÓ CHỦ ĐÍCH sang hợp đồng
 * MỚI: cả BA lời gọi (`:77` · `:78` · `:84`) bọc `guardedRead` ⇒ lỗi HẠ TẦNG thành
 * **503 `AUTH-ERR-2FA-UNAVAILABLE`** (fail-closed CÓ PHÂN LOẠI — vẫn từ chối, nhưng quan sát được và
 * KHÔNG giả dạng 403 "thiếu quyền"). Ca (6)(7)(8) phủ nốt `:84`, "không cache khi lỗi", và
 * "không nuốt 403 nghiệp vụ". Plan + census 16 route: `docs/plans/S10-AUTH-2FAGUARD-FAILMODE-1.md`.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { randomUUID } from "node:crypto";
import {
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
  type INestApplication,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import {
  TWO_FACTOR_SETUP_REQUIRED,
  TWO_FACTOR_UNAVAILABLE,
  TwoFactorEnforcementGuard,
} from "../../src/auth/two-factor-enforcement.guard";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { DatabaseService } from "../../src/db/db.service";
import { SecurityPolicyService } from "../../src/security-policy/security-policy.service";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s10cs500");
const JUNK = "khong-phai-uuid";
/** Thông điệp lỗi hạ tầng dùng để TIÊM — cùng hình dạng lỗi `pg` khi connection chết giữa chừng. */
const INFRA_ERR = "Connection terminated unexpectedly";

describe.skipIf(!hasLaneDb)(
  "S10-QA-COLDSTART500-1 · bề mặt TRƯỚC-pipe của `PATCH /leave/types/:id`",
  () => {
    let app: INestApplication;
    let direct: Pool;
    const companyIds: string[] = [];
    /** Bắt ĐÚNG thứ `AllExceptionsFilter` log cho 5xx (message + stack thật). */
    const errorLog: Array<{ message: string; stack: string }> = [];

    const http = () => request(app.getHttpServer());

    /** Công ty MỚI ⇒ cache 2FA (khoá theo CÔNG TY) và cache quyền (khoá theo USER) đều LẠNH. */
    async function freshCompany(): Promise<SeededTenant> {
      const T = await seedCompany(direct, "s10cs500");
      companyIds.push(T.companyId);
      return T;
    }

    /** Thêm một admin `manage:leave` vào công ty đã có; trả access token. */
    async function adminIn(T: SeededTenant): Promise<string> {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `adm-${randomUUID().slice(0, 8)}@s10cs500.local`;
      const userId = await seedUser(direct, T.companyId, email, hash);
      const roleId = await seedRole(direct, T.companyId, `s10cs500-${randomUUID().slice(0, 8)}`);
      const permId = await seedPermissionCatalog(direct, "manage", "leave", false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      await seedUserRole(direct, userId, roleId, T.companyId);
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: T.slug, email, password: LOGIN_PW });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function freshAdmin(): Promise<string> {
      return adminIn(await freshCompany());
    }

    /** Request BIÊN: `:id` rác, body HỢP LỆ, KHÔNG `Idempotency-Key`. DB khoẻ ⇒ phải là 400. */
    const patchJunk = (token: string) =>
      http()
        .patch(`/leave/types/${JUNK}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Đổi tên" });

    /**
     * Guard THẬT dựng từ deps của container (vitest.config ép `TWO_FACTOR_ENFORCEMENT_ENABLED='false'`
     * cho toàn suite, nên nhánh `:78`/`:84` chỉ đo được bằng cách tự dựng rồi đặt cờ).
     */
    function freshGuard() {
      const guard = new TwoFactorEnforcementGuard(
        app.get(Reflector),
        app.get(TwoFactorService, { strict: false }),
        app.get(DatabaseService),
        app.get(SecurityPolicyService, { strict: false }),
      );
      const g = guard as unknown as {
        globalEnabled: boolean;
        company2faCache: Map<string, { value: boolean; expiresAt: number }>;
      };
      return { guard, g, companyId: randomUUID() };
    }

    /** ExecutionContext HTTP tối thiểu: route thường (không @Public/@AllowWithoutTwoFactor). */
    function ctxFor(companyId: string, userId: string = randomUUID()) {
      return {
        getType: () => "http",
        getHandler: () => function handler() {},
        getClass: () => class Ctrl {},
        switchToHttp: () => ({ getRequest: () => ({ user: { id: userId, companyId } }) }),
      } as unknown as Parameters<TwoFactorEnforcementGuard["canActivate"]>[0];
    }

    /** Chạy `fn` với `DatabaseService.withTenant` LUÔN HỎNG, rồi trả nguyên trạng. */
    async function withBrokenDb<T>(fn: () => Promise<T>): Promise<T> {
      const dbsvc = app.get(DatabaseService);
      const real = dbsvc.withTenant.bind(dbsvc);
      (dbsvc as unknown as { withTenant: unknown }).withTenant = (): Promise<never> =>
        Promise.reject(new Error(INFRA_ERR));
      try {
        return await fn();
      } finally {
        (dbsvc as unknown as { withTenant: unknown }).withTenant = real;
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useLogger({
        log: () => undefined,
        warn: () => undefined,
        debug: () => undefined,
        verbose: () => undefined,
        error: (message: unknown, stack?: unknown) => {
          errorLog.push({ message: String(message), stack: String(stack ?? "") });
        },
      });
      // Mirror main.ts — thiếu một lớp thì mọi kết luận "400 hay 500" đo một stack KHÁC với PROD.
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();
    }, 180_000);

    afterAll(async () => {
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ══ (1) BẢN ĐỒ — request `:id` RÁC chạm DB mấy lần TRƯỚC pipe, và ở ĐÂU? ═══════════════════
    it("BẢN ĐỒ · :id rác trên tenant LẠNH đi qua ĐÚNG 2 lời gọi withTenant TRƯỚC pipe", async () => {
      const dbsvc = app.get(DatabaseService);
      const real = dbsvc.withTenant.bind(dbsvc);
      const callSites: string[] = [];
      (dbsvc as unknown as { withTenant: unknown }).withTenant = (
        companyId: string,
        fn: never,
      ): unknown => {
        callSites.push(new Error("call-site").stack ?? "");
        return real(companyId, fn);
      };
      let res: request.Response;
      try {
        const token = await freshAdmin();
        callSites.length = 0;
        res = await patchJunk(token);
      } finally {
        (dbsvc as unknown as { withTenant: unknown }).withTenant = real;
      }

      // DB KHOẺ ⇒ biên vẫn đúng: pipe từ chối bằng 400.
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      // …nhưng ĐƯỜNG ĐI tới cái 400 đó đã chạm DB hai lần. Đây là điều kiện CẦN của flake.
      expect(callSites).toHaveLength(2);
      expect(callSites[0]).toContain("TwoFactorEnforcementGuard.isCompany2faEnforced");
      expect(callSites[1]).toContain("PermissionGuard.canActivate");
    }, 60_000);

    // ══ (2) HỢP ĐỒNG SAU VÁ — lỗi hạ tầng ở guard 2FA ⇒ 503 CÓ PHÂN LOẠI, KHÔNG 500 vô danh ═════
    // Trước vá ca này ghim 500 `SYSTEM-ERR-001` · `type:"Error"`. Sau vá: mã riêng + type có tên
    // ⇒ 500 THẬT trên PROD không còn bị 500 GIẢ này làm loãng.
    it("SAU VÁ · withTenant hỏng khi cache 2FA LẠNH (:77) ⇒ 503 AUTH-ERR-2FA-UNAVAILABLE", async () => {
      const token = await freshAdmin();
      errorLog.length = 0;
      const res = await withBrokenDb(() => patchJunk(token));

      expect(res.status, JSON.stringify(res.body)).toBe(503);
      expect(res.body.error?.code).toBe(TWO_FACTOR_UNAVAILABLE);
      // `type` = tên exception ⇒ KHÔNG còn là `"Error"` thô nổi lên filter.
      expect(res.body.error?.type).toBe("ServiceUnavailableException");
      // Message ra client KHÔNG mang chi tiết hạ tầng (security.md).
      expect(JSON.stringify(res.body)).not.toContain(INFRA_ERR);
      // …nhưng lý do THẬT vẫn vào log server-side, chỉ đích danh tầng.
      const logged = errorLog.map((e) => `${e.message}\n${e.stack}`).join("\n");
      expect(logged).toContain(INFRA_ERR);
    }, 60_000);

    // ══ (3) ĐỐI CHỨNG — pipe KHÔNG hỏng: cache ẤM thì cùng lỗi đó không chạm request ═══════════
    it("ĐỐI CHỨNG · cache 2FA + cache quyền ẤM ⇒ cùng lỗi withTenant vẫn cho 400 ở BIÊN", async () => {
      const token = await freshAdmin();
      const warm = await patchJunk(token); // làm ẤM cả hai cache
      expect(warm.status, JSON.stringify(warm.body)).toBe(400);

      const res = await withBrokenDb(() => patchJunk(token));
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.type).toBe("BadRequestException");
    }, 60_000);

    // ══ (4) PHÂN LẬP — PermissionGuard KHÔNG phải nguồn của 500 ════════════════════════════════
    it("PHÂN LẬP · PermissionGuard hỏng DB ⇒ 403 AUTH-ERR-FORBIDDEN, KHÔNG 500", async () => {
      const T = await freshCompany();
      const user1 = await adminIn(T);
      const warm = await patchJunk(user1); // ẤM cache 2FA của CÔNG TY T (khoá theo company)
      expect(warm.status, JSON.stringify(warm.body)).toBe(400);

      const user2 = await adminIn(T); // user MỚI ⇒ cache quyền (khoá theo user) còn LẠNH
      const res = await withBrokenDb(() => patchJunk(user2));
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.error?.code).toBe("AUTH-ERR-FORBIDDEN");
    }, 60_000);

    // ══ (5) HÌNH DẠNG PROD — nhánh `roleRequired` KHÔNG có cache nào che ═══════════════════════
    // vitest.config ép `TWO_FACTOR_ENFORCEMENT_ENABLED='false'` cho toàn suite, nên nhánh này chỉ đo
    // được bằng cách dựng guard THẬT (deps thật từ container) rồi bật cờ đúng như mặc định PROD.
    it("SAU VÁ · nhánh roleRequired (guard:78) ⇒ 503 AUTH-ERR-2FA-UNAVAILABLE, KHÔNG lỗi thô", async () => {
      const { guard, g, companyId } = freshGuard();
      g.globalEnabled = true; // = mặc định PROD (env.schema:102)
      // Cho nhánh L77 TRÚNG cache ⇒ ca này phân lập ĐÚNG nhánh L78.
      g.company2faCache.set(companyId, { value: false, expiresAt: Date.now() + 60_000 });

      const err = await withBrokenDb(() =>
        guard.canActivate(ctxFor(companyId)).then(
          () => null as unknown,
          (e: unknown) => e,
        ),
      );

      // Trước vá: lỗi THÔ (`instanceof HttpException === false`) ⇒ 500 vô danh. Sau vá: đã phân loại.
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as HttpException).getStatus()).toBe(503);
      expect((err as HttpException).getResponse()).toMatchObject({ code: TWO_FACTOR_UNAVAILABLE });
    }, 60_000);

    // ══ (6) NHÁNH THỨ BA — `:84` isEnabled cũng phải được bọc ═════════════════════════════════
    // Phân lập `:84`: globalEnabled=false ⇒ bỏ qua `:78`; cache `:77` = true ⇒ mustHaveTwoFactor
    // ⇒ lời gọi withTenant DUY NHẤT còn lại là `isEnabled`.
    it("SAU VÁ · nhánh isEnabled (guard:84) ⇒ 503 AUTH-ERR-2FA-UNAVAILABLE", async () => {
      const { guard, g, companyId } = freshGuard();
      g.globalEnabled = false;
      g.company2faCache.set(companyId, { value: true, expiresAt: Date.now() + 60_000 });

      const err = await withBrokenDb(() =>
        guard.canActivate(ctxFor(companyId)).then(
          () => null as unknown,
          (e: unknown) => e,
        ),
      );

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: TWO_FACTOR_UNAVAILABLE });
    }, 60_000);

    // ══ (7) KHÔNG CACHE GIÁ TRỊ SINH TỪ LỖI ═══════════════════════════════════════════════════
    // Bẫy của hướng (a): đóng dấu một quyết định-từ-lỗi vào cache TTL 30s = kéo dài hạ-chuẩn thêm 30s.
    // Hướng (b) không có giá trị fallback, nhưng ca này GHIM điều đó lại để bản vá sau không lén thêm.
    it("SAU VÁ · lỗi hạ tầng KHÔNG đóng dấu company2faCache (không hạ chuẩn thêm 30s)", async () => {
      const { guard, g, companyId } = freshGuard();
      g.globalEnabled = false;

      const err = await withBrokenDb(() =>
        guard.canActivate(ctxFor(companyId)).then(
          () => null as unknown,
          (e: unknown) => e,
        ),
      );
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      // Cache PHẢI còn trống ⇒ request kế tiếp đọc lại DB thật, không dùng lại quyết-định-từ-lỗi.
      expect(g.company2faCache.has(companyId)).toBe(false);
    }, 60_000);

    // ══ (8) KHÔNG NUỐT ĐƯỜNG NGHIỆP VỤ ════════════════════════════════════════════════════════
    // Helper chỉ được phân loại lỗi HẠ TẦNG. 403 TWO_FACTOR_SETUP_REQUIRED (bị ép 2FA + chưa enroll)
    // là NGHIỆP VỤ — bọc quá tay (try/catch cả thân canActivate) sẽ biến nó thành 503 và ca này ĐỎ.
    it("SAU VÁ · DB KHOẺ + bị ép 2FA chưa enroll ⇒ vẫn 403 TWO_FACTOR_SETUP_REQUIRED", async () => {
      const T = await freshCompany();
      const { guard, g } = freshGuard();
      g.globalEnabled = false;
      g.company2faCache.set(T.companyId, { value: true, expiresAt: Date.now() + 60_000 });

      const err = await guard.canActivate(ctxFor(T.companyId)).then(
        () => null as unknown,
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as HttpException).getResponse()).toMatchObject({
        code: TWO_FACTOR_SETUP_REQUIRED,
      });
    }, 60_000);

    // ══ (9) LỐI THOÁT HttpException — `guardedRead` chỉ phân loại lỗi HẠ TẦNG ══════════════════
    // Ca (8) chứng "không bọc cả thân canActivate", nhưng 403 ở đó ném NGOÀI guardedRead nên nó KHÔNG
    // chạm `if (err instanceof HttpException) throw err`. Ca này ném HttpException TỪ BÊN TRONG một lời
    // đọc được bọc: nếu lối thoát bị gỡ, nó biến thành 503 và ca ĐỎ. (Đo đột biến: gỡ dòng đó ⇒ ca này
    // là ca DUY NHẤT bắt được — trước khi có nó, đột biến sống sót hoàn toàn.)
    it("SAU VÁ · HttpException từ TRONG lời đọc được bọc đi qua NGUYÊN TRẠNG, không thành 503", async () => {
      const { guard, g, companyId } = freshGuard();
      g.globalEnabled = false;
      g.company2faCache.set(companyId, { value: true, expiresAt: Date.now() + 60_000 });

      // `isEnabled` (:84) là lời đọc được bọc; cho nó ném lỗi NGHIỆP VỤ thay vì lỗi hạ tầng.
      const tfa = app.get(TwoFactorService, { strict: false });
      const realIsEnabled = tfa.isEnabled.bind(tfa);
      const BUSINESS = new ForbiddenException({ code: "AUTH-ERR-BUSINESS-PROBE" });
      (tfa as unknown as { isEnabled: unknown }).isEnabled = (): Promise<never> =>
        Promise.reject(BUSINESS);
      let err: unknown;
      try {
        err = await guard.canActivate(ctxFor(companyId)).then(
          () => null as unknown,
          (e: unknown) => e,
        );
      } finally {
        (tfa as unknown as { isEnabled: unknown }).isEnabled = realIsEnabled;
      }

      expect(err).toBe(BUSINESS); // ĐÚNG object gốc — không bị bọc lại, không bị thay mã.
      expect(err).not.toBeInstanceOf(ServiceUnavailableException);
    }, 60_000);
  },
);
