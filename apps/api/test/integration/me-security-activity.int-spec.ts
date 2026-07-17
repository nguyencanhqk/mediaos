/**
 * S5-ME-BE-3 — GET /me/security/activity integration (Postgres THẬT, DB CÔ LẬP).
 *
 * Int-spec CANONICAL (RED-trước) cho route Hoạt động bảo mật own-scope: đọc login_logs +
 * user_security_events CỦA CHÍNH user hiện tại (SPEC-09 ME-FUNC-016 §14.2/§17). Chứng minh trên
 * ĐƯỜNG THẬT (JwtAuthGuard 401 · PermissionGuard cặp access:me 403 · RLS+FORCE qua withTenant):
 *   a.  unauth        : không Bearer → 401.
 *   b.  deny          : có quyền nguồn nhưng KHÔNG access:me → 403 AUTH-ERR-FORBIDDEN.
 *   c.  happy/merge   : plant 2 login + 2 event → 200, hai nguồn merge, createdAt DESC toàn cục,
 *                       pagination block chuẩn (total ≥ 4).
 *   d.  shape-no-leak : serialize response KHÔNG chứa raw IP / marker metadata·payload / fragment
 *                       raw-UA (XYZBUILD); item chỉ đúng bộ key DTO; ipMasked dạng a.b.*.*.
 *   e.  own-scope     : A không thấy activity của B cùng tenant.
 *   f.  IDOR          : ?user_id=<B>&employee_id=<B> (+body) bị STRIP → 200, chỉ item của A.
 *   g.  cross-tenant  : plant login_logs tenant B gắn user_id=A → RLS chặn (không surface).
 *   g2. nullable-tenant: login_logs company NULL + user B → KHÔNG thấy (actor-lock); company NULL +
 *                       user A → THẤY (fail pre-auth của chính chủ vẫn hiện — plan-review M2).
 *   h.  time-window   : row cũ 200 ngày KHÔNG trong data VÀ total KHÔNG đếm (count cùng clamp 90
 *                       ngày với data query — plan-review M1).
 *   i.  paging/validate: per_page=1 → 1 item + has_next; per_page=999 → 400; from>to → 400.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Chạy:
 *   bash scripts/lane-db-setup.sh mebe3 → export LANE_DB=mediaos_mebe3 → pnpm --filter @mediaos/api test
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
// Ghép chuỗi theo quy tắc fixture giống-secret (CLAUDE.md §5) — tránh trip gitleaks generic-api-key.
const LOGIN_PW = ["Passw0rd!mesec", "activity", "1"].join("-");

const ROUTE = "/me/security/activity";

/** Cặp quyền tuple engine (mirror me-personal-hub.int-spec). */
const PAIR = {
  accessMe: ["access", "me", false],
  noti: ["read", "notification", false],
} as const;
type Triple = readonly [string, string, boolean];

/** Bộ key DTO tối giản duy nhất được phép xuất hiện trên 1 item (SPEC-09 §17 — plan §2.5). */
const DTO_KEYS = ["createdAt", "device", "eventType", "id", "ipMasked", "severity", "source"];

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}
function daysAgo(d: number): string {
  return new Date(Date.now() - d * 24 * 3600_000).toISOString();
}

