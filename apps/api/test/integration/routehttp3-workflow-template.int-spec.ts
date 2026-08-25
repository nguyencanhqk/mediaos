/**
 * S10-QA-ROUTEHTTP-3 (file 1/6) — test HTTP THẬT (supertest) cho TOÀN BỘ `WorkflowTemplatesController`
 * (17 route) + `POST /workflow-templates/:id/apply`. Tất cả nằm ở phần đuôi risk≤2 mà
 * `test/foundation/route-http-coverage.e2e-spec.ts` đo là CHƯA có bằng chứng test HTTP nào chạm.
 *
 * ⚠️ ĐỌC TRƯỚC — TẠI SAO VẪN TEST MỘT MODULE ĐÃ PARK. `content`/`media` bị đưa ra khỏi phạm vi sản
 * phẩm (CLAUDE.md reframe 2026-06-20) và `test/workflow-lifecycle.e2e-spec.ts` đã bị `vitest.config.ts`
 * EXCLUDE vì lý do đó. Nhưng CONTROLLER thì VẪN MOUNT: 18 route này có thật trên app PROD, đi qua
 * guard chain thật, và đếm vào mẫu số 500 của KI-025. "Park" là quyết định KHÔNG PHÁT TRIỂN TIẾP —
 * nó KHÔNG gỡ route khỏi app. Một route mounted mà chưa từng có lượt HTTP nào chạy chính là lớp lỗi
 * KI-065 (route CHẾT mà không ai biết). Vì vậy ở đây đo, chứ không suy.
 *
 * LUẬT CHỐNG DENY-XANH-RỖNG. Mọi route GHI đều được chứng minh bằng HỆ QUẢ đọc lại được qua HTTP
 * (`GET /workflow-templates/:id` trả đúng thứ vừa tạo/sửa/xoá), không chỉ bằng status code. Ca DENY
 * (actor role RỖNG → 403) đặt SAU ca ALLOW của cùng route để 403 không thể xanh vì route chết
 * ([[deny-cases-vacuous-without-allow-case]]).
 *
 * THỨ TỰ CÓ RÀNG BUỘC — KHÔNG xáo được. `loadDraftTemplate()` chặn mọi mutation trên template
 * `published` (D4: published là bất biến, sửa = clone). Nên dãy phải là:
 *   draft T1: create → detail → update → addStep×2 → updateStep → addDependency → addChecklist →
 *             addChecklistItem → publish → clone(T2, draft) → apply(T1)
 *   rồi các route XOÁ chạy trên T2 (bản clone còn draft), KHÔNG chạy trên T1 (đã published + đã apply).
 * Chạy DELETE trên T1 sẽ nhận 409/400 chứ không phải 2xx ⇒ ca sẽ ghim nhầm hành vi.
 *
 * ACTOR KHÔNG PHẢI SUPER-ADMIN ([[superadmin-not-a-canonical-role]]) — role tự chế mang ĐÚNG 5 cặp
 * quyền mà controller khai. DENY dùng role RỖNG (deny-default), KHÔNG seed cặp `*:*` (catalog TOÀN CỤC).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5) — thiếu LANE_DB thì SKIP, không chạm DB dev chung.
 *
 * FIXTURE GIỐNG-SECRET: mật khẩu lấy từ `loginPasswordFixture()` (ghép chuỗi) — CLAUDE.md §5.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
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
const LOGIN_PW = loginPasswordFixture("s10rh3wt");

/** Cặp quyền THẬT của controller (is_sensitive đo trên catalog lane DB, không đoán). */
const PAIRS = [
  { action: "create", resource: "workflow-template", sensitive: false },
  { action: "update", resource: "workflow-template", sensitive: false },
  { action: "publish", resource: "workflow-template", sensitive: false },
  { action: "apply", resource: "workflow-instance", sensitive: false },
] as const;

