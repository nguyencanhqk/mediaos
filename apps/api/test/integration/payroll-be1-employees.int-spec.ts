/**
 * S15-PAYROLL-BE-1 — `PAYROLL-API-036/037`: nhân sự hưởng lương (chiếu HR bó hẹp, PAY-DEC-016).
 *
 * Năm khối, mỗi khối DENY đều có ca ALLOW đối chứng NGAY CẠNH
 * (`deny-cases-vacuous-without-allow-case`), và mọi ca ALLOW assert **mã cụ thể** — cấm
 * `.not.toBe(403)` (`allow-counter-case-not-403-lets-500-through`):
 *
 *   A. ALLOW đối chứng — `payroll-officer` giữ 2 cặp `payroll-employee` và **0 cặp HR** ⇒ vẫn 200 + đủ
 *      5 trường chiếu. Đây là lý do tồn tại của route (officer không dùng được `HR-API-*`).
 *   B. DENY per-pair + wildcard `*:*` + **sàn scope Company**.
 *   C. 🔴 **B3 — `taxCode` đi qua cặp PHỤ `view:salary-profile` CÓ SÀN Company.**
 *   D. IDOR/cross-tenant ⇒ **404 sentinel**, không 403 (chống oracle).
 *   E. 🔴 **B6 — hồ sơ nhân sự xoá mềm KHÔNG được nhân bản hàng** (unique là PARTIAL).
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
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
const LOGIN_PW = "Passw0rd!s15be1emp";

/** 2 cặp mới của track A — CẢ HAI `is_sensitive` (SPEC-11 §11.3). */
const VIEW_EMP: [string, string] = ["view", "payroll-employee"];
const MANAGE_EMP: [string, string] = ["manage", "payroll-employee"];
const VIEW_SALARY: [string, string] = ["view", "salary-profile"];

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-1 — 036/037 nhân sự hưởng lương", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tOfficer = ""; // view+manage payroll-employee @Company, 0 cặp HR, KHÔNG view:salary-profile
  let tWithSalary = ""; // + view:salary-profile @Company  ⇒ taxCode LỘ
  let tSalaryDept = ""; // + view:salary-profile @Department ⇒ taxCode VẮNG (B3)
  let tNoView = ""; // chỉ manage:payroll-employee ⇒ 403 trên 036/037
  let tWildcard = ""; // `*:*` ⇒ 403 (cổng sensitive)
  let tEmpScopeDept = ""; // view:payroll-employee @Department ⇒ 403 (sàn Company)

  let subjectUserId = "";
  let orgUnitId = "";
  let positionId = "";
  let otherTenantUserId = "";

  const http = () => request(app.getHttpServer());
  const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);

  async function grant(
    userId: string,
    label: string,
    pairs: Array<[string, string, DataScope?]>,
    companyId = A.companyId,
  ) {
    const roleId = await seedRole(direct, companyId, `s15be1-${label}-${randomUUID().slice(0, 6)}`);
    for (const [action, resource, scope] of pairs) {
      // ⚠️ `permissions` là catalog TOÀN CỤC — `cleanupTenants()` KHÔNG dọn nó, nên truyền sai
      // `is_sensitive` là ĐÓNG DẤU VĨNH VIỄN lên lane DB và làm spec KHÁC đỏ ở nơi khác
      // (`test-fixture-stamps-global-permission-catalog`). `*:*` canonical là **false**; 2 cặp
      // `payroll-employee` của §11.3 là **true**.
      const isSensitive = !(action === "*" && resource === "*");
      const permId = await seedPermissionCatalog(direct, action, resource, isSensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope ?? "Company");
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Hồ sơ NHÂN SỰ (HR) — route 036/037 chiếu từ đây, không từ `users`. */
  async function seedEmployeeProfile(
    companyId: string,
    userId: string,
    opts: { code: string; taxCode?: string; deleted?: boolean; status?: string },
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles
         (company_id, user_id, employee_code, org_unit_id, position_id, tax_code, status, start_date, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-01-15',${opts.deleted ? "now()" : "NULL"})
       RETURNING id`,
      [
        companyId,
        userId,
        opts.code,
        companyId === A.companyId ? orgUnitId : null,
        companyId === A.companyId ? positionId : null,
        opts.taxCode ?? null,
        opts.status ?? "active",
      ],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s15be1empa");
    B = await seedCompany(direct, "s15be1empb");
    companyIds.push(A.companyId, B.companyId);

    const ou = await direct.query(
      `INSERT INTO org_units (company_id, name, code) VALUES ($1,'Phòng Kế toán','KT') RETURNING id`,
      [A.companyId],
    );
    orgUnitId = ou.rows[0].id;
    const po = await direct.query(
      `INSERT INTO positions (company_id, name, code) VALUES ($1,'Kế toán viên','KTV') RETURNING id`,
      [A.companyId],
    );
    positionId = po.rows[0].id;

    subjectUserId = await seedUser(direct, A.companyId, `subject@${A.slug}.test`, hash);
    await seedEmployeeProfile(A.companyId, subjectUserId, { code: "NV001", taxCode: "8000000001" });

    otherTenantUserId = await seedUser(direct, B.companyId, `subject@${B.slug}.test`, hash);
    await seedEmployeeProfile(B.companyId, otherTenantUserId, {
      code: "NVB01",
      taxCode: "9000000002",
    });

    const mk = async (label: string, pairs: Array<[string, string, DataScope?]>) => {
      const email = `${label}@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      await grant(uid, label, pairs);
      return login(A.slug, email);
    };

    tOfficer = await mk("officer", [VIEW_EMP, MANAGE_EMP]);
    tWithSalary = await mk("withsalary", [VIEW_EMP, MANAGE_EMP, VIEW_SALARY]);
    tSalaryDept = await mk("salarydept", [
      VIEW_EMP,
      MANAGE_EMP,
      [VIEW_SALARY[0], VIEW_SALARY[1], "Department"],
    ]);
    tNoView = await mk("noview", [MANAGE_EMP]);
    tWildcard = await mk("wildcard", [["*", "*"]]);
    tEmpScopeDept = await mk("empdept", [[VIEW_EMP[0], VIEW_EMP[1], "Department"]]);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
  });

  // ── A. ALLOW đối chứng ────────────────────────────────────────────────────────────────────────
  it("A1 — payroll-officer (0 cặp HR) VẪN đọc được 036 với đủ 5 trường chiếu", async () => {
    const res = await get(tOfficer, "/payroll/employees");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = res.body.data.find((r: { userId: string }) => r.userId === subjectUserId) as Record<
      string,
      unknown
    >;
    expect(row, "nhân sự đã seed phải có trong danh sách").toBeTruthy();
    expect(row["employeeCode"]).toBe("NV001");
    expect(row["fullName"]).toBeDefined();
    expect(row["orgUnitName"]).toBe("Phòng Kế toán");
    expect(row["positionName"]).toBe("Kế toán viên");
    expect(row["employeeStatus"]).toBe("active");
  });

  it("A2 — 037 chi tiết 200 + `startDate`", async () => {
    const res = await get(tOfficer, `/payroll/employees/${subjectUserId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.startDate).toBe("2026-01-15");
  });

  it("A3 — 036 KHÔNG rò khoá nhạy cảm ngoài chiếu (email/điện thoại/lương)", async () => {
    const res = await get(tOfficer, "/payroll/employees");
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body.data);
    for (const k of ["email", "phone", "baseSalary", "salary", "bankAccount"]) {
      expect(json, `036 rò khoá '${k}'`).not.toContain(k);
    }
  });

  // ── B. DENY per-pair / wildcard / sàn scope ───────────────────────────────────────────────────
  it("B1 — thiếu `view:payroll-employee` ⇒ 403 trên CẢ 036 lẫn 037", async () => {
    expect((await get(tNoView, "/payroll/employees")).status).toBe(403);
    expect((await get(tNoView, `/payroll/employees/${subjectUserId}`)).status).toBe(403);
  });

  it("B2 — wildcard `*:*` KHÔNG thoả cổng sensitive ⇒ 403", async () => {
    expect((await get(tWildcard, "/payroll/employees")).status).toBe(403);
  });

  it("B3 — grant hẹp hơn Company (Department) ⇒ 403 (SÀN scope, không 'coi như' Company)", async () => {
    // Chủ thể CÓ đúng cặp, chỉ khác `data_scope` ⇒ cổng đang chặn là SÀN, không phải thiếu-cặp
    // (`overdetermined-gate-makes-deny-spec-vacuous`).
    expect((await get(tEmpScopeDept, "/payroll/employees")).status).toBe(403);
  });

  // ── C. 🔴 B3 của plan-review — taxCode qua cặp PHỤ CÓ SÀN ──────────────────────────────────────
  it("C1 — KHÔNG có `view:salary-profile` ⇒ **vắng khoá** `taxCode`, route vẫn 200", async () => {
    const res = await get(tOfficer, `/payroll/employees/${subjectUserId}`);
    expect(res.status, "thiếu cặp PHỤ không được làm 403 CẢ route").toBe(200);
    expect("taxCode" in res.body.data, "mask phải là VẮNG KHOÁ, không phải null").toBe(false);
  });

  it("C2 — có `view:salary-profile`@Company ⇒ `taxCode` CÓ mặt (ca ALLOW đối chứng)", async () => {
    const res = await get(tWithSalary, `/payroll/employees/${subjectUserId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.taxCode).toBe("8000000001");
  });

  /**
   * 🔴 Đây là BLOCKER B3 của plan-review vòng 1. `resolveOrNull` KHÔNG ép sàn scope nào; nếu
   * `canRevealTaxCode` viết `scope !== null` thì role này — vốn **403 ở 019/021** (route sở hữu hồ sơ
   * lương) — vẫn đọc được `taxCode` của BẤT KỲ ai qua 037: ô cửa sổ rộng hơn cửa chính.
   */
  it("C3 — `view:salary-profile`@**Department** ⇒ `taxCode` VẮNG (sàn Company ép ở cấp TRƯỜNG)", async () => {
    const res = await get(tSalaryDept, `/payroll/employees/${subjectUserId}`);
    expect(res.status, "vẫn 200 — đây là kiểm MỀM cấp trường").toBe(200);
    expect("taxCode" in res.body.data, "scope Department KHÔNG được mở taxCode").toBe(false);
    // Đối chứng: chính chủ thể này bị 403 ở route sở hữu dữ liệu ⇒ hai cổng nhất quán.
    expect((await get(tSalaryDept, "/salary-profiles")).status).toBe(403);
  });

  it("C4 — audit 037 ghi cờ `taxCodeRevealed`, KHÔNG ghi chính MST", async () => {
    await get(tWithSalary, `/payroll/employees/${subjectUserId}`);
    const r = await direct.query(
      `SELECT after FROM audit_logs
        WHERE company_id = $1 AND object_type = 'payroll_employee' AND action = 'read'
          AND object_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, subjectUserId],
    );
    expect(r.rowCount, "037 phải để lại vết đọc").toBe(1);
    expect(r.rows[0].after).toMatchObject({ taxCodeRevealed: true });
    expect(JSON.stringify(r.rows[0].after), "audit KHÔNG nhân bản PII").not.toContain(
      "8000000001",
    );
  });

  // ── D. IDOR / cross-tenant ⇒ 404 sentinel ─────────────────────────────────────────────────────
  it("D1 — `:userId` của tenant KHÁC ⇒ 404 PAYROLL-ERR-010 (không 403)", async () => {
    const res = await get(tOfficer, `/payroll/employees/${otherTenantUserId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYROLL-ERR-010");
  });

  it("D2 — `:userId` không tồn tại ⇒ CÙNG phản hồi 404 (không dựng oracle)", async () => {
    const res = await get(tOfficer, `/payroll/employees/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYROLL-ERR-010");
  });

  it("D3 — 036 KHÔNG trả nhân sự của tenant khác", async () => {
    const res = await get(tOfficer, "/payroll/employees");
    expect(res.status).toBe(200);
    expect(
      res.body.data.some((r: { userId: string }) => r.userId === otherTenantUserId),
      "rò nhân sự cross-tenant",
    ).toBe(false);
  });

  // ── E. 🔴 B6 của plan-review — hồ sơ xoá mềm không nhân bản hàng ───────────────────────────────
  /**
   * `employee_profiles_company_user_uq` là unique **PARTIAL** `WHERE deleted_at IS NULL` ⇒ một user có
   * thể có NHIỀU hồ sơ đã xoá mềm. Nếu repo JOIN `users → employee_profiles` mà chỉ lọc tenant thì
   * hàng nhân bản và `pagination.total` đếm sai (`partial-unique-index-makes-join-duplicate`).
   */
  it("E1 — user có 1 hồ sơ Active + 2 hồ sơ XOÁ MỀM ⇒ ĐÚNG 1 hàng, total đếm 1", async () => {
    const hash = await new PasswordService().hash(LOGIN_PW);
    const dupUser = await seedUser(direct, A.companyId, `dup@${A.slug}.test`, hash);
    await seedEmployeeProfile(A.companyId, dupUser, { code: "NVDUP-OLD1", deleted: true });
    await seedEmployeeProfile(A.companyId, dupUser, { code: "NVDUP-OLD2", deleted: true });
    await seedEmployeeProfile(A.companyId, dupUser, { code: "NVDUP" });

    const res = await get(tOfficer, "/payroll/employees?per_page=100");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const hits = res.body.data.filter((r: { userId: string }) => r.userId === dupUser);
    expect(hits.length, "hồ sơ xoá mềm làm NHÂN BẢN hàng").toBe(1);
    expect(hits[0].employeeCode, "phải là hồ sơ CÒN SỐNG").toBe("NVDUP");

    const onlyDup = await get(tOfficer, "/payroll/employees?q=NVDUP");
    expect(onlyDup.status).toBe(200);
    expect(onlyDup.body.data.length, "lọc q cũng không được nhân bản").toBe(1);
    expect(onlyDup.body.pagination.total, "total đếm sai vì hàng nhân bản").toBe(1);
  });

  it("E2 — lọc `orgUnitId` + `hasSalaryProfile=false` hoạt động (ca ALLOW đối chứng cho E1)", async () => {
    const res = await get(tOfficer, `/payroll/employees?orgUnitId=${orgUnitId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.length, "phải có ít nhất nhân sự đã gán đơn vị").toBeGreaterThan(0);
    for (const r of res.body.data) expect(r.orgUnitName).toBe("Phòng Kế toán");

    const none = await get(tOfficer, "/payroll/employees?hasSalaryProfile=true");
    expect(none.status).toBe(200);
    // Chưa ai có hồ sơ lương trong fixture này ⇒ rỗng, và đó là khẳng định có nội dung: nếu vị từ
    // `EXISTS` bị viết ngược thì ca này ĐỎ.
    expect(none.body.data.length).toBe(0);
  });
});
