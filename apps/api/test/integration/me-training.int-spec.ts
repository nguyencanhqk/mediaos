/**
 * S5-LMS-BE-3 — GET /me/training integration (Postgres THẬT, DB CÔ LẬP) — RED TRƯỚC.
 *
 * Chứng minh trên ĐƯỜNG THẬT (JwtAuthGuard 401 · PermissionGuard cặp access:lms 403 · guard chain đầy đủ),
 * với `LmsProgressClient` bị overrideProvider bằng FAKE điều-khiển-được (không gọi LMS thật):
 *   a. unauth              : không Bearer → 401.
 *   b. deny                : có quyền khác nhưng KHÔNG access:lms → 403 AUTH-ERR-FORBIDDEN.
 *   c. happy               : có access:lms → 200, envelope { status:'ok', progress } ĐÃ qua Zod.
 *   d. IDOR own-scope      : ?email=<B> + body + header giả mạo → VẪN dữ liệu của A; fake ghi nhận email A.
 *   e. 2 actor song song   : A và B nhận đúng dữ liệu của mình (cache không lẫn).
 *   f. LMS chết/timeout    : fake throw → 502 ME-ERR-TRAINING-LMS-UNAVAILABLE (không treo).
 *   g. payload lệch v2     : → 502 ME-ERR-TRAINING-CONTRACT-MISMATCH.
 *   h. 404 (chưa có account): → 200 { status:'no_account', progress:null }.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Chạy:
 *   bash scripts/lane-db-setup.sh s5lmsbe3 → export LANE_DB=mediaos_s5lmsbe3 → pnpm --filter @mediaos/api test
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { LmsProgressClient } from "../../src/integrations/lms/lms-progress-client.service";
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

const runDb = hasDb && Boolean(process.env.LANE_DB);
// Fixture giống-secret: GHÉP CHUỖI (CLAUDE.md §5).
const LOGIN_PW = ["Passw0rd!metrain", "lms", "1"].join("-");
const ROUTE = "/me/training";

const PAIR = {
  accessLms: ["access", "lms", false],
  noti: ["read", "notification", false],
} as const;
type Triple = readonly [string, string, boolean];

/** Ghi nhận MỌI email mà service gửi sang LMS — bằng chứng own-scope (không phải email client bơm). */
const calledEmails: string[] = [];
/** Điều khiển hành vi fake theo email actor. */
const behaviour = new Map<string, "ok" | "throw" | "v2" | "notfound">();

function progressFor(email: string) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    user: { email, name: "NV", active: true },
    summary: {
      courseCount: 1,
      completedCourses: 0,
      learningTimeSec: 120,
      lastActivityAt: null,
    },
    courses: [
      {
        slug: `khoa-cua-${email}`,
        title: "Khoá học",
        percent: 50,
        completed: 1,
        total: 2,
        learningTimeSec: 120,
        lastActivityAt: null,
      },
    ],
    coursesTruncated: false,
    exams: {
      submitted: 0,
      passed: 0,
      failed: 0,
      pendingGrading: 0,
      bestScore10: null,
      lastSubmittedAt: null,
      truncated: false,
    },
    quizzes: { submitted: 0, averagePercent: null, lastSubmittedAt: null },
  };
}

const fakeClient = {
  isEnabled: () => true,
  async fetchProgress(email: string) {
    calledEmails.push(email);
    switch (behaviour.get(email) ?? "ok") {
      case "throw":
        throw new Error("LMS progress network error: aborted");
      case "v2":
        return { found: true as const, body: { ...progressFor(email), version: 2 } };
      case "notfound":
        return { found: false as const };
      default:
        return { found: true as const, body: progressFor(email) };
    }
  },
};

