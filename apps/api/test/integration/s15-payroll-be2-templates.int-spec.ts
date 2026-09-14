/**
 * S15-PAYROLL-BE-2 — `PAYROLL-API-049..054`: mẫu bảng lương + xem trước (plan §4 · §9).
 *
 *   A. ALLOW/DENY per-pair (054 gác cặp GHI) + sàn Company + 404 cross-tenant.
 *   B. 050/052: trùng mã ⇒ 409 023 THẬT · đơn vị không tồn tại / đã xoá mềm / khác tenant ⇒ 404 · cặp scope sau merge.
 *   C. 053 đặt lại toàn bộ: 6 kind 018 + vòng trên TRẠNG THÁI SAU ⇒ 019 · audit kèm danh sách · fingerprint đổi đúng lúc.
 *   D. 054 xem trước: số đối soát tay trên mẫu mặc định · ẩn cột vẫn cộng (MF4) · thiếu SYS_WORK_DAYS ⇒ 020 ·
 *      bậc hỏng ⇒ 022 · 🔴 fail-closed mẫu thiếu aggregate ghi thẳng DB ⇒ 018 · 0 hàng audit + ALLOW song sinh.
 *   E. Ràng buộc THẬT qua repository (bỏ tiền-kiểm): FK đơn vị ⇒ 404 · FK thành phần ⇒ 018.
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
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { DatabaseService } from "../../src/db/db.service";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { PayrollTemplatesRepository } from "../../src/payroll/payroll-templates.repository";
import { mapPayrollPgError } from "../../src/payroll/payroll.errors";
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
const LOGIN_PW = "Passw0rd!s15be2tpl";

type Res = request.Response;
type ComponentInput = {
  componentId: string;
  columnLabel?: string | null;
  formulaOverride?: string | null;
  isVisible?: boolean;
  sortOrder?: number;
};
const kindOf = (res: Res): string | undefined =>
  res.body?.error?.details?.find((d: { field: string }) => d.field === "kind")?.message;
const detailOf = (res: Res, field: string): string | undefined =>
  res.body?.error?.details?.find((d: { field: string }) => d.field === field)?.message;

/** Số seed PAY-DEC-014 — preview KHÔNG đọc bảng tỉ lệ, client gửi. */
const STATUTORY = {
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
  personalDeduction: 11000000,
  dependentDeduction: 4400000,
  pitBrackets: [
    { upTo: 5000000, rate: 5 },
    { upTo: 10000000, rate: 10 },
    { upTo: 18000000, rate: 15 },
    { upTo: 32000000, rate: 20 },
    { upTo: 52000000, rate: 25 },
    { upTo: 80000000, rate: 30 },
    { upTo: null, rate: 35 },
  ],
};

