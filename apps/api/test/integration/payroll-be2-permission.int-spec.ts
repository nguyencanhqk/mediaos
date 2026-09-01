/**
 * S13-PAYROLL-BE-2 — MA TRẬN QUYỀN cho 17 route mới (SPEC-11 §11.1 · §13.5 · §18 · §20.18).
 *
 * Luật của file này:
 *  · **Mỗi ca DENY đi CẶP với ca ALLOW.** Một role thiếu ĐÚNG MỘT cặp phải 403; role đủ cặp phải
 *    KHÁC 403 trên CÙNG route. Thiếu vế ALLOW thì một guard luôn-403 (hoặc một route gõ sai path)
 *    cũng làm cả file xanh (`deny-cases-vacuous-without-allow-case`).
 *  · **Chủ thể là role DỰNG TRONG TEST**, không mượn role canonical — trừ đúng ca `hr-manager`, nơi
 *    điều cần chứng minh CHÍNH LÀ role canonical đó giữ 0 cặp PAYROLL sau đợt thu hồi của DB-1.
 *  · **SÀN SCOPE Company** (§13.5): grant hẹp hơn phải 403, KHÔNG được "coi như" Company.
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

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!payrollperm";

const SENSITIVE = new Set([
  "view-line:payroll-period",
  "calculate:payroll-period",
  "approve:payroll-period",
  "publish:payroll-period",
  "reopen:payroll-period",
  "view:salary-profile",
  "manage:salary-profile",
  "export:payroll",
  "view-payslip:payslip",
  "view-own-payslip:payslip",
]);
const OWN_SCOPE = new Set([
  "access:payroll",
  "view-own-payslip:payslip",
  "acknowledge-own-payslip:payslip",
]);

/** Toàn bộ cặp cần để CHẠY được 17 route BE-2 (+ vài cặp nền để dựng dữ liệu). */
const ALL_PAIRS: Array<[string, string]> = [
  ["access", "payroll"],
  ["view", "payroll-period"],
  ["manage", "payroll-period"],
  ["view-line", "payroll-period"],
  ["calculate", "payroll-period"],
  ["approve", "payroll-period"],
  ["publish", "payroll-period"],
  ["reopen", "payroll-period"],
  ["export", "payroll"],
  ["view", "salary-profile"],
  ["manage", "salary-profile"],
  ["view-payslip", "payslip"],
  ["view-own-payslip", "payslip"],
  ["acknowledge-own-payslip", "payslip"],
];

type Call = { method: "get" | "post" | "patch"; path: (ctx: Ctx) => string; body?: object };
interface Ctx {
  periodId: string;
  lineId: string;
  payslipId: string;
}

/**
 * 17 route BE-2 → cặp quyền GÁC nó. Nguồn: `PAYROLL_ROUTE_PAIRS` (bảng hằng), chép tay ở đây **có
 * chủ đích**: import lại chính nguồn sự thật là tautology — census 2 tầng đã so decorator/service với
 * bảng hằng rồi; file này đo hành vi HTTP THẬT.
 */
