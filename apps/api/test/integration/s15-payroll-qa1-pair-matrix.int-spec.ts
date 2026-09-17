/**
 * S15-PAYROLL-QA-1 — MA TRẬN «thiếu ĐÚNG MỘT cặp» cho 17 cặp mới × route nó gác · cặp phụ ở scope hẹp.
 *
 * Khoảng trống G3/G4 (plan §0): 066–070 · 072 chưa có ca thiếu-cặp; 046 · 051 · 057 · 073 · 075 chưa có; cặp phụ của
 * 071 · 083 · 085 chỉ được thử ở dạng VẮNG hẳn, chưa ở dạng giữ-nhưng-scope-hẹp; 082 chưa có ALLOW báo cáo theo-người.
 *
 *  A. ALLOW đối chứng (§21.1 #18): người giữ MỌI cặp PAYROLL @Company ⇒ MÃ CHÍNH XÁC trên cả 50 route (lát riêng).
 *     Thiếu khối này thì mọi ca DENY dưới xanh-RỖNG (`deny-cases-vacuous-without-allow-case`).
 *  B. DENY — với MỖI cặp P trong 17 cặp mới: người giữ mọi cặp TRỪ P ⇒ 403 `Permission denied` trên MỌI route có
 *     decorator = P, và KHÔNG ít hơn một route (neo số route mỗi cặp — bảng đổi mà quên cặp là ĐỎ).
 *  C. Cặp phụ ở tầng service, giữ nhưng scope `Department` (sàn Company §13.5) ⇒ 403, thông điệp `AUTH-ERR-SCOPE-DENIED`:
 *     071 (`export:payroll` hoặc `view-payslip:payslip` hẹp) · 083 (`export:payroll` hẹp) · 085 (`view-payslip` hẹp).
 *     Decorator của ba route giữ @Company nên 403 ở đây CHỈ có thể đến từ vế `resolveActor` thứ hai.
 *  D. 082 báo cáo THEO NGƯỜI (`employee-income`, cặp nguồn `view-payslip`) ⇒ người đủ cặp tải được (200 + XLSX).
 *
 * GATE CỨNG `hasDb && LANE_DB`.
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
import {
  PAYROLL_ROUTE_PAIRS,
  type PayrollRouteKey,
} from "../../src/payroll/payroll-route-pairs.const";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  QA1_ROUTES,
  callQa1Route,
  seedQa1Slice,
  type Qa1Http,
  type Qa1Route,
  type Qa1Slice,
} from "../helpers/payroll-qa1-routes";
import {
  grantAllPayrollPairs,
  grantPayrollPairs,
  seedPayrollCatalog,
} from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15payrollqa1pairs");

const pairOf = (k: PayrollRouteKey): string =>
  `${PAYROLL_ROUTE_PAIRS[k].action}:${PAYROLL_ROUTE_PAIRS[k].resourceType}`;
const ALL_KEYS = Object.keys(PAYROLL_ROUTE_PAIRS) as PayrollRouteKey[];
/** Mọi key route trừ các key có cặp nằm trong `drop`. */
const keysExcept = (...drop: string[]): PayrollRouteKey[] =>
  ALL_KEYS.filter((k) => !drop.includes(pairOf(k)));

/** Số route v2 (036–085) mỗi cặp mới gác ở DECORATOR — bảng TAY theo API-18 §5b. */
const ROUTES_PER_NEW_PAIR: Record<string, number> = {
  "view:payroll-employee": 4, // 036 037 038 040
  "manage:payroll-employee": 3, // 039 041 042
  "view:salary-component": 2, // 044 046
  "manage:salary-component": 3, // 045 047 048
  "view:payroll-template": 2, // 049 051
  "manage:payroll-template": 4, // 050 052 053 054
  "view:statutory-rate": 2, // 055 057
  "manage:statutory-rate": 2, // 056 058
  "view:payroll-advance": 2, // 059 061
  "manage:payroll-advance": 2, // 060 062
  "approve:payroll-advance": 2, // 063 064
  "view-own:payroll-advance": 1, // 065
  "view:payment-batch": 3, // 066 068 070
  "manage:payment-batch": 4, // 067 069 071 072
  "view:payroll-budget": 1, // 073
  "manage:payroll-budget": 2, // 074 075
  "view:payroll-report": 5, // 078–082
};
const NEW_PAIRS = Object.keys(ROUTES_PER_NEW_PAIR);

