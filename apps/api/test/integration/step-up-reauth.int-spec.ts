/**
 * S10-AUTH-STEPUP-1 · L4 — ĐƯỜNG STEP-UP ĐẦU-CUỐI QUA HTTP THẬT (Postgres cô lập theo lane).
 *
 * ─── CÂU HỎI FILE NÀY TRẢ LỜI ───────────────────────────────────────────────────────────────────
 * "Một route reveal-class (`isSensitive` + `requiresReauth`) có THỰC SỰ mở được sau khi người dùng
 * xác thực lại, và có ĐÓNG lại đúng ở mọi chiều của bộ-5 không?" — không phải "service có compile
 * không". Toàn bộ chuỗi đi qua HTTP: `JwtAuthGuard` → `CompanyGuard` → `TwoFactorEnforcementGuard`
 * → `ReauthGuard` → `PermissionGuard` → `permission.decide.ts`, trên Postgres thật với RLS bật.
 *
 * ─── VÌ SAO CÓ CONTROLLER GIẢ, VÀ VÌ SAO NÓ KHÔNG ĐƯỢC VÀO `AppModule` ──────────────────────────
 * `REVEAL_CLASS_PAIRS` hôm nay RỖNG có chủ đích (D3) và **0 route sản phẩm** khai `requiresReauth`
 * (cổng `test/foundation/reauth-reachability.e2e-spec.ts` ép điều đó). Vậy muốn đo đường reveal-class
 * end-to-end thì phải tự dựng một route. Route đó sống trong `StepUpFixtureModule` — một module CHỈ
 * tồn tại trong file này, KHÔNG import vào `AppModule` — vì hai lý do đo được:
 *   1. `collectRoutes()` của census chỉ thấy route của `AppModule` đã boot ⇒ route giả không lọt vào
 *      `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`, không làm phồng số liệu Phụ lục A;
 *   2. cổng `reauth-reachability` sẽ ĐỎ nếu một route sản phẩm khai `requiresReauth` với cặp ngoài
 *      registry — dựng route giả vào `AppModule` là tự tháo chính cổng vừa dựng.
 * Registry được nới CHỈ trong testing module qua `overrideProvider(REVEAL_CLASS_PAIRS_TOKEN)`; hằng
 * `REVEAL_CLASS_PAIRS` trong `src/**` KHÔNG bị chạm (spec `reveal-class-pairs.spec.ts` ghim identity).
 *
 * ─── 🚩V2-BLOCK#6 — ĐƯỜNG DỰNG CA ALLOW PHẢI LÀ ĐƯỜNG THẬT ─────────────────────────────────────
 * Step-up là TOTP-only (D1). Một ca ALLOW chỉ có nghĩa khi `user_totp` được dựng qua **luồng bật-2FA
 * THẬT** (`POST /auth/2fa/enroll` → `POST /auth/2fa/enable`), tức secret được envelope-encrypt bằng KEK
 * y như production. Helper `seedTwoFactorEnabled()` trong `test/helpers/seed.ts` cố ý ghi envelope
 * PLACEHOLDER (Buffer rỗng) — dùng nó ở đây thì `decryptSecret` nổ và ta sẽ "chữa" bằng cách nới assert.
 * Vì vậy: thiếu KEK ⇒ **ĐỎ TO có thông điệp** ở `beforeAll` (xem `assertKekAvailable`), TUYỆT ĐỐI
 * không `skipIf` vì thiếu KEK. Gate `skipIf` duy nhất là gate DB cô lập (`hasDb && LANE_DB`) — chuẩn
 * chung của mọi int-spec, không phải lối thoát cho lane này.
 *
 * ─── 🚩PLAN-BLOCK#2 — VÌ SAO MỌI CA DENY ĐỀU GIỮ OBJECT GRANT VÀ ASSERT CHUỖI LÝ DO ─────────────
 * `permission.decide.ts:93-95` trả `deny-object-required` **TRƯỚC** mọi kiểm tra re-auth. Nghĩa là một
 * ca deny quên cấp object grant sẽ 403 vì lý do HOÀN TOÀN KHÁC, và assert `status === 403` trần sẽ
 * XANH RỖNG: nó xanh y hệt trong một thế giới mà cửa sổ step-up không tồn tại. Vì vậy mỗi ca deny ở
 * đây (a) GIỮ object grant đúng cho chủ thể/đối tượng đang đo, (b) assert CHUỖI lý do
 * `deny-reauth-required` do `PermissionGuard` phát ra (`Permission denied: ${decision.reason}`), và
 * (c) đứng SAU ít nhất một ca ALLOW 2xx thật (`deny-cases-vacuous-without-allow-case`).
 *
 * ─── GIỚI HẠN CỦA BẰNG CHỨNG CROSS-TENANT Ở TẦNG HTTP (nói thẳng) ──────────────────────────────
 * Bộ-5 gồm `companyId`; nhưng một user CHỈ thuộc MỘT công ty, nên không có cách nào ở tầng HTTP đổi
 * ĐÚNG một thành phần `companyId` mà giữ nguyên `userId`. Ca HTTP cross-tenant dưới đây đổi hai thành
 * phần (company + user) — vẫn có giá trị, nhưng KHÔNG phải bằng chứng "lệch đúng 1/5". Bằng chứng đó
 * nằm ở ca bảng 5 hàng gọi thẳng `StepUpWindowService` THẬT của app đã boot (⚠WARN(e)).
 *
 * GATE CỨNG `hasDb && LANE_DB` — CLAUDE.md §9.5 (DB chung `mediaos` cho xanh-giả/đỏ-giả).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Controller, Get, Module, Param, UseGuards } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool, PoolClient } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AuthModule } from "../../src/auth/auth.module";
import { PasswordService } from "../../src/auth/password.service";
import { TotpService } from "../../src/auth/totp.service";
import {
  REVEAL_CLASS_PAIRS_TOKEN,
  type RevealClassPair,
} from "../../src/auth/step-up/reveal-class-pairs";
import { STEP_UP_ERROR_CODES } from "../../src/auth/step-up/step-up.constants";
import {
  StepUpWindowService,
  type StepUpWindowKey,
} from "../../src/auth/step-up/step-up-window.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { loadEnv } from "../../src/config/env.schema";
import { PermissionModule } from "../../src/permission/permission.module";
import { PermissionGuard } from "../../src/permission/guards/permission.guard";
import { ReauthGuard } from "../../src/permission/guards/reauth.guard";
import { RequirePermission } from "../../src/permission/require-permission.decorator";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedObjectGrant,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

/**
 * Cặp reveal-class RIÊNG của fixture — KHÔNG mượn cặp sản phẩm.
 *
 * `permissions` là catalog TOÀN CỤC (không `company_id`) nên `cleanupTenants()` không dọn nó; mượn một
 * cặp thật rồi đổi `is_sensitive` sẽ đóng dấu vĩnh viễn lên lane DB (xem thông điệp chốt trong
 * `seedPermissionCatalog`). Tên ổn định (không random mỗi lượt) để lượt chạy sau tái dùng đúng hàng,
 * không bồi thêm rác vào catalog.
 */
