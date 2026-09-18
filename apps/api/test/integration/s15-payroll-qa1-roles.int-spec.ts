/**
 * S15-PAYROLL-QA-1 — ROLE HỆ THỐNG × 50 route v2 (036–085) qua HTTP · wildcard không kế thừa · /auth/me.
 *
 * Khoảng trống G1/G2 (plan §0): trước WO này, MỌI ca HTTP của v2 dùng role DỰNG TRONG TEST; ma trận grant của
 * mig `0571` (31 hàng) + `0565` (v1) chỉ được ĐẾM HÀNG ở DB (`s15-payroll-db1-invariants` D3/D5–D7). Đếm hàng không
 * chứng minh engine quyền đọc đúng các hàng đó lúc chạy. File này đăng nhập bằng CHÍNH role canonical
 * (`company_id IS NULL`) và gọi từng route.
 *
 *  A. Ma trận TAY (không suy từ code) — SPEC-11 §21.1 #17 · #18:
 *     · `company-admin`   ⇒ ALLOW 48/50; DENY 065 (`view-own:payroll-advance` là cặp của nhân viên) · 084
 *       (không giữ `view-own-payslip`).
 *     · `payroll-officer` ⇒ ALLOW 44/50; DENY 056/058 (`manage:statutory-rate`) · 074/075 (`manage:payroll-budget`)
 *       — §11.3 ghi chú 3 · 065 · 084.
 *     · `employee`        ⇒ ALLOW ĐÚNG 065 + 084 (phiếu của chính mình); 48 route còn lại 403.
 *     · `hr-manager` · `manager` · `hr` ⇒ 403 trên CẢ 50 route (DECISIONS-01 Phương án B — 0 cặp PAYROLL).
 *     Ca ALLOW assert MÃ CHÍNH XÁC (200/201/202) trên một «lát» dữ liệu riêng (`payroll-qa1-routes.ts`).
 *  B. Wildcard (done_when 1): role chỉ giữ `*:*` ⇒ 403 cả 50 route (mỗi cặp mới có ≥ 1 route). Ba hình dạng
 *     còn lại (`*:<res>` · `<act>:*`) ghim ở engine (`permission.decide.pair-sensitive.spec.ts` #11b) — dựng qua
 *     HTTP phải ghi hàng catalog TOÀN CỤC mang resource PAYROLL (xem comment trong beforeAll).
 *  C. /auth/me (§21.1 #23): cờ hiển thị của officer/admin/employee chứa ĐÚNG các cặp v2 họ giữ, không cặp nào họ
 *     không giữ; hr-manager không có cặp v2 nào.
 *
 * ⓘ `TWO_FACTOR_ENFORCEMENT_ENABLED=false` trong env vitest ⇒ role `requires_two_factor` đăng nhập không cần TOTP.
 * File này đo MA TRẬN GRANT, không đo 2FA (đã có `two-factor-enforcement.guard.spec.ts`).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). Ca DENY assert thông điệp của `PermissionGuard` để 403 không đến
 * từ cổng khác (sàn scope/2FA).
 */
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  QA1_ROUTES,
  callQa1Route,
  seedQa1Slice,
  type Qa1Http,
  type Qa1Slice,
} from "../helpers/payroll-qa1-routes";
import { grantAllPayrollPairs, seedPayrollCatalog } from "../helpers/payroll-v2-fixtures";
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
const LOGIN_PW = loginPasswordFixture("s15payrollqa1roles");

const CANONICAL = [
  "company-admin",
  "payroll-officer",
  "employee",
  "hr-manager",
  "manager",
  "hr",
] as const;
type Canonical = (typeof CANONICAL)[number];
const ALL_CODES = QA1_ROUTES.map((r) => r.code);

/** Ma trận TAY — tập route ALLOW của từng role canonical (mig 0565 + 0571). */
const ALLOWED: Record<Canonical, ReadonlySet<string>> = {
  "company-admin": new Set(ALL_CODES.filter((c) => !["065", "084"].includes(c))),
  "payroll-officer": new Set(
    ALL_CODES.filter((c) => !["056", "058", "065", "074", "075", "084"].includes(c)),
  ),
  employee: new Set(["065", "084"]),
  "hr-manager": new Set(),
  manager: new Set(),
  hr: new Set(),
};

/** 17 cặp mới (mig 0571) — nguồn cho ca /auth/me và hình dạng wildcard. */
const V2_PAIRS = [
  "view:payroll-employee",
  "manage:payroll-employee",
  "view:salary-component",
  "manage:salary-component",
  "view:payroll-template",
  "manage:payroll-template",
  "view:statutory-rate",
  "manage:statutory-rate",
  "view:payroll-advance",
  "manage:payroll-advance",
  "approve:payroll-advance",
  "view-own:payroll-advance",
  "view:payment-batch",
  "manage:payment-batch",
  "view:payroll-budget",
  "manage:payroll-budget",
  "view:payroll-report",
] as const;
const V2_HELD: Record<"company-admin" | "payroll-officer" | "employee", ReadonlySet<string>> = {
  "company-admin": new Set(V2_PAIRS.filter((p) => p !== "view-own:payroll-advance")),
  "payroll-officer": new Set(
    V2_PAIRS.filter(
      (p) =>
        !["manage:statutory-rate", "manage:payroll-budget", "view-own:payroll-advance"].includes(p),
    ),
  ),
  employee: new Set(["view-own:payroll-advance"]),
};

