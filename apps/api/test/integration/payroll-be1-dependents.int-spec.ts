/**
 * S15-PAYROLL-BE-1 — `PAYROLL-API-040/041/042`: người phụ thuộc giảm trừ TNCN.
 *
 *   A. ALLOW/DENY per-pair + 404 sentinel cross-tenant.
 *   B. 🔴 **PAYROLL-ERR-032 chồng lấp** — kích hoạt CẢ tiền-kiểm LẪN chốt cuối `EXCLUDE USING gist`
 *      THẬT ở DB (`23P01`, KHÔNG `23505`); có ca **đối chứng dương** (khác tên ⇒ chồng khoảng vẫn OK)
 *      để ràng buộc không "chặn mọi thứ" rồi xanh rỗng.
 *   C. 🔴 **B8 — audit GHI neo `dependentId`, audit ĐỌC neo `userId`.** Neo sai thì 3 lượt tạo + 1 lượt
 *      xoá để lại 4 hàng giống hệt nhau và không truy được NPT nào.
 *   D. Envelope GHI 0 khoá PII — role chỉ có `manage` (không `view`) KHÔNG được đọc NPT qua cửa sau
 *      (SPEC-11 §3.12; invariant seed `manage ⇒ view` KHÔNG phủ `payroll-employee`).
 *   E. 042 resolve `userId` TỪ HÀNG, không từ URL.
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
const LOGIN_PW = "Passw0rd!s15be1dep";

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-1 — 040/041/042 người phụ thuộc", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tFull = "";
  let tViewOnly = "";
  let tManageOnly = "";
  let subjectUserId = "";
  let secondUserId = "";
  let otherTenantUserId = "";
  let otherTenantDependentId = "";

  const http = () => request(app.getHttpServer());
  const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
  const patch = (t: string, u: string) => http().patch(u).set("Authorization", `Bearer ${t}`);

  async function grant(userId: string, label: string, pairs: Array<[string, string]>) {
    const roleId = await seedRole(
      direct,
      A.companyId,
      `s15dep-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const [action, resource] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, true);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
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

  const dep = (over: Record<string, unknown> = {}) => ({
    fullName: "Nguyễn Thị Bé",
    relationship: "Child",
    effectiveFrom: "2027-01-01",
    effectiveTo: "2027-12-31",
    ...over,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s15depa");
    B = await seedCompany(direct, "s15depb");
    companyIds.push(A.companyId, B.companyId);

    const mkEmp = async (companyId: string, slug: string, label: string, code: string) => {
      const uid = await seedUser(direct, companyId, `${label}@${slug}.test`, hash);
      await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, employee_code, status)
         VALUES ($1,$2,$3,'active')`,
        [companyId, uid, code],
      );
      return uid;
    };
    subjectUserId = await mkEmp(A.companyId, A.slug, "subject", "NV001");
    secondUserId = await mkEmp(A.companyId, A.slug, "second", "NV002");
    otherTenantUserId = await mkEmp(B.companyId, B.slug, "subject", "NVB01");

    const od = await direct.query(
      `INSERT INTO payroll_dependents (company_id, user_id, full_name, relationship, effective_from)
       VALUES ($1,$2,'NPT cua tenant B','Child','2027-01-01') RETURNING id`,
      [B.companyId, otherTenantUserId],
    );
    otherTenantDependentId = od.rows[0].id;

    const mk = async (label: string, pairs: Array<[string, string]>) => {
      const email = `${label}@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      await grant(uid, label, pairs);
      return login(A.slug, email);
    };
    tFull = await mk("full", [
      ["view", "payroll-employee"],
      ["manage", "payroll-employee"],
    ]);
    tViewOnly = await mk("viewonly", [["view", "payroll-employee"]]);
    tManageOnly = await mk("manageonly", [["manage", "payroll-employee"]]);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
  });

  // ── A. ALLOW / DENY ───────────────────────────────────────────────────────────────────────────
  it("A1 — 041 tạo NPT ⇒ 201, envelope `{id, warnings}`; 040 đọc lại thấy đúng NPT (ALLOW đối chứng)", async () => {
    const created = await post(tFull, `/payroll/employees/${subjectUserId}/dependents`).send(dep());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(Object.keys(created.body.data).sort()).toEqual(["id", "warnings"]);

    const list = await get(tFull, `/payroll/employees/${subjectUserId}/dependents`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      fullName: "Nguyễn Thị Bé",
      relationship: "Child",
      effectiveFrom: "2027-01-01",
      effectiveTo: "2027-12-31",
    });
  });

  it("A2 — thiếu `view` ⇒ 040 403; thiếu `manage` ⇒ 041/042 403", async () => {
    expect((await get(tManageOnly, `/payroll/employees/${subjectUserId}/dependents`)).status).toBe(
      403,
    );
    expect(
      (await post(tViewOnly, `/payroll/employees/${subjectUserId}/dependents`).send(dep())).status,
    ).toBe(403);
    expect(
      (await patch(tViewOnly, `/payroll/dependents/${randomUUID()}`).send({ fullName: "x" }))
        .status,
    ).toBe(403);
  });

  it("A3 — cross-tenant ⇒ 404 PAYROLL-ERR-010 trên CẢ 040 lẫn 042 (không 403)", async () => {
    const l = await get(tFull, `/payroll/employees/${otherTenantUserId}/dependents`);
    expect(l.status).toBe(404);
    expect(l.body.error.code).toBe("PAYROLL-ERR-010");

    const u = await patch(tFull, `/payroll/dependents/${otherTenantDependentId}`).send({
      fullName: "doi ten",
    });
    expect(u.status).toBe(404);
    expect(u.body.error.code).toBe("PAYROLL-ERR-010");
    // Và hàng của tenant B KHÔNG bị đụng.
    const check = await direct.query(`SELECT full_name FROM payroll_dependents WHERE id = $1`, [
      otherTenantDependentId,
    ]);
    expect(check.rows[0].full_name).toBe("NPT cua tenant B");
  });

  // ── B. 🔴 PAYROLL-ERR-032 chồng lấp ───────────────────────────────────────────────────────────
  it("B1 — 041 chồng lấp CÙNG tên ⇒ 409 PAYROLL-ERR-032 `dependent-overlap`", async () => {
    const res = await post(tFull, `/payroll/employees/${subjectUserId}/dependents`).send(
      dep({ effectiveFrom: "2027-06-01", effectiveTo: "2028-06-30" }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe("PAYROLL-ERR-032");
    expect(res.body.error.details).toContainEqual(
      expect.objectContaining({ field: "kind", message: "dependent-overlap" }),
    );
  });

  it("B2 — khoảng MỞ (`effectiveTo` null) chồng khoảng đóng ⇒ vẫn 409 032", async () => {
    const res = await post(tFull, `/payroll/employees/${subjectUserId}/dependents`).send(
      dep({ effectiveFrom: "2027-11-01", effectiveTo: null }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe("PAYROLL-ERR-032");
  });

  it("B3 — ĐỐI CHỨNG DƯƠNG: KHÁC tên, chồng khoảng ⇒ 201 (EXCLUDE không chặn nhầm)", async () => {
    const res = await post(tFull, `/payroll/employees/${subjectUserId}/dependents`).send(
      dep({ fullName: "Nguyễn Văn Anh", effectiveFrom: "2027-06-01", effectiveTo: "2028-06-30" }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("B4 — ĐỐI CHỨNG DƯƠNG: CÙNG tên, khoảng KHÔNG chồng ⇒ 201", async () => {
    const res = await post(tFull, `/payroll/employees/${subjectUserId}/dependents`).send(
      dep({ effectiveFrom: "2029-01-01", effectiveTo: "2029-12-31" }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  /**
   * Chốt cuối ở DB là `EXCLUDE USING gist` ném **`23P01`**, KHÔNG `23505`. Bỏ qua tiền-kiểm của service
   * (INSERT thẳng qua `direct`) để chắc chắn nhánh `mapPayrollPgError` cho `23P01` là THẬT — không chỉ
   * là nhánh chết được che bởi tiền-kiểm.
   */
  it("B5 — chốt cuối DB ném 23P01 (không 23505) — nhánh map là THẬT, không phải code chết", async () => {
    await expect(
      direct.query(
        `INSERT INTO payroll_dependents (company_id, user_id, full_name, relationship, effective_from, effective_to)
         VALUES ($1,$2,'Nguyễn Thị Bé','Child','2027-03-01','2027-04-01')`,
        [A.companyId, subjectUserId],
      ),
    ).rejects.toMatchObject({ code: "23P01", constraint: "payroll_dependents_no_overlap_excl" });
  });

  it("B6 — 042 sửa khoảng thành chồng lấp hàng KHÁC ⇒ 409 032 (hướng PATCH, không chỉ POST)", async () => {
    const list = await get(tFull, `/payroll/employees/${subjectUserId}/dependents`);
    const target = list.body.data.find(
      (d: { fullName: string; effectiveFrom: string }) =>
        d.fullName === "Nguyễn Thị Bé" && d.effectiveFrom === "2029-01-01",
    );
    expect(target, "fixture B4 phải tồn tại").toBeTruthy();
    const res = await patch(tFull, `/payroll/dependents/${target.id}`).send({
      effectiveFrom: "2027-02-01",
      effectiveTo: "2027-03-01",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe("PAYROLL-ERR-032");

    // ĐỐI CHỨNG DƯƠNG cùng hàng: dời sang khoảng TRỐNG ⇒ 200 (không phải "mọi PATCH đều 409").
    const ok = await patch(tFull, `/payroll/dependents/${target.id}`).send({
      effectiveFrom: "2030-01-01",
      effectiveTo: "2030-12-31",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  // ── C. 🔴 B8 — neo audit ──────────────────────────────────────────────────────────────────────
  it("C1 — audit GHI neo `dependentId`; audit ĐỌC neo `userId`", async () => {
    const created = await post(tFull, `/payroll/employees/${secondUserId}/dependents`).send(
      dep({ fullName: "NPT cua NV002" }),
    );
    expect(created.status).toBe(201);
    const depId = created.body.data.id as string;

    const w = await direct.query(
      `SELECT object_id, after FROM audit_logs
        WHERE company_id = $1 AND object_type = 'payroll_dependent' AND action = 'create'
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    expect(w.rows[0].object_id, "đường GHI phải neo id của CHÍNH NPT").toBe(depId);
    expect(w.rows[0].after).toMatchObject({ userId: secondUserId });

    await get(tFull, `/payroll/employees/${secondUserId}/dependents`);
    const r = await direct.query(
      `SELECT object_id, after FROM audit_logs
        WHERE company_id = $1 AND object_type = 'payroll_dependent' AND action = 'read'
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    expect(r.rows[0].object_id, "đường ĐỌC neo CHA (§18.1 B hàng 4)").toBe(secondUserId);
    expect(r.rows[0].after).toMatchObject({ rowCount: 1 });
  });

  it("C2 — audit NPT KHÔNG nhân bản PII (họ tên / MST NPT)", async () => {
    const rows = await direct.query(
      `SELECT before, after FROM audit_logs
        WHERE company_id = $1 AND object_type = 'payroll_dependent'
        ORDER BY created_at DESC LIMIT 30`,
      [A.companyId],
    );
    for (const r of rows.rows) {
      const j = JSON.stringify({ b: r.before, a: r.after });
      expect(j, "audit rò họ tên NPT").not.toContain("Nguyễn Thị Bé");
      expect(j, "audit rò họ tên NPT").not.toContain("NPT cua NV002");
    }
  });

  // ── D. Envelope GHI không rò PII ──────────────────────────────────────────────────────────────
  it("D1 — role chỉ có `manage` (KHÔNG `view`): 041 vẫn 201 nhưng phản hồi 0 khoá PII", async () => {
    const res = await post(tManageOnly, `/payroll/employees/${secondUserId}/dependents`).send(
      dep({
        fullName: "NPT bi mat",
        dependentTaxCode: "8123456789",
        effectiveFrom: "2031-01-01",
        effectiveTo: "2031-12-31",
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const json = JSON.stringify(res.body.data);
    expect(json, "envelope GHI rò họ tên NPT").not.toContain("NPT bi mat");
    expect(json, "envelope GHI rò MST NPT").not.toContain("8123456789");
    expect(Object.keys(res.body.data).sort()).toEqual(["id", "warnings"]);
    // Và chính chủ thể đó KHÔNG đọc được qua đường hợp lệ ⇒ cửa sau thực sự đóng.
    expect((await get(tManageOnly, `/payroll/employees/${secondUserId}/dependents`)).status).toBe(
      403,
    );
  });

  // ── E. 042 xoá mềm + userId từ HÀNG ───────────────────────────────────────────────────────────
  it("E1 — 042 `{delete:true}` xoá MỀM (không hard-delete) và audit neo `userId` đọc TỪ HÀNG", async () => {
    const created = await post(tFull, `/payroll/employees/${secondUserId}/dependents`).send(
      dep({ fullName: "NPT se xoa", effectiveFrom: "2032-01-01", effectiveTo: "2032-12-31" }),
    );
    const depId = created.body.data.id as string;

    const res = await patch(tFull, `/payroll/dependents/${depId}`).send({ delete: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const row = await direct.query(
      `SELECT deleted_at, user_id FROM payroll_dependents WHERE id = $1`,
      [depId],
    );
    expect(row.rowCount, "hard-delete — bất biến #2 bị phá").toBe(1);
    expect(row.rows[0].deleted_at, "phải là xoá MỀM").not.toBeNull();

    const a = await direct.query(
      `SELECT object_id, before FROM audit_logs
        WHERE company_id = $1 AND object_type = 'payroll_dependent' AND action = 'delete'
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    expect(a.rows[0].object_id).toBe(depId);
    // `userId` resolve TỪ HÀNG — URL của 042 không có param đó.
    expect(a.rows[0].before).toMatchObject({ userId: secondUserId });
  });
});