const INPUTS = {
  SYS_BASE_SALARY: "20000000",
  SYS_PAY_RATIO: "100",
  SYS_PRESENT_DAYS: "22",
  SYS_WORK_DAYS: "22",
  SYS_INSURANCE_SALARY: "20000000",
  SYS_DEPENDENTS: "1",
};

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-2 — 049..054 mẫu bảng lương + xem trước", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tFull = "";
  let tViewTpl = "";
  let tNone = "";
  let tDept = "";
  let fullUserId = "";
  let defaultTplA = "";
  let defaultTplB = "";
  let luongId = "";
  let tongKhauTruId = "";
  let emptyTplId = "";

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

  async function grant(
    userId: string,
    label: string,
    pairs: Array<[string, string]>,
    scope: "Company" | "Department" = "Company",
  ) {
    const roleId = await seedRole(
      direct,
      A.companyId,
      `s15tpl-${label}-${randomUUID().slice(0, 6)}`,
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

  async function idOf(table: string, companyId: string, code: string): Promise<string> {
    const r = await direct.query(
      `SELECT id FROM ${table} WHERE company_id = $1 AND code = $2 AND deleted_at IS NULL`,
      [companyId, code],
    );
    return r.rows[0].id as string;
  }

  /** Danh sách thành phần HIỆN CÓ của mẫu mặc định A — khuôn cho mọi PUT hợp lệ. */
  async function defaultInputs(): Promise<ComponentInput[]> {
    const detail = await call("get", tFull, `/payroll/templates/${defaultTplA}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    return detail.body.data.components.map((c: Required<ComponentInput>) => ({
      componentId: c.componentId,
      columnLabel: c.columnLabel,
      formulaOverride: c.formulaOverride,
      isVisible: c.isVisible,
      sortOrder: c.sortOrder,
    }));
  }

  const putComponents = (templateId: string, components: ComponentInput[]) =>
    call("put", tFull, `/payroll/templates/${templateId}/components`).send({ components });

  const preview = (templateId: string, body: Record<string, unknown> = {}) =>
    call("post", tFull, `/payroll/templates/${templateId}/preview`).send({
      inputs: INPUTS,
      statutory: STATUTORY,
      ...body,
    });

  async function auditCount(): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1`,
      [A.companyId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s15tpla");
    B = await seedCompany(direct, "s15tplb");
    companyIds.push(A.companyId, B.companyId);

    const runner = app.get(MasterDataSeedRunner, { strict: false });
    for (const c of [A.companyId, B.companyId]) {
      const outcomes = await runner.reconcileCompany(c);
      expect(
        outcomes.every((o) => o.ok),
        JSON.stringify(outcomes),
      ).toBe(true);
    }
    defaultTplA = await idOf("payroll_templates", A.companyId, "MAU_MAC_DINH");
    defaultTplB = await idOf("payroll_templates", B.companyId, "MAU_MAC_DINH");
    luongId = await idOf("salary_components", A.companyId, "LUONG_CO_BAN");
    tongKhauTruId = await idOf("salary_components", A.companyId, "TONG_KHAU_TRU");

    const mk = async (label: string, pairs: Array<[string, string]>, scope: "Company" | "Department" = "Company") => {
      const email = `${label}@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      if (pairs.length > 0) await grant(uid, label, pairs, scope);
      return { uid, token: await login(email) };
    };
    const full = await mk("full", [
      ["view", "payroll-template"],
      ["manage", "payroll-template"],
      ["view", "salary-component"],
      ["manage", "salary-component"],
    ]);
    tFull = full.token;
    fullUserId = full.uid;
    tViewTpl = (await mk("viewtpl", [["view", "payroll-template"]])).token;
    tNone = (await mk("nopairs", [])).token;
    tDept = (
      await mk(
        "dept",
        [
          ["view", "payroll-template"],
          ["manage", "payroll-template"],
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
  it("A1 — ALLOW 049/051: mẫu mặc định có đủ thành phần hệ thống, fingerprint 64 hex, KHÔNG khoá fixedAmount", async () => {
    const list = await call("get", tFull, "/payroll/templates");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data.map((t: { code: string }) => t.code)).toContain("MAU_MAC_DINH");

    const detail = await call("get", tFull, `/payroll/templates/${defaultTplA}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.formulaSetFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const codes = detail.body.data.components.map((c: { code: string }) => c.code);
    expect(codes).toEqual(
      expect.arrayContaining(["LUONG_CO_BAN", "TONG_KHAU_TRU", "THUONG", "KPCD"]),
    );
    for (const c of detail.body.data.components) expect(c).not.toHaveProperty("fixedAmount");
  });

  it("A2 — DENY: không cặp ⇒ 403 · view-only ⇒ 403 trên 050/052/053/054 (054 gác cặp GHI) · Department ⇒ 403; ALLOW song sinh 051", async () => {
    expect((await call("get", tNone, "/payroll/templates")).status).toBe(403);
    expect(
      (await call("post", tViewTpl, "/payroll/templates").send({ code: "X", name: "x" })).status,
    ).toBe(403);
    expect(
      (await call("patch", tViewTpl, `/payroll/templates/${defaultTplA}`).send({ name: "x" }))
        .status,
    ).toBe(403);
    expect(
      (
        await call("put", tViewTpl, `/payroll/templates/${defaultTplA}/components`).send({
          components: [],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("post", tViewTpl, `/payroll/templates/${defaultTplA}/preview`).send({
          inputs: INPUTS,
          statutory: STATUTORY,
        })
      ).status,
    ).toBe(403);
    expect((await call("get", tDept, "/payroll/templates")).status).toBe(403);
    expect((await call("get", tViewTpl, `/payroll/templates/${defaultTplA}`)).status).toBe(200);
  });

  it("A3 — cross-tenant ⇒ 404 PAYROLL-ERR-010 trên 051 · 053 · 054", async () => {
    expect((await call("get", tFull, `/payroll/templates/${defaultTplB}`)).body.error.code).toBe(
      "PAYROLL-ERR-010",
    );
    expect((await putComponents(defaultTplB, [])).status).toBe(404);
    expect((await preview(defaultTplB)).status).toBe(404);
  });

  // ── B. 050 / 052 ──────────────────────────────────────────────────────────────────────────────
  it("B1 — 050 tạo ⇒ 201 envelope `{id}`; trùng mã ⇒ 409 PAYROLL-ERR-023 `template-code-exists` (UNIQUE THẬT)", async () => {
    const res = await call("post", tFull, "/payroll/templates").send({
      code: "MAU_TRONG",
      name: "Mẫu trống",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(Object.keys(res.body.data)).toEqual(["id"]);
    emptyTplId = res.body.data.id;
    const dup = await call("post", tFull, "/payroll/templates").send({
      code: "MAU_TRONG",
      name: "trùng",
    });
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
    expect(dup.body.error.code).toBe("PAYROLL-ERR-023");
    expect(kindOf(dup)).toBe("template-code-exists");
  });

  it("B2 — đơn vị: không tồn tại / xoá mềm / khác tenant ⇒ 404; sống ⇒ 201; 052 bỏ đơn vị mà giữ scope ⇒ 422 `template-scope-pair`; đổi scope=company ⇒ 200 tự bỏ đơn vị", async () => {
    const live = (
      await direct.query(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1,'Phòng A','department') RETURNING id`,
        [A.companyId],
      )
    ).rows[0].id;
    const dead = (
      await direct.query(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1,'Phòng cũ','department') RETURNING id`,
        [A.companyId],
      )
    ).rows[0].id;
    await direct.query(`UPDATE org_units SET deleted_at = now() WHERE id = $1`, [dead]);
    const foreign = (
      await direct.query(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1,'Phòng B','department') RETURNING id`,
        [B.companyId],
      )
    ).rows[0].id;

    for (const orgUnitId of [randomUUID(), dead, foreign]) {
      const res = await call("post", tFull, "/payroll/templates").send({
        code: `MAU_DV_${randomUUID().slice(0, 4).toUpperCase()}`,
        name: "x",
        scope: "org_unit",
        orgUnitId,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.error.code).toBe("PAYROLL-ERR-010");
    }
    const ok = await call("post", tFull, "/payroll/templates").send({
      code: "MAU_PHONG_A",
      name: "Mẫu phòng A",
      scope: "org_unit",
      orgUnitId: live,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);

    const pair = await call("patch", tFull, `/payroll/templates/${ok.body.data.id}`).send({
      orgUnitId: null,
    });
    expect(pair.status, JSON.stringify(pair.body)).toBe(422);
    expect(pair.body.error.code).toBe("PAYROLL-ERR-018");
    expect(kindOf(pair)).toBe("template-scope-pair");

    const toCompany = await call("patch", tFull, `/payroll/templates/${ok.body.data.id}`).send({
      scope: "company",
    });
    expect(toCompany.status, JSON.stringify(toCompany.body)).toBe(200);
    const row = await direct.query(
      `SELECT scope, org_unit_id FROM payroll_templates WHERE id = $1`,
      [ok.body.data.id],
    );
    expect(row.rows[0]).toMatchObject({ scope: "company", org_unit_id: null });
  });

  // ── C. 053 ────────────────────────────────────────────────────────────────────────────────────
  it("C1 — 053 từ chối đúng kind: >120 · trùng · không thuộc catalog · ghi đè engine · thiếu aggregate · công thức quá dài", async () => {
    const many = Array.from({ length: 121 }, () => ({ componentId: randomUUID() }));
    const tooMany = await putComponents(emptyTplId, many);
    expect(tooMany.status).toBe(422);
    expect(kindOf(tooMany)).toBe("template-too-many-components");

    const dup = await putComponents(emptyTplId, [
      { componentId: luongId },
      { componentId: luongId },
    ]);
    expect(kindOf(dup)).toBe("template-component-duplicate");

    const unknown = await putComponents(emptyTplId, [
      ...(await defaultInputs()),
      { componentId: randomUUID() },
    ]);
    expect(kindOf(unknown)).toBe("template-component-unknown");

    const overrideEngine = (await defaultInputs()).map((c) =>
      c.componentId === tongKhauTruId ? { ...c, formulaOverride: "1" } : c,
    );
    const eng = await putComponents(emptyTplId, overrideEngine);
    expect(eng.status, JSON.stringify(eng.body)).toBe(422);
    expect(kindOf(eng)).toBe("formula-override-not-allowed");

    const missing = await putComponents(emptyTplId, [{ componentId: luongId }]);
    expect(kindOf(missing)).toBe("template-missing-engine-nodes");
    expect(detailOf(missing, "missing")).toContain("TONG_KHAU_TRU");

    const long = (await defaultInputs()).map((c) =>
      c.componentId === luongId ? { ...c, formulaOverride: "1" + " ".repeat(500) } : c,
    );
    const tooLong = await putComponents(emptyTplId, long);
    expect(tooLong.body.error.code).toBe("PAYROLL-ERR-018");
    expect(kindOf(tooLong)).toBe("formula-too-long");
  });

  it("C2 — vòng kiểm trên TRẠNG THÁI SAU: ghi đè LUONG_CO_BAN = TONG_THU_NHAP ⇒ 422 PAYROLL-ERR-019 kèm mã mẫu", async () => {
    const cyc = (await defaultInputs()).map((c) =>
      c.componentId === luongId ? { ...c, formulaOverride: "TONG_THU_NHAP" } : c,
    );
    const res = await putComponents(emptyTplId, cyc);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("PAYROLL-ERR-019");
    expect(kindOf(res)).toBe("formula-cycle");
    expect(detailOf(res, "template")).toBe("MAU_TRONG");
  });

  it("C3 — 053 hợp lệ ⇒ 200, audit ghi danh sách trước/sau; fingerprint GIỮ khi đặt lại y nguyên, ĐỔI khi ghi đè công thức", async () => {
    const inputs = await defaultInputs();
    const put = await putComponents(emptyTplId, inputs);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const audit = await direct.query(
      `SELECT before, after FROM audit_logs WHERE company_id = $1 AND object_type = 'payroll_template' AND object_id = $2 AND action = 'update'
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, emptyTplId],
    );
    expect(audit.rows[0].before).toEqual({ components: [] });
    expect(audit.rows[0].after.components.length).toBe(inputs.length);

    const fp = async () =>
      (await call("get", tFull, `/payroll/templates/${emptyTplId}`)).body.data
        .formulaSetFingerprint as string;
    const fp1 = await fp();
    expect((await putComponents(emptyTplId, inputs)).status).toBe(200);
    expect(await fp()).toBe(fp1);
    expect(
      (
        await putComponents(
          emptyTplId,
          inputs.map((c) =>
            c.componentId === luongId ? { ...c, formulaOverride: "SYS_BASE_SALARY" } : c,
          ),
        )
      ).status,
    ).toBe(200);
    expect(await fp()).not.toBe(fp1);
  });

  // ── D. 054 xem trước ──────────────────────────────────────────────────────────────────────────
  it("D1 — 054 trên mẫu mặc định: số đối soát tay (lương 20tr · 1 NPT · không phụ cấp/thưởng/phạt)", async () => {
    const res = await preview(defaultTplA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const v = res.body.data.values;
    expect(v.TONG_THU_NHAP).toBe("20000000.00");
    expect(v.TONG_BH_NV).toBe("2100000.00"); // BH NV 8 + 1,5 + 1 % — KHÔNG đoàn phí
    expect(v.THU_NHAP_CHIU_THUE).toBe("2500000.00"); // 20tr − 2,1tr − 11tr − 4,4tr
    expect(v.TNCN).toBe("125000.00"); // 2,5tr × 5%
    expect(v.TONG_KHAU_TRU).toBe("2425000.00"); // BH NV 2,1tr + đoàn phí 200k + thuế 125k
    expect(v.BHXH_DN).toBe("3500000.00");
    expect(res.body.data.nodesVisited).toBeGreaterThan(0);
    expect(res.body.data.formulaSetFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      res.body.data.columns.find((c: { code: string }) => c.code === "LUONG_CO_BAN"),
    ).toMatchObject({ isVisible: true });
  });

  it("D2 — 054 KHÔNG ghi audit (§18.1 B), ALLOW song sinh: 050 trong cùng ca tăng audit đúng 1 hàng", async () => {
    const before = await auditCount();
    expect((await preview(defaultTplA)).status).toBe(200);
    expect(await auditCount()).toBe(before);
    expect(
      (await call("post", tFull, "/payroll/templates").send({ code: "MAU_DEM_AUDIT", name: "đếm" }))
        .status,
    ).toBe(201);
    expect(await auditCount()).toBe(before + 1);
  });

  it("D3 — MF4: cột ẨN vẫn cộng vào TONG_THU_NHAP (có mặt trong mẫu = đang bật)", async () => {
    const fx = await call("post", tFull, "/payroll/salary-components").send({
      code: "PC_AN_COT",
      name: "ẩn",
      kind: "earning",
      valueType: "fixed",
      fixedAmount: 1000000,
    });
    expect(fx.status, JSON.stringify(fx.body)).toBe(201);
    const t = await call("post", tFull, "/payroll/templates").send({
      code: "MAU_AN_COT",
      name: "ẩn cột",
    });
    expect(
      (
        await putComponents(t.body.data.id, [
          ...(await defaultInputs()),
          { componentId: fx.body.data.id, isVisible: false, sortOrder: 950 },
        ])
      ).status,
    ).toBe(200);
    const res = await preview(t.body.data.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.values.TONG_THU_NHAP).toBe("21000000.00");
  });

  it("D4 — thiếu SYS_WORK_DAYS ⇒ 422 PAYROLL-ERR-020 `division-by-zero` (FE PHẢI gửi); bậc TNCN 6 ⇒ 422 PAYROLL-ERR-022", async () => {
    const { SYS_WORK_DAYS: _omit, ...noWorkDays } = INPUTS;
    const dz = await preview(defaultTplA, { inputs: noWorkDays });
    expect(dz.status, JSON.stringify(dz.body)).toBe(422);
    expect(dz.body.error.code).toBe("PAYROLL-ERR-020");
    expect(kindOf(dz)).toBe("division-by-zero");

    const bad = await preview(defaultTplA, {
      statutory: { ...STATUTORY, pitBrackets: STATUTORY.pitBrackets.slice(1) },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("PAYROLL-ERR-022");
    expect(kindOf(bad)).toBe("statutory-rate-incomplete");
    expect(detailOf(bad, "reason")).toBe("count");
  });

  it("D5 — 🔴 FAIL-CLOSED: mẫu thiếu nút aggregate do GHI THẲNG DB ⇒ 422 018 `template-missing-engine-nodes`, KHÔNG 200 với số 0", async () => {
    const t = await call("post", tFull, "/payroll/templates").send({
      code: "MAU_HONG",
      name: "hỏng",
    });
    await direct.query(
      `INSERT INTO payroll_template_components (company_id, template_id, component_id, is_visible, sort_order)
       VALUES ($1, $2, $3, true, 10)`,
      [A.companyId, t.body.data.id, luongId],
    );
    const res = await preview(t.body.data.id);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("PAYROLL-ERR-018");
    expect(kindOf(res)).toBe("template-missing-engine-nodes");
  });

  // ── E. Ràng buộc THẬT (bỏ tiền-kiểm) ─────────────────────────────────────────────────────────
  it("E1 — FK THẬT: đơn vị không tồn tại ⇒ 23503 map 404 · thành phần không thuộc catalog ⇒ 23503 map 018", async () => {
    const repo = app.get(PayrollTemplatesRepository, { strict: false });
    const db = app.get(DatabaseService, { strict: false });
    const codeOf = (e: unknown) =>
      ((mapPayrollPgError(e) as HttpException).getResponse() as { code: string }).code;

    let orgErr: unknown;
    try {
      await db.withTenant(A.companyId, (tx) =>
        repo.createTx(
          tx,
          A.companyId,
          "MAU_FK_DV",
          { name: "fk", scope: "org_unit", orgUnitId: randomUUID() },
          fullUserId,
        ),
      );
    } catch (err) {
      orgErr = err;
    }
    expect(codeOf(orgErr)).toBe("PAYROLL-ERR-010");

    let compErr: unknown;
    try {
      await db.withTenant(A.companyId, (tx) =>
        repo.replaceComponentsTx(
          tx,
          A.companyId,
          emptyTplId,
          [
            {
              componentId: randomUUID(),
              columnLabel: null,
              formulaOverride: null,
              isVisible: true,
              sortOrder: 1,
            },
          ],
          fullUserId,
        ),
      );
    } catch (err) {
      compErr = err;
    }
    expect(codeOf(compErr)).toBe("PAYROLL-ERR-018");
    const mapped = mapPayrollPgError(compErr) as HttpException;
    expect(
      (mapped.getResponse() as { details: Array<{ field: string; message: string }> }).details.find(
        (d) => d.field === "kind",
      )?.message,
    ).toBe("template-component-unknown");
  });

  it("D6 — 🔴 FAIL-CLOSED: thành phần trong mẫu bị XOÁ MỀM bằng SQL thẳng ⇒ 054 422 018 `template-component-unknown` (security-review LOW-7)", async () => {
    const t = await call("post", tFull, "/payroll/templates").send({ code: "MAU_XOA_TP", name: "tp xoá" });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const extra = await call("post", tFull, "/payroll/salary-components").send({
      code: "TP_SE_XOA",
      name: "sẽ xoá",
      kind: "earning",
      valueType: "fixed",
      fixedAmount: 1000,
    });
    expect(extra.status, JSON.stringify(extra.body)).toBe(201);
    const put = await putComponents(t.body.data.id, [
      ...(await defaultInputs()),
      { componentId: extra.body.data.id, sortOrder: 990 },
    ]);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    // ĐỐI CHỨNG: trước khi xoá mềm, preview CÙNG mẫu ⇒ 200 (không thì ca dưới xanh-rỗng).
    const before = await preview(t.body.data.id);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    await direct.query(`UPDATE salary_components SET deleted_at = now() WHERE company_id = $1 AND id = $2`, [
      A.companyId,
      extra.body.data.id,
    ]);
    const res = await preview(t.body.data.id);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("PAYROLL-ERR-018");
    expect(kindOf(res)).toBe("template-component-unknown");
  });

  it("D7 — 054 khoá `profileItems` không khớp thành phần profile_item nào của mẫu ⇒ 422 018 `profile-item-unknown-component`, KHÔNG âm thầm = 0 (silent-failure-hunter MEDIUM-2)", async () => {
    const res = await preview(defaultTplA, { profileItems: { PHUCAP_GO_SAI: "500000" } });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("PAYROLL-ERR-018");
    expect(kindOf(res)).toBe("profile-item-unknown-component");
  });
});