describe.skipIf(!runDb)("S5-ME-BE-3 GET /me/security/activity (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let pw: string;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  let seq = 0;

  async function seedRoleWithPairs(companyId: string, name: string, pairs: Triple[]) {
    const roleId = await seedRole(direct, companyId, name);
    for (const [action, rt, sensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, rt, sensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Own");
    }
    return roleId;
  }

  async function makeUser(tenant: SeededTenant, roleId?: string) {
    const tag = `sa${++seq}`;
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

  /** Plant login_logs qua direct pool (bypass RLS — dựng lưới test). companyId nhận null tường minh. */
  async function plantLogin(opts: {
    companyId: string | null;
    userId: string | null;
    email?: string;
    status?: "success" | "failed" | "blocked";
    ip?: string | null;
    ua?: string | null;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void> {
    await direct.query(
      `INSERT INTO login_logs
         (company_id, user_id, email, normalized_email, login_status, ip_address, user_agent, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, COALESCE($9::timestamptz, now()))`,
      [
        opts.companyId,
        opts.userId,
        opts.email ?? "plant@x.test",
        opts.email ?? "plant@x.test",
        opts.status ?? "failed",
        opts.ip ?? null,
        opts.ua ?? null,
        JSON.stringify(opts.metadata ?? {}),
        opts.createdAt ?? null,
      ],
    );
  }

  /** Plant user_security_events (company NOT NULL). */
  async function plantEvent(opts: {
    companyId: string;
    userId: string;
    eventType: string;
    severity?: string;
    ip?: string | null;
    ua?: string | null;
    payload?: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void> {
    await direct.query(
      `INSERT INTO user_security_events
         (company_id, user_id, event_type, severity, ip_address, user_agent, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb, COALESCE($8::timestamptz, now()))`,
      [
        opts.companyId,
        opts.userId,
        opts.eventType,
        opts.severity ?? "info",
        opts.ip ?? null,
        opts.ua ?? null,
        JSON.stringify(opts.payload ?? {}),
        opts.createdAt ?? null,
      ],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    pw = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "mesa-a");
    B = await seedCompany(direct, "mesa-b");
    companyIds.push(A.companyId, B.companyId);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) {
      // login_logs company NULL (nhánh g2) không theo tenant — dọn theo email marker trước.
      await direct.query(
        "DELETE FROM login_logs WHERE company_id IS NULL AND email = 'plant@x.test'",
      );
      await cleanupTenants(direct, companyIds);
    }
    await direct?.end();
  });

  // ── a. unauth → 401 (JwtAuthGuard global) ────────────────────────────────────
  it("unauth — không Bearer → 401", async () => {
    const res = await request(app.getHttpServer()).get(ROUTE);
    expect(res.status).toBe(401);
  });

  // ── b. deny — KHÔNG access:me → 403 AUTH-ERR-FORBIDDEN (fail-closed) ─────────
  it("deny — có quyền nguồn nhưng KHÔNG cặp access:me → 403 AUTH-ERR-FORBIDDEN", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "mesa-no-access", [PAIR.noti]);
    const { token } = await makeUser(A, roleId);
    const res = await get(ROUTE, token);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error.code).toBe("AUTH-ERR-FORBIDDEN");
  });

  // ── c. happy — merge 2 nguồn, DESC toàn cục, pagination chuẩn ─────────────────
  it("happy — plant 2 login + 2 event → 200, merge 2 nguồn, createdAt DESC, pagination block", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "mesa-happy", [PAIR.accessMe]);
    const u = await makeUser(A, roleId);
    // Interleave 2 bảng theo thời gian để chứng minh merge-sort trong SQL (không phải nối 2 list).
    await plantLogin({
      companyId: A.companyId,
      userId: u.userId,
      status: "failed",
      ip: "10.9.1.1",
      createdAt: minutesAgo(1),
    });
    await plantEvent({
      companyId: A.companyId,
      userId: u.userId,
      eventType: "PLANT_HAPPY_E1",
      createdAt: minutesAgo(2),
    });
    await plantLogin({
      companyId: A.companyId,
      userId: u.userId,
      status: "blocked",
      ip: "10.9.1.2",
      createdAt: minutesAgo(3),
    });
    await plantEvent({
      companyId: A.companyId,
      userId: u.userId,
      eventType: "PLANT_HAPPY_E2",
      createdAt: minutesAgo(4),
    });

    const res = await get(ROUTE, u.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data as Array<Record<string, unknown>>;
    // Cả 2 nguồn cùng xuất hiện (login thật khi makeUser + planted).
    expect(items.some((i) => i.source === "login")).toBe(true);
    expect(items.some((i) => i.source === "security_event")).toBe(true);
    expect(items.some((i) => i.eventType === "PLANT_HAPPY_E1")).toBe(true);
    expect(items.some((i) => i.eventType === "PLANT_HAPPY_E2")).toBe(true);
    // LOGIN_* map từ login_status (không lộ failure_reason).
    expect(items.some((i) => i.eventType === "LOGIN_FAILED")).toBe(true);
    expect(items.some((i) => i.eventType === "LOGIN_BLOCKED")).toBe(true);
    // DESC toàn cục (merged-sort, tie-break ổn định).
    const times = items.map((i) => new Date(i.createdAt as string).getTime());
    for (let k = 1; k < times.length; k++) expect(times[k]).toBeLessThanOrEqual(times[k - 1]);
    // Pagination hoist chuẩn API-01 §16.1.
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(4);
  });

  // ── d. shape — KHÔNG lộ raw IP / metadata / payload / fragment raw-UA ────────
  it("shape — response KHÔNG chứa raw IP, marker metadata/payload, fragment raw-UA; item đúng bộ key DTO", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "mesa-shape", [PAIR.accessMe]);
    const u = await makeUser(A, roleId);
    await plantLogin({
      companyId: A.companyId,
      userId: u.userId,
      status: "failed",
      ip: "203.0.113.77",
      ua: "XYZBUILD/9.9.9 (SecretDevice; rooted)",
      metadata: { token: "PLANT-DO-NOT-LEAK-M" },
    });
    await plantEvent({
      companyId: A.companyId,
      userId: u.userId,
      eventType: "PLANT_SHAPE_EVT",
      severity: "medium",
      ip: "203.0.113.78",
      ua: "XYZBUILD/9.9.9 (SecretDevice; rooted)",
      payload: { secretRef: "PLANT-DO-NOT-LEAK-P" },
    });

    const res = await get(ROUTE, u.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const raw = JSON.stringify(res.body);
    // Raw IP tuyệt đối không lọt (chỉ dạng mask 203.0.*.*).
    expect(raw).not.toContain("113.77");
    expect(raw).not.toContain("113.78");
    // metadata/payload KHÔNG được SELECT ⇒ marker không có đường lộ (BẤT BIẾN #3).
    expect(raw).not.toContain("PLANT-DO-NOT-LEAK");
    // Fragment raw-UA không lọt qua device (plan-review M3).
    expect(raw).not.toContain("XYZBUILD");
    expect(raw).not.toContain("SecretDevice");
    // Key nhạy cảm không tồn tại trong response.
    for (const banned of [
      "ip_address",
      "user_agent",
      "metadata",
      "payload",
      "normalized_email",
      "failure_reason",
      "session_id",
    ]) {
      expect(raw, `key cấm: ${banned}`).not.toContain(`"${banned}"`);
    }
    // Item đúng bộ key DTO tối giản + ipMasked đúng dạng.
    const items = res.body.data as Array<Record<string, unknown>>;
    const evt = items.find((i) => i.eventType === "PLANT_SHAPE_EVT");
    expect(evt, "planted event phải xuất hiện").toBeTruthy();
    expect(Object.keys(evt as object).sort()).toEqual(DTO_KEYS);
    expect((evt as Record<string, unknown>).ipMasked).toBe("203.0.*.*");
    expect((evt as Record<string, unknown>).severity).toBe("medium");
    const login = items.find((i) => i.source === "login" && i.ipMasked === "203.0.*.*");
    expect(login, "planted login phải xuất hiện (mask IP)").toBeTruthy();
    expect(Object.keys(login as object).sort()).toEqual(DTO_KEYS);
    expect((login as Record<string, unknown>).eventType).toBe("LOGIN_FAILED");
  });

  // ── e. own-scope — A không thấy activity của B cùng tenant ───────────────────
  it("own-scope — user A KHÔNG thấy activity của user B cùng tenant", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "mesa-own", [PAIR.accessMe]);
    const a = await makeUser(A, roleId);
    const b = await makeUser(A, roleId);
    await plantEvent({ companyId: A.companyId, userId: b.userId, eventType: "PLANT_OWN_B_EVT" });
    await plantEvent({ companyId: A.companyId, userId: a.userId, eventType: "PLANT_OWN_A_EVT" });

    const res = await get(ROUTE, a.token);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).toContain("PLANT_OWN_A_EVT");
    expect(raw).not.toContain("PLANT_OWN_B_EVT");
    expect(raw).not.toContain(b.userId);
  });

  // ── f. IDOR — user_id/employee_id lạ (query + body) bị STRIP, không đổi hành vi ──
  it("IDOR — ?user_id=<B>&employee_id=<B> (+body) bị BỎ QUA: chỉ item của caller, vẫn 200", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "mesa-idor", [PAIR.accessMe]);
    const caller = await makeUser(A, roleId);
    const victim = await makeUser(A, roleId);
    await plantEvent({
      companyId: A.companyId,
      userId: victim.userId,
      eventType: "PLANT_IDOR_VICTIM",
    });
    await plantEvent({
      companyId: A.companyId,
      userId: caller.userId,
      eventType: "PLANT_IDOR_CALLER",
    });

    const res = await request(app.getHttpServer())
      .get(`${ROUTE}?user_id=${victim.userId}&employee_id=${victim.userId}`)
      .set("Authorization", `Bearer ${caller.token}`)
      .send({ user_id: victim.userId, employee_id: victim.userId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).toContain("PLANT_IDOR_CALLER");
    expect(raw).not.toContain("PLANT_IDOR_VICTIM");
    expect(raw).not.toContain(victim.userId);
  });

  // ── g. cross-tenant — planted row tenant B gắn user_id=A: RLS chặn (CẢ 2 nhánh union —
  //      user_security_events đối xứng theo finding LOW của security-reviewer) ──────────
  it("cross-tenant — login_logs + user_security_events tenant B gắn user_id=A KHÔNG surface qua token tenant A (RLS)", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "mesa-xt", [PAIR.accessMe]);
    const a = await makeUser(A, roleId);
    await plantLogin({
      companyId: B.companyId,
      userId: a.userId,
      status: "success",
      ip: "198.51.100.99",
    });
    await plantEvent({
      companyId: B.companyId,
      userId: a.userId,
      eventType: "PLANT_XT_EVT_TENANT_B",
    });

    const res = await get(ROUTE, a.token);
    expect(res.status).toBe(200);
    const items = res.body.data as Array<Record<string, unknown>>;
    expect(
      items.some((i) => i.ipMasked === "198.51.*.*"),
      "row login tenant B không được lộ",
    ).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("PLANT_XT_EVT_TENANT_B");
  });

  // ── g2. nullable-tenant — company NULL: actor-lock chặn user khác, chính chủ vẫn thấy ──
  it("nullable-tenant — login_logs company NULL + user B KHÔNG thấy; company NULL + user A THẤY (chính chủ)", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "mesa-null", [PAIR.accessMe]);
    const a = await makeUser(A, roleId);
    const b = await makeUser(A, roleId);
    // RLS nullable-tenant cho row company NULL đi qua — actor-lock user_id=actor phải là hàng rào.
    await plantLogin({ companyId: null, userId: b.userId, status: "failed", ip: "192.0.2.10" });
    await plantLogin({ companyId: null, userId: a.userId, status: "failed", ip: "198.18.0.1" });

    const res = await get(ROUTE, a.token);
    expect(res.status).toBe(200);
    const items = res.body.data as Array<Record<string, unknown>>;
    expect(
      items.some((i) => i.ipMasked === "192.0.*.*"),
      "row NULL-company của B không được lộ",
    ).toBe(false);
    expect(
      items.some((i) => i.ipMasked === "198.18.*.*"),
      "row NULL-company của CHÍNH A phải hiện",
    ).toBe(true);
  });

  // ── h. time-window — row 200 ngày: KHÔNG trong data VÀ total KHÔNG đếm ────────
  it("time-window — row cũ 200 ngày không trong data VÀ pagination.total không đếm (count cùng clamp)", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "mesa-window", [PAIR.accessMe]);
    const u = await makeUser(A, roleId);
    const before = await get(ROUTE, u.token);
    expect(before.status).toBe(200);
    const totalBefore = before.body.pagination.total as number;

    await plantEvent({
      companyId: A.companyId,
      userId: u.userId,
      eventType: "PLANT_OLD_EVT",
      createdAt: daysAgo(200),
    });

    const after = await get(ROUTE, u.token);
    expect(after.status).toBe(200);
    expect(JSON.stringify(after.body)).not.toContain("PLANT_OLD_EVT");
    // Count phải áp CÙNG clamp 90 ngày với data query (plan-review M1) — total không tăng.
    expect(after.body.pagination.total).toBe(totalBefore);

    // Kéo from_date xa hơn 90 ngày cũng bị clamp — row cũ vẫn không lộ.
    const wide = await get(`${ROUTE}?from_date=2020-01-01`, u.token);
    expect(wide.status).toBe(200);
    expect(JSON.stringify(wide.body)).not.toContain("PLANT_OLD_EVT");
  });

  // ── i. paging + validate ──────────────────────────────────────────────────────
  it("paging — per_page=1 → 1 item + has_next; per_page=999 → 400; from_date>to_date → 400", async () => {
    const roleId = await seedRoleWithPairs(A.companyId, "mesa-page", [PAIR.accessMe]);
    const u = await makeUser(A, roleId);
    await plantEvent({ companyId: A.companyId, userId: u.userId, eventType: "PLANT_PAGE_1" });
    await plantEvent({ companyId: A.companyId, userId: u.userId, eventType: "PLANT_PAGE_2" });

    const one = await get(`${ROUTE}?per_page=1`, u.token);
    expect(one.status).toBe(200);
    expect((one.body.data as unknown[]).length).toBe(1);
    expect(one.body.pagination.per_page).toBe(1);
    expect(one.body.pagination.has_next).toBe(true);

    const tooBig = await get(`${ROUTE}?per_page=999`, u.token);
    expect(tooBig.status, JSON.stringify(tooBig.body)).toBe(400);

    const inverted = await get(`${ROUTE}?from_date=2026-07-10&to_date=2026-07-01`, u.token);
    expect(inverted.status, JSON.stringify(inverted.body)).toBe(400);
  });
});