const PAIR: RevealClassPair = { action: "reveal-secret", resourceType: "stepup_fixture" };
const TEST_PAIRS: readonly RevealClassPair[] = [PAIR];

const LOGIN_PW = loginPasswordFixture("s10stepup");

/**
 * Controller GIẢ hạng reveal-class — hình dạng ĐÚNG theo ba điều kiện §6 điểm 5 của DECISIONS-09:
 *   (a) có ĐÚNG segment `:id` (`PermissionGuard` chỉ đọc `req.params?.id`);
 *   (b) `@UseGuards(ReauthGuard, PermissionGuard)` — ĐÚNG THỨ TỰ, cùng một tầng: `ReauthGuard` GHI
 *       `req.reauthContext`, `PermissionGuard` ĐỌC nó. Đảo hai tên này ⇒ mọi ca ALLOW dưới đây ĐỎ, và
 *       đó là chủ ý: cổng `reauth-reachability` đo đúng thứ tự đó bằng census runtime;
 *   (c) cặp `(action, resourceType)` nằm trong registry (được override trong testing module).
 * Handler KHÔNG chạm DB — nó chỉ là cái đích để đo phán quyết của chuỗi guard.
 */
@Controller("test-reveal")
class StepUpFixtureController {
  @Get(":id")
  @UseGuards(ReauthGuard, PermissionGuard)
  @RequirePermission(PAIR.action, PAIR.resourceType, { isSensitive: true, requiresReauth: true })
  reveal(@Param("id") id: string): { revealed: string } {
    return { revealed: id };
  }
}

/**
 * Module CHỈ của file này (xem docblock đầu file — không bao giờ vào `AppModule`).
 *
 * PHẢI import CẢ HAI: Nest dựng guard của `@UseGuards` trong ngữ cảnh MODULE CHỨA CONTROLLER, nên
 * `ReauthGuard` (từ `PermissionModule`) chỉ resolve được ở đây khi `StepUpWindowService` — thứ nó
 * inject — cũng nhìn thấy được, tức phải import `AuthModule` (module export service đó). Đây chính là
 * ràng buộc mà module nghiệp vụ THẬT sẽ gặp ngày đầu tiên nó khai `@UseGuards(ReauthGuard, ...)`, nên
 * để nguyên chứ không lách bằng `overrideProvider`.
 */