interface TemplateDetail {
  template: { id: string; status: string; name: string; version: number; code: string };
  steps: Array<{ id: string; nodeKey: string; name: string; stepOrder: number }>;
  dependencies: Array<{ id: string; fromStepId: string; toStepId: string }>;
  checklists: Array<{
    id: string;
    name: string;
    workflowDefinitionStepId: string | null;
    items?: Array<{ id: string; label: string }>;
  }>;
}

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-3 — HTTP thật: WorkflowTemplatesController (17 route) + apply",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let tAdminA = "";
    let tEmptyA = "";
    let tAdminB = "";
    let contentItemIdA = "";

    // State tích luỹ qua các `it` tuần tự (Vitest chạy tuần tự trong 1 file).
    let t1 = ""; // template gốc: draft → published → applied
    let t2 = ""; // clone của T1 (draft) — nơi chạy mọi route XOÁ
    let stepA = "";
    let stepB = "";
    let depId = "";
    let checklistId = "";
    let itemId = "";

    const http = () => request(app.getHttpServer());
    const authGet = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
    const authPatch = (t: string, u: string) => http().patch(u).set("Authorization", `Bearer ${t}`);
    const authDelete = (t: string, u: string) =>
      http().delete(u).set("Authorization", `Bearer ${t}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({
        companySlug: slug,
        email,
        password: LOGIN_PW,
      });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** User + role mang đúng `pairs` (mảng rỗng ⇒ role RỖNG = deny-default). Trả access token. */
    async function actor(
      tenant: SeededTenant,
      tag: string,
      pairs: ReadonlyArray<{ action: string; resource: string; sensitive: boolean }>,
    ): Promise<string> {
      const password = new PasswordService();
      const email = `${tag}-${randomUUID().slice(0, 8)}@s10rh3wt.local`;
      const userId = await seedUser(direct, tenant.companyId, email, await password.hash(LOGIN_PW));
      const roleId = await seedRole(
        direct,
        tenant.companyId,
        `s10rh3wt-${tag}-${randomUUID().slice(0, 8)}`,
      );
      for (const p of pairs) {
        const permId = await seedPermissionCatalog(direct, p.action, p.resource, p.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, roleId, tenant.companyId);
      return login(tenant.slug, email);
    }

    /**
     * Gieo THẲNG 1 project + content_item (module CONTENT đã park ⇒ KHÔNG còn route `POST /content`
     * để tạo qua HTTP). Chỉ là fixture cho `apply`; đường ĐO vẫn là HTTP.
     */
    async function seedContentItem(companyId: string): Promise<string> {
      const prj = await direct.query<{ id: string }>(
        `INSERT INTO projects (company_id, name) VALUES ($1, $2) RETURNING id`,
        [companyId, `s10rh3wt-prj-${randomUUID().slice(0, 8)}`],
      );
      const ci = await direct.query<{ id: string }>(
        `INSERT INTO content_items (company_id, project_id, title) VALUES ($1, $2, $3) RETURNING id`,
        [companyId, prj.rows[0].id, `s10rh3wt-content-${randomUUID().slice(0, 8)}`],
      );
      return ci.rows[0].id;
    }

    async function detail(token: string, id: string): Promise<TemplateDetail> {
      const res = await authGet(token, `/workflow-templates/${id}`);
      expect(res.status, `detail ${id}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data as TemplateDetail;
    }

    function stepPayload(nodeKey: string, order: number) {
      return {
        nodeKey,
        code: nodeKey,
        name: `Bước ${nodeKey}`,
        defaultTaskTitle: `Việc ${nodeKey}`,
        stepType: "task",
        isRequired: true,
        stepOrder: order,
      };
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // Mirror main.ts: Zod validate ở biên → envelope → filter (quyết định mã HTTP + hình dạng body).
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10rh3wta");
      B = await seedCompany(direct, "s10rh3wtb");
      companyIds.push(A.companyId, B.companyId);

      tAdminA = await actor(A, "tpladmin", PAIRS);
      tEmptyA = await actor(A, "empty", []);
      tAdminB = await actor(B, "tpladminb", PAIRS);
      contentItemIdA = await seedContentItem(A.companyId);
    });

    afterAll(async () => {
      await app?.close();
      if (companyIds.length > 0) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ─── 1. Vòng đời DRAFT: create → detail → update ────────────────────────────

    it("POST /workflow-templates — ALLOW 201, template mới ở trạng thái draft", async () => {
      const code = `s10rh3wt-${randomUUID().slice(0, 8)}`;
      const res = await authPost(tAdminA, "/workflow-templates").send({
        code,
        name: "Mẫu gốc",
        appliesTo: "content_item",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      t1 = res.body.data.id as string;
      expect(t1).toBeTruthy();
      expect(res.body.data.status).toBe("draft");
      expect(res.body.data.code).toBe(code);
    });

    it("GET /workflow-templates — list chứa template vừa tạo", async () => {
      const res = await authGet(tAdminA, "/workflow-templates");
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(t1);
    });

    it("GET /workflow-templates/:id — detail trả template + 4 nhánh con (rỗng lúc này)", async () => {
      const d = await detail(tAdminA, t1);
      expect(d.template.id).toBe(t1);
      expect(d.steps).toEqual([]);
      expect(d.dependencies).toEqual([]);
    });

    it("PATCH /workflow-templates/:id — ALLOW 200, HỆ QUẢ: detail đọc lại thấy tên mới", async () => {
      const res = await authPatch(tAdminA, `/workflow-templates/${t1}`).send({
        name: "Mẫu gốc (đã sửa)",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = await detail(tAdminA, t1);
      expect(d.template.name).toBe("Mẫu gốc (đã sửa)");
    });

    // ─── 2. Steps + dependency + checklist trên draft ───────────────────────────

    it("POST /workflow-templates/:id/steps — ALLOW 201 ×2, HỆ QUẢ: detail có 2 bước", async () => {
      const r1 = await authPost(tAdminA, `/workflow-templates/${t1}/steps`).send(
        stepPayload("alpha", 1),
      );
      expect(r1.status, JSON.stringify(r1.body)).toBe(201);
      stepA = r1.body.data.id as string;

      const r2 = await authPost(tAdminA, `/workflow-templates/${t1}/steps`).send(
        stepPayload("beta", 2),
      );
      expect(r2.status, JSON.stringify(r2.body)).toBe(201);
      stepB = r2.body.data.id as string;

      const d = await detail(tAdminA, t1);
      expect(d.steps.map((s) => s.nodeKey).sort()).toEqual(["alpha", "beta"]);
    });

    it("PATCH /workflow-templates/:id/steps/:stepId — ALLOW 200, HỆ QUẢ: tên bước đổi", async () => {
      const res = await authPatch(tAdminA, `/workflow-templates/${t1}/steps/${stepA}`).send({
        name: "Bước alpha (đã sửa)",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = await detail(tAdminA, t1);
      expect(d.steps.find((s) => s.id === stepA)?.name).toBe("Bước alpha (đã sửa)");
    });

    it("POST /workflow-templates/:id/dependencies — ALLOW 201, HỆ QUẢ: detail có cạnh alpha→beta", async () => {
      const res = await authPost(tAdminA, `/workflow-templates/${t1}/dependencies`).send({
        fromStepId: stepA,
        toStepId: stepB,
        dependencyType: "finish_to_start",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      depId = res.body.data.id as string;
      const d = await detail(tAdminA, t1);
      expect(d.dependencies.map((x) => x.id)).toContain(depId);
    });

    it("POST /workflow-templates/:id/steps/:stepId/checklists — ALLOW 201, HỆ QUẢ: detail có checklist", async () => {
      const res = await authPost(
        tAdminA,
        `/workflow-templates/${t1}/steps/${stepA}/checklists`,
      ).send({ name: "Checklist alpha" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      checklistId = res.body.data.id as string;
      const d = await detail(tAdminA, t1);
      expect(d.checklists.map((c) => c.id)).toContain(checklistId);
    });

    it("POST /workflow-templates/:id/checklists/:checklistId/items — ALLOW 201", async () => {
      const res = await authPost(
        tAdminA,
        `/workflow-templates/${t1}/checklists/${checklistId}/items`,
      ).send({ label: "Mục bắt buộc 1", isRequired: true, sortOrder: 0 });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      itemId = res.body.data.id as string;
      expect(itemId).toBeTruthy();
    });

    // ─── 3. publish → clone → apply ─────────────────────────────────────────────

    it("POST /workflow-templates/:id/publish — ALLOW 201, HỆ QUẢ: status = published", async () => {
      const res = await authPost(tAdminA, `/workflow-templates/${t1}/publish`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.status).toBe("published");
      const d = await detail(tAdminA, t1);
      expect(d.template.status).toBe("published");
    });

    it("PATCH /workflow-templates/:id sau publish — 4xx (D4: published bất biến, KHÔNG phải 2xx)", async () => {
      const res = await authPatch(tAdminA, `/workflow-templates/${t1}`).send({
        name: "không được",
      });
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it("POST /workflow-templates/:id/clone — ALLOW 201, HỆ QUẢ: bản sao draft, version tăng, chép đủ 2 bước", async () => {
      const res = await authPost(tAdminA, `/workflow-templates/${t1}/clone`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      t2 = res.body.data.id as string;
      expect(t2).not.toBe(t1);
      expect(res.body.data.status).toBe("draft");
      const d = await detail(tAdminA, t2);
      expect(d.template.version).toBeGreaterThan(1);
      expect(d.steps.map((s) => s.nodeKey).sort()).toEqual(["alpha", "beta"]);
    });

    it("POST /workflow-templates/:id/apply — ALLOW 201, HỆ QUẢ: instance active + step theo template", async () => {
      const res = await authPost(tAdminA, `/workflow-templates/${t1}/apply`).send({
        contentItemId: contentItemIdA,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const data = res.body.data as {
        instance: { id: string; status: string; workflowDefinitionId: string };
        steps: Array<{ id: string; nodeKey: string }>;
      };
      expect(data.instance.status).toBe("active");
      expect(data.instance.workflowDefinitionId).toBe(t1);
      expect(data.steps.map((s) => s.nodeKey).sort()).toEqual(["alpha", "beta"]);
    });

    it("POST /workflow-templates/:id/apply với template DRAFT — 404 (chỉ published mới apply được)", async () => {
      const res = await authPost(tAdminA, `/workflow-templates/${t2}/apply`).send({
        contentItemId: contentItemIdA,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    // ─── 4. Các route XOÁ — chạy trên T2 (clone còn draft) ──────────────────────

    it("DELETE /workflow-templates/:id/checklists/:checklistId/items/:itemId — ALLOW 200", async () => {
      const d = await detail(tAdminA, t2);
      const cl = d.checklists[0];
      expect(cl, "clone phải chép checklist sang").toBeDefined();

      // ⚠️ `GET /workflow-templates/:id` KHÔNG trả `items` (findChecklistsInTx chỉ select 5 cột của
      // `checklists`) và KHÔNG có route HTTP nào liệt kê item của template. Nên id lấy qua `direct`
      // — đó là FIXTURE, không phải đường ĐO: đường đo vẫn là lượt DELETE qua HTTP bên dưới, và HỆ
      // QUẢ cũng đọc lại bằng `direct` vì HTTP không có cửa nào nhìn thấy nó.
      const itemsBefore = await direct.query<{ id: string }>(
        `SELECT id FROM checklist_items WHERE company_id = $1 AND checklist_id = $2`,
        [A.companyId, cl.id],
      );
      expect(itemsBefore.rowCount, "clone phải chép item sang").toBeGreaterThan(0);
      const targetItem = itemsBefore.rows[0].id;

      const res = await authDelete(
        tAdminA,
        `/workflow-templates/${t2}/checklists/${cl.id}/items/${targetItem}`,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const itemsAfter = await direct.query<{ id: string }>(
        `SELECT id FROM checklist_items WHERE company_id = $1 AND checklist_id = $2`,
        [A.companyId, cl.id],
      );
      expect(itemsAfter.rows.map((r) => r.id)).not.toContain(targetItem);
    });

    it("DELETE /workflow-templates/:id/steps/:stepId/checklists/:checklistId — ALLOW 200", async () => {
      const d = await detail(tAdminA, t2);
      const cl = d.checklists[0];
      const owner = d.steps.find((s) => s.id === cl.workflowDefinitionStepId);
      expect(owner, "checklist của clone phải gắn vào một bước của clone").toBeDefined();
      const res = await authDelete(
        tAdminA,
        `/workflow-templates/${t2}/steps/${owner!.id}/checklists/${cl.id}`,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = await detail(tAdminA, t2);
      expect(after.checklists.map((c) => c.id)).not.toContain(cl.id);
    });

    it("DELETE /workflow-templates/:id/dependencies/:depId — ALLOW 200", async () => {
      const d = await detail(tAdminA, t2);
      expect(d.dependencies.length, "clone phải chép cạnh sang").toBeGreaterThan(0);
      const target = d.dependencies[0].id;
      const res = await authDelete(tAdminA, `/workflow-templates/${t2}/dependencies/${target}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = await detail(tAdminA, t2);
      expect(after.dependencies.map((x) => x.id)).not.toContain(target);
    });

    it("DELETE /workflow-templates/:id/steps/:stepId — ALLOW 200", async () => {
      const d = await detail(tAdminA, t2);
      const target = d.steps.find((s) => s.nodeKey === "beta")!;
      const res = await authDelete(tAdminA, `/workflow-templates/${t2}/steps/${target.id}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = await detail(tAdminA, t2);
      expect(after.steps.map((s) => s.nodeKey)).not.toContain("beta");
    });

    it("DELETE /workflow-templates/:id — ALLOW 200 (soft-delete draft), HỆ QUẢ: detail 404 + rời list", async () => {
      const res = await authDelete(tAdminA, `/workflow-templates/${t2}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const gone = await authGet(tAdminA, `/workflow-templates/${t2}`);
      expect(gone.status).toBe(404);

      const list = await authGet(tAdminA, "/workflow-templates");
      expect((list.body.data as Array<{ id: string }>).map((t) => t.id)).not.toContain(t2);
    });

    // ─── 5. DENY — role RỖNG. Đặt SAU ALLOW nên 403 không thể xanh vì route chết ──

    it("DENY 403: actor role RỖNG trên create · publish · apply · update · delete", async () => {
      const calls = [
        authPost(tEmptyA, "/workflow-templates").send({ code: `x-${randomUUID()}`, name: "x" }),
        authPost(tEmptyA, `/workflow-templates/${t1}/publish`).send({}),
        authPost(tEmptyA, `/workflow-templates/${t1}/clone`).send({}),
        authPost(tEmptyA, `/workflow-templates/${t1}/apply`).send({
          contentItemId: contentItemIdA,
        }),
        authPatch(tEmptyA, `/workflow-templates/${t1}`).send({ name: "x" }),
        authDelete(tEmptyA, `/workflow-templates/${t1}`),
        authPost(tEmptyA, `/workflow-templates/${t1}/steps`).send(stepPayload("gamma", 9)),
        authPatch(tEmptyA, `/workflow-templates/${t1}/steps/${stepA}`).send({ name: "x" }),
        authDelete(tEmptyA, `/workflow-templates/${t1}/steps/${stepA}`),
        authPost(tEmptyA, `/workflow-templates/${t1}/dependencies`).send({
          fromStepId: stepA,
          toStepId: stepB,
        }),
        authDelete(tEmptyA, `/workflow-templates/${t1}/dependencies/${depId}`),
        authPost(tEmptyA, `/workflow-templates/${t1}/steps/${stepA}/checklists`).send({
          name: "x",
        }),
        authDelete(tEmptyA, `/workflow-templates/${t1}/steps/${stepA}/checklists/${checklistId}`),
        authPost(tEmptyA, `/workflow-templates/${t1}/checklists/${checklistId}/items`).send({
          label: "x",
        }),
        authDelete(tEmptyA, `/workflow-templates/${t1}/checklists/${checklistId}/items/${itemId}`),
      ];
      const results = await Promise.all(calls);
      for (const [i, r] of results.entries()) {
        expect(r.status, `call#${i} phải 403, nhận ${r.status}: ${JSON.stringify(r.body)}`).toBe(
          403,
        );
      }
    });

    it("DTO 400 ở BIÊN: create thiếu `name`, addStep thiếu `nodeKey`, dependency `fromStepId` không phải UUID", async () => {
      const bad1 = await authPost(tAdminA, "/workflow-templates").send({ code: "chỉ-có-code" });
      expect(bad1.status, JSON.stringify(bad1.body)).toBe(400);

      const bad2 = await authPost(tAdminA, `/workflow-templates/${t1}/steps`).send({ code: "x" });
      expect(bad2.status, JSON.stringify(bad2.body)).toBe(400);

      const bad3 = await authPost(tAdminA, `/workflow-templates/${t1}/dependencies`).send({
        fromStepId: "không-phải-uuid",
        toStepId: stepB,
      });
      expect(bad3.status, JSON.stringify(bad3.body)).toBe(400);
    });

    // ─── 6. Cô lập tenant ───────────────────────────────────────────────────────

    it("CROSS-TENANT: admin công ty B không đọc/không sửa được template của công ty A", async () => {
      const readB = await authGet(tAdminB, `/workflow-templates/${t1}`);
      expect(readB.status, JSON.stringify(readB.body)).toBe(404);

      const listB = await authGet(tAdminB, "/workflow-templates");
      expect(listB.status).toBe(200);
      expect((listB.body.data as Array<{ id: string }>).map((t) => t.id)).not.toContain(t1);

      const publishB = await authPost(tAdminB, `/workflow-templates/${t1}/publish`).send({});
      expect(publishB.status, JSON.stringify(publishB.body)).toBe(404);
    });
  },
);
