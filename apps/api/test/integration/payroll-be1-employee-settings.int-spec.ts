/**
 * S15-PAYROLL-BE-1 — `PAYROLL-API-038/039`: thiết lập BH · công đoàn · **tài khoản ngân hàng**.
 *
 * Trọng tâm là **PII thanh toán** (SPEC-11 §3.12 · §18.1 A):
 *   A. ALLOW đối chứng + DENY per-pair (mỗi DENY có ALLOW ngay cạnh).
 *   B. 🔴 `bankAccountLast4` là trường DẪN XUẤT; khoá `bankAccountNumber` **KHÔNG BAO GIỜ** rời server
 *      qua route của WO này (đường duy nhất là tệp UNC của 071 — thuộc BE-4).
 *   C. Upsert THẬT: PUT hai lần ⇒ **một hàng**, giá trị của lần sau.
 *   D. Cặp bank (số TK ⇒ phải có tên NH + chủ TK) chặn ở Zod = 400 đọc được, TRƯỚC khi chạm CHECK DB.
 *   E. Envelope GHI 0 khoá PII + audit `changedFields` (TÊN trường, không giá trị).
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
const LOGIN_PW = "Passw0rd!s15be1set";
const FULL_BANK = "0123456789012";

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-1 — 038/039 thiết lập nhân sự (PII ngân hàng)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tFull = "";
  let tViewOnly = "";
  let tManageOnly = "";
  let subjectUserId = "";
  let otherTenantUserId = "";

  const http = () => request(app.getHttpServer());
  const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
  const put = (t: string, u: string) => http().put(u).set("Authorization", `Bearer ${t}`);

  async function grant(userId: string, label: string, pairs: Array<[string, string]>) {
    const roleId = await seedRole(
      direct,
      A.companyId,
      `s15set-${label}-${randomUUID().slice(0, 6)}`,
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s15seta");
    B = await seedCompany(direct, "s15setb");
    companyIds.push(A.companyId, B.companyId);

    subjectUserId = await seedUser(direct, A.companyId, `subject@${A.slug}.test`, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code, status)
       VALUES ($1,$2,'NV001','active')`,
      [A.companyId, subjectUserId],
    );
    otherTenantUserId = await seedUser(direct, B.companyId, `subject@${B.slug}.test`, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code, status)
       VALUES ($1,$2,'NVB01','active')`,
      [B.companyId, otherTenantUserId],
    );

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
  it("A1 — 038 trước khi thiết lập ⇒ 200 với giá trị MẶC ĐỊNH (hàng chưa tồn tại KHÔNG phải 404)", async () => {
    const res = await get(tFull, `/payroll/employees/${subjectUserId}/settings`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      userId: subjectUserId,
      joinsSocialInsurance: false,
      joinsUnion: false,
      bankAccountLast4: null,
    });
  });

  it("A2 — thiếu `view` ⇒ GET 403; thiếu `manage` ⇒ PUT 403 (ALLOW đối chứng ở A1/C1)", async () => {
    expect((await get(tManageOnly, `/payroll/employees/${subjectUserId}/settings`)).status).toBe(
      403,
    );
    const res = await put(tViewOnly, `/payroll/employees/${subjectUserId}/settings`).send({
      joinsSocialInsurance: true,
      joinsUnion: false,
    });
    expect(res.status).toBe(403);
  });

  it("A3 — `:userId` tenant khác ⇒ 404 PAYROLL-ERR-010 (không 403)", async () => {
    const res = await get(tFull, `/payroll/employees/${otherTenantUserId}/settings`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYROLL-ERR-010");
  });

  // ── B/C/E. Upsert + mask + envelope ───────────────────────────────────────────────────────────
  it("C1 — PUT lần đầu ⇒ 200, envelope `{id, warnings}` KHÔNG khoá PII nào", async () => {
    const res = await put(tFull, `/payroll/employees/${subjectUserId}/settings`).send({
      joinsSocialInsurance: true,
      socialInsuranceNo: "SI-001",
      joinsUnion: true,
      bankAccountNumber: FULL_BANK,
      bankName: "Vietcombank",
      accountHolder: "NGUYEN VAN A",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(["id", "warnings"]);
    const json = JSON.stringify(res.body.data);
    for (const k of ["bankAccountNumber", "accountHolder", "bankName", FULL_BANK]) {
      expect(json, `envelope GHI rò '${k}'`).not.toContain(k);
    }
  });

  it("B1 — 038 trả `bankAccountLast4` ĐÚNG 4 số cuối và **VẮNG** khoá số đầy đủ", async () => {
    const res = await get(tFull, `/payroll/employees/${subjectUserId}/settings`);
    expect(res.status).toBe(200);
    expect(res.body.data.bankAccountLast4).toBe(FULL_BANK.slice(-4));
    expect("bankAccountNumber" in res.body.data, "khoá số TK đầy đủ KHÔNG được tồn tại").toBe(
      false,
    );
    expect(JSON.stringify(res.body.data), "số TK đầy đủ rò ra DTO").not.toContain(FULL_BANK);
  });

  it("C2 — PUT lần hai ⇒ UPSERT tại chỗ: ĐÚNG MỘT hàng, giá trị của lần sau", async () => {
    const res = await put(tFull, `/payroll/employees/${subjectUserId}/settings`).send({
      joinsSocialInsurance: false,
      joinsUnion: false,
      bankAccountNumber: "9998887776665",
      bankName: "Techcombank",
      accountHolder: "NGUYEN VAN A",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cnt = await direct.query(
      `SELECT count(*)::int AS n FROM payroll_employee_settings
        WHERE company_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [A.companyId, subjectUserId],
    );
    expect(cnt.rows[0].n, "upsert đẻ hàng thứ hai — target ON CONFLICT sai vị từ partial").toBe(1);
    const after = await get(tFull, `/payroll/employees/${subjectUserId}/settings`);
    expect(after.body.data.bankAccountLast4).toBe("6665");
    expect(after.body.data.joinsSocialInsurance).toBe(false);
  });

  // ── D. Cặp bank ───────────────────────────────────────────────────────────────────────────────
  it("D1 — số TK mà THIẾU tên NH/chủ TK ⇒ 400 VALIDATION-ERR-001 (Zod chặn TRƯỚC CHECK DB)", async () => {
    const res = await put(tFull, `/payroll/employees/${subjectUserId}/settings`).send({
      joinsSocialInsurance: false,
      joinsUnion: false,
      bankAccountNumber: "1112223334445",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION-ERR-001");
  });

  it("D2 — đủ CẢ BA ⇒ 200 (ca ALLOW đối chứng cho D1: không phải 'mọi payload bank đều 400')", async () => {
    const res = await put(tFull, `/payroll/employees/${subjectUserId}/settings`).send({
      joinsSocialInsurance: false,
      joinsUnion: false,
      bankAccountNumber: "1112223334445",
      bankName: "ACB",
      accountHolder: "NGUYEN VAN A",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("D3 — khoá LẠ trong body ⇒ 400 (`.strict()`), không nuốt im lặng", async () => {
    const res = await put(tFull, `/payroll/employees/${subjectUserId}/settings`).send({
      joinsSocialInsurance: false,
      joinsUnion: false,
      hackerField: "x",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION-ERR-001");
  });

  /**
   * 🔴 **Security review S15-PAYROLL-BE-1 (HIGH #2) — 500 vùng đỏ + số TK vào log.**
   *
   * 039 là upsert MERGE TỪNG PHẦN, nên CHECK `payroll_employee_settings_bank_pair_check` chạy trên
   * hàng **SAU MERGE**. `.refine` của Zod chỉ soi PAYLOAD ⇒ `{bankName:null}` gửi lên nhân sự ĐÃ có
   * số TK là payload HỢP LỆ nhưng hàng sau merge thì không. Trước bản vá: DB ném `23514` không có
   * nhánh map ⇒ **500**, và message của drizzle (`Failed query: … params: …`) mang **SỐ TÀI KHOẢN
   * ĐẦY ĐỦ** vào log 5xx.
   */
  it("D4 — gỡ `bankName` khỏi hàng ĐÃ có số TK ⇒ 422 018 đọc được, KHÔNG 500", async () => {
    // Tiền đề: hàng đã có đủ bộ ba.
    const seed = await put(tFull, `/payroll/employees/${subjectUserId}/settings`).send({
      joinsSocialInsurance: false,
      joinsUnion: false,
      bankAccountNumber: FULL_BANK,
      bankName: "Vietcombank",
      accountHolder: "NGUYEN VAN A",
    });
    expect(seed.status, JSON.stringify(seed.body)).toBe(200);

    const res = await put(tFull, `/payroll/employees/${subjectUserId}/settings`).send({
      joinsSocialInsurance: false,
      joinsUnion: false,
      bankName: null,
    });
    expect(res.status, `PHẢI là lỗi đọc được, không 500: ${JSON.stringify(res.body)}`).toBe(422);
    expect(res.body.error.code).toBe("PAYROLL-ERR-018");
    expect(res.body.error.details).toContainEqual(
      expect.objectContaining({ field: "kind", message: "bank-pair-incomplete" }),
    );
    // Và thông điệp lỗi KHÔNG được mang số TK ra ngoài.
    expect(JSON.stringify(res.body), "lỗi rò số tài khoản").not.toContain(FULL_BANK);
  });

  it("D5 — `bankAccountNumber: \"\"` ⇒ 400, KHÔNG ghi hàng `''` nửa nạc nửa mỡ", async () => {
    const res = await put(tFull, `/payroll/employees/${subjectUserId}/settings`).send({
      joinsSocialInsurance: false,
      joinsUnion: false,
      bankAccountNumber: "",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION-ERR-001");
    // Không có hàng nào mang chuỗi rỗng — trạng thái đó làm CHECK coi là "CÓ số TK" còn mapper coi là
    // "KHÔNG có", hai tầng đọc cùng một hàng ra hai nghĩa.
    const bad = await direct.query(
      `SELECT count(*)::int AS n FROM payroll_employee_settings
        WHERE company_id = $1 AND bank_account_number = '' AND deleted_at IS NULL`,
      [A.companyId],
    );
    expect(bad.rows[0].n).toBe(0);
  });

  it("D6 — ĐỐI CHỨNG DƯƠNG: gỡ CẢ BA cùng lượt (số TK về null) ⇒ 200", async () => {
    const res = await put(tFull, `/payroll/employees/${subjectUserId}/settings`).send({
      joinsSocialInsurance: false,
      joinsUnion: false,
      bankAccountNumber: null,
      bankName: null,
      accountHolder: null,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await get(tFull, `/payroll/employees/${subjectUserId}/settings`);
    expect(after.body.data.bankAccountLast4).toBeNull();
  });

  // ── E. Audit ──────────────────────────────────────────────────────────────────────────────────
  it("E1 — audit 038/039 neo `userId`, payload KHÔNG chứa số TK", async () => {
    await get(tFull, `/payroll/employees/${subjectUserId}/settings`);
    const rows = await direct.query(
      `SELECT action, object_id, after FROM audit_logs
        WHERE company_id = $1 AND object_type = 'payroll_employee_setting'
        ORDER BY created_at DESC LIMIT 20`,
      [A.companyId],
    );
    expect(rows.rowCount, "038/039 phải để lại vết").toBeGreaterThan(0);
    for (const r of rows.rows) {
      // §18.1 B hàng 3 — neo theo NHÂN SỰ (hàng có thể chưa tồn tại lúc đọc), không theo `id` hàng.
      expect(r.object_id).toBe(subjectUserId);
      const j = JSON.stringify(r.after ?? {});
      expect(j, "audit rò số TK").not.toContain(FULL_BANK);
      expect(j, "audit rò số TK").not.toContain("6665");
    }
    const write = rows.rows.find((r) => r.action === "update");
    expect(write, "đường GHI phải có vết").toBeTruthy();
    // TÊN trường, KHÔNG giá trị.
    expect(write.after.changedFields).toContain("bankAccountNumber");
  });
});
