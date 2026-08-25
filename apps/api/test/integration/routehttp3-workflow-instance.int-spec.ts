/**
 * S10-QA-ROUTEHTTP-3 (file 2/6) — test HTTP THẬT cho TOÀN BỘ `WorkflowController` (12 route).
 *
 * ⚠️ BẢY route trong nhóm này TRƯỚC ĐÂY được phép đo tính là "đã phủ", nhưng bằng chứng DUY NHẤT của
 * chúng là `test/workflow-lifecycle.e2e-spec.ts` — file mà `vitest.config.ts` **EXCLUDE** (de-media-fy).
 * Tức là: census đọc file trên ĐĨA, còn vitest thì KHÔNG BAO GIỜ CHẠY file đó ⇒ 7 route được đóng dấu
 * "covered" bởi một lượt HTTP chưa từng xảy ra. Đây là lớp DƯƠNG-TÍNH-GIẢ của chính thước đo, đã cấp
 * số **KI-080**. File này thay bằng bằng chứng CHẠY THẬT:
 *   startWorkflow · getWorkflow · listApprovalRequests · startStep · submitStep · approve · requestRevision
 * và phủ nốt 5 route chưa từng có bằng chứng nào:
 *   getWorkflowByContent · getStepChecklist · assignStep · checkItem · uncheckItem
 *
 * ĐƯỜNG ĐI LÀ MVP-0, KHÔNG PHẢI TEMPLATE. `start/submit/approve/request-revision` chạy trên máy trạng
 * thái đọc bảng `step_transitions`, mà `seedWorkflowDefinition()` mới là thứ gieo đủ 7 chuyển tiếp đó.
 * Template do `POST /workflow-templates` tạo KHÔNG có `step_transitions` ⇒ dùng nó ở đây sẽ đo một
 * nhánh lỗi chứ không đo vòng đời. (Vòng đời TEMPLATE đã được file 1 phủ tới `apply`.)
 *
 * LUẬT CHỐNG DENY-XANH-RỖNG: mỗi route có ca ALLOW 2xx chứng minh bằng HỆ QUẢ đọc lại được
 * (`GET /workflow/:instanceId` thấy status bước đổi; `GET /workflow/steps/:id/checklist` thấy tick
 * bật/tắt) — ca từ chối đặt SAU. `checkItem/uncheckItem` gate theo ASSIGNEE (không phải permission)
 * nên ca DENY của chúng là một user KHÁC đã đăng nhập, không phải role rỗng.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
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
  seedWorkflowDefinition,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s10rh3wi");

interface StepRow {
  id: string;
  stepOrder: number;
  status: string;
  nodeKey: string | null;
}

describe.skipIf(!hasLaneDb)("S10-QA-ROUTEHTTP-3 — HTTP thật: WorkflowController (12 route)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tPmA = ""; // có `update:content` → gán bước được
  let pmUserIdA = "";
  let tOtherA = ""; // user khác trong CÙNG tenant — dùng cho ca DENY theo assignee
  let tPmB = ""; // tenant B — cô lập

  let contentItemIdA = "";
  let contentItemIdB = "";
  let instanceId = "";
  let steps: StepRow[] = [];
  let step1 = "";
  let checklistItemId = "";

  const http = () => request(app.getHttpServer());
  const authGet = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
  const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
  const authDelete = (t: string, u: string) => http().delete(u).set("Authorization", `Bearer ${t}`);

  async function login(slug: string, email: string): Promise<string> {
    const res = await http().post("/auth/login").send({
      companySlug: slug,
      email,
      password: LOGIN_PW,
    });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function actor(
    tenant: SeededTenant,
    tag: string,
    pairs: ReadonlyArray<{ action: string; resource: string; sensitive: boolean }>,
  ): Promise<{ id: string; token: string }> {
    const password = new PasswordService();
    const email = `${tag}-${randomUUID().slice(0, 8)}@s10rh3wi.local`;
    const id = await seedUser(direct, tenant.companyId, email, await password.hash(LOGIN_PW));
    const roleId = await seedRole(
      direct,
      tenant.companyId,
      `s10rh3wi-${tag}-${randomUUID().slice(0, 8)}`,
    );
    for (const p of pairs) {
      const permId = await seedPermissionCatalog(direct, p.action, p.resource, p.sensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, id, roleId, tenant.companyId);
    return { id, token: await login(tenant.slug, email) };
  }

  /** project + content_item gieo thẳng (module CONTENT đã park ⇒ không còn route tạo qua HTTP). */
  async function seedContentItem(companyId: string): Promise<string> {
    const prj = await direct.query<{ id: string }>(
      `INSERT INTO projects (company_id, name) VALUES ($1, $2) RETURNING id`,
      [companyId, `s10rh3wi-prj-${randomUUID().slice(0, 8)}`],
    );
    const ci = await direct.query<{ id: string }>(
      `INSERT INTO content_items (company_id, project_id, title) VALUES ($1, $2, $3) RETURNING id`,
      [companyId, prj.rows[0].id, `s10rh3wi-content-${randomUUID().slice(0, 8)}`],
    );
    return ci.rows[0].id;
  }

  /**
   * Gắn 1 checklist + 1 item BẮT BUỘC vào def-step `script` của định nghĩa MVP-0. Không có route HTTP
   * nào tạo checklist cho một `workflow_definition` (chỉ template mới có) ⇒ đây là FIXTURE. Đường ĐO
   * vẫn là `GET /workflow/steps/:id/checklist` + tick/untick qua HTTP.
   */
  async function seedDefinitionChecklist(companyId: string, definitionId: string): Promise<string> {
    const defStep = await direct.query<{ id: string }>(
      `SELECT id FROM workflow_definition_steps
        WHERE company_id = $1 AND workflow_definition_id = $2 AND code = 'script'`,
      [companyId, definitionId],
    );
    const cl = await direct.query<{ id: string }>(
      `INSERT INTO checklists (company_id, name, workflow_definition_step_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [companyId, "Checklist kịch bản", defStep.rows[0].id],
    );
    const item = await direct.query<{ id: string }>(
      `INSERT INTO checklist_items (company_id, checklist_id, label, is_required, sort_order)
       VALUES ($1, $2, $3, true, 0) RETURNING id`,
      [companyId, cl.rows[0].id, "Đã viết xong kịch bản"],
    );
    return item.rows[0].id;
  }

  async function readInstance(): Promise<{ instance: { status: string }; steps: StepRow[] }> {
    const res = await authGet(tPmA, `/workflow/${instanceId}`);
    expect(res.status, `getWorkflow: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data;
  }

  async function pendingRequestId(): Promise<string> {
    const res = await authGet(tPmA, "/workflow/approval-requests");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<{ id: string; status: string; workflowStepId?: string }>;
    const pending = rows.find((r) => r.status === "pending");
    expect(pending, `không thấy approval-request pending: ${JSON.stringify(rows)}`).toBeDefined();
    return pending!.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    A = await seedCompany(direct, "s10rh3wia");
    B = await seedCompany(direct, "s10rh3wib");
    companyIds.push(A.companyId, B.companyId);

    const updateContent = { action: "update", resource: "content", sensitive: false } as const;
    const pmA = await actor(A, "pm", [updateContent]);
    tPmA = pmA.token;
    pmUserIdA = pmA.id;
    tOtherA = (await actor(A, "other", [])).token;
    tPmB = (await actor(B, "pmb", [updateContent])).token;

    const defA = await seedWorkflowDefinition(direct, A.companyId);
    await seedWorkflowDefinition(direct, B.companyId);
    checklistItemId = await seedDefinitionChecklist(A.companyId, defA);

    contentItemIdA = await seedContentItem(A.companyId);
    contentItemIdB = await seedContentItem(B.companyId);
  });

  afterAll(async () => {
    await app?.close();
    if (companyIds.length > 0) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ─── 1. Khởi động + đọc ──────────────────────────────────────────────────────

  it("POST /workflow/start — ALLOW 201, instance active + 4 bước MVP-0", async () => {
    const res = await authPost(tPmA, "/workflow/start").send({ contentItemId: contentItemIdA });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    instanceId = res.body.data.instance.id as string;
    steps = res.body.data.steps as StepRow[];
    expect(res.body.data.instance.status).toBe("active");
    expect(steps.map((s) => s.stepOrder).sort()).toEqual([1, 2, 3, 4]);
    step1 = steps.find((s) => s.stepOrder === 1)!.id;
  });

  it("POST /workflow/start lần hai trên cùng content — 409 (idempotency), KHÔNG tạo instance thứ hai", async () => {
    const res = await authPost(tPmA, "/workflow/start").send({ contentItemId: contentItemIdA });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  it("GET /workflow/:instanceId — 200, trả đúng instance + 4 bước", async () => {
    const data = await readInstance();
    expect(data.instance.status).toBe("active");
    expect(data.steps).toHaveLength(4);
  });

  it("GET /workflow/by-content/:contentItemId — 200, trỏ về đúng instance; content chưa start → null", async () => {
    const res = await authGet(tPmA, `/workflow/by-content/${contentItemIdA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.instance.id).toBe(instanceId);

    const fresh = await seedContentItem(A.companyId);
    const none = await authGet(tPmA, `/workflow/by-content/${fresh}`);
    expect(none.status).toBe(200);
    expect(none.body.data).toBeNull();
  });

  // ─── 2. Gán bước ─────────────────────────────────────────────────────────────

  it("POST /workflow/steps/:stepId/assign — ALLOW 201, HỆ QUẢ: assignee + reviewer là chính PM", async () => {
    const res = await authPost(tPmA, `/workflow/steps/${step1}/assign`).send({
      assigneeUserId: pmUserIdA,
      reviewerUserId: pmUserIdA,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.assigneeUserId).toBe(pmUserIdA);
    expect(res.body.data.reviewerUserId).toBe(pmUserIdA);
  });

  it("POST /workflow/steps/:stepId/assign — DENY 403 khi actor KHÔNG có `update:content`", async () => {
    const res = await authPost(tOtherA, `/workflow/steps/${step1}/assign`).send({
      assigneeUserId: pmUserIdA,
      reviewerUserId: pmUserIdA,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  // ─── 3. Checklist của bước (đọc · tick · bỏ tick) ────────────────────────────

  it("GET /workflow/steps/:stepId/checklist — 200, thấy item của def-step qua node_key, checked=false", async () => {
    const res = await authGet(tPmA, `/workflow/steps/${step1}/checklist`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data.items as Array<{ id: string; checked: boolean }>;
    expect(items.map((i) => i.id)).toContain(checklistItemId);
    expect(items.find((i) => i.id === checklistItemId)?.checked).toBe(false);
  });

  it("POST /workflow/steps/:stepId/checklist-items/:itemId — ALLOW 201, HỆ QUẢ: đọc lại checked=true", async () => {
    const res = await authPost(
      tPmA,
      `/workflow/steps/${step1}/checklist-items/${checklistItemId}`,
    ).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.checked).toBe(true);
    expect(res.body.data.changed).toBe(true);

    const after = await authGet(tPmA, `/workflow/steps/${step1}/checklist`);
    const items = after.body.data.items as Array<{ id: string; checked: boolean }>;
    expect(items.find((i) => i.id === checklistItemId)?.checked).toBe(true);
  });

  it("POST tick lần hai — 201 nhưng `changed=false` (replay là no-op thật, không phải lỗi)", async () => {
    const res = await authPost(
      tPmA,
      `/workflow/steps/${step1}/checklist-items/${checklistItemId}`,
    ).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.changed).toBe(false);
  });

  it("DELETE /workflow/steps/:stepId/checklist-items/:itemId — ALLOW 200, HỆ QUẢ: đọc lại checked=false", async () => {
    const res = await authDelete(
      tPmA,
      `/workflow/steps/${step1}/checklist-items/${checklistItemId}`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.checked).toBe(false);
    expect(res.body.data.changed).toBe(true);

    const after = await authGet(tPmA, `/workflow/steps/${step1}/checklist`);
    const items = after.body.data.items as Array<{ id: string; checked: boolean }>;
    expect(items.find((i) => i.id === checklistItemId)?.checked).toBe(false);
  });

  it("DENY 403: user KHÁC (không phải assignee của bước) không tick/bỏ tick được", async () => {
    const tick = await authPost(
      tOtherA,
      `/workflow/steps/${step1}/checklist-items/${checklistItemId}`,
    ).send({});
    expect(tick.status, JSON.stringify(tick.body)).toBe(403);

    const untick = await authDelete(
      tOtherA,
      `/workflow/steps/${step1}/checklist-items/${checklistItemId}`,
    );
    expect(untick.status, JSON.stringify(untick.body)).toBe(403);
  });

  // ─── 4. Vòng đời FSM: start → submit → request-revision → start → submit → approve ──

  it("POST /workflow/steps/:stepId/start — ALLOW 201, HỆ QUẢ: bước 1 sang in_progress", async () => {
    const res = await authPost(tPmA, `/workflow/steps/${step1}/start`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe("in_progress");
  });

  it("POST /workflow/steps/:stepId/submit — chặn khi item BẮT BUỘC chưa tick, cho qua sau khi tick", async () => {
    const blocked = await authPost(tPmA, `/workflow/steps/${step1}/submit`).send({
      submissionUrl: "https://example.test/v1",
      submissionNote: "bản 1",
    });
    expect(
      blocked.status,
      `submit khi checklist chưa xong phải bị chặn: ${JSON.stringify(blocked.body)}`,
    ).toBeGreaterThanOrEqual(400);

    const tick = await authPost(
      tPmA,
      `/workflow/steps/${step1}/checklist-items/${checklistItemId}`,
    ).send({});
    expect(tick.status).toBe(201);

    const ok = await authPost(tPmA, `/workflow/steps/${step1}/submit`).send({
      submissionUrl: "https://example.test/v1",
      submissionNote: "bản 1",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.step.status).toBe("waiting_review");
  });

  it("GET /workflow/approval-requests — 200, hàng chờ có yêu cầu pending vừa sinh", async () => {
    const id = await pendingRequestId();
    expect(id).toBeTruthy();
  });

  it("POST /workflow/approval-requests/:requestId/request-revision — ALLOW 201, HỆ QUẢ: bước về `revision` + có defect", async () => {
    const requestId = await pendingRequestId();
    const res = await authPost(
      tPmA,
      `/workflow/approval-requests/${requestId}/request-revision`,
    ).send({ description: "Thiếu phần mở đầu", comment: "Xem lại intro" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.step.status).toBe("revision");
    expect(res.body.data.defect).toBeDefined();

    const data = await readInstance();
    expect(data.steps.find((s) => s.id === step1)?.status).toBe("revision");
  });

  it("POST /workflow/approval-requests/:requestId/approve — ALLOW 201, HỆ QUẢ: bước 1 `approved`", async () => {
    // revision → start → submit → mới có yêu cầu duyệt mới để approve.
    const restart = await authPost(tPmA, `/workflow/steps/${step1}/start`).send({});
    expect(restart.status, JSON.stringify(restart.body)).toBe(201);
    const resubmit = await authPost(tPmA, `/workflow/steps/${step1}/submit`).send({
      submissionUrl: "https://example.test/v2",
      submissionNote: "bản 2",
    });
    expect(resubmit.status, JSON.stringify(resubmit.body)).toBe(201);

    const requestId = await pendingRequestId();
    const res = await authPost(tPmA, `/workflow/approval-requests/${requestId}/approve`).send({
      comment: "Đạt",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const data = await readInstance();
    expect(data.steps.find((s) => s.id === step1)?.status).toBe("approved");
  });

  // ─── 5. Cô lập tenant ────────────────────────────────────────────────────────

  it("CROSS-TENANT: tenant B không thấy instance/bước/hàng chờ của tenant A", async () => {
    const inst = await authGet(tPmB, `/workflow/${instanceId}`);
    expect(inst.status, JSON.stringify(inst.body)).toBe(404);

    const byContent = await authGet(tPmB, `/workflow/by-content/${contentItemIdA}`);
    expect(byContent.status).toBe(200);
    expect(byContent.body.data, "content của tenant A phải vô hình với tenant B").toBeNull();

    const checklist = await authGet(tPmB, `/workflow/steps/${step1}/checklist`);
    expect(checklist.status).toBe(404);

    const assign = await authPost(tPmB, `/workflow/steps/${step1}/assign`).send({
      assigneeUserId: pmUserIdA,
      reviewerUserId: pmUserIdA,
    });
    expect(assign.status).toBe(404);

    const queue = await authGet(tPmB, "/workflow/approval-requests");
    expect(queue.status).toBe(200);
    expect(queue.body.data).toEqual([]);

    // Cạnh đối chứng: tenant B khởi động được workflow của CHÍNH nó ⇒ 404 ở trên là do cô lập,
    // không phải do route chết ([[deny-cases-vacuous-without-allow-case]]).
    const ownStart = await authPost(tPmB, "/workflow/start").send({
      contentItemId: contentItemIdB,
    });
    expect(ownStart.status, JSON.stringify(ownStart.body)).toBe(201);
  });
});