describe.skipIf(!hasLaneDb)("S15-PAYROLL-QA-1 · thiếu ĐÚNG một cặp × 17 cặp mới", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let fullToken = "";
  let fullSlice: Qa1Slice;
  let denySlice: Qa1Slice;
  const minusOne = new Map<string, string>();
  const narrow = {} as Record<"u071export" | "u071payslip" | "u083export" | "u085payslip", string>;

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
  const routeByCode = (code: string): Qa1Route => {
    const r = QA1_ROUTES.find((x) => x.code === code);
    if (!r) throw new Error(`không có route ${code}`);
    return r;
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

    A = await seedCompany(direct, "qa1pairs");
    companyIds.push(A.companyId);
    const defaultTemplateId = await seedPayrollCatalog(direct, A.companyId);
    let seq = 0;
    const mk = async (label: string, grant: (id: string) => Promise<void>) => {
      const email = `${label}-${seq++}@${A.slug}.test`;
      const id = await seedUser(direct, A.companyId, email, hash);
      await grant(id);
      return { id, token: await login(email) };
    };

    const seeder = await mk("seeder", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, "qa1p-seed"),
    );
    const approverId = await seedUser(direct, A.companyId, `approver@${A.slug}.test`, hash);
    const full = await mk("full", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, "qa1p-full"),
    );
    fullToken = full.token;

    for (const p of NEW_PAIRS) {
      const u = await mk(`minus-${p.replace(/[^a-z]/g, "")}`, (id) =>
        grantPayrollPairs(direct, A.companyId, id, "qa1p-minus", keysExcept(p)),
      );
      minusOne.set(p, u.token);
    }

    // C — cặp phụ ở scope Department, mọi cặp khác @Company.
    const withNarrow = (label: string, narrowPair: string, narrowKey: PayrollRouteKey) =>
      mk(label, async (id) => {
        await grantPayrollPairs(direct, A.companyId, id, `qa1p-${label}`, keysExcept(narrowPair));
        await grantPayrollPairs(
          direct,
          A.companyId,
          id,
          `qa1p-${label}-d`,
          [narrowKey],
          "Department",
        );
      });
    narrow.u071export = (await withNarrow("n071exp", "export:payroll", "periodExport")).token;
    narrow.u071payslip = (await withNarrow("n071ps", "view-payslip:payslip", "payslipList")).token;
    narrow.u083export = (await withNarrow("n083exp", "export:payroll", "periodExport")).token;
    narrow.u085payslip = (await withNarrow("n085ps", "view-payslip:payslip", "payslipList")).token;

    const deps = {
      direct,
      companyId: A.companyId,
      slug: A.slug,
      http,
      seederToken: seeder.token,
      seederId: seeder.id,
      approverId,
      defaultTemplateId,
    };
    fullSlice = await seedQa1Slice(deps, 1, full.id);
    denySlice = await seedQa1Slice(deps, 2, null);
  }, 600_000);

  afterAll(async () => {
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
    await app?.close();
  });

  describe("A · ALLOW đối chứng — đủ mọi cặp @Company ⇒ mã chính xác trên 50 route", () => {
    it.each(QA1_ROUTES.map((r) => [r.code, r] as const))("%s", async (_code, route) => {
      const res = await callQa1Route(http, route, fullSlice, fullToken);
      expect(res.status, `${route.code}: ${JSON.stringify(res.body)}`).toBe(route.ok);
    });
  });

  describe("B · thiếu ĐÚNG một cặp mới ⇒ 403 trên mọi route cặp đó gác", () => {
    it("neo: 17 cặp mới, số route mỗi cặp khớp bảng tay (tổng 50 − 043/076/077/083/084/085 dùng cặp v1)", () => {
      const counted = new Map<string, number>();
      for (const r of QA1_ROUTES) counted.set(pairOf(r.key), (counted.get(pairOf(r.key)) ?? 0) + 1);
      expect(NEW_PAIRS).toHaveLength(17);
      for (const p of NEW_PAIRS) expect(counted.get(p), p).toBe(ROUTES_PER_NEW_PAIR[p]);
      const covered = NEW_PAIRS.reduce((s, p) => s + ROUTES_PER_NEW_PAIR[p], 0);
      expect(covered).toBe(44);
    });

    it.each(NEW_PAIRS)("thiếu %s", async (pair) => {
      const token = minusOne.get(pair) as string;
      const routes = QA1_ROUTES.filter((r) => pairOf(r.key) === pair);
      expect(routes.length, pair).toBeGreaterThan(0);
      for (const route of routes) {
        const res = await callQa1Route(http, route, denySlice, token);
        const what = `thiếu ${pair} · ${route.code}`;
        expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(JSON.stringify(res.body), what).toMatch(/Permission denied/);
      }
    });
  });

  describe("C · cặp phụ giữ ở scope Department ⇒ 403 sàn Company (vế service)", () => {
    it.each([
      ["071 · export:payroll @Department", "u071export", "071"],
      ["071 · view-payslip @Department", "u071payslip", "071"],
      ["083 · export:payroll @Department", "u083export", "083"],
      ["085 · view-payslip @Department", "u085payslip", "085"],
    ] as const)("%s", async (_label, who, code) => {
      const res = await callQa1Route(http, routeByCode(code), denySlice, narrow[who]);
      expect(res.status, `${who}: ${JSON.stringify(res.body)}`).toBe(403);
      // `ForbiddenException("AUTH-ERR-SCOPE-DENIED: …")` chuỗi TRẦN ⇒ envelope `code` là AUTH-ERR-FORBIDDEN, mã sàn nằm ở
      // `message` (khuôn `s13-payroll-qa1-scope-floor`). Phân biệt được với deny của decorator («Permission denied»).
      expect(res.body.error?.message, who).toContain("AUTH-ERR-SCOPE-DENIED");
    });
  });

  it("D · 082 báo cáo THEO NGƯỜI `employee-income` — đủ cặp nguồn ⇒ 200 + tệp XLSX", async () => {
    const res = await request(app.getHttpServer())
      .get("/payroll/reports/employee-income/export?fromMonth=2091-01&toMonth=2092-12")
      .set("Authorization", `Bearer ${fullToken}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status, String(res.body)).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    // Chữ ký ZIP của XLSX — không phải thân JSON lỗi dán nhãn XLSX (bẫy `@Header` của S13-QA-1).
    expect((res.body as Buffer).subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