describe.skipIf(!runDb)("S5-LMS-BE-3 GET /me/training (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let pw: string;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let seq = 0;
  let originalLmsCompanyId: string | undefined;

  async function seedRoleWithPairs(companyId: string, name: string, pairs: Triple[]) {
    const roleId = await seedRole(direct, companyId, name);
    for (const [action, rt, sensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, rt, sensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Own");
    }
    return roleId;
  }

  async function makeUser(tenant: SeededTenant, roleId?: string) {
    const tag = `tr${++seq}`;
    const email = `${tag}-${tenant.slug}@x.test`;
    const userId = await seedUser(direct, tenant.companyId, email, pw);
    if (roleId) await seedUserRole(direct, userId, roleId, tenant.companyId);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    return { userId, email, token: login.body.data.accessToken as string };
  }

  function get(path: string, token: string) {
    return request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${token}`);
  }

  beforeAll(async () => {
    // Company-gate LMS_COMPANY_ID (fail-closed isolation) đọc theo request. Máy dev có sẵn biến này trỏ
    // company THẬT ⇒ tắt trong suốt suite (các ca chính chạy như PROD-của-đúng-tenant), riêng ca gate
    // tự bật lại để chứng minh tenant ngoài phạm vi bị chặn.
    originalLmsCompanyId = process.env.LMS_COMPANY_ID;
    delete process.env.LMS_COMPANY_ID;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LmsProgressClient)
      .useValue(fakeClient)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    pw = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "metrain-a");
    companyIds.push(A.companyId);
  });

  afterAll(async () => {
    await app?.close();
    if (originalLmsCompanyId === undefined) delete process.env.LMS_COMPANY_ID;
    else process.env.LMS_COMPANY_ID = originalLmsCompanyId;
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── a. unauth → 401 ─────────────────────────────────────────────────────────
  it("unauth — không Bearer → 401", async () => {
    const res = await request(app.getHttpServer()).get(ROUTE);
    expect(res.status).toBe(401);
  });

  // ── b. deny — thiếu access:lms → 403 ────────────────────────────────────────
  it("deny — có quyền khác nhưng KHÔNG access:lms → 403 AUTH-ERR-FORBIDDEN", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "metrain-no-access", [PAIR.noti]);
    const { token } = await makeUser(A, roleId);
    const res = await get(ROUTE, token);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error.code).toBe("AUTH-ERR-FORBIDDEN");
  });

  // ── c/d. happy + IDOR own-scope ─────────────────────────────────────────────
  it("happy + IDOR — bơm ?email=<B>/body/header KHÔNG đổi kết quả (vẫn dữ liệu của A)", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "metrain-ok", [PAIR.accessLms]);
    const a = await makeUser(A, roleId);
    const b = await makeUser(A, roleId);

    // Request BƠM PARAM đi TRƯỚC (a chưa có cache) ⇒ chắc chắn phải gọi client thật ⇒ assert dưới đây
    // KHÔNG rỗng-vacuous: chứng minh email gửi sang LMS là của actor, không phải email client bơm.
    calledEmails.length = 0;
    const injected = await get(
      `${ROUTE}?email=${encodeURIComponent(b.email)}&user_id=${b.userId}&employee_id=${b.userId}`,
      a.token,
    )
      .set("x-employee-id", b.userId)
      .set("x-user-email", b.email)
      .send({ email: b.email });

    expect(injected.status, JSON.stringify(injected.body)).toBe(200);
    expect(injected.body.data.progress.user.email).toBe(a.email);
    expect(JSON.stringify(injected.body)).not.toContain(b.email);
    expect(calledEmails).toEqual([a.email]);

    const clean = await get(ROUTE, a.token);
    expect(clean.status, JSON.stringify(clean.body)).toBe(200);
    expect(clean.body.data.status).toBe("ok");
    expect(clean.body.data.progress.version).toBe(1);
    expect(clean.body.data.progress.user.email).toBe(a.email);
  });

  // ── e. 2 actor song song, cache không lẫn ───────────────────────────────────
  it("2 actor gọi song song — mỗi người nhận đúng dữ liệu của mình (cache khoá theo company+user)", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "metrain-par", [PAIR.accessLms]);
    const a = await makeUser(A, roleId);
    const b = await makeUser(A, roleId);

    const [ra, rb] = await Promise.all([get(ROUTE, a.token), get(ROUTE, b.token)]);
    expect(ra.body.data.progress.user.email).toBe(a.email);
    expect(rb.body.data.progress.user.email).toBe(b.email);

    // đọc lại (có thể HIT cache) — vẫn không lẫn
    const [ra2, rb2] = await Promise.all([get(ROUTE, a.token), get(ROUTE, b.token)]);
    expect(ra2.body.data.progress.user.email).toBe(a.email);
    expect(rb2.body.data.progress.user.email).toBe(b.email);
  });

  // ── f. LMS chết/timeout → 502 sạch ──────────────────────────────────────────
  it("LMS chết/timeout → 502 ME-ERR-TRAINING-LMS-UNAVAILABLE (không treo request)", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "metrain-down", [PAIR.accessLms]);
    const u = await makeUser(A, roleId);
    behaviour.set(u.email, "throw");

    const started = Date.now();
    const res = await get(ROUTE, u.token);
    expect(res.status, JSON.stringify(res.body)).toBe(502);
    expect(res.body.error.code).toBe("ME-ERR-TRAINING-LMS-UNAVAILABLE");
    expect(Date.now() - started).toBeLessThan(10_000);
    // KHÔNG rò chi tiết nội bộ ra client.
    expect(JSON.stringify(res.body)).not.toContain("network error");
  });

  // ── g. shape lệch → 502 contract-mismatch ───────────────────────────────────
  it("LMS trả version 2 → 502 ME-ERR-TRAINING-CONTRACT-MISMATCH (không forward object lệch)", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "metrain-v2", [PAIR.accessLms]);
    const u = await makeUser(A, roleId);
    behaviour.set(u.email, "v2");

    const res = await get(ROUTE, u.token);
    expect(res.status, JSON.stringify(res.body)).toBe(502);
    expect(res.body.error.code).toBe("ME-ERR-TRAINING-CONTRACT-MISMATCH");
    expect(res.body.data).toBeNull();
  });

  // ── i. company ngoài phạm vi LMS → 503 (fail-closed, KHÔNG gửi email sang hệ ngoài) ──
  it("LMS_COMPANY_ID khai company KHÁC → 503 ME-ERR-TRAINING-LMS-DISABLED, KHÔNG gọi LMS", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "metrain-gate", [PAIR.accessLms]);
    const u = await makeUser(A, roleId);
    process.env.LMS_COMPANY_ID = "99999999-9999-9999-9999-999999999999";
    calledEmails.length = 0;
    try {
      const res = await get(ROUTE, u.token);
      expect(res.status, JSON.stringify(res.body)).toBe(503);
      expect(res.body.error.code).toBe("ME-ERR-TRAINING-LMS-DISABLED");
      expect(calledEmails).toHaveLength(0);
    } finally {
      delete process.env.LMS_COMPANY_ID;
    }
  });

  // ── h. chưa có tài khoản LMS → no_account (fail-soft) ───────────────────────
  it("LMS 404 (chưa từng có tài khoản học) → 200 { status:'no_account', progress:null }", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "metrain-404", [PAIR.accessLms]);
    const u = await makeUser(A, roleId);
    behaviour.set(u.email, "notfound");

    const res = await get(ROUTE, u.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ status: "no_account", progress: null });
  });
});
