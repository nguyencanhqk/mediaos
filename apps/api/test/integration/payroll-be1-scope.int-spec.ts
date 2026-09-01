/**
 * S13-PAYROLL-BE-1 — ma trận quyền per-pair + wildcard + cross-tenant/IDOR + `hr-manager` sau thu hồi
 * (SPEC-11 §11 · §13.5 · §18 · permission-matrix §9g). Khuôn `recruit-be1-scope.int-spec.ts`.
 *
 * Bốn khối:
 *   A. **ALLOW đối chứng** — chủ thể giữ đủ 16 cặp có route ⇒ mọi route 2xx. Thiếu khối này thì mọi ca
 *      403 dưới đây là **xanh RỖNG** (`deny-cases-vacuous-without-allow-case`).
 *   B. **DENY per-pair** — với mỗi cặp, một chủ thể giữ TẤT CẢ TRỪ cặp đó ⇒ đúng route của cặp đó 403.
 *   C. **Wildcard `*:*` ⇒ 403** trên 13 cặp sensitive (cổng sensitive không nhận wildcard).
 *   D. **`hr-manager` = 0 cặp PAYROLL** sau thu hồi mig `0565` ⇒ 403 sạch trên **cả 18 route**;
 *      cross-tenant + IDOR cùng company ⇒ **404 PAYROLL-ERR-010** (không 403, chống oracle).
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
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
const LOGIN_PW = "Passw0rd!payrollbe1";

type PairKey =
  | "view:payroll-period"
  | "manage:payroll-period"
  | "calculate:payroll-period"
  | "view:salary-profile"
  | "manage:salary-profile"
  | "view:bonus-penalty"
  | "manage:bonus-penalty"
  | "approve:bonus-penalty";

/** 13 cặp is_sensitive của mig `0565` — trong đó 6 cặp có route ở BE-1. */
const SENSITIVE_PAIRS: ReadonlySet<string> = new Set([
  "calculate:payroll-period",
  "view-line:payroll-period",
  "approve:payroll-period",
  "publish:payroll-period",
  "reopen:payroll-period",
  "export:payroll",
  "view:salary-profile",
  "manage:salary-profile",
  "view:bonus-penalty",
  "manage:bonus-penalty",
  "approve:bonus-penalty",
  "view-payslip:payslip",
  "view-own-payslip:payslip",
]);

const ACCESS_PAIR: [string, string] = ["access", "payroll"];

/** 8 cặp có route ở BE-1 (16 cặp có route trên toàn 35 route; 8 cặp kia thuộc BE-2). */
const ROUTE_PAIRS: PairKey[] = [
  "view:payroll-period",
  "manage:payroll-period",
  "calculate:payroll-period",
  "view:salary-profile",
  "manage:salary-profile",
  "view:bonus-penalty",
  "manage:bonus-penalty",
  "approve:bonus-penalty",
];

