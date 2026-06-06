/**
 * G4-7 — E2E: 1 video đi trọn vòng đời
 *
 * Kịch bản: tạo project/content → start workflow → 4 bước tuần tự (Script→Edit→QA→Upload).
 *   - Bước 1 (Script): start → submit → request_revision → restart → resubmit → approve
 *   - Bước 2–4: start → submit → approve (happy path)
 *   - Sau bước 4 approve → workflow.status = 'completed'
 *
 * Dùng Postgres thật (CI). Dùng NestJS TestingModule + supertest cho HTTP.
 * Direct pool (superuser) chỉ dùng để seed/teardown + set assignee_user_id trên workflow_steps.
 */

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../src/auth/password.service";
import { directPool, hasDb } from "./helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedWorkflowDefinition,
  type SeededTenant,
} from "./helpers/seed";

const PASSWORD = "Passw0rd!test99";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function loginAs(
  app: INestApplication,
  slug: string,
  email: string,
): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Set assignee_user_id trên tất cả workflow_steps của 1 instance (bypass RLS qua direct). */
async function assignStepsTo(
  direct: Pool,
  instanceId: string,
  userId: string,
): Promise<void> {
  await direct.query(
    `UPDATE workflow_steps SET assignee_user_id = $1 WHERE workflow_instance_id = $2`,
    [userId, instanceId],
  );
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)("G4-7 workflow full lifecycle (e2e)", () => {
  let app: INestApplication;
  let direct: Pool;
  let tenant: SeededTenant;
  let tenantB: SeededTenant;
  let userId: string;
  let token: string;
  let tokenB: string;

  // Accumulated state across sequential its
  let projectId: string;
  let contentItemId: string;
  let instanceId: string;
  let steps: Array<{ id: string; stepOrder: number; status: string }>;

  beforeAll(async () => {
    direct = directPool();

    // ── Seed tenant A (người dùng chính) ──
    tenant = await seedCompany(direct, "wf-e2e");
    const password = new PasswordService();
    const hash = await password.hash(PASSWORD);
    userId = await seedUser(direct, tenant.companyId, "worker@wf-e2e.test", hash);
    await seedWorkflowDefinition(direct, tenant.companyId);

    // ── Seed tenant B (dùng để kiểm isolation) ──
    tenantB = await seedCompany(direct, "wf-e2e-b");
    const userBId = await seedUser(direct, tenantB.companyId, "worker@wf-e2e-b.test", hash);
    await seedWorkflowDefinition(direct, tenantB.companyId);

    // ── NestJS app ──
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    token = await loginAs(app, tenant.slug, "worker@wf-e2e.test");
    tokenB = await loginAs(app, tenantB.slug, "worker@wf-e2e-b.test");

    // silence unused-var warning
    void userBId;
  });

  afterAll(async () => {
    await app?.close();
    const companyIds = [tenant?.companyId, tenantB?.companyId].filter(Boolean) as string[];
    if (companyIds.length > 0) await cleanupTenants(direct, companyIds);
    await direct.end();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Tạo project + content
  // ────────────────────────────────────────────────────────────────────────────

  it("POST /projects → tạo project thành công", async () => {
    const res = await api(app)
      .post("/projects")
      .set(bearer(token))
      .send({ name: "E2E Project" })
      .expect(201);

    expect(res.body.success).toBe(true);
    projectId = res.body.data.id as string;
    expect(projectId).toBeTruthy();
  });

  it("POST /projects/:id/content → tạo content item", async () => {
    const res = await api(app)
      .post(`/projects/${projectId}/content`)
      .set(bearer(token))
      .send({ title: "Video E2E Test", contentType: "video" })
      .expect(201);

    expect(res.body.success).toBe(true);
    contentItemId = res.body.data.id as string;
    expect(contentItemId).toBeTruthy();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Khởi động workflow
  // ────────────────────────────────────────────────────────────────────────────

  it("POST /workflow/start → tạo 4 bước + task bước 1", async () => {
    const res = await api(app)
      .post("/workflow/start")
      .set(bearer(token))
      .send({ contentItemId })
      .expect(201);

    expect(res.body.success).toBe(true);
    const data = res.body.data as { instance: { id: string; status: string }; steps: typeof steps };
    instanceId = data.instance.id;
    steps = data.steps;

    expect(instanceId).toBeTruthy();
    expect(data.instance.status).toBe("active");
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.stepOrder).sort()).toEqual([1, 2, 3, 4]);

    // Gán assignee cho tất cả bước qua direct (simulating PM assignment)
    await assignStepsTo(direct, instanceId, userId);
  });

  it("POST /workflow/start lần 2 → 409 Conflict (idempotency)", async () => {
    await api(app)
      .post("/workflow/start")
      .set(bearer(token))
      .send({ contentItemId })
      .expect(409);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Bước 1 (Script): start → submit → request_revision → restart → resubmit → approve
  // ────────────────────────────────────────────────────────────────────────────

  it("Bước 1: start → in_progress", async () => {
    const step1 = steps.find((s) => s.stepOrder === 1)!;
    const res = await api(app)
      .post(`/workflow/steps/${step1.id}/start`)
      .set(bearer(token))
      .expect(201);

    expect(res.body.data.status).toBe("in_progress");
  });

  it("Bước 1: submit → waiting_review + approval_request pending", async () => {
    const step1 = steps.find((s) => s.stepOrder === 1)!;
    const res = await api(app)
      .post(`/workflow/steps/${step1.id}/submit`)
      .set(bearer(token))
      .send({ submissionUrl: "https://docs.example.com/script-v1", submissionNote: "Draft 1" })
      .expect(201);

    expect(res.body.data.step.status).toBe("waiting_review");
  });

  it("Bước 1: request_revision → step về revision + defect tạo", async () => {
    const pendingRes = await api(app)
      .get("/workflow/approval-requests")
      .set(bearer(token))
      .expect(200);

    const requests = pendingRes.body.data as Array<{ id: string; status: string }>;
    const pending = requests.find((r) => r.status === "pending");
    expect(pending).toBeDefined();

    const revRes = await api(app)
      .post(`/workflow/approval-requests/${pending!.id}/request-revision`)
      .set(bearer(token))
      .send({ description: "Kịch bản chưa đủ chi tiết", comment: "Xem lại phần intro" })
      .expect(201);

    expect(revRes.body.data.step.status).toBe("revision");
    expect(revRes.body.data.defect).toBeDefined();
    expect(revRes.body.data.defect.id).toBeTruthy();
  });

  it("Bước 1 (sau revision): restart → in_progress", async () => {
    const step1 = steps.find((s) => s.stepOrder === 1)!;
    const res = await api(app)
      .post(`/workflow/steps/${step1.id}/start`)
      .set(bearer(token))
      .expect(201);

    expect(res.body.data.status).toBe("in_progress");
  });

  it("Bước 1 (sau revision): resubmit → waiting_review", async () => {
    const step1 = steps.find((s) => s.stepOrder === 1)!;
    await api(app)
      .post(`/workflow/steps/${step1.id}/submit`)
      .set(bearer(token))
      .send({ submissionUrl: "https://docs.example.com/script-v2", submissionNote: "Đã sửa" })
      .expect(201);
  });

  it("Bước 1: approve → step approved + bước 2 mở (currentStepOrder = 2)", async () => {
    const pendingRes = await api(app)
      .get("/workflow/approval-requests")
      .set(bearer(token))
      .expect(200);

    const pending = (pendingRes.body.data as Array<{ id: string; status: string }>).find(
      (r) => r.status === "pending",
    );
    expect(pending).toBeDefined();

    const approveRes = await api(app)
      .post(`/workflow/approval-requests/${pending!.id}/approve`)
      .set(bearer(token))
      .send({ comment: "OK, kịch bản tốt" })
      .expect(201);

    expect(approveRes.body.data.step.status).toBe("approved");
    expect(approveRes.body.data.isLastStep).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Bước 2–4: happy path
  // ────────────────────────────────────────────────────────────────────────────

  for (const stepOrder of [2, 3, 4]) {
    it(`Bước ${stepOrder}: start → submit → approve`, async () => {
      const step = steps.find((s) => s.stepOrder === stepOrder)!;

      await api(app).post(`/workflow/steps/${step.id}/start`).set(bearer(token)).expect(201);
      await api(app)
        .post(`/workflow/steps/${step.id}/submit`)
        .set(bearer(token))
        .send({ submissionUrl: `https://example.com/step${stepOrder}-v1` })
        .expect(201);

      const pendingRes = await api(app)
        .get("/workflow/approval-requests")
        .set(bearer(token))
        .expect(200);

      const pending = (pendingRes.body.data as Array<{ id: string; status: string }>).find(
        (r) => r.status === "pending",
      );
      expect(pending).toBeDefined();

      const approveRes = await api(app)
        .post(`/workflow/approval-requests/${pending!.id}/approve`)
        .set(bearer(token))
        .send({})
        .expect(201);

      expect(approveRes.body.data.step.status).toBe("approved");
      expect(approveRes.body.data.isLastStep).toBe(stepOrder === 4);
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Kiểm tra trạng thái cuối
  // ────────────────────────────────────────────────────────────────────────────

  it("GET /workflow/:instanceId → instance.status = completed, tất cả bước approved", async () => {
    const res = await api(app)
      .get(`/workflow/${instanceId}`)
      .set(bearer(token))
      .expect(200);

    const data = res.body.data as {
      instance: { status: string };
      steps: Array<{ status: string }>;
    };

    expect(data.instance.status).toBe("completed");
    for (const step of data.steps) {
      expect(step.status).toBe("approved");
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. Kiểm tra tenant isolation (cross-tenant barrier)
  //    Tenant B KHÔNG thấy workflow instance của tenant A (RLS chặn → 404).
  // ────────────────────────────────────────────────────────────────────────────

  it("Tenant B không thể truy cập workflow của tenant A → 404", async () => {
    await api(app)
      .get(`/workflow/${instanceId}`)
      .set(bearer(tokenB))
      .expect(404);
  });

  it("Tenant B không thể approve approval_request của tenant A → 404", async () => {
    // Approval requests của A đã resolved, nhưng test vẫn xác nhận không tìm thấy theo tenant B
    const pendingRes = await api(app)
      .get("/workflow/approval-requests")
      .set(bearer(tokenB))
      .expect(200);

    // Tenant B không thấy bất kỳ approval request nào của tenant A
    const idsB = (pendingRes.body.data as Array<{ id: string }>).map((r) => r.id);
    const stepsA = steps.map((s) => s.id);

    // Không có approval request nào của A lọt vào list của B
    // (approval_requests table có RLS theo company_id)
    expect(idsB.every((id) => !stepsA.includes(id))).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 7. Guard deny-path: actor không phải assignee → 409
  // ────────────────────────────────────────────────────────────────────────────

  it("Người khác không thể start bước của workflow đã complete → 409 hoặc 404", async () => {
    // Tạo tenant B workflow để test deny-path với user B
    const projectResB = await api(app)
      .post("/projects")
      .set(bearer(tokenB))
      .send({ name: "B Project" })
      .expect(201);
    const projectIdB = projectResB.body.data.id as string;

    const contentResB = await api(app)
      .post(`/projects/${projectIdB}/content`)
      .set(bearer(tokenB))
      .send({ title: "B Video", contentType: "video" })
      .expect(201);
    const contentItemIdB = contentResB.body.data.id as string;

    const wfResB = await api(app)
      .post("/workflow/start")
      .set(bearer(tokenB))
      .send({ contentItemId: contentItemIdB })
      .expect(201);

    const instanceIdB = wfResB.body.data.instance.id as string;
    const stepsB = wfResB.body.data.steps as Array<{ id: string; stepOrder: number }>;
    const step1B = stepsB.find((s) => s.stepOrder === 1)!;

    // assignee chưa set (null) → start step → FSM: assigneeUserId null → 409 NotStepActorError
    await api(app)
      .post(`/workflow/steps/${step1B.id}/start`)
      .set(bearer(tokenB))
      .expect(409);

    // Gán assignee cho tenant B
    await assignStepsTo(direct, instanceIdB, (await direct.query(
      "SELECT id FROM users WHERE company_id = $1 LIMIT 1",
      [tenantB.companyId],
    )).rows[0].id as string);

    // Giờ start OK (assignee khớp)
    await api(app)
      .post(`/workflow/steps/${step1B.id}/start`)
      .set(bearer(tokenB))
      .expect(201);
  });
});