const ROUTES: Array<{ code: string; pair: string; call: Call }> = [
  {
    code: "007 calculate",
    pair: "calculate:payroll-period",
    call: { method: "post", path: (c) => `/payroll-periods/${c.periodId}/calculate` },
  },
  {
    code: "008 lines",
    pair: "view-line:payroll-period",
    call: { method: "get", path: (c) => `/payroll-periods/${c.periodId}/lines` },
  },
  {
    code: "009 adjust-line",
    pair: "calculate:payroll-period",
    call: {
      method: "patch",
      path: (c) => `/payroll-periods/${c.periodId}/lines/${c.lineId}`,
      body: { adjustmentAmount: 0 },
    },
  },
  {
    code: "010 submit",
    pair: "calculate:payroll-period",
    call: { method: "post", path: (c) => `/payroll-periods/${c.periodId}/submit` },
  },
  {
    code: "011 approve",
    pair: "approve:payroll-period",
    call: { method: "post", path: (c) => `/payroll-periods/${c.periodId}/approve` },
  },
  {
    code: "012 reject",
    pair: "approve:payroll-period",
    call: {
      method: "post",
      path: (c) => `/payroll-periods/${c.periodId}/reject`,
      body: { reason: "x" },
    },
  },
  {
    code: "013 generate",
    pair: "publish:payroll-period",
    call: { method: "post", path: (c) => `/payroll-periods/${c.periodId}/generate-payslips` },
  },
  {
    code: "014 publish",
    pair: "publish:payroll-period",
    call: { method: "post", path: (c) => `/payroll-periods/${c.periodId}/publish` },
  },
  {
    code: "015 lock",
    pair: "manage:payroll-period",
    call: { method: "post", path: (c) => `/payroll-periods/${c.periodId}/lock` },
  },
  {
    code: "016 reopen",
    pair: "reopen:payroll-period",
    call: {
      method: "post",
      path: (c) => `/payroll-periods/${c.periodId}/reopen`,
      body: { reason: "x" },
    },
  },
  {
    code: "017 export",
    pair: "export:payroll",
    call: { method: "get", path: (c) => `/payroll-periods/${c.periodId}/export` },
  },
  {
    code: "018 summary",
    pair: "view-line:payroll-period",
    call: { method: "get", path: () => `/payroll-periods/summary` },
  },
  {
    code: "029 payslip list",
    pair: "view-payslip:payslip",
    call: { method: "get", path: () => `/payslips` },
  },
  {
    code: "030 payslip detail",
    pair: "view-payslip:payslip",
    call: { method: "get", path: (c) => `/payslips/${c.payslipId}` },
  },
  {
    code: "031 me list",
    pair: "view-own-payslip:payslip",
    call: { method: "get", path: () => `/me/payslips` },
  },
  {
    code: "032 me detail",
    pair: "view-own-payslip:payslip",
    call: { method: "get", path: (c) => `/me/payslips/${c.payslipId}` },
  },
  {
    code: "033 me ack",
    pair: "acknowledge-own-payslip:payslip",
    call: { method: "post", path: (c) => `/me/payslips/${c.payslipId}/acknowledge`, body: {} },
  },
];