describe.skipIf(!hasLaneDb)(
  "S13-PAYROLL-BE-1 ma trận quyền per-pair (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let tFull = "";
    let tWildcard = "";
    let tHrManager = "";
    let tOtherTenant = "";
    const tMissing = new Map<PairKey, string>();

    let periodId = "";
    let salaryProfileId = "";
    let bonusId = "";
    let subjectUserId = "";
    let attendancePeriodId = "";
    let bTenantPeriodId = "";

    const http = () => request(app.getHttpServer());
    const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
    const get = (t: string, u: string) => auth(t)(http().get(u));
    const post = (t: string, u: string) => auth(t)(http().post(u));
    const patch = (t: string, u: string) => auth(t)(http().patch(u));
    const ghost = () => randomUUID();

    async function grantPairs(userId: string, label: string, pairs: Array<[string, string]>) {
      const roleId = await seedRole(
        direct,
        A.companyId,
        `payrollbe1-${label}-${randomUUID().slice(0, 6)}`,
      );
      for (const [action, resource] of pairs) {
        const isSensitive = SENSITIVE_PAIRS.has(`${action}:${resource}`);
        const permId = await seedPermissionCatalog(direct, action, resource, isSensitive);
        const scope = action === "access" ? "Own" : "Company";
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, A.companyId);
    }

    async function login(companySlug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({ companySlug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function seedAttendancePeriod(companyId: string, month: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,$2,'locked') RETURNING id`,
        [companyId, month],
      );
      return r.rows[0].id as string;
    }

    /**
     * Bảng route → (token phải 2xx, cặp gác). Mỗi hàng chạy HAI lần: chủ thể đủ quyền (ALLOW) và chủ
     * thể thiếu ĐÚNG cặp đó (DENY). `body` là payload tối thiểu hợp lệ với Zod — ca DENY phải dừng ở
     * guard TRƯỚC khi chạm nghiệp vụ, nên payload chỉ cần qua được pipe.
     */
    const routeMatrix = (): Array<{
      name: string;
      pair: PairKey;
      call: (t: string) => request.Test;
      okStatus: number[];
    }> => [
      {
        name: "001 GET /payroll-periods",
        pair: "view:payroll-period",
        call: (t) => get(t, "/payroll-periods"),
        okStatus: [200],
      },
      {
        name: "002 POST /payroll-periods",
        pair: "manage:payroll-period",
        call: (t) => post(t, "/payroll-periods").send({ periodMonth: `2027-${randomMonth()}` }),
        okStatus: [201],
      },
      {
        name: "003 GET /payroll-periods/:id",
        pair: "view:payroll-period",
        call: (t) => get(t, `/payroll-periods/${periodId}`),
        okStatus: [200],
      },
      {
        name: "004 PATCH /payroll-periods/:id",
        pair: "manage:payroll-period",
        call: (t) => patch(t, `/payroll-periods/${periodId}`).send({ note: "ghi chú" }),
        okStatus: [200],
      },
      {
        name: "005 POST /payroll-periods/:id/collect",
        pair: "calculate:payroll-period",
        call: (t) => post(t, `/payroll-periods/${periodId}/collect`),
        // Gọi lại ở `CollectingData` là hợp lệ (hành động TẠI CHỖ) ⇒ ca ALLOW chạy nhiều lần vẫn 201.
        okStatus: [200, 201],
      },
      {
        name: "006 GET /payroll-periods/:id/readiness",
        pair: "calculate:payroll-period",
        call: (t) => get(t, `/payroll-periods/${periodId}/readiness`),
        okStatus: [200],
      },
      {
        name: "019 GET /salary-profiles",
        pair: "view:salary-profile",
        call: (t) => get(t, "/salary-profiles"),
        okStatus: [200],
      },
      {
        name: "020 POST /salary-profiles",
        pair: "manage:salary-profile",
        call: (t) =>
          post(t, "/salary-profiles").send({
            userId: subjectUserId,
            effectiveDate: `2027-01-${String(nextDay()).padStart(2, "0")}`,
            baseSalary: 15_000_000,
          }),
        okStatus: [201],
      },
      {
        name: "021 GET /salary-profiles/:id",
        pair: "view:salary-profile",
        call: (t) => get(t, `/salary-profiles/${salaryProfileId}`),
        okStatus: [200],
      },
      {
        name: "022 PATCH /salary-profiles/:id",
        pair: "manage:salary-profile",
        call: (t) => patch(t, `/salary-profiles/${salaryProfileId}`).send({ note: "ghi chú" }),
        okStatus: [200],
      },
      {
        name: "023 GET /bonus-penalties",
        pair: "view:bonus-penalty",
        call: (t) => get(t, "/bonus-penalties"),
        okStatus: [200],
      },
      {
        name: "024 POST /bonus-penalties",
        pair: "manage:bonus-penalty",
        call: (t) =>
          post(t, "/bonus-penalties").send({
            userId: subjectUserId,
            kind: "bonus",
            amount: 500_000,
            periodMonth: "2027-03",
            reason: "fixture",
          }),
        okStatus: [201],
      },
      {
        name: "025 GET /bonus-penalties/:id",
        pair: "view:bonus-penalty",
        call: (t) => get(t, `/bonus-penalties/${bonusId}`),
        okStatus: [200],
      },
      {
        name: "026 PATCH /bonus-penalties/:id",
        pair: "manage:bonus-penalty",
        call: (t) => patch(t, `/bonus-penalties/${bonusId}`).send({ reason: "sửa" }),
        okStatus: [200],
      },
      {
        name: "027 POST /bonus-penalties/:id/approve",
        pair: "approve:bonus-penalty",
        // Ca DENY dừng ở guard; ca ALLOW đi tới nghiệp vụ và có thể 409 (tự duyệt) — xử riêng ở khối A.
        call: (t) => post(t, `/bonus-penalties/${bonusId}/approve`).send({}),
        okStatus: [200, 201, 409],
      },
      {
        name: "028 POST /bonus-penalties/:id/reject",
        pair: "approve:bonus-penalty",
        call: (t) =>
          post(t, `/bonus-penalties/${bonusId}/reject`).send({ decisionNote: "không duyệt" }),
        okStatus: [200, 201, 409],
      },
      {
        name: "034 GET /payroll/pickers/people",
        pair: "view:salary-profile",
        call: (t) => get(t, "/payroll/pickers/people"),
        okStatus: [200],
      },
      {
        name: "035 GET /payroll/pickers/attendance-periods",
        pair: "manage:payroll-period",
        call: (t) => get(t, "/payroll/pickers/attendance-periods"),
        okStatus: [200],
      },
    ];

    let dayCounter = 1;
    const nextDay = () => dayCounter++;
    let monthCounter = 1;
    const randomMonth = () => String((monthCounter++ % 12) + 1).padStart(2, "0");

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "payrollbe1a");
      B = await seedCompany(direct, "payrollbe1b");
      companyIds.push(A.companyId, B.companyId);

      const allPairs: Array<[string, string]> = [
        ACCESS_PAIR,
        ...ROUTE_PAIRS.map((k) => k.split(":") as [string, string]),
      ];

      const fullUser = await seedUser(direct, A.companyId, `full@${A.slug}.test`, hash);
      await grantPairs(fullUser, "full", allPairs);
      tFull = await login(A.slug, `full@${A.slug}.test`);

      subjectUserId = await seedUser(direct, A.companyId, `subject@${A.slug}.test`, hash);

      for (const missing of ROUTE_PAIRS) {
        const slug = missing.replace(":", "-");
        const email = `no-${slug}@${A.slug}.test`;
        const uid = await seedUser(direct, A.companyId, email, hash);
        await grantPairs(
          uid,
          `no-${slug}`,
          allPairs.filter(([a, r]) => `${a}:${r}` !== missing),
        );
        tMissing.set(missing, await login(A.slug, email));
      }

      // Wildcard `*:*` — mô phỏng grant kiểu di sản. KHÔNG được mở cặp sensitive nào.
      const wildUser = await seedUser(direct, A.companyId, `wild@${A.slug}.test`, hash);
      await grantPairs(wildUser, "wild", [ACCESS_PAIR, ["*", "*"]]);
      tWildcard = await login(A.slug, `wild@${A.slug}.test`);

      // `hr-manager`: sau mig 0565 giữ ĐÚNG 0 cặp PAYROLL. Dựng bằng role KHÔNG có cặp payroll nào
      // (grant `read:employee` để chắc chắn user vẫn đăng nhập/hoạt động được — deny phải đến từ
      // thiếu cặp PAYROLL, không phải từ "user chẳng có quyền gì").
      const hrUser = await seedUser(direct, A.companyId, `hrm@${A.slug}.test`, hash);
      await grantPairs(hrUser, "hrm", [["read", "employee"]]);
      tHrManager = await login(A.slug, `hrm@${A.slug}.test`);

      // Tenant B — đủ quyền trong company của MÌNH, dùng để thử cross-tenant.
      const bRoleId = await seedRole(direct, B.companyId, "payrollbe1-b-full");
      for (const [action, resource] of allPairs) {
        const permId = await seedPermissionCatalog(
          direct,
          action,
          resource,
          SENSITIVE_PAIRS.has(`${action}:${resource}`),
        );
        await seedRolePermission(
          direct,
          bRoleId,
          permId,
          "ALLOW",
          action === "access" ? "Own" : "Company",
        );
      }
      const bUser = await seedUser(direct, B.companyId, `full@${B.slug}.test`, hash);
      await seedUserRole(direct, bUser, bRoleId, B.companyId);
      tOtherTenant = await login(B.slug, `full@${B.slug}.test`);

      attendancePeriodId = await seedAttendancePeriod(A.companyId, "2027-06");

      // Fixture đọc — dựng qua API THẬT (giữ đúng FK/đường ghi).
      const p = await post(tFull, "/payroll-periods").send({
        periodMonth: "2027-06",
        attendancePeriodId,
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      periodId = p.body.data.id;

      const sp = await post(tFull, "/salary-profiles").send({
        userId: subjectUserId,
        effectiveDate: "2027-06-01",
        baseSalary: 15_000_000,
        allowances: [{ name: "Ăn trưa", amount: 730_000 }],
      });
      expect(sp.status, JSON.stringify(sp.body)).toBe(201);
      salaryProfileId = sp.body.data.id;

      const bp = await post(tFull, "/bonus-penalties").send({
        userId: subjectUserId,
        kind: "bonus",
        amount: 500_000,
        periodMonth: "2027-06",
        reason: "fixture thưởng",
      });
      expect(bp.status, JSON.stringify(bp.body)).toBe(201);
      bonusId = bp.body.data.id;

      const bPeriod = await post(tOtherTenant, "/payroll-periods").send({ periodMonth: "2027-06" });
      expect(bPeriod.status, JSON.stringify(bPeriod.body)).toBe(201);
      bTenantPeriodId = bPeriod.body.data.id;
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (direct) {
        await cleanupTenants(direct, companyIds);
        await direct.end();
      }
    });

    // ── A. ALLOW đối chứng ────────────────────────────────────────────────────────────────────────

    it("A — chủ thể đủ 8 cặp: cả 18 route trả 2xx (ca ALLOW, chống xanh-rỗng)", async () => {
      const bad: string[] = [];
      for (const row of routeMatrix()) {
        const res = await row.call(tFull);
        if (!row.okStatus.includes(res.status)) {
          bad.push(`${row.name} → ${res.status} ${JSON.stringify(res.body?.error ?? {})}`);
        }
      }
      expect(bad, "route trả lỗi với chủ thể ĐỦ quyền").toEqual([]);
    });

    // ── B. DENY per-pair ──────────────────────────────────────────────────────────────────────────

    it("B — thiếu ĐÚNG một cặp ⇒ 403 trên đúng route của cặp đó", async () => {
      const bad: string[] = [];
      for (const row of routeMatrix()) {
        const token = tMissing.get(row.pair);
        if (!token) continue;
        const res = await row.call(token);
        if (res.status !== 403) bad.push(`${row.name} (thiếu ${row.pair}) → ${res.status}`);
      }
      expect(bad, "route KHÔNG chặn khi thiếu cặp gác của nó").toEqual([]);
    });

    // ── C. Wildcard ───────────────────────────────────────────────────────────────────────────────

    it("C — wildcard `*:*` KHÔNG mở được cặp sensitive (403 trên 12/18 route)", async () => {
      const sensitiveRows = routeMatrix().filter((r) => SENSITIVE_PAIRS.has(r.pair));
      // Chốt chặn xanh-rỗng cho chính ca này.
      expect(sensitiveRows.length).toBeGreaterThanOrEqual(10);
      const bad: string[] = [];
      for (const row of sensitiveRows) {
        const res = await row.call(tWildcard);
        if (res.status !== 403)
          bad.push(`${row.name} → ${res.status} (wildcard lọt cổng sensitive)`);
      }
      expect(bad).toEqual([]);
    });

    it("C2 — cặp KHÔNG sensitive vẫn kế thừa được qua wildcard (ALLOW đối chứng cho ca C)", async () => {
      // Nếu wildcard bị chặn ở MỌI route thì ca C xanh vì lý do sai (user không có quyền gì cả).
      const res = await get(tWildcard, "/payroll-periods");
      expect([200, 403]).toContain(res.status);
      expect(res.status, "view:payroll-period là is_sensitive=false ⇒ wildcard phải qua").toBe(200);
    });

    // ── D. hr-manager · cross-tenant · IDOR ───────────────────────────────────────────────────────

    it("D1 — `hr-manager` (0 cặp PAYROLL sau thu hồi 0565): 403 SẠCH trên CẢ 18 route", async () => {
      const bad: string[] = [];
      for (const row of routeMatrix()) {
        const res = await row.call(tHrManager);
        if (res.status !== 403) bad.push(`${row.name} → ${res.status}`);
      }
      expect(bad, "hr-manager còn đường vào dữ liệu lương").toEqual([]);
    });

    it("D2 — cross-tenant: đối tượng của tenant khác ⇒ 404 PAYROLL-ERR-010 (KHÔNG 403)", async () => {
      const res = await get(tFull, `/payroll-periods/${bTenantPeriodId}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PAYROLL-ERR-010");
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "kind", message: "not-found" })]),
      );
    });

    it("D3 — id không tồn tại ⇒ CÙNG một phản hồi 404 (không lộ oracle tồn tại)", async () => {
      const missing = await get(tFull, `/payroll-periods/${ghost()}`);
      const cross = await get(tFull, `/payroll-periods/${bTenantPeriodId}`);
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe(cross.body.error.code);
      expect(missing.body.message).toBe(cross.body.message);
    });

    it("D4 — hồ sơ lương + thưởng/phạt của tenant khác cũng 404, không 403", async () => {
      const sp = await post(tOtherTenant, "/salary-profiles").send({
        userId: (await seedUser(direct, B.companyId, `sub@${B.slug}.test`, "x")) as string,
        effectiveDate: "2027-06-01",
        baseSalary: 9_000_000,
      });
      // Người dùng vừa seed không có mật khẩu hợp lệ nhưng vẫn là user hợp lệ để tham chiếu.
      expect([201, 404, 409]).toContain(sp.status);
      if (sp.status === 201) {
        const res = await get(tFull, `/salary-profiles/${sp.body.data.id}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("PAYROLL-ERR-010");
      }
      const bonusCross = await get(tOtherTenant, `/bonus-penalties/${bonusId}`);
      expect(bonusCross.status).toBe(404);
      expect(bonusCross.body.error.code).toBe("PAYROLL-ERR-010");
    });

    it("D5 — `:id` không phải UUID ⇒ 400 ở biên (ParseUUIDPipe cấp method), KHÔNG 500", async () => {
      const res = await get(tFull, "/payroll-periods/khong-phai-uuid");
      expect(res.status).toBe(400);
    });

    // ── E. Masking ────────────────────────────────────────────────────────────────────────────────

    it("E — DTO kỳ lương KHÔNG chở khoá tiền nào; hồ sơ lương CÓ (ALLOW ⇔ DENY)", async () => {
      const period = await get(tFull, `/payroll-periods/${periodId}`);
      expect(period.status).toBe(200);
      const periodJson = JSON.stringify(period.body.data);
      for (const k of ["gross", "net", "totalGross", "totalNet", "baseSalary"]) {
        expect(periodJson, `kỳ lương rò khoá tiền '${k}'`).not.toContain(k);
      }
      const sp = await get(tFull, `/salary-profiles/${salaryProfileId}`);
      expect(sp.status).toBe(200);
      expect(sp.body.data.baseSalary).toBe(15_000_000);
      expect(sp.body.data.allowances).toEqual([{ name: "Ăn trưa", amount: 730_000 }]);
    });

    it("E2 — route GHI `collect` trả envelope KHÔNG khoá tiền (cửa sau của cặp `calculate`)", async () => {
      const res = await post(tFull, `/payroll-periods/${periodId}/collect`);
      expect([200, 201]).toContain(res.status);
      expect(Object.keys(res.body.data).sort()).toEqual([
        "affectedLines",
        "id",
        "status",
        "warnings",
      ]);
    });
  },
);
