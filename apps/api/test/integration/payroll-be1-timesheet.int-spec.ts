/**
 * S15-PAYROLL-BE-1 — `PAYROLL-API-043`: bảng công tổng hợp kỳ.
 *
 *   A. ALLOW/DENY theo cặp `view-line:payroll-period` + sàn scope + 404 cross-tenant.
 *   B. 🔴 **KHÔNG SỐ TIỀN** — dù cặp gác là cặp CHỞ TIỀN ở route khác (008/018).
 *   C. 🔴 **B5 — pagination THẬT** và **nhân sự 0 công 0 phép KHÔNG được biến mất**
 *      (CTE `people` của `computeInputsTx` là `att ∪ lv`; bảng công thiếu người = người đó không được
 *      trả lương mà không ai nhìn thấy).
 *   D. Audit §18.1 B hàng 5: `payroll_period` / `payrollPeriodId` / `{rowCount}` = TỔNG hàng của kỳ.
 *
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import type { DataScope } from "@mediaos/contracts";
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
const LOGIN_PW = "Passw0rd!s15be1ts";
const PERIOD_MONTH = "2027-05";

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-1 — 043 bảng công tổng hợp kỳ", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tLine = ""; // view-line:payroll-period @Company ⇒ 200
  let tScopeDept = ""; // cùng cặp, scope Department ⇒ 403 (sàn Company)
  let tNoPair = ""; // chỉ view:payroll-period ⇒ 403
  let periodId = "";
  let otherPeriodId = "";
  const workers: string[] = [];
  let idleUserId = "";

  const http = () => request(app.getHttpServer());
  const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);

  async function grant(
    userId: string,
    label: string,
    pairs: Array<[string, string, DataScope?]>,
  ) {
    const roleId = await seedRole(
      direct,
      A.companyId,
      `s15ts-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const [action, resource, scope] of pairs) {
      const permId = await seedPermissionCatalog(
        direct,
        action,
        resource,
        resource === "payroll-period" && action === "view" ? false : true,
      );
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope ?? "Company");
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
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
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s15tsa");
    B = await seedCompany(direct, "s15tsb");
    companyIds.push(A.companyId, B.companyId);

    // 3 nhân sự CÓ bản ghi công + 1 nhân sự KHÔNG có gì (ca C2).
    for (let i = 0; i < 3; i++) {
      const uid = await seedUser(direct, A.companyId, `w${i}@${A.slug}.test`, hash);
      workers.push(uid);
      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, work_date, status)
         VALUES ($1,$2,$3,'present')`,
        [A.companyId, uid, `${PERIOD_MONTH}-04`],
      );
    }
    idleUserId = await seedUser(direct, A.companyId, `idle@${A.slug}.test`, hash);

    const mkPeriod = async (companyId: string, month: string) => {
      const ap = await direct.query(
        `INSERT INTO attendance_periods (company_id, period_month, status)
         VALUES ($1,$2,'locked') RETURNING id`,
        [companyId, month],
      );
      const p = await direct.query(
        `INSERT INTO payroll_periods (company_id, period_month, attendance_period_id, status)
         VALUES ($1,$2,$3,'CollectingData') RETURNING id`,
        [companyId, month, ap.rows[0].id],
      );
      return p.rows[0].id as string;
    };
    periodId = await mkPeriod(A.companyId, PERIOD_MONTH);
    otherPeriodId = await mkPeriod(B.companyId, PERIOD_MONTH);

    const mk = async (label: string, pairs: Array<[string, string, DataScope?]>) => {
      const email = `${label}@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      await grant(uid, label, pairs);
      return login(A.slug, email);
    };
    tLine = await mk("line", [["view-line", "payroll-period"]]);
    tScopeDept = await mk("linedept", [["view-line", "payroll-period", "Department"]]);
    tNoPair = await mk("nopair", [["view", "payroll-period"]]);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
  });

  // ── A. ALLOW / DENY ───────────────────────────────────────────────────────────────────────────
  it("A1 — có `view-line:payroll-period`@Company ⇒ 200 + có hàng", async () => {
    const res = await get(tLine, `/payroll-periods/${periodId}/timesheet?per_page=100`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty("workDays");
    expect(res.body.data[0]).toHaveProperty("presentDays");
  });

  it("A2 — thiếu cặp ⇒ 403; scope Department (CÓ cặp) ⇒ 403 vì SÀN Company", async () => {
    expect((await get(tNoPair, `/payroll-periods/${periodId}/timesheet`)).status).toBe(403);
    expect((await get(tScopeDept, `/payroll-periods/${periodId}/timesheet`)).status).toBe(403);
  });

  it("A3 — kỳ của tenant KHÁC ⇒ 404 PAYROLL-ERR-010 (không 403)", async () => {
    const res = await get(tLine, `/payroll-periods/${otherPeriodId}/timesheet`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYROLL-ERR-010");
  });

  it("A4 — `:id` không phải UUID ⇒ 400 (ParseUUIDPipe ở biên)", async () => {
    expect((await get(tLine, "/payroll-periods/khong-phai-uuid/timesheet")).status).toBe(400);
  });

  // ── B. KHÔNG số tiền ──────────────────────────────────────────────────────────────────────────
  it("B1 — payload 043 KHÔNG chứa khoá tiền nào (dù cặp gác là cặp chở-tiền ở route khác)", async () => {
    const res = await get(tLine, `/payroll-periods/${periodId}/timesheet?per_page=100`);
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body.data);
    for (const k of ["gross", "net", "baseSalary", "amount", "allowance", "salary"]) {
      expect(json, `043 rò khoá tiền '${k}'`).not.toContain(k);
    }
  });

  // ── C. 🔴 B5 — pagination + nhân sự 0 dữ liệu ─────────────────────────────────────────────────
  /**
   * `computeInputsTx` chỉ trả hàng cho người CÓ công/phép (CTE `people` = `att ∪ lv`). 043 union thêm
   * `aliveUserIdsTx` để người 0 công vẫn hiện hàng 0 ngày — thiếu vế đó thì người đó **không được trả
   * lương mà không ai nhìn thấy**.
   */
  it("C1 — nhân sự 0 công 0 phép VẪN hiện hàng với số 0 (không biến mất)", async () => {
    const res = await get(tLine, `/payroll-periods/${periodId}/timesheet?per_page=100`);
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { userId: string }) => r.userId === idleUserId);
    expect(row, "nhân sự KHÔNG có bản ghi công đã biến mất khỏi bảng công").toBeTruthy();
    expect(row.presentDays).toBe(0);
    expect(row.paidLeaveDays).toBe(0);
    expect(row.unpaidLeaveDays).toBe(0);
    // ĐỐI CHỨNG DƯƠNG: người CÓ công thì `presentDays` > 0 ⇒ ca trên không xanh vì "mọi số đều 0".
    const worker = res.body.data.find((r: { userId: string }) => r.userId === workers[0]);
    expect(worker.presentDays).toBeGreaterThan(0);
  });

  it("C2 — pagination THẬT: trang 2 khác trang 1, `total` = tổng hàng của KỲ", async () => {
    const all = await get(tLine, `/payroll-periods/${periodId}/timesheet?per_page=100`);
    const total = all.body.pagination.total as number;
    expect(total, "fixture phải có ≥3 hàng để chia trang có nghĩa").toBeGreaterThanOrEqual(3);

    const p1 = await get(tLine, `/payroll-periods/${periodId}/timesheet?per_page=2&page=1`);
    const p2 = await get(tLine, `/payroll-periods/${periodId}/timesheet?per_page=2&page=2`);
    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.pagination.total, "`total` phải là TỔNG kỳ, không phải số hàng của trang").toBe(
      total,
    );
    expect(p2.body.pagination.total).toBe(total);

    const ids1 = p1.body.data.map((r: { userId: string }) => r.userId);
    const ids2 = p2.body.data.map((r: { userId: string }) => r.userId);
    expect(
      ids1.some((i: string) => ids2.includes(i)),
      "trang 2 lặp người của trang 1",
    ).toBe(false);

    // Thứ tự ỔN ĐỊNH: gọi lại trang 1 cho CÙNG tập (planner không được đổi lát cắt).
    const p1again = await get(tLine, `/payroll-periods/${periodId}/timesheet?per_page=2&page=1`);
    expect(p1again.body.data.map((r: { userId: string }) => r.userId)).toEqual(ids1);
  });

  // ── D. Audit ──────────────────────────────────────────────────────────────────────────────────
  it("D1 — audit neo `payroll_period`/`periodId`, `rowCount` = TỔNG kỳ (không phải hàng của trang)", async () => {
    const all = await get(tLine, `/payroll-periods/${periodId}/timesheet?per_page=100`);
    const total = all.body.pagination.total as number;
    await get(tLine, `/payroll-periods/${periodId}/timesheet?per_page=1&page=1`);
    const r = await direct.query(
      `SELECT object_type, object_id, after FROM audit_logs
        WHERE company_id = $1 AND object_type = 'payroll_period' AND action = 'read'
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    expect(r.rowCount, "043 phải để lại vết đọc").toBe(1);
    expect(r.rows[0].object_id).toBe(periodId);
    expect(r.rows[0].after).toMatchObject({ rowCount: total });
  });
});
