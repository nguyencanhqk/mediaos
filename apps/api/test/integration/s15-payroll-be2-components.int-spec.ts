/**
 * S15-PAYROLL-BE-2 — `PAYROLL-API-044..048`: catalog thành phần lương (plan `docs/plans/S15-PAYROLL-BE-2.md` §4 · §9).
 *
 *   A. ALLOW/DENY per-pair + sàn scope Company + 404 cross-tenant — mỗi ca DENY có ca ALLOW song sinh.
 *   B. Giới hạn tĩnh đi ĐÚNG mã: công thức 501 ký tự ⇒ 422 018 `formula-too-long`, KHÔNG 400 (equal-caps).
 *   C. 🔴 Shadowing BA nhánh (§21.1 B8): mã dành riêng · trùng mã sống · xoá mềm hàng hệ thống ở DB.
 *   D. 🔴 M1/M2 — hàng hệ thống ĐÓNG BĂNG; trigger THẬT (bỏ tiền-kiểm) map 024, không dán nhầm 013.
 *   E. component-in-use (mẫu xoá mềm KHÔNG tính) · 047 làm vỡ mẫu ⇒ 018 · đổi `pitDeductible` sinh vòng ⇒ 019.
 *   F. 048 kiểm tại chỗ: luôn 200, `kind` phụ thuộc loại thành phần.
 *   G. Audit GHI kèm chuỗi công thức, KHÔNG số tiền · envelope `{id}` · M3 không chạm bảng lương.
 *
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { HttpException, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { pgErrorCode, pgErrorField } from "../../src/common/db-error";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { DatabaseService } from "../../src/db/db.service";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { mapPayrollPgError } from "../../src/payroll/payroll.errors";
import { SalaryComponentsRepository } from "../../src/payroll/salary-components.repository";
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
const LOGIN_PW = "Passw0rd!s15be2cmp";

type Res = request.Response;
const kindOf = (res: Res): string | undefined =>
  res.body?.error?.details?.find((d: { field: string }) => d.field === "kind")?.message;
const detailOf = (res: Res, field: string): string | undefined =>
  res.body?.error?.details?.find((d: { field: string }) => d.field === field)?.message;

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-2 — 044..048 thành phần lương", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tFull = "";
  let tView = "";
  let tNone = "";
  let tDept = "";
  let fullUserId = "";
  let luongId = "";
  let tongKhauTruId = "";
  let otherTenantComponentId = "";

  const http = () => request(app.getHttpServer());
  /** Verb TƯỜNG MINH — `route-http-coverage` nhận verb qua literal `.patch(`/`.put(`, không qua `http()[method]`. */
  const pick = (method: "get" | "post" | "patch" | "put", url: string) => {
    const agent = http();
    if (method === "get") return agent.get(url);
    if (method === "post") return agent.post(url);
    if (method === "patch") return agent.patch(url);
    return agent.put(url);
  };
  const call = (method: "get" | "post" | "patch" | "put", token: string, url: string) =>
    pick(method, url).set("Authorization", `Bearer ${token}`);

  async function grant(userId: string, label: string, pairs: Array<[string, string]>, scope: "Company" | "Department" = "Company") {
    const roleId = await seedRole(direct, A.companyId, `s15cmp-${label}-${randomUUID().slice(0, 6)}`);
    for (const [action, resource] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, true);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function login(email: string): Promise<string> {
    const res = await http().post("/auth/login").send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function componentId(companyId: string, code: string): Promise<string> {
    const r = await direct.query(
      `SELECT id FROM salary_components WHERE company_id = $1 AND code = $2 AND deleted_at IS NULL`,
      [companyId, code],
    );
    return r.rows[0].id as string;
  }

  async function createComponent(body: Record<string, unknown>): Promise<string> {
    const res = await call("post", tFull, "/payroll/salary-components").send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function defaultTemplateId(): Promise<string> {
    const r = await direct.query(
      `SELECT id FROM payroll_templates WHERE company_id = $1 AND code = 'MAU_MAC_DINH' AND deleted_at IS NULL`,
      [A.companyId],
    );
    return r.rows[0].id as string;
  }

  /** Đặt lại thành phần của mẫu = thành phần hiện có của MẪU MẶC ĐỊNH + `extraIds`. */
  async function putDefaultPlus(templateId: string, extraIds: string[]): Promise<Res> {
    const detail = await call("get", tFull, `/payroll/templates/${await defaultTemplateId()}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const existing = detail.body.data.components.map(
      (c: { componentId: string; columnLabel: string | null; formulaOverride: string | null; isVisible: boolean; sortOrder: number }) => ({
        componentId: c.componentId,
        columnLabel: c.columnLabel,
        formulaOverride: c.formulaOverride,
        isVisible: c.isVisible,
        sortOrder: c.sortOrder,
      }),
    );
    return call("put", tFull, `/payroll/templates/${templateId}/components`).send({
      components: [...existing, ...extraIds.map((id, i) => ({ componentId: id, sortOrder: 900 + i }))],
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s15cmpa");
    B = await seedCompany(direct, "s15cmpb");
    companyIds.push(A.companyId, B.companyId);

    // Catalog hệ thống + mẫu mặc định qua runner THẬT (NODE_ENV=test tắt seed-on-boot).
    const runner = app.get(MasterDataSeedRunner, { strict: false });
    for (const c of [A.companyId, B.companyId]) {
      const outcomes = await runner.reconcileCompany(c);
      expect(outcomes.every((o) => o.ok), JSON.stringify(outcomes)).toBe(true);
    }
    luongId = await componentId(A.companyId, "LUONG_CO_BAN");
    tongKhauTruId = await componentId(A.companyId, "TONG_KHAU_TRU");
    otherTenantComponentId = await componentId(B.companyId, "LUONG_CO_BAN");

    const mk = async (label: string, pairs: Array<[string, string]>, scope: "Company" | "Department" = "Company") => {
      const email = `${label}@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      if (pairs.length > 0) await grant(uid, label, pairs, scope);
      return { uid, token: await login(email) };
    };
    const full = await mk("full", [
      ["view", "salary-component"],
      ["manage", "salary-component"],
      ["view", "payroll-template"],
      ["manage", "payroll-template"],
    ]);
    tFull = full.token;
    fullUserId = full.uid;
    tView = (await mk("viewonly", [["view", "salary-component"]])).token;
    tNone = (await mk("nopairs", [])).token;
    tDept = (
      await mk(
        "dept",
        [
          ["view", "salary-component"],
          ["manage", "salary-component"],
        ],
        "Department",
      )
    ).token;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
  });

  // ── A. ALLOW / DENY ───────────────────────────────────────────────────────────────────────────
  it("A1 — ALLOW 044: danh sách có thành phần hệ thống; lọc isSystem=false ⇒ chỉ hàng tự thêm", async () => {
    const all = await call("get", tFull, "/payroll/salary-components?per_page=100");
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const codes = all.body.data.map((c: { code: string }) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["LUONG_CO_BAN", "TONG_KHAU_TRU", "THUONG", "PHAT", "TAM_UNG"]));
    const custom = await call("get", tFull, "/payroll/salary-components?isSystem=false");
    expect(custom.status).toBe(200);
    expect(custom.body.data.every((c: { isSystem: boolean }) => c.isSystem === false)).toBe(true);
  });

  it("A2 — DENY: không cặp ⇒ 403 044 · view-only ⇒ 403 045/047/048 (048 gác cặp GHI) · grant Department ⇒ 403 (sàn)", async () => {
    expect((await call("get", tNone, "/payroll/salary-components")).status).toBe(403);
    expect(
      (await call("post", tView, "/payroll/salary-components").send({ code: "X1", name: "x", kind: "earning", valueType: "profile_item" }))
        .status,
    ).toBe(403);
    expect((await call("patch", tView, `/payroll/salary-components/${luongId}`).send({ name: "x" })).status).toBe(403);
    expect(
      (await call("post", tView, "/payroll/salary-components/validate-formula").send({ formula: "1" })).status,
    ).toBe(403);
    expect((await call("get", tDept, "/payroll/salary-components")).status).toBe(403);
    // ALLOW song sinh cho view-only trên route ĐỌC:
    expect((await call("get", tView, `/payroll/salary-components/${luongId}`)).status).toBe(200);
  });

  it("A3 — cross-tenant ⇒ 404 PAYROLL-ERR-010 trên 046 và 047 (không 403, không đụng hàng tenant B)", async () => {
    const g = await call("get", tFull, `/payroll/salary-components/${otherTenantComponentId}`);
    expect(g.status).toBe(404);
    expect(g.body.error.code).toBe("PAYROLL-ERR-010");
    const p = await call("patch", tFull, `/payroll/salary-components/${otherTenantComponentId}`).send({ name: "doi" });
    expect(p.status).toBe(404);
    const check = await direct.query(`SELECT name FROM salary_components WHERE id = $1`, [otherTenantComponentId]);
    expect(check.rows[0].name).toBe("Lương cơ bản");
  });

  // ── B. Giới hạn tĩnh + envelope ───────────────────────────────────────────────────────────────
  it("B1 — 045 tạo công thức hợp lệ ⇒ 201 envelope CHỈ `{id}`; 046 chi tiết có usedByTemplates []", async () => {
    const res = await call("post", tFull, "/payroll/salary-components").send({
      code: "PC_DI_LAI",
      name: "Phụ cấp đi lại",
      kind: "earning",
      valueType: "formula",
      formula: "SYS_BASE_SALARY * 5 / 100",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(Object.keys(res.body.data)).toEqual(["id"]);
    const detail = await call("get", tFull, `/payroll/salary-components/${res.body.data.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ code: "PC_DI_LAI", isSystem: false, usedByTemplates: [] });
  });

  it("B2 — 🔴 công thức 501 ký tự ⇒ 422 PAYROLL-ERR-018 `formula-too-long`, KHÔNG 400 (Zod không cap)", async () => {
    const res = await call("post", tFull, "/payroll/salary-components").send({
      code: "DAI_QUA",
      name: "dài",
      kind: "earning",
      valueType: "formula",
      formula: "1" + " ".repeat(500),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("PAYROLL-ERR-018");
    expect(kindOf(res)).toBe("formula-too-long");
  });

  it("B3 — tham chiếu lạ / hàm lạ / vòng qua aggregate ⇒ 422 với đúng mã + kind", async () => {
    const base = { name: "x", kind: "earning", valueType: "formula" };
    const ref = await call("post", tFull, "/payroll/salary-components").send({ ...base, code: "R1", formula: "KHONG_TON_TAI + 1" });
    expect(ref.status).toBe(422);
    expect(kindOf(ref)).toBe("formula-unknown-ref");
    expect(detailOf(ref, "ref")).toBe("KHONG_TON_TAI");

    const fn = await call("post", tFull, "/payroll/salary-components").send({ ...base, code: "R2", formula: "SQRT(4)" });
    expect(fn.status).toBe(422);
    expect(kindOf(fn)).toBe("formula-unknown-function");

    const cyc = await call("post", tFull, "/payroll/salary-components").send({ ...base, code: "HOA_HONG", formula: "TONG_THU_NHAP * 0.1" });
    expect(cyc.status, JSON.stringify(cyc.body)).toBe(422);
    expect(cyc.body.error.code).toBe("PAYROLL-ERR-019");
    expect(kindOf(cyc)).toBe("formula-cycle");
    expect(detailOf(cyc, "cycle")).toContain("TONG_THU_NHAP");

    // ĐỐI CHỨNG: cùng công thức nhưng là khoản KHẤU TRỪ ⇒ không vòng ⇒ 201.
    const ok = await call("post", tFull, "/payroll/salary-components").send({
      code: "DOAN_PHI_TU_NGUYEN",
      name: "đoàn phí tự nguyện",
      kind: "deduction",
      valueType: "formula",
      formula: "TONG_THU_NHAP * 0.01",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  // ── C. Shadowing ba nhánh ──────────────────────────────────────────────────────────────────────
  it("C1 — mã dành riêng (tiền tố SYS_/TL_/GT_ · mã hệ thống · tên hàm · từ khoá) ⇒ 409 PAYROLL-ERR-024 `component-code-reserved`", async () => {
    for (const code of ["SYS_GROSS", "TL_X", "GT_Y", "TONG_KHAU_TRU", "LUONG_CO_BAN", "MIN", "AND"]) {
      const res = await call("post", tFull, "/payroll/salary-components").send({ code, name: "x", kind: "earning", valueType: "profile_item" });
      expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.error.code).toBe("PAYROLL-ERR-024");
      expect(kindOf(res)).toBe("component-code-reserved");
    }
  });

  it("C2 — trùng mã tự thêm đang sống ⇒ 409 024 `component-code-exists` (chốt cuối UNIQUE partial THẬT)", async () => {
    await createComponent({ code: "PC_TRUNG", name: "a", kind: "earning", valueType: "profile_item" });
    const dup = await call("post", tFull, "/payroll/salary-components").send({ code: "PC_TRUNG", name: "b", kind: "earning", valueType: "profile_item" });
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
    expect(kindOf(dup)).toBe("component-code-exists");
  });

  it("C3 — 🔴 nhánh XOÁ MỀM: xoá mềm hàng hệ thống bằng SQL thẳng bị CHECK chặn ở DB (23514)", async () => {
    await expect(
      direct.query(`UPDATE salary_components SET deleted_at = now() WHERE company_id = $1 AND code = 'TONG_KHAU_TRU'`, [
        A.companyId,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "salary_components_system_not_deletable" });
  });

  // ── D. Hàng hệ thống ĐÓNG BĂNG (M1) + trigger THẬT (M2) ───────────────────────────────────────
  it("D1 — M1: 047 đổi công thức / ngưng dùng hàng hệ thống ⇒ 409 024 `system-component-immutable`; đổi tên ⇒ 200", async () => {
    const f = await call("patch", tFull, `/payroll/salary-components/${luongId}`).send({ formula: "1" });
    expect(f.status, JSON.stringify(f.body)).toBe(409);
    expect(f.body.error.code).toBe("PAYROLL-ERR-024");
    expect(kindOf(f)).toBe("system-component-immutable");
    const a = await call("patch", tFull, `/payroll/salary-components/${tongKhauTruId}`).send({ isActive: false });
    expect(a.status).toBe(409);
    expect(kindOf(a)).toBe("system-component-immutable");
    const del = await call("patch", tFull, `/payroll/salary-components/${tongKhauTruId}`).send({ delete: true });
    expect(kindOf(del)).toBe("system-component-immutable");

    const name = await call("patch", tFull, `/payroll/salary-components/${luongId}`).send({ name: "Lương cơ bản (đổi tên)", sortOrder: 11 });
    expect(name.status, JSON.stringify(name.body)).toBe(200);
  });

  it("D2 — M2: trigger ĐÓNG BĂNG THẬT (gọi thẳng repository, bỏ tiền-kiểm) ⇒ 23514 KHÔNG tên ⇒ map 024, KHÔNG 013", async () => {
    const repo = app.get(SalaryComponentsRepository, { strict: false });
    const db = app.get(DatabaseService, { strict: false });
    let caught: unknown;
    try {
      await db.withTenant(A.companyId, (tx) => repo.updateTx(tx, A.companyId, luongId, { formula: "1" }, fullUserId));
    } catch (err) {
      caught = err;
    }
    expect(pgErrorCode(caught)).toBe("23514");
    expect(pgErrorField(caught, "constraint") ?? "").toBe("");
    const mapped = mapPayrollPgError(caught) as HttpException;
    const body = mapped.getResponse() as { code: string; details: Array<{ field: string; message: string }> };
    expect(body.code).toBe("PAYROLL-ERR-024");
    expect(body.details.find((d) => d.field === "kind")?.message).toBe("system-component-immutable");
  });

  // ── E. Đang dùng · làm vỡ mẫu · vòng do pitDeductible ─────────────────────────────────────────
  it("E1 — component-in-use: thành phần trong mẫu sống ⇒ ngưng dùng/xoá 409 024 (details liệt kê mẫu); mẫu XOÁ MỀM không tính", async () => {
    const inDefault = await createComponent({ code: "AN_TRUA", name: "Ăn trưa", kind: "tax_exempt", valueType: "fixed", fixedAmount: 730000 });
    const tpl = await defaultTemplateId();
    const put = await putDefaultPlus(tpl, [inDefault]);
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    const off = await call("patch", tFull, `/payroll/salary-components/${inDefault}`).send({ isActive: false });
    expect(off.status, JSON.stringify(off.body)).toBe(409);
    expect(kindOf(off)).toBe("component-in-use");
    expect(detailOf(off, "templates")).toContain("MAU_MAC_DINH");
    expect(kindOf(await call("patch", tFull, `/payroll/salary-components/${inDefault}`).send({ delete: true }))).toBe(
      "component-in-use",
    );
    const detail = await call("get", tFull, `/payroll/salary-components/${inDefault}`);
    expect(detail.body.data.usedByTemplates.map((t: { code: string }) => t.code)).toEqual(["MAU_MAC_DINH"]);

    // Mẫu XOÁ MỀM không giữ thành phần «đang dùng» (MF15).
    const onlyInDeleted = await createComponent({ code: "PC_TAM", name: "tạm", kind: "earning", valueType: "profile_item" });
    const created = await call("post", tFull, "/payroll/templates").send({ code: "MAU_SE_XOA", name: "Mẫu sẽ xoá" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await putDefaultPlus(created.body.data.id, [onlyInDeleted])).status).toBe(200);
    expect((await call("patch", tFull, `/payroll/templates/${created.body.data.id}`).send({ delete: true })).status).toBe(200);
    const nowFree = await call("patch", tFull, `/payroll/salary-components/${onlyInDeleted}`).send({ isActive: false });
    expect(nowFree.status, JSON.stringify(nowFree.body)).toBe(200);
  });

  it("E2 — 047 đổi công thức sang REF KHÔNG có trong mẫu chứa nó ⇒ 422 018 `formula-unknown-ref` kèm mã mẫu", async () => {
    const inTpl = await createComponent({ code: "PC_HIEU_SUAT", name: "hiệu suất", kind: "earning", valueType: "formula", formula: "SYS_BASE_SALARY * 0.1" });
    const outside = await createComponent({ code: "PC_NGOAI_MAU", name: "ngoài mẫu", kind: "earning", valueType: "fixed", fixedAmount: 1000 });
    expect((await putDefaultPlus(await defaultTemplateId(), [inTpl])).status).toBe(200);

    const bad = await call("patch", tFull, `/payroll/salary-components/${inTpl}`).send({ formula: "PC_NGOAI_MAU * 2" });
    expect(bad.status, JSON.stringify(bad.body)).toBe(422);
    expect(kindOf(bad)).toBe("formula-unknown-ref");
    expect(detailOf(bad, "template")).toBe("MAU_MAC_DINH");
    // ĐỐI CHỨNG: REF CÓ trong mẫu ⇒ 200.
    const ok = await call("patch", tFull, `/payroll/salary-components/${inTpl}`).send({ formula: "LUONG_CO_BAN * 0.1" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(outside).toBeTruthy();
  });

  it("E3 — MF3: lật `pitDeductible` làm khoản BH tham chiếu thu nhập tính thuế thành VÒNG ⇒ 422 019", async () => {
    const s = await createComponent({
      code: "BH_TU_NGUYEN",
      name: "BH tự nguyện",
      kind: "statutory_employee",
      valueType: "formula",
      formula: "THU_NHAP_CHIU_THUE * 0",
      pitDeductible: false,
    });
    const flip = await call("patch", tFull, `/payroll/salary-components/${s}`).send({ pitDeductible: true });
    expect(flip.status, JSON.stringify(flip.body)).toBe(422);
    expect(flip.body.error.code).toBe("PAYROLL-ERR-019");
    expect(kindOf(flip)).toBe("formula-cycle");
  });

  it("E4 — cặp valueType kiểm trên hàng SAU MERGE: đổi sang formula không gửi công thức ⇒ 422 018 `component-value-pair`; gửi đủ ⇒ 200 và số tiền cố định tự về NULL", async () => {
    const fx = await createComponent({ code: "PC_CO_DINH", name: "cố định", kind: "earning", valueType: "fixed", fixedAmount: 500000 });
    const bad = await call("patch", tFull, `/payroll/salary-components/${fx}`).send({ valueType: "formula" });
    expect(bad.status, JSON.stringify(bad.body)).toBe(422);
    expect(kindOf(bad)).toBe("component-value-pair");
    const ok = await call("patch", tFull, `/payroll/salary-components/${fx}`).send({ valueType: "formula", formula: "SYS_BASE_SALARY" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const row = await direct.query(`SELECT value_type, formula, fixed_amount FROM salary_components WHERE id = $1`, [fx]);
    expect(row.rows[0]).toMatchObject({ value_type: "formula", formula: "SYS_BASE_SALARY", fixed_amount: null });
  });

  // ── F. 048 kiểm tại chỗ ────────────────────────────────────────────────────────────────────────
  it("F1 — 048 luôn 200: hợp lệ ⇒ valid:true + refs; sai cú pháp ⇒ valid:false kèm pos; 10.000 ký tự ⇒ too-long (không 400)", async () => {
    const ok = await call("post", tFull, "/payroll/salary-components/validate-formula").send({ formula: "SYS_BASE_SALARY * TL_BHXH_NV / 100" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ valid: true, errors: [], refs: ["SYS_BASE_SALARY", "TL_BHXH_NV"] });

    const syn = await call("post", tFull, "/payroll/salary-components/validate-formula").send({ formula: "LUONG_CO_BAN +" });
    expect(syn.status).toBe(200);
    expect(syn.body.data.valid).toBe(false);
    expect(syn.body.data.errors[0]).toMatchObject({ code: "PAYROLL-ERR-018", kind: "formula-syntax", pos: 14 });

    const long = await call("post", tFull, "/payroll/salary-components/validate-formula").send({ formula: "1" + " ".repeat(9999) });
    expect(long.status).toBe(200);
    expect(long.body.data.errors[0].kind).toBe("formula-too-long");
  });

  it("F2 — 048: `kind` quyết định có vòng hay không (earning ⇒ vòng · deduction ⇒ hợp lệ)", async () => {
    const asEarning = await call("post", tFull, "/payroll/salary-components/validate-formula").send({ formula: "TONG_THU_NHAP * 0.1", kind: "earning" });
    expect(asEarning.body.data.valid).toBe(false);
    expect(asEarning.body.data.errors[0].kind).toBe("formula-cycle");
    const asDeduction = await call("post", tFull, "/payroll/salary-components/validate-formula").send({ formula: "TONG_THU_NHAP * 0.1", kind: "deduction" });
    expect(asDeduction.body.data.valid, JSON.stringify(asDeduction.body)).toBe(true);
  });

  // ── G. Audit · M3 ─────────────────────────────────────────────────────────────────────────────
  it("G1 — audit 047 ghi CHUỖI công thức cũ/mới (§13.6 I) và KHÔNG ghi số tiền (MF14)", async () => {
    const f = await createComponent({ code: "PC_AUDIT", name: "audit", kind: "earning", valueType: "formula", formula: "SYS_BASE_SALARY * 2" });
    expect((await call("patch", tFull, `/payroll/salary-components/${f}`).send({ formula: "SYS_BASE_SALARY * 3" })).status).toBe(200);
    const r = await direct.query(
      `SELECT action, before, after FROM audit_logs
        WHERE company_id = $1 AND object_type = 'salary_component' AND object_id = $2 AND action = 'update'
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, f],
    );
    expect(r.rows[0].before).toMatchObject({ formula: "SYS_BASE_SALARY * 2" });
    expect(r.rows[0].after).toMatchObject({ formula: "SYS_BASE_SALARY * 3", changedFields: ["formula"] });

    const fx = await createComponent({ code: "PC_TIEN", name: "tiền", kind: "earning", valueType: "fixed", fixedAmount: 7654321 });
    expect((await call("patch", tFull, `/payroll/salary-components/${fx}`).send({ fixedAmount: 1234567 })).status).toBe(200);
    const all = await direct.query(
      `SELECT before, after FROM audit_logs WHERE company_id = $1 AND object_type = 'salary_component' AND object_id = $2`,
      [A.companyId, fx],
    );
    const text = JSON.stringify(all.rows);
    expect(text).not.toContain("7654321");
    expect(text).not.toContain("1234567");
    expect(text).toContain("fixedAmount"); // TÊN trường có mặt trong changedFields — giá trị thì không
  });

  it("G2 — M3: route GHI track B KHÔNG chạm payroll_periods / payroll_period_lines (fixture có ≥ 1 kỳ + 1 dòng)", async () => {
    const period = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status) VALUES ($1, '2031-01', 'Draft') RETURNING id`,
      [A.companyId],
    );
    await direct.query(
      `INSERT INTO payroll_period_lines (company_id, payroll_period_id, user_id, input_snapshot_json, base_amount, gross, net)
       VALUES ($1, $2, $3, '{"src":"s15be2-m3"}'::jsonb, 100, 100, 100)`,
      [A.companyId, period.rows[0].id, fullUserId],
    );
    const snap = async () =>
      (
        await direct.query(
          `SELECT (SELECT count(*) || '|' || coalesce(max(updated_at)::text, '') FROM payroll_periods WHERE company_id = $1) AS p,
                  (SELECT count(*) || '|' || coalesce(max(updated_at)::text, '') FROM payroll_period_lines WHERE company_id = $1) AS l`,
          [A.companyId],
        )
      ).rows[0];
    const before = await snap();
    const id = await createComponent({ code: "PC_M3", name: "m3", kind: "earning", valueType: "formula", formula: "SYS_BASE_SALARY" });
    expect((await call("patch", tFull, `/payroll/salary-components/${id}`).send({ formula: "SYS_BASE_SALARY * 2" })).status).toBe(200);
    expect(await snap()).toEqual(before);
  });

  // ── H. Vá security-review FULL gate BE-2 ─────────────────────────────────────────────────────
  it("H1 — 🔴 047 trên hàng NGƯNG DÙNG vẫn parse công thức: 501 ký tự ⇒ 422 018 `formula-too-long` (không 500) · sai cú pháp ⇒ 422 `formula-syntax` (MEDIUM-2)", async () => {
    const id = await createComponent({ code: "NGUNG_PARSE", name: "ngưng", kind: "earning", valueType: "formula", formula: "SYS_BASE_SALARY" });
    const longOff = await call("patch", tFull, `/payroll/salary-components/${id}`).send({ isActive: false, formula: "1" + " ".repeat(500) });
    expect(longOff.status, JSON.stringify(longOff.body)).toBe(422);
    expect(kindOf(longOff)).toBe("formula-too-long");
    // ĐỐI CHỨNG: ngưng dùng với công thức hợp lệ ⇒ 200; rồi sửa công thức TRÊN hàng đã ngưng.
    const off = await call("patch", tFull, `/payroll/salary-components/${id}`).send({ isActive: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const syntax = await call("patch", tFull, `/payroll/salary-components/${id}`).send({ formula: "SYS_BASE_SALARY *" });
    expect(syntax.status, JSON.stringify(syntax.body)).toBe(422);
    expect(kindOf(syntax)).toBe("formula-syntax");
    const fine = await call("patch", tFull, `/payroll/salary-components/${id}`).send({ formula: "SYS_BASE_SALARY * 2" });
    expect(fine.status, JSON.stringify(fine.body)).toBe(200);
  });

  it("H2 — 🔴 047 `{delete:true}` kiểm lại đồ thị catalog y như `{isActive:false}`: X đang được Y tham chiếu ⇒ 422 018 `formula-unknown-ref`, X CÒN SỐNG (MEDIUM-3)", async () => {
    const x = await createComponent({ code: "GOC_X", name: "X", kind: "earning", valueType: "fixed", fixedAmount: 1000 });
    await createComponent({ code: "PHU_Y", name: "Y", kind: "earning", valueType: "formula", formula: "GOC_X * 2" });
    const del = await call("patch", tFull, `/payroll/salary-components/${x}`).send({ delete: true });
    expect(del.status, JSON.stringify(del.body)).toBe(422);
    expect(kindOf(del)).toBe("formula-unknown-ref");
    const still = await direct.query(`SELECT deleted_at FROM salary_components WHERE company_id = $1 AND id = $2`, [
      A.companyId,
      x,
    ]);
    expect(still.rows[0].deleted_at).toBeNull();
    // Song sinh: `{isActive:false}` cùng mã + cùng kind (hai đường rút hàng khỏi catalog phải NHƯ NHAU).
    expect(kindOf(await call("patch", tFull, `/payroll/salary-components/${x}`).send({ isActive: false }))).toBe(
      "formula-unknown-ref",
    );
  });

  it("H3 — 045 trùng mã ĐANG DÙNG kèm công thức tham chiếu thành phần ⇒ 409 024 `component-code-exists`, KHÔNG 422 019 chu trình rỗng (LOW-4)", async () => {
    await createComponent({ code: "TRUNG_CT", name: "gốc", kind: "earning", valueType: "formula", formula: "SYS_BASE_SALARY" });
    const dup = await call("post", tFull, "/payroll/salary-components").send({
      code: "TRUNG_CT",
      name: "trùng",
      kind: "earning",
      valueType: "formula",
      formula: "LUONG_CO_BAN + 1",
    });
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
    expect(dup.body.error.code).toBe("PAYROLL-ERR-024");
    expect(kindOf(dup)).toBe("component-code-exists");
  });

  it("H4 — đổi TÊN + thứ tự nút aggregate hệ thống (TONG_KHAU_TRU, value_type engine) ⇒ 200; đổi công thức vẫn 409 024 (silent-failure-hunter MEDIUM-1)", async () => {
    const id = await componentId(A.companyId, "TONG_KHAU_TRU");
    const res = await call("patch", tFull, `/payroll/salary-components/${id}`).send({ name: "Tổng khấu trừ (đổi tên)", sortOrder: 990 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const frozen = await call("patch", tFull, `/payroll/salary-components/${id}`).send({ formula: "1" });
    expect(frozen.status, JSON.stringify(frozen.body)).toBe(409);
    expect(kindOf(frozen)).toBe("system-component-immutable");
  });
});