describe.skipIf(!hasLaneDb)("S13-PAYROLL-BE-2 ma trận quyền 17 route", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let ctx: Ctx;
  /** Token của role ĐỦ cặp — vế ALLOW đối chứng cho mọi ca DENY. */
  let tFull = "";
  /** `pair → token của role thiếu ĐÚNG cặp đó`. */
  const tMissing = new Map<string, string>();
  let tHrManager = "";
  let tNarrowScope = "";

  const http = () => request(app.getHttpServer());
  const send = (t: string, call: Call) => {
    const r = http()[call.method](call.path(ctx)).set("Authorization", `Bearer ${t}`);
    return call.body ? r.send(call.body) : r;
  };

  async function makeUser(
    label: string,
    pairs: Array<[string, string]>,
    scopeOverride?: Map<string, string>,
  ): Promise<string> {
    const hash = await new PasswordService().hash(LOGIN_PW);
    const email = `${label}@${A.slug}.test`;
    const uid = await seedUser(direct, A.companyId, email, hash);
    const roleId = await seedRole(
      direct,
      A.companyId,
      `payperm-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const [action, resource] of pairs) {
      const key = `${action}:${resource}`;
      const permId = await seedPermissionCatalog(direct, action, resource, SENSITIVE.has(key));
      const scope = scopeOverride?.get(key) ?? (OWN_SCOPE.has(key) ? "Own" : "Company");
      await seedRolePermission(
        direct,
        roleId,
        permId,
        "ALLOW",
        scope as "Own" | "Team" | "Department" | "Company" | "System",
      );
    }
    await seedUserRole(direct, uid, roleId, A.companyId);
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    A = await seedCompany(direct, "payperm");
    companyIds.push(A.companyId);
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      A.companyId,
      JSON.stringify({ days: [1, 2, 3, 4, 5] }),
    ]);

    tFull = await makeUser("full", ALL_PAIRS);
    for (const pair of new Set(ROUTES.map((r) => r.pair))) {
      const [action, resource] = pair.split(":");
      tMissing.set(
        pair,
        await makeUser(
          `no-${action}-${resource}`.replace(/[^a-z0-9-]/g, ""),
          ALL_PAIRS.filter(([a, r]) => `${a}:${r}` !== pair),
        ),
      );
    }

    // `hr-manager` CANONICAL (seed toàn cục) — sau đợt thu hồi của S13-PAYROLL-DB-1 nó giữ 0 cặp
    // PAYROLL. Ca này neo điều đó bằng HÀNH VI HTTP, không bằng đếm hàng bảng.
    {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `hrm@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      const r = await direct.query<{ id: string }>(
        `SELECT id FROM roles WHERE name = 'hr-manager' AND company_id IS NULL AND deleted_at IS NULL LIMIT 1`,
      );
      expect(r.rows.length, "seed canonical phải có role hr-manager").toBe(1);
      await seedUserRole(direct, uid, r.rows[0].id, A.companyId);
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status).toBe(200);
      tHrManager = res.body.data.accessToken as string;
    }

    // Cùng bộ cặp như `full` nhưng `view-line` ở scope Department ⇒ phải 403 (SÀN Company).
    tNarrowScope = await makeUser(
      "narrowscope",
      ALL_PAIRS,
      new Map([["view-line:payroll-period", "Department"]]),
    );

    // ── Dữ liệu để mọi route có id THẬT (403 phải đến từ QUYỀN, không phải 404/400) ──
    const subject = await seedUser(direct, A.companyId, `subj@${A.slug}.test`, "x");
    await direct.query(
      `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances)
       VALUES ($1,$2,'2028-01-01','10000000.00','[]'::jsonb)`,
      [A.companyId, subject],
    );
    const ap = await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,'2028-06','locked') RETURNING id`,
      [A.companyId],
    );
    const p = await http()
      .post("/payroll-periods")
      .set("Authorization", `Bearer ${tFull}`)
      .send({ periodMonth: "2028-06", attendancePeriodId: ap.rows[0].id as string });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const periodId = p.body.data.id as string;
    const authFull = (r: request.Test) => r.set("Authorization", `Bearer ${tFull}`);
    expect((await authFull(http().post(`/payroll-periods/${periodId}/collect`))).status).toBe(201);
    expect((await authFull(http().post(`/payroll-periods/${periodId}/calculate`))).status).toBe(
      201,
    );
    const lines = await authFull(http().get(`/payroll-periods/${periodId}/lines`));
    expect(lines.status).toBe(200);
    const lineId = (lines.body.data as Array<{ id: string }>)[0].id;

    // Một phiếu lương THẬT (kỳ đưa tới `Paid`) cho các route 029–033. `full` tự submit không duyệt
    // được (four-eyes) nên đẩy trạng thái + vết duyệt bằng SQL với HAI actor khác nhau.
    const other = await seedUser(direct, A.companyId, `approver2@${A.slug}.test`, "x");
    // ⚠️ `submitted_by` PHẢI khác `approved_by`: CHECK `payroll_periods_four_eyes_check` sống ở DB và
    // khoá cả FIXTURE, không chỉ khoá đường API (`db-invariant-kills-adversarial-fixtures`). Dùng hai
    // user ĐÃ BIẾT thay vì suy id của actor từ `/me` — hình dạng envelope `/me` không phải thứ file
    // này đo, và đoán sai làm cả suite chết ở `beforeAll`.
    await direct.query(
      `UPDATE payroll_periods SET status='Approved', submitted_by=$2, submitted_at=now(),
         approved_by=$3, approved_at=now() WHERE id=$1`,
      [periodId, subject, other],
    );
    expect(
      (await authFull(http().post(`/payroll-periods/${periodId}/generate-payslips`))).status,
    ).toBe(201);
    expect((await authFull(http().post(`/payroll-periods/${periodId}/publish`))).status).toBe(201);
    const payslips = await authFull(http().get(`/payslips?payrollPeriodId=${periodId}`));
    expect(payslips.status).toBe(200);
    ctx = {
      periodId,
      lineId,
      payslipId: (payslips.body.data as Array<{ id: string }>)[0].id,
    };
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
  });

  it.each(ROUTES)("$code — THIẾU cặp `$pair` ⇒ 403", async ({ pair, call }) => {
    const res = await send(tMissing.get(pair)!, call);
    expect(
      res.status,
      `${call.method.toUpperCase()} ${call.path(ctx)}: ${JSON.stringify(res.body)}`,
    ).toBe(403);
  });

  it.each(ROUTES)("$code — ĐỐI CHỨNG ALLOW: role ĐỦ cặp KHÔNG bị 403", async ({ call }) => {
    // Không assert 200: nhiều route trả 409 vì FSM (kỳ đang `Paid`). Điều cần chứng minh là guard
    // KHÔNG chặn — thiếu vế này thì mọi ca DENY ở trên xanh-RỖNG.
    const res = await send(tFull, call);
    expect(
      res.status,
      `${call.method.toUpperCase()} ${call.path(ctx)}: ${JSON.stringify(res.body)}`,
    ).not.toBe(403);
  });

  it.each(ROUTES)(
    "$code — `hr-manager` canonical ⇒ 403 (0 cặp PAYROLL sau thu hồi DB-1)",
    async ({ call }) => {
      const res = await send(tHrManager, call);
      expect(res.status, `${call.method.toUpperCase()} ${call.path(ctx)}`).toBe(403);
    },
  );

  it("SÀN SCOPE: `view-line` ở scope Department ⇒ 403 trên `/lines` và `/summary`", async () => {
    // Grant hẹp hơn KHÔNG được "coi như" Company — một lần đổi `data_scope` per-pair sẽ âm thầm nới
    // quyền đọc bảng lương toàn công ty (`dash-widget-gate-needs-scope-floor`).
    for (const path of [`/payroll-periods/${ctx.periodId}/lines`, `/payroll-periods/summary`]) {
      const res = await http().get(path).set("Authorization", `Bearer ${tNarrowScope}`);
      expect(res.status, path).toBe(403);
    }
    // ĐỐI CHỨNG: cùng hai route, scope Company ⇒ KHÔNG 403.
    for (const path of [`/payroll-periods/${ctx.periodId}/lines`, `/payroll-periods/summary`]) {
      const res = await http().get(path).set("Authorization", `Bearer ${tFull}`);
      expect(res.status, path).not.toBe(403);
    }
  });

  it("§20.18 — cặp ĐỌC dòng TÁCH khỏi cặp GHI: `view-line` không cho `calculate`, và ngược lại", async () => {
    const tReader = await makeUser("readeronly", [
      ["access", "payroll"],
      ["view", "payroll-period"],
      ["view-line", "payroll-period"],
      ["approve", "payroll-period"],
    ]);
    expect(
      (
        await http()
          .get(`/payroll-periods/${ctx.periodId}/lines`)
          .set("Authorization", `Bearer ${tReader}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await http()
          .post(`/payroll-periods/${ctx.periodId}/calculate`)
          .set("Authorization", `Bearer ${tReader}`)
      ).status,
    ).toBe(403);

    const tWriter = await makeUser("writeronly", [
      ["access", "payroll"],
      ["view", "payroll-period"],
      ["calculate", "payroll-period"],
    ]);
    // Người chỉ có `calculate` KHÔNG đọc được dòng (cửa sau đọc tiền) và KHÔNG duyệt được.
    expect(
      (
        await http()
          .get(`/payroll-periods/${ctx.periodId}/lines`)
          .set("Authorization", `Bearer ${tWriter}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .post(`/payroll-periods/${ctx.periodId}/approve`)
          .set("Authorization", `Bearer ${tWriter}`)
      ).status,
    ).toBe(403);
  });

  it("017 export — thiếu `view-line` (dù CÓ `export:payroll`) ⇒ 403 (hai cặp, SPEC-11 §18)", async () => {
    const tExportOnly = await makeUser("exportonly", [
      ["access", "payroll"],
      ["view", "payroll-period"],
      ["export", "payroll"],
    ]);
    const res = await http()
      .get(`/payroll-periods/${ctx.periodId}/export`)
      .set("Authorization", `Bearer ${tExportOnly}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    // ĐỐI CHỨNG: đủ CẢ HAI ⇒ 200 + đúng content-type XLSX.
    const ok = await http()
      .get(`/payroll-periods/${ctx.periodId}/export`)
      .set("Authorization", `Bearer ${tFull}`);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toContain("spreadsheetml");
  });
});