@Module({ imports: [PermissionModule, AuthModule], controllers: [StepUpFixtureController] })
class StepUpFixtureModule {}

/**
 * 🚩V2-BLOCK#6 — KEK phải CÓ THẬT, không được biến thành `skipIf`.
 *
 * Thiếu file KEK thì `POST /auth/2fa/enroll` không mã hoá nổi secret ⇒ ca ALLOW không dựng được ⇒
 * TOÀN BỘ file này thoái hoá thành một tập ca DENY xanh-rỗng (mọi thứ 403 vì chẳng ai step-up được).
 * Đó đúng là kiểu "xanh không đủ bằng chứng" mà CLAUDE.md §9 cảnh báo. Nên: DỪNG, ồn, chỉ rõ cách vá.
 */
function assertKekAvailable(): void {
  const kekPath = loadEnv().KMS_LOCAL_KEK_PATH;
  if (kekPath && existsSync(kekPath)) return;
  throw new Error(
    [
      "",
      "╔══════════════════════════════════════════════════════════════════════════════════════╗",
      "║  DỪNG: step-up int-spec cần KEK THẬT để bật 2FA qua luồng thật (S10-AUTH-STEPUP-1).  ║",
      "╚══════════════════════════════════════════════════════════════════════════════════════╝",
      `  KMS_LOCAL_KEK_PATH = ${kekPath || "(chưa đặt)"}`,
      "",
      "Ca ALLOW của file này dựng `user_totp` qua POST /auth/2fa/enroll + /2fa/enable — tức secret",
      "TOTP phải envelope-encrypt được bằng KEK. Không có KEK thì không có ca ALLOW nào, và mọi ca",
      "DENY còn lại trở thành xanh-RỖNG (403 vì không ai step-up nổi, không phải vì cổng hoạt động).",
      "",
      "Vá: chạy trong worktree đã có `.env` + `.secrets/local-kek.bin` (worktree-missing-kek-false-red),",
      "hoặc `bash harness/check.sh --lane-db=<lane>` để nạp env đúng.",
      "TUYỆT ĐỐI KHÔNG đổi ca này thành `skipIf` — đó là cách biến một lỗ hổng thành một dòng log xanh.",
      "",
    ].join("\n"),
  );
}

interface Actor {
  id: string;
  email: string;
  token: string;
  /** base32 secret TOTP — chỉ có với actor đã bật 2FA qua luồng thật. */
  secret?: string;
}

