/**
 * S15-PAYROLL-BE-2B — trả nợ ghi nhận của `S15-PAYROLL-BE-2` trên ĐƯỜNG THẬT
 * (plan `docs/plans/S15-PAYROLL-BE-2B.md` §2 · §3, hợp đồng thi công §12).
 *
 *   N. N+1 `assertGraphsAfterEdit` — 047 đọc thành phần của MỌI mẫu chứa thành phần bằng MỘT câu.
 *      Gồm ca ORACLE ép method gộp đồng nhất `componentsTx` (typecheck KHÔNG bắt hoán vị hai cột
 *      cùng kiểu `boolean`, plan §12 B6) và ca DENY chứng minh gộp không lẫn dữ liệu giữa các mẫu.
 *   L. Trần catalog 200 hàng sống + `is_active` ⇒ 422 `PAYROLL-ERR-034` `component-catalog-limit`,
 *      áp ở 045 (hàng mới sẽ SỐNG+ACTIVE) và 047 (bật lại hàng đang tắt — plan §12 B2).
 *
 * VÌ SAO FILE RIÊNG chứ không nối vào `s15-payroll-be2-components.int-spec.ts` như plan §2.3 viết:
 * file đó đã 541 dòng, phần thêm ~260 dòng đẩy nó chạm trần 800 của CLAUDE.md §5. Fixture dựng lại ở
 * đây (không tách helper dùng chung) là CÓ CHỦ Ý — helper supertest dùng chung giữa hai int-spec từng
 * làm đỏ cổng `supertest-listen-ratchet` ở `S15-PAYROLL-BE-4`.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { DatabaseService } from "../../src/db/db.service";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { PayrollTemplatesRepository } from "../../src/payroll/payroll-templates.repository";
import { PAYROLL_CATALOG_COMPONENTS_MAX } from "../../src/payroll/salary-components.service";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
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
const LOGIN_PW = loginPasswordFixture("s15be2b");

type Res = request.Response;
const kindOf = (res: Res): string | undefined =>
  res.body?.error?.details?.find((d: { field: string }) => d.field === "kind")?.message;
const detailOf = (res: Res, field: string): string | undefined =>
  res.body?.error?.details?.find((d: { field: string }) => d.field === field)?.message;

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-2B — gộp N+1 047 · trần catalog 045/047", () => {
  let app: INestApplication;
  let direct: Pool;
  /** A = công ty của các ca N+1. L = công ty RIÊNG cho trần (đổ đầy 199 hàng, không nhiễu ca khác). */
  let A: SeededTenant;
  let L: SeededTenant;
  const companyIds: string[] = [];
  let tA = "";
  let tL = "";
  let templatesRepo: PayrollTemplatesRepository;
  let db: DatabaseService;
  let fillSeq = 0;

  const http = () => request(app.getHttpServer());
  const call = (method: "get" | "post" | "patch" | "put", token: string, url: string) => {
    const agent = http();
    if (method === "get") return agent.get(url).set("Authorization", `Bearer ${token}`);
    if (method === "post") return agent.post(url).set("Authorization", `Bearer ${token}`);
    if (method === "patch") return agent.patch(url).set("Authorization", `Bearer ${token}`);
    return agent.put(url).set("Authorization", `Bearer ${token}`);
  };

  async function grantFull(companyId: string, userId: string, label: string): Promise<void> {
    const roleId = await seedRole(
      direct,
      companyId,
      `s15be2b-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const [action, resource] of [
      ["view", "salary-component"],
      ["manage", "salary-component"],
      ["view", "payroll-template"],
      ["manage", "payroll-template"],
    ] as Array<[string, string]>) {
      const permId = await seedPermissionCatalog(direct, action, resource, true);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(company: SeededTenant, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: company.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Số hàng SỐNG + `is_active` — ĐÚNG predicate mà trần đo (`countActiveTx` / `listActiveTx`). */
  async function activeCount(companyId: string): Promise<number> {
    const r = await direct.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM salary_components
        WHERE company_id = $1 AND deleted_at IS NULL AND is_active = true`,
      [companyId],
    );
    return Number(r.rows[0].n);
  }

  /**
   * Đưa số hàng sống+active của công ty về ĐÚNG `target` — ghi THẲNG SQL, KHÔNG qua service (seeder/đường
   * ghi nội bộ cũng làm vậy; đi qua 045 thì chính trần đang đo lại chặn việc dựng fixture).
   * Mỗi ca tự gọi ⇒ ca không phụ thuộc THỨ TỰ chạy của ca khác.
   */
  async function setActiveTo(companyId: string, target: number): Promise<void> {
    const current = await activeCount(companyId);
    if (current < target) {
      const n = target - current;
      const base = fillSeq;
      fillSeq += n;
      await direct.query(
        `INSERT INTO salary_components (company_id, code, name, kind, value_type, fixed_amount, is_active, sort_order)
         SELECT $1, 'FILL_' || lpad((i + $3)::text, 5, '0'), 'filler ' || i, 'earning', 'fixed', 0.00, true, 500 + i
           FROM generate_series(1, $2::int) AS i`,
        [companyId, n, base],
      );
    } else if (current > target) {
      await direct.query(
        `UPDATE salary_components SET is_active = false
          WHERE id IN (SELECT id FROM salary_components
                        WHERE company_id = $1 AND deleted_at IS NULL AND is_active = true
                          AND code LIKE 'FILL\\_%'
                        LIMIT $2)`,
        [companyId, current - target],
      );
    }
    expect(await activeCount(companyId), `setActiveTo(${target})`).toBe(target);
  }

  const newCode = (p: string) => `${p}_${randomUUID().slice(0, 6)}`.toUpperCase().replace(/-/g, "");

  /** 045 — thân tối thiểu của một thành phần `fixed` (không đụng đồ thị công thức). */
  const fixedBody = (code: string, extra: Record<string, unknown> = {}) => ({
    code,
    name: `Thành phần ${code}`,
    kind: "earning",
    valueType: "fixed",
    fixedAmount: 1000,
    pitDeductible: false,
    ...extra,
  });

  /** 045 — thân của một thành phần `formula` (KHÔNG mang `fixedAmount`: Zod ép cặp giá trị). */
  const formulaBody = (code: string, formula: string) => ({
    code,
    name: `Thành phần ${code}`,
    kind: "earning",
    valueType: "formula",
    formula,
    pitDeductible: false,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    templatesRepo = app.get(PayrollTemplatesRepository, { strict: false });
    db = app.get(DatabaseService, { strict: false });
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s15b2ba");
    L = await seedCompany(direct, "s15b2bl");
    companyIds.push(A.companyId, L.companyId);

    const runner = app.get(MasterDataSeedRunner, { strict: false });
    for (const c of [A.companyId, L.companyId]) {
      const outcomes = await runner.reconcileCompany(c);
      expect(
        outcomes.every((o) => o.ok),
        JSON.stringify(outcomes),
      ).toBe(true);
    }

    const uA = await seedUser(direct, A.companyId, `full@${A.slug}.test`, hash);
    await grantFull(A.companyId, uA, "a");
    tA = await login(A, `full@${A.slug}.test`);
    const uL = await seedUser(direct, L.companyId, `full@${L.slug}.test`, hash);
    await grantFull(L.companyId, uL, "l");
    tL = await login(L, `full@${L.slug}.test`);

    // Hàng VẬT LÝ không được đếm: 5 xoá mềm + 5 `is_active = false`. Có mặt ở MỌI ca của công ty L ⇒
    // mọi lần chạm trần dưới đây đều diễn ra khi tổng hàng vật lý ĐÃ vượt xa số sống+active.
    await direct.query(
      `INSERT INTO salary_components (company_id, code, name, kind, value_type, fixed_amount, is_active, deleted_at, sort_order)
       SELECT $1, 'GHOST_D' || i, 'đã xoá ' || i, 'earning', 'fixed', 0.00, true, now(), 400 + i
         FROM generate_series(1, 5) AS i`,
      [L.companyId],
    );
    await direct.query(
      `INSERT INTO salary_components (company_id, code, name, kind, value_type, fixed_amount, is_active, sort_order)
       SELECT $1, 'GHOST_I' || i, 'đã tắt ' || i, 'earning', 'fixed', 0.00, false, 450 + i
         FROM generate_series(1, 5) AS i`,
      [L.companyId],
    );
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // N. Gộp N+1 ở `assertGraphsAfterEdit` (plan §2)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  describe("N. 047 đọc thành phần của MỌI mẫu bằng MỘT câu", () => {
    /** Mã thành phần tuỳ biến nằm trong CẢ ba mẫu. */
    let xId = "";
    let xCode = "";
    const templates: Array<{ id: string; code: string }> = [];

    /** Thành phần hiện có của mẫu mặc định — mọi mẫu mới phải chở đủ 4 nút aggregate, nếu không 018. */
    async function defaultComponents(): Promise<
      Array<{
        componentId: string;
        columnLabel: string | null;
        formulaOverride: string | null;
        isVisible: boolean;
        sortOrder: number;
      }>
    > {
      const r = await direct.query<{ id: string }>(
        `SELECT id FROM payroll_templates
          WHERE company_id = $1 AND code = 'MAU_MAC_DINH' AND deleted_at IS NULL`,
        [A.companyId],
      );
      const detail = await call("get", tA, `/payroll/templates/${r.rows[0].id}`);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      return detail.body.data.components.map(
        (c: {
          componentId: string;
          columnLabel: string | null;
          formulaOverride: string | null;
          isVisible: boolean;
          sortOrder: number;
        }) => ({
          componentId: c.componentId,
          columnLabel: c.columnLabel,
          formulaOverride: c.formulaOverride,
          isVisible: c.isVisible,
          sortOrder: c.sortOrder,
        }),
      );
    }

    beforeAll(async () => {
      if (!hasLaneDb) return;
      xCode = newCode("XN1");
      const created = await call("post", tA, "/payroll/salary-components").send({
        code: xCode,
        name: "Thành phần gộp",
        kind: "earning",
        valueType: "formula",
        formula: "SYS_BASE_SALARY * 0",
        pitDeductible: false,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      xId = created.body.data.id as string;

      const base = await defaultComponents();
      for (const suffix of ["T1", "T2", "T3"]) {
        const code = newCode(`TPL${suffix}`);
        const t = await call("post", tA, "/payroll/templates").send({
          code,
          name: `Mẫu ${suffix}`,
          scope: "company",
        });
        expect(t.status, JSON.stringify(t.body)).toBe(201);
        const id = t.body.data.id as string;
        const put = await call("put", tA, `/payroll/templates/${id}/components`).send({
          components: [...base, { componentId: xId, sortOrder: 900 }],
        });
        expect(put.status, JSON.stringify(put.body)).toBe(200);
        templates.push({ id, code });
      }
      // Thứ tự `templatesContainingTx` là `ORDER BY payroll_templates.code` — ghim để ca DENY đọc đúng mẫu.
      templates.sort((a, b) => a.code.localeCompare(b.code));
    }, 120_000);

    it("N1 — PATCH 047 hợp lệ với cả 3 mẫu: gộp gọi ĐÚNG 1 lần đủ 3 id, `componentsTx` 0 lần", async () => {
      const batched = vi.spyOn(templatesRepo, "componentsForTemplatesTx");
      const perTemplate = vi.spyOn(templatesRepo, "componentsTx");
      batched.mockClear();
      perTemplate.mockClear();

      const res = await call("patch", tA, `/payroll/salary-components/${xId}`).send({
        formula: "SYS_BASE_SALARY * 0 + 1",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expect(batched, "một câu cho MỌI mẫu — không phải một câu mỗi mẫu").toHaveBeenCalledTimes(1);
      const ids = batched.mock.calls[0][2] as readonly string[];
      expect([...ids].sort()).toEqual(templates.map((t) => t.id).sort());
      expect(
        perTemplate,
        "`componentsTx` KHÔNG được gọi trên đường 047 nữa (vòng lặp cũ đã gỡ)",
      ).toHaveBeenCalledTimes(0);

      batched.mockRestore();
      perTemplate.mockRestore();
    });

    it("N2 — ORACLE: mỗi bucket của method gộp deep-equal `componentsTx` của chính mẫu đó (giữ thứ tự)", async () => {
      // Đột biến-killer cho MỌI lệch cột/JOIN/`orderBy`: hoán vị hai cột cùng kiểu `boolean`
      // (`pitDeductible` ↔ `componentActive`) đi lọt typecheck nhưng đỏ ở đây.
      await db.withTenant(A.companyId, async (tx) => {
        const byTemplate = await templatesRepo.componentsForTemplatesTx(
          tx,
          A.companyId,
          templates.map((t) => t.id),
        );
        for (const t of templates) {
          const single = await templatesRepo.componentsTx(tx, A.companyId, t.id);
          expect(single.length, `mẫu ${t.code} phải có thành phần`).toBeGreaterThan(0);
          expect(byTemplate.get(t.id), `bucket của ${t.code}`).toEqual(single);
        }
      });
    });

    it("N3 — guard RỖNG: `componentsForTemplatesTx(tx, company, [])` trả Map rỗng, KHÔNG phát SQL", async () => {
      await db.withTenant(A.companyId, async (tx) => {
        const select = vi.spyOn(tx, "select");
        select.mockClear();
        const empty = await templatesRepo.componentsForTemplatesTx(tx, A.companyId, []);
        expect(empty.size).toBe(0);
        expect(select, "danh sách rỗng ⇒ không vòng nào tới DB").toHaveBeenCalledTimes(0);
        select.mockRestore();
      });
    });

    it("N3b — cách ly tenant: `templateId` của công ty KHÁC ⇒ bucket VẮNG (không rò thành phần chéo tenant)", async () => {
      // Method MỚI trên đường crown-jewel: `inArray` chỉ lọc theo `templateId`, nên vế `company_id` tường
      // minh + JOIN theo `company_id` là thứ DUY NHẤT chặn id của tenant khác (RLS FORCE là lưới cuối).
      const foreign = await direct.query<{ id: string }>(
        `SELECT id FROM payroll_templates
          WHERE company_id = $1 AND code = 'MAU_MAC_DINH' AND deleted_at IS NULL`,
        [L.companyId],
      );
      const foreignId = foreign.rows[0].id;
      await db.withTenant(A.companyId, async (tx) => {
        const mixed = await templatesRepo.componentsForTemplatesTx(tx, A.companyId, [
          templates[0].id,
          foreignId,
        ]);
        expect(
          mixed.get(templates[0].id)?.length,
          "mẫu của CHÍNH công ty vẫn trả về",
        ).toBeGreaterThan(0);
        expect(mixed.has(foreignId), "mẫu của công ty KHÁC không được có bucket").toBe(false);
      });
    });

    it("N4 — DENY đối chứng: vỡ đồ thị CHỈ ở một mẫu ⇒ 422 018 nêu ĐÚNG mẫu đó (gộp không lẫn dữ liệu)", async () => {
      // Ghi đè công thức của `X` ở MẪU THỨ HAI thành tham chiếu tới chính `X` ⇒ chỉ mẫu đó thành vòng.
      const target = templates[1];
      const base = await defaultComponents();
      const put = await call("put", tA, `/payroll/templates/${target.id}/components`).send({
        components: [
          ...base,
          { componentId: xId, sortOrder: 900, formulaOverride: `${xCode} + 1` },
        ],
      });
      expect(put.status, JSON.stringify(put.body)).toBe(422);
      expect(put.body.error.code, "vòng tự tham chiếu bị chặn ngay lúc đặt mẫu").toBe(
        "PAYROLL-ERR-019",
      );

      // ── Vế THỨ HAI: mỗi bucket phải mang ĐÚNG thành phần của mẫu mình ──────────────────────────
      // Dựng một mã `Z` CHỈ có mặt ở mẫu thứ hai, rồi cho `X` (nằm trong CẢ BA mẫu) tham chiếu `Z`.
      // Hai mẫu KHÔNG chứa `Z` phải vỡ vì REF không phân giải được; mẫu chứa `Z` thì KHÔNG.
      //
      // Đây là đột biến-killer của việc gộp truy vấn:
      //   · gộp trả NHẦM «hợp của mọi mẫu» cho từng mẫu ⇒ mẫu nào cũng thấy `Z` ⇒ 200, ca này ĐỎ;
      //   · gán nhầm bucket sang mẫu khác ⇒ `details.template` chỉ vào mẫu CHỨA `Z`, ca này ĐỎ.
      const zCode = newCode("ONLYSECOND");
      const z = await call("post", tA, "/payroll/salary-components").send(
        formulaBody(zCode, "SYS_BASE_SALARY * 0"),
      );
      expect(z.status, JSON.stringify(z.body)).toBe(201);
      const zId = z.body.data.id as string;
      const putSecond = await call("put", tA, `/payroll/templates/${target.id}/components`).send({
        components: [
          ...base,
          { componentId: xId, sortOrder: 900 },
          { componentId: zId, sortOrder: 901 },
        ],
      });
      expect(putSecond.status, JSON.stringify(putSecond.body)).toBe(200);

      const denied = await call("patch", tA, `/payroll/salary-components/${xId}`).send({
        formula: `${zCode} + 1`,
      });
      expect(denied.status, JSON.stringify(denied.body)).toBe(422);
      expect(denied.body.error.code).toBe("PAYROLL-ERR-018");
      // `compileOrThrow` dừng ở mẫu VỠ ĐẦU TIÊN theo thứ tự `ORDER BY payroll_templates.code`.
      expect(detailOf(denied, "template"), "mẫu vỡ đầu tiên theo thứ tự mã").toBe(
        templates[0].code,
      );
      expect(
        detailOf(denied, "template"),
        "mẫu CHỨA Z là mẫu DUY NHẤT không được vỡ — báo tên nó nghĩa là bucket bị gán nhầm",
      ).not.toBe(target.code);

      // ALLOW song sinh: cho CẢ BA mẫu cùng chứa `Z` ⇒ chính công thức vừa bị từ chối nay đi qua.
      for (const t of templates.filter((x) => x.id !== target.id)) {
        const put3 = await call("put", tA, `/payroll/templates/${t.id}/components`).send({
          components: [
            ...base,
            { componentId: xId, sortOrder: 900 },
            { componentId: zId, sortOrder: 901 },
          ],
        });
        expect(put3.status, JSON.stringify(put3.body)).toBe(200);
      }
      const allowed = await call("patch", tA, `/payroll/salary-components/${xId}`).send({
        formula: `${zCode} + 1`,
      });
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);

      // Dọn: trả `X` về công thức không tham chiếu, để ca sau không kế thừa trạng thái này.
      const back = await call("patch", tA, `/payroll/salary-components/${xId}`).send({
        formula: "SYS_BASE_SALARY * 0",
      });
      expect(back.status, JSON.stringify(back.body)).toBe(200);
    });

    it("N5 — thành phần KHÔNG nằm trong mẫu nào: 047 không gọi method gộp lần nào", async () => {
      const lone = await call("post", tA, "/payroll/salary-components").send(
        formulaBody(newCode("LONE"), "SYS_BASE_SALARY * 0"),
      );
      expect(lone.status, JSON.stringify(lone.body)).toBe(201);

      const batched = vi.spyOn(templatesRepo, "componentsForTemplatesTx");
      batched.mockClear();
      const res = await call(
        "patch",
        tA,
        `/payroll/salary-components/${lone.body.data.id as string}`,
      ).send({ formula: "SYS_BASE_SALARY * 0 + 2" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(batched, "0 mẫu chứa thành phần ⇒ không câu SQL thừa").toHaveBeenCalledTimes(0);
      batched.mockRestore();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // L. Trần catalog 200 hàng sống + active (plan §3 · §12 B2)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  describe("L. trần catalog ⇒ 422 PAYROLL-ERR-034 component-catalog-limit", () => {
    const MAX = PAYROLL_CATALOG_COMPONENTS_MAX;

    it("L0 — neo hằng: trần là 200 (đổi số ở service phải đổi cả hợp đồng SPEC-11 §12.1)", () => {
      expect(MAX).toBe(200);
    });

    it("L1 — ALLOW biên dưới: đang 199 ⇒ tạo hàng thứ 200 vẫn 201 (chạm ĐÚNG trần vẫn qua)", async () => {
      await setActiveTo(L.companyId, MAX - 1);
      const res = await call("post", tL, "/payroll/salary-components").send(
        fixedBody(newCode("EDGE199")),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await activeCount(L.companyId)).toBe(MAX);
    });

    it("L2 — DENY biên trên: đang 200 ⇒ 422 PAYROLL-ERR-034 với total/max đọc được", async () => {
      await setActiveTo(L.companyId, MAX);
      const res = await call("post", tL, "/payroll/salary-components").send(
        fixedBody(newCode("OVER200")),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.code).toBe("PAYROLL-ERR-034");
      expect(kindOf(res)).toBe("component-catalog-limit");
      expect(detailOf(res, "total")).toBe(String(MAX));
      expect(detailOf(res, "max")).toBe(String(MAX));
      expect(await activeCount(L.companyId), "request bị từ chối ⇒ KHÔNG hàng nào được ghi").toBe(
        MAX,
      );
    });

    it("L3 — không đếm nhầm: tổng hàng VẬT LÝ > 200 nhưng sống+active = 199 ⇒ vẫn 201", async () => {
      await setActiveTo(L.companyId, MAX - 1);
      const physical = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM salary_components WHERE company_id = $1`,
        [L.companyId],
      );
      expect(
        Number(physical.rows[0].n),
        "fixture phải có hàng xoá mềm + hàng tắt để ca này đo được thứ nó tuyên bố",
      ).toBeGreaterThan(MAX);
      const res = await call("post", tL, "/payroll/salary-components").send(
        fixedBody(newCode("NOTCOUNT")),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it("L4 — ALLOW ở trần: 045 với `isActive:false` KHÔNG bị chặn (không làm phình tập compile)", async () => {
      await setActiveTo(L.companyId, MAX);
      const res = await call("post", tL, "/payroll/salary-components").send(
        fixedBody(newCode("INACT"), { isActive: false }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await activeCount(L.companyId), "hàng tắt không vào tập sống+active").toBe(MAX);
    });

    it("L5 — DENY đường VÒNG: 047 bật lại hàng đang tắt khi đã ở trần ⇒ 422 PAYROLL-ERR-034", async () => {
      await setActiveTo(L.companyId, MAX);
      const off = await call("post", tL, "/payroll/salary-components").send(
        fixedBody(newCode("REACT"), { isActive: false }),
      );
      expect(off.status, JSON.stringify(off.body)).toBe(201);
      const id = off.body.data.id as string;

      const denied = await call("patch", tL, `/payroll/salary-components/${id}`).send({
        isActive: true,
      });
      expect(
        denied.status,
        "thiếu cổng này thì «tạo N hàng tắt rồi bật từng hàng» biến trần thành trang trí",
      ).toBe(422);
      expect(denied.body.error.code).toBe("PAYROLL-ERR-034");
      expect(kindOf(denied)).toBe("component-catalog-limit");

      // ALLOW song sinh: hạ xuống 199 thì CHÍNH hàng đó bật lại được.
      await setActiveTo(L.companyId, MAX - 1);
      const allowed = await call("patch", tL, `/payroll/salary-components/${id}`).send({
        isActive: true,
      });
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
      expect(await activeCount(L.companyId)).toBe(MAX);
    });

    /**
     * 🔴 Lỗi THẬT do security-review bắt (MEDIUM, đã vá cùng lượt): schema 047 là `.partial().strict()` chỉ
     * đòi «ít nhất một trường», nên `{delete:true, isActive:true}` là payload HỢP LỆ. Cổng trần đứng TRƯỚC
     * nhánh xoá mềm, nên thiếu vế `dto.delete !== true` thì ở trần, lượt XOÁ một hàng đang tắt bị chính lỗi
     * «hết chỗ» chặn — người dùng đang GIẢI PHÓNG chỗ lại bị từ chối, với thông điệp sai bản chất.
     */
    it("L5b — trần KHÔNG được bịt đường thoát: `{delete:true, isActive:true}` ở trần vẫn xoá mềm được", async () => {
      await setActiveTo(L.companyId, MAX);
      const off = await call("post", tL, "/payroll/salary-components").send(
        fixedBody(newCode("DELOFF"), { isActive: false }),
      );
      expect(off.status, JSON.stringify(off.body)).toBe(201);
      const id = off.body.data.id as string;

      const res = await call("patch", tL, `/payroll/salary-components/${id}`).send({
        delete: true,
        isActive: true,
      });
      expect(res.status, "xoá mềm là đường GIẢI PHÓNG chỗ — trần chặn nó là chặn ngược chiều").toBe(
        200,
      );
      const row = await direct.query<{ deleted_at: Date | null }>(
        `SELECT deleted_at FROM salary_components WHERE id = $1`,
        [id],
      );
      expect(row.rows[0].deleted_at, "phải xoá mềm THẬT, không chỉ trả 200").not.toBeNull();
      expect(await activeCount(L.companyId), "hàng tắt bị xoá ⇒ tập sống+active không đổi").toBe(
        MAX,
      );
    });

    it("L6 — 047 KHÔNG đụng trần khi sửa trường khác (đổi tên hàng đang active ở trần vẫn 200)", async () => {
      await setActiveTo(L.companyId, MAX);
      const r = await direct.query<{ id: string }>(
        `SELECT id FROM salary_components
          WHERE company_id = $1 AND deleted_at IS NULL AND is_active = true AND code LIKE 'FILL\\_%'
          LIMIT 1`,
        [L.companyId],
      );
      const res = await call("patch", tL, `/payroll/salary-components/${r.rows[0].id}`).send({
        name: "Đổi tên ở trần",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("L7 — 048 (kiểm công thức tại chỗ, KHÔNG ghi) vẫn 200 khi công ty đã ở trần", async () => {
      await setActiveTo(L.companyId, MAX);
      const res = await call("post", tL, "/payroll/salary-components/validate-formula").send({
        formula: "SYS_BASE_SALARY * 2",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.valid).toBe(true);
    });

    it("L8 — cách ly tenant (bất biến #1): công ty L ở trần KHÔNG chặn công ty A tạo mới", async () => {
      await setActiveTo(L.companyId, MAX);
      const res = await call("post", tA, "/payroll/salary-components").send(
        fixedBody(newCode("CROSS")),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await activeCount(A.companyId), "A còn xa trần").toBeLessThan(MAX);
    });
  });
});
