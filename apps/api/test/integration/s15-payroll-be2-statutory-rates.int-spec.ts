/**
 * S15-PAYROLL-BE-2 — `PAYROLL-API-055..058`: tỉ lệ · trần · bậc thuế luật định (plan §4 · §9).
 *
 *   A. ALLOW/DENY per-pair + sàn Company + 404 cross-tenant.
 *   B. 056: trùng ngày hiệu lực ⇒ 409 033 THẬT · bậc TNCN hỏng ⇒ 422 022 kèm `reason` TỪNG hình dạng.
 *   C. 🔴 058 «đã có kỳ dùng» (MF13): kỳ Draft KHÔNG làm «đang dùng» · kỳ Calculated thì CÓ · chèn bản R2 xen
 *      giữa KHÔNG gỡ được khoá của R · đổi ngày hiệu lực kiểm với ngày SỚM hơn · `inUse` ở 055/057 khớp.
 *   D. Audit KHÔNG chở số tiền/tỉ lệ (MF14).
 *
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import { randomUUID } from "node:crypto";
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
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
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
const LOGIN_PW = "Passw0rd!s15be2rate";

type Res = request.Response;
const kindOf = (res: Res): string | undefined =>
  res.body?.error?.details?.find((d: { field: string }) => d.field === "kind")?.message;
const detailOf = (res: Res, field: string): string | undefined =>
  res.body?.error?.details?.find((d: { field: string }) => d.field === field)?.message;

const BRACKETS = [
  { upTo: 5000000, rate: 5 },
  { upTo: 10000000, rate: 10 },
  { upTo: 18000000, rate: 15 },
  { upTo: 32000000, rate: 20 },
  { upTo: 52000000, rate: 25 },
  { upTo: 80000000, rate: 30 },
  { upTo: null, rate: 35 },
];

const rateBody = (over: Record<string, unknown> = {}) => ({
  effectiveFrom: "2026-01-01",
  siEmployeePct: 8,
  hiEmployeePct: 1.5,
  uiEmployeePct: 1,
  siEmployerPct: 17.5,
  hiEmployerPct: 3,
  uiEmployerPct: 1,
  unionEmployerPct: 2,
  unionEmployeePct: 1,
  siCap: 46800000,
  hiCap: 46800000,
  uiCap: 99200000,
  baseWage: 2340000,
  minRegionWage: 4960000,
  personalDeduction: 11000000,
  dependentDeduction: 4400000,
  pitBrackets: BRACKETS,
  note: "bản thử",
  ...over,
});

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-2 — 055..058 tỉ lệ luật định", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tFull = "";
  let tView = "";
  let tNone = "";
  let tDept = "";
  let seedRateA = "";
  let seedRateB = "";
  let rateJan = "";

  const http = () => request(app.getHttpServer());
  /** Verb TƯỜNG MINH — `route-http-coverage` nhận verb qua literal `.patch(`/`.put(`, không qua `http()[method]`. */
  const pick = (method: "get" | "post" | "patch" | "put", url: string) => {
    const agent = http();
    if (method === "get") return agent.get(url);
    if (method === "post") return agent.post(url);
    if (method === "patch") return agent.patch(url);
    return agent.put(url);
  };
  const call = (method: "get" | "post" | "patch", token: string, url: string) =>
    pick(method, url).set("Authorization", `Bearer ${token}`);

  async function grant(
    userId: string,
    label: string,
    pairs: Array<[string, string]>,
    scope: "Company" | "Department" = "Company",
  ) {
    const roleId = await seedRole(
      direct,
      A.companyId,
      `s15rate-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const [action, resource] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, true);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function login(email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function seedRateId(companyId: string): Promise<string> {
    const r = await direct.query(
      `SELECT id FROM payroll_statutory_rates WHERE company_id = $1 AND effective_from = '2024-07-01' AND deleted_at IS NULL`,
      [companyId],
    );
    return r.rows[0].id as string;
  }

  async function createRate(effectiveFrom: string): Promise<string> {
    const res = await call("post", tFull, "/payroll/statutory-rates").send(
      rateBody({ effectiveFrom }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s15ratea");
    B = await seedCompany(direct, "s15rateb");
    companyIds.push(A.companyId, B.companyId);

    const runner = app.get(MasterDataSeedRunner, { strict: false });
    for (const c of [A.companyId, B.companyId]) {
      const outcomes = await runner.reconcileCompany(c);
      expect(
        outcomes.every((o) => o.ok),
        JSON.stringify(outcomes),
      ).toBe(true);
    }
    seedRateA = await seedRateId(A.companyId);
    seedRateB = await seedRateId(B.companyId);

    const mk = async (label: string, pairs: Array<[string, string]>, scope: "Company" | "Department" = "Company") => {
      const email = `${label}@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      if (pairs.length > 0) await grant(uid, label, pairs, scope);
      return login(email);
    };
    tFull = await mk("full", [
      ["view", "statutory-rate"],
      ["manage", "statutory-rate"],
    ]);
    tView = await mk("viewonly", [["view", "statutory-rate"]]);
    tNone = await mk("nopairs", []);
    tDept = await mk(
      "dept",
      [
        ["view", "statutory-rate"],
        ["manage", "statutory-rate"],
      ],
      "Department",
    );
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
  });

  // ── A ────────────────────────────────────────────────────────────────────────────────────────
  it("A1 — ALLOW 055/057: bản seed có mặt, trần giữ NGUYÊN số tiền đã lưu, chưa có kỳ dùng", async () => {
    const list = await call("get", tFull, "/payroll/statutory-rates");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data.map((r: { effectiveFrom: string }) => r.effectiveFrom)).toContain(
      "2024-07-01",
    );
    const detail = await call("get", tFull, `/payroll/statutory-rates/${seedRateA}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ siCap: 46800000, uiCap: 99200000, inUse: false });
    expect(detail.body.data.pitBrackets).toHaveLength(7);
  });

  it("A2 — DENY: không cặp ⇒ 403 · view-only ⇒ 403 trên 056/058 · Department ⇒ 403; ALLOW song sinh view-only đọc 057", async () => {
    expect((await call("get", tNone, "/payroll/statutory-rates")).status).toBe(403);
    expect(
      (
        await call("post", tView, "/payroll/statutory-rates").send(
          rateBody({ effectiveFrom: "2030-01-01" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await call("patch", tView, `/payroll/statutory-rates/${seedRateA}`).send({ note: "x" }))
        .status,
    ).toBe(403);
    expect((await call("get", tDept, "/payroll/statutory-rates")).status).toBe(403);
    expect((await call("get", tView, `/payroll/statutory-rates/${seedRateA}`)).status).toBe(200);
  });

  it("A3 — cross-tenant ⇒ 404 PAYROLL-ERR-010 trên 057/058, hàng tenant B không bị đụng", async () => {
    const g = await call("get", tFull, `/payroll/statutory-rates/${seedRateB}`);
    expect(g.status).toBe(404);
    expect(g.body.error.code).toBe("PAYROLL-ERR-010");
    expect(
      (await call("patch", tFull, `/payroll/statutory-rates/${seedRateB}`).send({ note: "doi" }))
        .status,
    ).toBe(404);
  });

  // ── B ────────────────────────────────────────────────────────────────────────────────────────
  it("B1 — 056 tạo ⇒ 201 `{id}`; trùng ngày hiệu lực ⇒ 409 PAYROLL-ERR-033 `rate-effective-date-exists` (UNIQUE THẬT)", async () => {
    const res = await call("post", tFull, "/payroll/statutory-rates").send(rateBody());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(Object.keys(res.body.data)).toEqual(["id"]);
    rateJan = res.body.data.id;
    const dup = await call("post", tFull, "/payroll/statutory-rates").send(rateBody());
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
    expect(dup.body.error.code).toBe("PAYROLL-ERR-033");
    expect(kindOf(dup)).toBe("rate-effective-date-exists");
  });

  it.each([
    ["6 bậc", BRACKETS.slice(1), "count"],
    ["8 bậc", [{ upTo: 1000000, rate: 1 }, ...BRACKETS], "count"],
    [
      "chồng — upTo không tăng",
      BRACKETS.map((b, i) => (i === 1 ? { ...b, upTo: 5000000 } : b)),
      "not-increasing",
    ],
    [
      "hở — bậc giữa để trống upTo",
      BRACKETS.map((b, i) => (i === 3 ? { ...b, upTo: null } : b)),
      "open-not-last",
    ],
    [
      "bậc cuối có upTo",
      BRACKETS.map((b, i) => (i === 6 ? { ...b, upTo: 999999999 } : b)),
      "last-not-open",
    ],
    ["thuế suất > 100", BRACKETS.map((b, i) => (i === 2 ? { ...b, rate: 150 } : b)), "rate-range"],
  ])(
    "B2 — 056 bậc TNCN %s ⇒ 422 PAYROLL-ERR-022 `statutory-rate-incomplete` reason=%s",
    async (_label, pitBrackets, reason) => {
      const res = await call("post", tFull, "/payroll/statutory-rates").send(
        rateBody({ effectiveFrom: "2035-01-01", pitBrackets }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.code).toBe("PAYROLL-ERR-022");
      expect(kindOf(res)).toBe("statutory-rate-incomplete");
      expect(detailOf(res, "reason")).toBe(reason);
    },
  );

  // ── C ────────────────────────────────────────────────────────────────────────────────────────
  it("C1 — ĐỐI CHỨNG: chỉ có kỳ Draft ⇒ bản CHƯA «đang dùng» ⇒ 058 sửa được (200)", async () => {
    await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status) VALUES ($1, '2026-10', 'Draft')`,
      [A.companyId],
    );
    const res = await call("patch", tFull, `/payroll/statutory-rates/${rateJan}`).send({
      note: "sửa khi chưa dùng",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("C2 — 🔴 có kỳ ≥ Calculated sau ngày hiệu lực ⇒ 058 ⇒ 409 PAYROLL-ERR-033 `rate-in-use`; 057 báo inUse=true", async () => {
    const att = await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1, '2026-09', 'locked') RETURNING id`,
      [A.companyId],
    );
    await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id) VALUES ($1, '2026-09', 'Calculated', $2)`,
      [A.companyId, att.rows[0].id],
    );
    const res = await call("patch", tFull, `/payroll/statutory-rates/${rateJan}`).send({
      siEmployeePct: 9,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe("PAYROLL-ERR-033");
    expect(kindOf(res)).toBe("rate-in-use");
    expect((await call("get", tFull, `/payroll/statutory-rates/${rateJan}`)).body.data.inUse).toBe(
      true,
    );
    // Bản seed 2024-07-01 cũng rơi vào kỳ 2026-09 ⇒ cũng khoá.
    expect(
      (await call("patch", tFull, `/payroll/statutory-rates/${seedRateA}`).send({ note: "x" }))
        .status,
    ).toBe(409);
  });

  it("C3 — 🔴 MF13: chèn bản R2 xen giữa (2026-06-01) KHÔNG gỡ được khoá của R; R2 cũng «đang dùng»", async () => {
    const r2 = await createRate("2026-06-01");
    expect(
      (await call("patch", tFull, `/payroll/statutory-rates/${rateJan}`).send({ siEmployeePct: 9 }))
        .status,
    ).toBe(409);
    const own = await call("patch", tFull, `/payroll/statutory-rates/${r2}`).send({ note: "x" });
    expect(own.status).toBe(409);
    expect(kindOf(own)).toBe("rate-in-use");
  });

  it("C4 — bản tương lai (2027-01-01) sửa được; kéo ngày hiệu lực về trước kỳ đã tính ⇒ 409 (kiểm với ngày SỚM hơn); 055 inUse khớp từng bản", async () => {
    const future = await createRate("2027-01-01");
    expect(
      (
        await call("patch", tFull, `/payroll/statutory-rates/${future}`).send({
          note: "sửa bản tương lai",
        })
      ).status,
    ).toBe(200);
    const moved = await call("patch", tFull, `/payroll/statutory-rates/${future}`).send({
      effectiveFrom: "2026-05-01",
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(409);
    expect(kindOf(moved)).toBe("rate-in-use");

    const list = await call("get", tFull, "/payroll/statutory-rates");
    const byDate = Object.fromEntries(
      list.body.data.map((r: { effectiveFrom: string; inUse: boolean }) => [
        r.effectiveFrom,
        r.inUse,
      ]),
    );
    expect(byDate).toMatchObject({
      "2027-01-01": false,
      "2026-06-01": true,
      "2026-01-01": true,
      "2024-07-01": true,
    });
  });

  it("C5 — 058 bậc TNCN hỏng trên bản chưa dùng ⇒ 422 022 (đường PATCH, không chỉ POST)", async () => {
    const free = await createRate("2028-01-01");
    const res = await call("patch", tFull, `/payroll/statutory-rates/${free}`).send({
      pitBrackets: BRACKETS.slice(0, 6),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("PAYROLL-ERR-022");
  });

  // ── D ────────────────────────────────────────────────────────────────────────────────────────
  it("D1 — audit 056/058 KHÔNG chở số tiền/tỉ lệ (MF14) — chỉ ngày hiệu lực + TÊN trường đổi", async () => {
    const id = await createRate("2029-01-01");
    expect(
      (
        await call("patch", tFull, `/payroll/statutory-rates/${id}`).send({
          personalDeduction: 12345678,
        })
      ).status,
    ).toBe(200);
    const rows = await direct.query(
      `SELECT action, before, after FROM audit_logs WHERE company_id = $1 AND object_type = 'payroll_statutory_rate' AND object_id = $2
        ORDER BY created_at`,
      [A.companyId, id],
    );
    expect(rows.rows.map((r) => r.action)).toEqual(["create", "update"]);
    expect(rows.rows[0].after).toEqual({ effectiveFrom: "2029-01-01" });
    expect(rows.rows[1].after).toMatchObject({
      effectiveFrom: "2029-01-01",
      changedFields: ["personalDeduction"],
    });
    const text = JSON.stringify(rows.rows);
    expect(text).not.toContain("12345678");
    expect(text).not.toContain("46800000");
  });
});