describe.skipIf(!hasLaneDb)(
  "S10-AUTH-STEPUP-1 — step-up TOTP mở cửa sổ re-auth cho route reveal-class (HTTP thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let appRolePool: Pool;
    let windows: StepUpWindowService;
    const totp = new TotpService();

    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    /** Có object grant trên X và Y; là actor của ca ALLOW. */
    let uAllow: Actor;
    /** Có object grant trên X nhưng KHÔNG BAO GIỜ step-up — ca "cửa sổ của người khác". */
    let uOther: Actor;
    /** Có ALLOW cấp công ty + cửa sổ hợp lệ nhưng KHÔNG có object grant — ca `deny-object-required`. */
    let uNoObject: Actor;
    /** Actor riêng cho phép đếm audit/security-event/recovery-code (bucket rate-limit riêng). */
    let uAudit: Actor;
    /** Chưa bật 2FA — ca 409 `AUTH-ERR-STEP-UP-2FA-REQUIRED`. */
    let uNo2fa: Actor;
    /** Actor của công ty B, có object grant trên CÙNG resourceId — ca cross-tenant. */
    let uCross: Actor;

    const OBJECT_X = randomUUID();
    const OBJECT_Y = randomUUID();

    const http = () => request(app.getHttpServer());
    const authGet = (t: string, url: string) => http().get(url).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, url: string) =>
      http().post(url).set("Authorization", `Bearer ${t}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      const token = res.body.data?.accessToken as string | undefined;
      expect(
        token,
        `login ${email} không trả accessToken: ${JSON.stringify(res.body)}`,
      ).toBeTruthy();
      return token as string;
    }

    /** Bật 2FA QUA HTTP (enroll → enable). Trả base32 secret để sinh mã TOTP hợp lệ về sau. */
    async function enableTwoFactor(token: string): Promise<string> {
      const enrolled = await authPost(token, "/auth/2fa/enroll");
      expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(200);
      const secret =
        new URL(String(enrolled.body.data?.otpauthUri)).searchParams.get("secret") ?? "";
      expect(secret.length, "otpauth URI không mang secret").toBeGreaterThan(0);
      const enabled = await authPost(token, "/auth/2fa/enable").send({
        token: totp.generate(secret),
      });
      expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
      return secret;
    }

    async function newActor(
      tenant: SeededTenant,
      tag: string,
      opts: { twoFactor: boolean },
    ): Promise<Actor> {
      const email = `${tag}-${randomUUID().slice(0, 8)}@s10stepup.local`;
      const id = await seedUser(direct, tenant.companyId, email, await hashed());
      const token = await login(tenant.slug, email);
      const secret = opts.twoFactor ? await enableTwoFactor(token) : undefined;
      return { id, email, token, secret };
    }

    let cachedHash: string | null = null;
    async function hashed(): Promise<string> {
      cachedHash ??= await new PasswordService().hash(LOGIN_PW);
      return cachedHash;
    }

    /** Mã TOTP chắc chắn SAI (kiểm ngược bằng chính `verify`, kể cả dung sai ±1 step). */
    function wrongCode(secret: string): string {
      const current = Number(totp.generate(secret));
      for (let delta = 1; delta <= 9; delta += 1) {
        const candidate = String((current + delta * 111_111) % 1_000_000).padStart(6, "0");
        if (!totp.verify(candidate, secret)) return candidate;
      }
      throw new Error("không dựng nổi một mã TOTP SAI — kiểm lại TotpService");
    }

    function stepUp(
      actor: Actor,
      body: { code?: string; action?: string; resourceType?: string; resourceId?: string },
    ) {
      return authPost(actor.token, "/auth/step-up").send({
        code: body.code ?? totp.generate(actor.secret ?? ""),
        action: body.action ?? PAIR.action,
        resourceType: body.resourceType ?? PAIR.resourceType,
        resourceId: body.resourceId ?? OBJECT_X,
      });
    }

    /** Lý do deny do `PermissionGuard` phát ra: `Permission denied: <reason>`. */
    function denyReason(body: unknown): string {
      const b = body as { message?: string };
      return String(b?.message ?? "");
    }

    async function countAudit(userId: string): Promise<number> {
      const r = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_logs
          WHERE actor_user_id = $1 AND action LIKE 'auth.step_up%'`,
        [userId],
      );
      return Number(r.rows[0].n);
    }

    async function countSecurityEvents(userId: string): Promise<number> {
      const r = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM user_security_events
          WHERE user_id = $1 AND event_type LIKE 'STEP_UP%'`,
        [userId],
      );
      return Number(r.rows[0].n);
    }

    async function countBurnedRecoveryCodes(userId: string): Promise<number> {
      const r = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM user_recovery_codes
          WHERE user_id = $1 AND used_at IS NOT NULL`,
        [userId],
      );
      return Number(r.rows[0].n);
    }

    /** Chạy `fn` bằng role `mediaos_app` với tenant GUC đã set (đo GRANT thật, không phải superuser). */
    async function asAppRole<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
      const c = await appRolePool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
        const out = await fn(c);
        await c.query("COMMIT");
        return out;
      } catch (err) {
        await c.query("ROLLBACK");
        throw err;
      } finally {
        c.release();
      }
    }

    beforeAll(async () => {
      assertKekAvailable();

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule, StepUpFixtureModule],
      })
        // Registry nới CHỈ trong testing module — hằng `REVEAL_CLASS_PAIRS` của `src/**` KHÔNG bị chạm.
        .overrideProvider(REVEAL_CLASS_PAIRS_TOKEN)
        .useValue(TEST_PAIRS)
        .compile();
      app = moduleRef.createNestApplication();
      // Mirror main.ts: Zod ở biên → envelope → filter. Thứ tự này quyết định mã HTTP trả về.
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      windows = app.get(StepUpWindowService, { strict: false });

      direct = directPool();
      appRolePool = appPool();

      A = await seedCompany(direct, "s10stepup-a");
      B = await seedCompany(direct, "s10stepup-b");
      companyIds.push(A.companyId, B.companyId);

      // Catalog: cặp RIÊNG của fixture, `is_sensitive = true` (điều kiện của hạng reveal-class).
      const permissionId = await seedPermissionCatalog(
        direct,
        PAIR.action,
        PAIR.resourceType,
        true,
      );

      uAllow = await newActor(A, "allow", { twoFactor: true });
      uOther = await newActor(A, "other", { twoFactor: false });
      uNoObject = await newActor(A, "noobject", { twoFactor: true });
      uAudit = await newActor(A, "audit", { twoFactor: true });
      uNo2fa = await newActor(A, "no2fa", { twoFactor: false });
      uCross = await newActor(B, "cross", { twoFactor: true });

      // Object grant THẬT (bảng `object_permissions`) — vế Tier-3 mà hạng reveal-class bắt buộc.
      await seedObjectGrant(
        direct,
        A.companyId,
        uAllow.id,
        PAIR.resourceType,
        OBJECT_X,
        PAIR.action,
        "ALLOW",
      );
      await seedObjectGrant(
        direct,
        A.companyId,
        uAllow.id,
        PAIR.resourceType,
        OBJECT_Y,
        PAIR.action,
        "ALLOW",
      );
      await seedObjectGrant(
        direct,
        A.companyId,
        uOther.id,
        PAIR.resourceType,
        OBJECT_X,
        PAIR.action,
        "ALLOW",
      );
      await seedObjectGrant(
        direct,
        B.companyId,
        uCross.id,
        PAIR.resourceType,
        OBJECT_X,
        PAIR.action,
        "ALLOW",
      );

      // uNoObject: ALLOW CẤP CÔNG TY đúng cặp, KHÔNG object grant. Ca của nó chứng minh rằng cấp công
      // ty — kể cả grant tường minh, không wildcard — KHÔNG thay được Tier-3 cho hạng reveal-class.
      const roleNoObject = await seedRole(
        direct,
        A.companyId,
        `s10stepup-noobj-${uNoObject.id.slice(0, 8)}`,
      );
      await seedRolePermission(direct, roleNoObject, permissionId, "ALLOW", "Company");
      await seedUserRole(direct, uNoObject.id, roleNoObject, A.companyId);
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct?.end();
      await appRolePool?.end();
      await app?.close();
    });

    // ══ 1. CA ALLOW — phải đứng TRƯỚC mọi ca DENY (deny-cases-vacuous-without-allow-case) ═══════

    it("ALLOW: DENY trước step-up → step-up TOTP thật → 200 trên CÙNG route/actor/đối tượng", async () => {
      // (1) Trước khi có cửa sổ: object grant ĐÃ CÓ, nên 403 phải mang lý do RE-AUTH, không phải OBJECT.
      const before = await authGet(uAllow.token, `/test-reveal/${OBJECT_X}`);
      expect(before.status, JSON.stringify(before.body)).toBe(403);
      expect(denyReason(before.body)).toContain("deny-reauth-required");
      expect(denyReason(before.body)).not.toContain("deny-object-required");

      // (2) Step-up THẬT: TOTP sinh từ secret đã enroll qua HTTP (envelope-encrypt bằng KEK).
      const su = await stepUp(uAllow, {});
      expect(su.status, JSON.stringify(su.body)).toBe(200);
      const validUntil = String(su.body.data?.reauthValidUntil ?? "");
      expect(new Date(validUntil).getTime()).toBeGreaterThan(Date.now());

      // (3) Cùng route, cùng actor, cùng đối tượng ⇒ giờ mở.
      const after = await authGet(uAllow.token, `/test-reveal/${OBJECT_X}`);
      expect(after.status, JSON.stringify(after.body)).toBe(200);
      expect(after.body.data).toEqual({ revealed: OBJECT_X });
    });

    it("§6(6) cửa sổ DÙNG LẠI ĐƯỢC trong TTL và đường ĐỌC KHÔNG gia hạn mốc hết hạn", async () => {
      const key: StepUpWindowKey = {
        companyId: A.companyId,
        userId: uAllow.id,
        action: PAIR.action,
        resourceType: PAIR.resourceType,
        resourceId: OBJECT_X,
      };
      const first = await windows.getValidWindow(key);
      expect(first, "ca ALLOW ở trên phải để lại một cửa sổ còn hạn").toBeInstanceOf(Date);

      // Gọi route thêm hai lần: ADR chốt dùng-lại-được trong TTL (một thao tác UI đẻ nhiều request).
      for (let i = 0; i < 2; i += 1) {
        const res = await authGet(uAllow.token, `/test-reveal/${OBJECT_X}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      }

      // ...nhưng TTL TUYỆT ĐỐI: mốc hết hạn KHÔNG được nhích lên sau các lượt đọc. Sliding-window sẽ
      // ghi lại entry ⇒ giá trị đọc ra đổi. Đây là phép đo ở tầng tích hợp; ca "0 lời gọi ghi/gia hạn
      // lên store" nằm ở `step-up-window.service.spec.ts` (stub đếm `set`/`expire`/`getex`).
      const afterReads = await windows.getValidWindow(key);
      expect(afterReads).toBeInstanceOf(Date);
      expect((afterReads as Date).toISOString()).toBe((first as Date).toISOString());
    });

    // ══ 2. CA DENY — mỗi ca GIỮ object grant đúng và assert CHUỖI LÝ DO ══════════════════════════

    it("DENY: cửa sổ cấp cho đối tượng X KHÔNG mở đối tượng Y (object grant Y vẫn còn nguyên)", async () => {
      // uAllow có object grant trên CẢ X lẫn Y ⇒ 403 ở đây chỉ có thể vì THIẾU CỬA SỔ cho Y.
      const res = await authGet(uAllow.token, `/test-reveal/${OBJECT_Y}`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(denyReason(res.body)).toContain("deny-reauth-required");
      expect(denyReason(res.body)).not.toContain("deny-object-required");
    });

    it("DENY: cửa sổ của user A KHÔNG dùng được cho user B (cùng công ty, cùng đối tượng, cùng cặp)", async () => {
      // Lệch ĐÚNG MỘT thành phần của bộ-5 ở tầng HTTP: `userId`. uOther có object grant trên X.
      const res = await authGet(uOther.token, `/test-reveal/${OBJECT_X}`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(denyReason(res.body)).toContain("deny-reauth-required");
      expect(denyReason(res.body)).not.toContain("deny-object-required");
    });

    it("DENY cross-tenant: công ty B không mượn được cửa sổ của A; B tự step-up thì mở đúng của B", async () => {
      // (1) B có object grant trên CÙNG giá trị resourceId, và A đang giữ một cửa sổ còn hạn cho X.
      const leak = await authGet(uCross.token, `/test-reveal/${OBJECT_X}`);
      expect(leak.status, JSON.stringify(leak.body)).toBe(403);
      expect(denyReason(leak.body)).toContain("deny-reauth-required");
      expect(denyReason(leak.body)).not.toContain("deny-object-required");

      // (2) Chứng minh ca (1) KHÔNG xanh vì công ty B hỏng sẵn: B tự step-up thì route mở.
      const su = await stepUp(uCross, {});
      expect(su.status, JSON.stringify(su.body)).toBe(200);
      const ok = await authGet(uCross.token, `/test-reveal/${OBJECT_X}`);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    });

    it("DENY: có cửa sổ hợp lệ + ALLOW cấp công ty nhưng THIẾU object grant ⇒ deny-object-required", async () => {
      // Ca đối chứng cho chuỗi lý do: nếu mọi ca deny ở trên cũng trả `deny-object-required` thì assert
      // của chúng vô nghĩa. Ở đây object grant là thứ DUY NHẤT thiếu, và lý do đổi đúng như dự đoán.
      const su = await stepUp(uNoObject, {});
      expect(su.status, JSON.stringify(su.body)).toBe(200);

      const res = await authGet(uNoObject.token, `/test-reveal/${OBJECT_X}`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(denyReason(res.body)).toContain("deny-object-required");
      expect(denyReason(res.body)).not.toContain("deny-reauth-required");
    });

    it("DENY: cửa sổ HẾT HẠN đóng lại đúng route vừa mở (không phải một route khác)", async () => {
      const key: StepUpWindowKey = {
        companyId: A.companyId,
        userId: uAllow.id,
        action: PAIR.action,
        resourceType: PAIR.resourceType,
        resourceId: OBJECT_X,
      };
      // Ghi đè CHÍNH khoá vừa mở bằng một mốc đã qua. Dùng tham số đồng hồ của `grant()` (đường ghi
      // thật, không INSERT tay) — chờ TTL 300s thật thì test vô dụng, còn hạ TTL bằng env sẽ đổi hành
      // vi của MỌI ca khác trong file.
      const pastMs = Date.now() - (windows.ttlSec + 60) * 1000;
      await windows.grant(key, pastMs);
      expect(await windows.getValidWindow(key)).toBeNull();

      const res = await authGet(uAllow.token, `/test-reveal/${OBJECT_X}`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(denyReason(res.body)).toContain("deny-reauth-required");
      expect(denyReason(res.body)).not.toContain("deny-object-required");
    });

    // ══ 3. BỘ-5: lệch ĐÚNG MỘT thành phần mỗi hàng (⚠WARN(e)) ═══════════════════════════════════

    it("bộ-5 khoá cửa sổ: đổi ĐÚNG MỘT thành phần ⇒ KHÔNG đọc được, bộ-5 gốc VẪN mở", async () => {
      // Ở tầng HTTP không thể đổi riêng `companyId` (một user thuộc đúng một công ty) — xem docblock
      // đầu file. Bảng này gọi thẳng `StepUpWindowService` THẬT của app đã boot (cùng store, cùng
      // envScope, cùng codec) nên vẫn là bằng chứng tích hợp, không phải unit-test đội lốt.
      const base: StepUpWindowKey = {
        companyId: A.companyId,
        userId: uAllow.id,
        action: PAIR.action,
        resourceType: PAIR.resourceType,
        resourceId: OBJECT_X,
      };
      await windows.grant(base);
      expect(await windows.getValidWindow(base)).toBeInstanceOf(Date);

      const rows: { label: string; key: StepUpWindowKey }[] = [
        { label: "companyId", key: { ...base, companyId: B.companyId } },
        { label: "userId", key: { ...base, userId: uOther.id } },
        { label: "action", key: { ...base, action: `${PAIR.action}-other` } },
        { label: "resourceType", key: { ...base, resourceType: `${PAIR.resourceType}_other` } },
        { label: "resourceId", key: { ...base, resourceId: OBJECT_Y } },
      ];

      for (const row of rows) {
        // Tự kiểm "lệch ĐÚNG 1/5": bảng trôi thành ca đổi-kèm-nhau là mất hết sức nặng của phép đo.
        const differing = (Object.keys(base) as (keyof StepUpWindowKey)[]).filter(
          (k) => base[k] !== row.key[k],
        );
        expect(differing, `hàng ${row.label} phải lệch đúng 1 thành phần`).toEqual([row.label]);
        expect(await windows.getValidWindow(row.key), `hàng ${row.label} KHÔNG được mở`).toBeNull();
      }

      // Đối chứng cuối: bộ-5 gốc vẫn mở ⇒ 5 hàng null ở trên không phải vì store rỗng/hỏng.
      expect(await windows.getValidWindow(base)).toBeInstanceOf(Date);
    });

    // ══ 4. VẾT: audit + security-event hai nhánh · KHÔNG đốt recovery code · KHÔNG lộ mã ═════════

    it("một lượt SAI + một lượt ĐÚNG ⇒ 2 hàng audit + 2 hàng user_security_events, 0 recovery code bị đốt", async () => {
      const auditBefore = await countAudit(uAudit.id);
      const eventsBefore = await countSecurityEvents(uAudit.id);
      const burnedBefore = await countBurnedRecoveryCodes(uAudit.id);
      // Không xanh-rỗng: user PHẢI thật sự có mã khôi phục để phép đo "delta = 0" nói lên điều gì đó.
      const totalCodes = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM user_recovery_codes WHERE user_id = $1`,
        [uAudit.id],
      );
      expect(Number(totalCodes.rows[0].n)).toBeGreaterThan(0);

      const secret = uAudit.secret as string;
      const bad = await stepUp(uAudit, { code: wrongCode(secret) });
      expect(bad.status, JSON.stringify(bad.body)).toBe(400);
      expect(bad.body.error?.code).toBe(STEP_UP_ERROR_CODES.INVALID_CODE);

      const good = await stepUp(uAudit, { code: totp.generate(secret) });
      expect(good.status, JSON.stringify(good.body)).toBe(200);

      expect(await countAudit(uAudit.id)).toBe(auditBefore + 2);
      expect(await countSecurityEvents(uAudit.id)).toBe(eventsBefore + 2);
      // 🚩D2 — step-up KHÔNG chạm `user_recovery_codes`. Ở `verifyChallenge` (bước-2 LOGIN), TOTP sai rơi
      // xuống đường recovery-code và ĐỐT một mã; nếu step-up dùng lại đường đó, delta ở đây sẽ > 0.
      expect(await countBurnedRecoveryCodes(uAudit.id)).toBe(burnedBefore);
    });

    it("audit ghi ĐÚNG HÌNH DẠNG cả hai nhánh và metadata KHÔNG chứa mã TOTP/secret", async () => {
      const rows = await direct.query<{
        action: string;
        object_type: string;
        object_id: string;
        result_status: string;
        metadata: Record<string, unknown> | null;
      }>(
        `SELECT action, object_type, object_id, result_status, metadata
           FROM audit_logs
          WHERE actor_user_id = $1 AND action LIKE 'auth.step_up%'
          ORDER BY created_at ASC`,
        [uAudit.id],
      );
      expect(rows.rows.length).toBeGreaterThanOrEqual(2);
      const failed = rows.rows.find((r) => r.action === "auth.step_up_failed");
      const granted = rows.rows.find((r) => r.action === "auth.step_up_granted");
      expect(failed, "thiếu hàng audit của lượt SAI").toBeDefined();
      expect(granted, "thiếu hàng audit của lượt ĐÚNG").toBeDefined();
      expect(failed?.result_status).toBe("Failure");
      expect(granted?.result_status).toBe("Success");
      for (const row of [failed, granted]) {
        expect(row?.object_type).toBe("auth");
        expect(row?.object_id).toBe(OBJECT_X);
      }

      // Metadata chỉ mang ngữ cảnh, KHÔNG mang credential (BẤT BIẾN #3). Soi cả secret lẫn mã hiện tại.
      const secret = uAudit.secret as string;
      const dumped = JSON.stringify(rows.rows.map((r) => r.metadata ?? {}));
      expect(dumped).not.toContain(secret);
      expect(dumped).not.toContain(totp.generate(secret));
      expect(Object.keys(failed?.metadata ?? {}).sort()).toEqual([
        "action",
        "resourceId",
        "resourceType",
      ]);
    });

    it("audit_logs vẫn APPEND-ONLY sau khi step-up ghi vào đó (app role không UPDATE/DELETE được)", async () => {
      const row = await direct.query<{ id: string }>(
        `SELECT id FROM audit_logs
          WHERE actor_user_id = $1 AND action = 'auth.step_up_granted' LIMIT 1`,
        [uAudit.id],
      );
      expect(row.rows.length, "chưa có hàng audit step-up nào để đo").toBe(1);
      const id = row.rows[0].id;

      await expect(
        asAppRole(A.companyId, (c) =>
          c.query("UPDATE audit_logs SET result_status = 'Denied' WHERE id = $1", [id]),
        ),
      ).rejects.toThrow();
      await expect(
        asAppRole(A.companyId, (c) => c.query("DELETE FROM audit_logs WHERE id = $1", [id])),
      ).rejects.toThrow();
    });

    // ══ 5. RANH GIỚI ĐẦU VÀO + MÃ LỖI TƯỜNG MINH ═══════════════════════════════════════════════

    it("🚩PLAN-BLOCK#3: resourceId KHÔNG phải UUID ⇒ 400 ở biên, KHÔNG thêm audit, KHÔNG tạo cửa sổ", async () => {
      const auditBefore = await countAudit(uNo2fa.id);
      const junk = "khong-phai-uuid";

      const res = await stepUp(uNo2fa, {
        code: "123456",
        resourceId: junk,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION-ERR-001");

      // Zod chặn TRƯỚC service ⇒ không hàng audit nào, không cửa sổ nào. (Nếu để lọt xuống DB thì
      // `audit_logs.object_id` là cột uuid ⇒ 22P02 ⇒ drizzle bọc mã lỗi PG vào `cause` ⇒ ra 500.)
      expect(await countAudit(uNo2fa.id)).toBe(auditBefore);
      expect(
        await windows.getValidWindow({
          companyId: A.companyId,
          userId: uNo2fa.id,
          action: PAIR.action,
          resourceType: PAIR.resourceType,
          resourceId: junk,
        }),
      ).toBeNull();
    });

    it("CHƯA BẬT 2FA ⇒ 409 AUTH-ERR-STEP-UP-2FA-REQUIRED (không 403 câm, không 500)", async () => {
      const res = await stepUp(uNo2fa, { code: "123456" });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error?.code).toBe(STEP_UP_ERROR_CODES.TWO_FACTOR_REQUIRED);
      expect(String(res.body.message)).toContain("2FA");
    });

    it("cặp NGOÀI registry ⇒ 400 AUTH-ERR-STEP-UP-PAIR-NOT-ALLOWED (cổng D3 vẫn đứng dù đã override)", async () => {
      const res = await stepUp(uAllow, {
        code: totp.generate(uAllow.secret as string),
        action: "configure",
        resourceType: "company",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.code).toBe(STEP_UP_ERROR_CODES.PAIR_NOT_ALLOWED);
    });

    it("KHÔNG token ⇒ 401: `POST /auth/step-up` KHÔNG phải route @Public", async () => {
      const res = await http().post("/auth/step-up").send({
        code: "123456",
        action: PAIR.action,
        resourceType: PAIR.resourceType,
        resourceId: OBJECT_X,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(401);
    });
  },
);