describe.skipIf(!hasLaneDb)("S15-PAYROLL-QA-1 · role hệ thống × 50 route v2", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  const tokens = {} as Record<Canonical | "wildStar", string>;
  const slices = {} as Record<"company-admin" | "payroll-officer" | "employee", Qa1Slice>;

  const http: Qa1Http = async (verb, path, token, body, csv) => {
    let req = request(app.getHttpServer())[verb](path).set("Authorization", `Bearer ${token}`);
    if (csv) req = req.attach("file", csv, { filename: "qa1.csv", contentType: "text/csv" });
    else if (body) req = req.send(body);
    const res = await req;
    return { status: res.status, body: res.body };
  };
  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }
  const expectPermissionDenied = (res: { status: number; body: unknown }, what: string) => {
    expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBe(403);
    expect(JSON.stringify(res.body), what).toMatch(/Permission denied/);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);

    A = await seedCompany(direct, "qa1roles");
    companyIds.push(A.companyId);
    const defaultTemplateId = await seedPayrollCatalog(direct, A.companyId);
    const mkUser = (label: string) =>
      seedUser(direct, A.companyId, `${label}@${A.slug}.test`, hash);

    const seederId = await mkUser("seeder");
    await grantAllPayrollPairs(direct, A.companyId, seederId, "qa1r-seed");
    const approverId = await mkUser("approver");

    const ids = {} as Record<Canonical, string>;
    for (const name of CANONICAL) {
      const r = await direct.query<{ id: string }>(
        `SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL`,
        [name],
      );
      expect(r.rows.length, `seed canonical phải có đúng một role ${name}`).toBe(1);
      ids[name] = await mkUser(`canon-${name}`);
      await seedUserRole(direct, ids[name], r.rows[0].id, A.companyId);
      tokens[name] = await login(`canon-${name}@${A.slug}.test`);
    }

    // Wildcard: CHỈ `*:*` — hàng catalog đó đã có sẵn (seed super-admin), nên KHÔNG ghi thêm hàng `permissions` toàn
    // cục nào. ⚠️ ĐỪNG thêm dạng `*:<tài-nguyên-payroll>` / `<action>:*` ở đây: mỗi dạng là một hàng catalog TOÀN CỤC
    // mang resource PAYROLL, sống qua `cleanupTenants`, làm đỏ D1 «catalog PAYROLL đúng 34 cặp» của
    // `s15-payroll-db1-invariants` (đã đo 17/09 — chạy chung chunk ⇒ 1 đỏ thật). Bốn hình dạng được ghim ở tầng
    // engine: `src/permission/permission.decide.pair-sensitive.spec.ts` #11b.
    {
      const uid = await mkUser("wildstar");
      const roleId = await seedRole(direct, A.companyId, "qa1r-wildstar");
      await seedRolePermission(
        direct,
        roleId,
        await seedPermissionCatalog(direct, "*", "*", false),
        "ALLOW",
        "Company",
      );
      await seedUserRole(direct, uid, roleId, A.companyId);
      tokens.wildStar = await login(`wildstar@${A.slug}.test`);
    }

    const deps = {
      direct,
      companyId: A.companyId,
      slug: A.slug,
      http,
      seederToken: await login(`seeder@${A.slug}.test`),
      seederId,
      approverId,
      defaultTemplateId,
    };
    slices["company-admin"] = await seedQa1Slice(deps, 1, ids["company-admin"]);
    slices["payroll-officer"] = await seedQa1Slice(deps, 2, ids["payroll-officer"]);
    slices.employee = await seedQa1Slice(deps, 3, ids.employee);
  }, 600_000);

  afterAll(async () => {
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
    await app?.close();
  });

  it("chống xanh-RỖNG: bảng đủ 50 route 036–085, mã không trùng", () => {
    expect(ALL_CODES).toEqual(
      Array.from({ length: 50 }, (_, i) => String(36 + i).padStart(3, "0")),
    );
  });

  describe.each(["company-admin", "payroll-officer", "employee"] as const)("A · %s", (role) => {
    it.each(QA1_ROUTES.map((r) => [r.code, r] as const))("%s", async (_code, route) => {
      const res = await callQa1Route(http, route, slices[role], tokens[role]);
      const what = `${role} ${route.verb.toUpperCase()} ${route.code}`;
      if (ALLOWED[role].has(route.code)) {
        expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBe(route.ok);
      } else {
        expectPermissionDenied(res, what);
      }
    });
  });

  describe.each(["hr-manager", "manager", "hr", "wildStar"] as const)(
    "A/B · %s ⇒ 403 cả 50 route",
    (who) => {
      it.each(QA1_ROUTES.map((r) => [r.code, r] as const))("%s", async (_code, route) => {
        // Lát của nhân viên: ALLOW không xảy ra nên không tiêu dữ liệu; một cổng rò sẽ ĐỎ ở đây trước.
        const res = await callQa1Route(http, route, slices.employee, tokens[who]);
        expectPermissionDenied(res, `${who} ${route.verb.toUpperCase()} ${route.code}`);
      });
    },
  );

  describe("C · /auth/me — cờ hiển thị cặp v2 khớp ĐÚNG tập đang giữ", () => {
    const capsOf = async (token: string): Promise<Record<string, boolean>> => {
      const res = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.capabilities as Record<string, boolean>;
    };

    it.each(["company-admin", "payroll-officer", "employee"] as const)("%s", async (role) => {
      const caps = await capsOf(tokens[role]);
      const shown = V2_PAIRS.filter((p) => caps[p] === true);
      expect(shown).toEqual(V2_PAIRS.filter((p) => V2_HELD[role].has(p)));
    });

    it("hr-manager · wildcard ⇒ KHÔNG cặp v2 nào", async () => {
      for (const who of ["hr-manager", "wildStar"] as const) {
        const caps = await capsOf(tokens[who]);
        expect(
          V2_PAIRS.filter((p) => caps[p] === true),
          who,
        ).toEqual([]);
      }
    });
  });
});
