/**
 * S4-TASK-BE-5 (L4, CROWN/security — SUPERSEDE OWNER 2026-07-12) — legacy `/tasks/:taskId/attachments`
 * (TaskAttachmentsController) DEPRECATE-IN-PLACE → 410 Gone.
 *
 * Vấn đề (đã đóng): TaskAttachmentsService.listByTask/getDownloadUrl chỉ assertTaskInTenant (KHÔNG
 * data-scope/membership) trong khi gate `read:task` cấp cho employee@Own/manager@Team/hr@Company/
 * admin@Company ⇒ bất kỳ user có `read:task` LIỆT KÊ/TẢI được attachment của MỌI task trong tenant
 * (IDOR trong-tenant, né membership). Canonical thay thế = /tasks/:id/files (S4-TASK-BE-5 L2).
 *
 * done_when: MỌI handler (POST / GET list / GET :id/download / DELETE) → 410 Gone, code
 * TASK_ATTACHMENTS_SUPERSEDED, KHÔNG BAO GIỜ 200/302 kèm data — kể cả user có `read:task` rộng
 * (Company scope) gọi vào task KHÔNG thuộc phạm vi mình (chứng minh lỗ IDOR cũ đã đóng, không phải
 * né bằng 403 do thiếu quyền). task_attachments (bảng) + TaskAttachmentsService giữ nguyên PARK —
 * regression riêng: DB-level RLS/append-only vẫn đúng ở task-attachments.int-spec.ts (không đổi).
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate).
 */

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
import { appPool, directPool, hasDb } from "../helpers/integration-db";
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

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!legacyLock5";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Grant a fresh company-scoped role carrying read:task@Company (the historical IDOR grant). */
async function grantReadTaskCompany(
  direct: Pool,
  companyId: string,
  userId: string,
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `qa-legacy-read-${userId.slice(0, 8)}`);
  const permId = await seedPermissionCatalog(direct, "read", "task", false);
  await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
  await seedUserRole(direct, userId, roleId, companyId);
}

async function seedTask(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO tasks (company_id, task_type, title, task_status)
     VALUES ($1, 'office', 'legacy-lock-task', 'Todo') RETURNING id`,
    [companyId],
  );
  return r.rows[0].id as string;
}

async function seedAttachment(
  direct: Pool,
  companyId: string,
  taskId: string,
  userId: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO task_attachments
       (company_id, task_id, uploaded_by, storage_key, file_name, content_type, size_bytes)
     VALUES ($1, $2, $3, $4, 'legacy.pdf', 'application/pdf', 100) RETURNING id`,
    [companyId, taskId, userId, `${companyId}/tasks/${taskId}/legacy-lock`],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!hasLaneDb)("S4-TASK-BE-5 L4 — legacy attachments route locked (410 Gone)", () => {
  const direct = directPool();
  const app = appPool();
  let nest: INestApplication;

  let A: SeededTenant;
  let ownerUserId = ""; // uploaded the attachment / owns the task's company
  let otherTaskId = ""; // task NOT owned/assigned to `readerUserId` — the historical IDOR victim task
  let attachmentId = "";
  let readerEmail = ""; // holds read:task@Company (broad) — the exact grant the old IDOR abused
  let noPermEmail = ""; // no task grant at all

  beforeAll(async () => {
    const hash = await hashedPw();
    A = await seedCompany(direct, "lgcyA5");

    ownerUserId = await seedUser(direct, A.companyId, `owner@${A.slug}.test`, hash);
    otherTaskId = await seedTask(direct, A.companyId);
    attachmentId = await seedAttachment(direct, A.companyId, otherTaskId, ownerUserId);

    readerEmail = `reader@${A.slug}.test`;
    const readerUserId = await seedUser(direct, A.companyId, readerEmail, hash);
    await grantReadTaskCompany(direct, A.companyId, readerUserId);

    noPermEmail = `noperm@${A.slug}.test`;
    await seedUser(direct, A.companyId, noPermEmail, hash);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = moduleRef.createNestApplication();
    nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    nest.useGlobalFilters(new AllExceptionsFilter());
    await nest.init();
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
    if (nest) await nest.close();
  });

  it("LEGACY REGRESSION: read:task@Company (the old IDOR grant) → list of a task it does NOT own → 410, not 200/data", async () => {
    const token = await login(nest, A.slug, readerEmail);
    const res = await api(nest).get(`/tasks/${otherTaskId}/attachments`).set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(410);
    expect(res.body.error?.code).toBe("TASK_ATTACHMENTS_SUPERSEDED");
    expect(res.body.data).toBeNull();
    // The historical leak returned an array of attachment DTOs — assert it is categorically gone.
    expect(Array.isArray(res.body.data)).toBe(false);
  });

  it("LEGACY REGRESSION: read:task@Company → download of a task it does NOT own → 410, no signed URL", async () => {
    const token = await login(nest, A.slug, readerEmail);
    const res = await api(nest)
      .get(`/tasks/${otherTaskId}/attachments/${attachmentId}/download`)
      .set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(410);
    expect(res.body.error?.code).toBe("TASK_ATTACHMENTS_SUPERSEDED");
    expect(res.headers.location).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("downloadUrl");
  });

  it("POST (create upload-intent) on any task → 410, no metadata row written", async () => {
    const token = await login(nest, A.slug, readerEmail);
    const before = await direct.query(
      `SELECT count(*)::int AS n FROM task_attachments WHERE task_id = $1`,
      [otherTaskId],
    );
    const res = await api(nest)
      .post(`/tasks/${otherTaskId}/attachments`)
      .set(bearer(token))
      .send({ fileName: "x.pdf", contentType: "application/pdf", sizeBytes: 10 });
    expect(res.status, JSON.stringify(res.body)).toBe(410);
    expect(res.body.error?.code).toBe("TASK_ATTACHMENTS_SUPERSEDED");
    const after = await direct.query(
      `SELECT count(*)::int AS n FROM task_attachments WHERE task_id = $1`,
      [otherTaskId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("DELETE on any task's attachment → 410, row NOT soft-deleted", async () => {
    const token = await login(nest, A.slug, readerEmail);
    const res = await api(nest)
      .delete(`/tasks/${otherTaskId}/attachments/${attachmentId}`)
      .set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(410);
    expect(res.body.error?.code).toBe("TASK_ATTACHMENTS_SUPERSEDED");
    const row = await direct.query(`SELECT deleted_at FROM task_attachments WHERE id = $1`, [
      attachmentId,
    ]);
    expect(row.rows[0].deleted_at).toBeNull();
  });

  it("noPerm (zero task grant) also gets 410 (dead route, not a permission decision)", async () => {
    const token = await login(nest, A.slug, noPermEmail);
    const res = await api(nest).get(`/tasks/${otherTaskId}/attachments`).set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(410);
    expect(res.body.error?.code).toBe("TASK_ATTACHMENTS_SUPERSEDED");
  });

  it("unauthenticated request still 401 (global JwtAuthGuard unaffected)", async () => {
    const res = await api(nest).get(`/tasks/${otherTaskId}/attachments`);
    expect(res.status).toBe(401);
  });
});
