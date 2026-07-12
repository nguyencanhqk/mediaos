/**
 * S4-TASK-BE-5 — Task File (đính kèm công việc) integration (CROWN-JEWEL: permission + data-scope/membership
 * IDOR + tenant isolation + STRICT scan_status guard + soft-delete + append-only task_activity_logs + resolver
 * anti-escalation). Real NestJS app (AppModule) + supertest → full guard chain (JwtAuthGuard → CompanyGuard →
 * 2FA → PermissionGuard → TaskFilesController → TaskFileService → FileService/TaskFileResolver) with the REAL
 * permission engine. No mocks. Routes: /tasks/:taskId/files. TÁI DÙNG pattern EMPFILE — KHÔNG task_files table.
 *
 * done_when (RED-first):
 *   deny (permission): reader (read:task only) POST/DELETE → 403; noPerm → GET/POST/DELETE → 403;
 *     emp (read+file-upload@Own, NO file-delete) DELETE → 403.
 *   IDOR cross-tenant: file/task của công ty B → user công ty A → GET/POST/DELETE → 404 (RLS 0-row, no leak).
 *   IDOR cross-task: fileId link vào taskOther, gọi qua /tasks/{taskA}/files/{fileId} → 404.
 *   out-of-scope: emp@Own GET files của taskOther (ngoài membership/assignee) → 404.
 *   scan-guard STRICT: scanStatus∈{Pending,Failed,Infected} → download → 409 NOT_DOWNLOADABLE, KHÔNG URL;
 *     {Clean,NotRequired} → 302 + Location + file_access_logs Download append.
 *   resolver fail-closed / NO escalation: user chỉ có FOUNDATION.FILE.download (rộng) tải file task-linked qua
 *     /foundation/files/:id/download → 403 (deny-resolver, KHÔNG 302 — không escalate lên foundation fallback).
 *   happy: hr POST link (Uploaded+Clean) → 201 + file_links.company_id + TASK_FILE_UPLOADED (target 'File') +
 *     FileLinked audit; GET list/metadata → 200 (no storage internals); DELETE → 204 soft-delete + TASK_FILE_
 *     DELETED + rời list; emp@Own link file vào task assigned mình → 201.
 *   append-only: app role UPDATE/DELETE trên task_activity_logs bị chặn (chỉ INSERT).
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env trỏ DATABASE_URL vào DB chung
 * (hasDb=true) → CHỈ chạy trên lane DB cô lập (LANE_DB=mediaos_s4_task_be5), else false-red.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { appPool, directPool, hasDb, withClient } from "../helpers/integration-db";
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

const PASSWORD = "Passw0rd!taskf5";
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

type Pair = [action: string, resourceType: string];
const READ_ONLY: Pair[] = [["read", "task"]];
const FILE_ALL: Pair[] = [
  ["read", "task"],
  ["file-upload", "task"],
  ["file-delete", "task"],
];
const EMP_UPLOAD: Pair[] = [
  ["read", "task"],
  ["file-upload", "task"],
]; // NO file-delete (mirror seed 0485 employee@Own)
const FOUNDATION_DL: Pair[] = [["download", "foundation-file"]];

const SENSITIVE = new Set(["delete", "export", "view", "view-report"]);

/** Grant a fresh company-scoped role carrying `pairs` to `userId` at `scope`. */
async function grant(
  direct: Pool,
  companyId: string,
  userId: string,
  pairs: Pair[],
  scope: "Own" | "Team" | "Department" | "Company" | "System" = "Company",
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `qa-taskfile-${scope}-${userId.slice(0, 8)}`);
  for (const [action, resourceType] of pairs) {
    const permId = await seedPermissionCatalog(direct, action, resourceType, SENSITIVE.has(action));
    await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

async function seedEmployee(
  direct: Pool,
  companyId: string,
  userId: string | null,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
    [companyId, userId],
  );
  return r.rows[0].id as string;
}

async function seedTask(
  direct: Pool,
  companyId: string,
  assigneeEmployeeId: string | null,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id)
     VALUES ($1, 'office', 't5-task', 'Todo', $2) RETURNING id`,
    [companyId, assigneeEmployeeId],
  );
  return r.rows[0].id as string;
}

/** Seed a `files` row (Uploaded by default). storage_path = {companyId}/files/{fileId} (tenant prefix). */
async function seedFile(
  direct: Pool,
  companyId: string,
  uploadedBy: string,
  opts?: { scanStatus?: string; uploadStatus?: string },
): Promise<string> {
  const fileId = randomUUID();
  const storagePath = `${companyId}/files/${fileId}`;
  await direct.query(
    `INSERT INTO files
       (id, company_id, original_name, stored_name, mime_type, file_size_bytes, storage_provider,
        storage_path, upload_status, scan_status, uploaded_by)
     VALUES ($1, $2, 'attach.pdf', $3, 'application/pdf', 4096, 'MinIO', $4, $5, $6, $7)`,
    [
      fileId,
      companyId,
      fileId,
      storagePath,
      opts?.uploadStatus ?? "Uploaded",
      opts?.scanStatus ?? "Clean",
      uploadedBy,
    ],
  );
  return fileId;
}

/** Seed a file_links row (module TASK / entity task). Returns linkId. */
async function seedTaskLink(
  direct: Pool,
  companyId: string,
  fileId: string,
  taskId: string,
  createdBy: string,
  category: string | null = null,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO file_links
       (company_id, file_id, module_code, entity_type, entity_id, link_type, access_scope, is_primary,
        purpose, created_by)
     VALUES ($1, $2, 'TASK', 'task', $3, 'Attachment', 'Company', false, $4, $5) RETURNING id`,
    [companyId, fileId, taskId, category, createdBy],
  );
  return r.rows[0].id as string;
}

async function rawFile(
  direct: Pool,
  fileId: string,
): Promise<{ deletedAt: Date | null } | undefined> {
  const r = await direct.query(`SELECT deleted_at AS "deletedAt" FROM files WHERE id = $1`, [
    fileId,
  ]);
  return r.rows[0];
}

async function countActivity(
  direct: Pool,
  companyId: string,
  taskId: string,
  action: string,
): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM task_activity_logs
      WHERE company_id = $1 AND task_id = $2 AND action = $3 AND target_type = 'File'`,
    [companyId, taskId, action],
  );
  return r.rows[0].n as number;
}

async function countAccessLogs(direct: Pool, fileId: string, action: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM file_access_logs WHERE file_id = $1 AND action = $2`,
    [fileId, action],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!hasLaneDb)("S4-TASK-BE-5 task files (HTTP, real permission engine)", () => {
  const direct = directPool();
  const app = appPool();
  let nest: INestApplication;

  let A: SeededTenant;
  let B: SeededTenant;
  let hrEmail = "";
  let hrUserId = "";
  let readerEmail = ""; // read:task@Company only → 403 on POST/DELETE
  let noPermEmail = ""; // no grant → 403 everywhere
  let empEmail = ""; // read+file-upload:task@Own (assignee of taskA) → link ok, DELETE 403
  let foundationEmail = ""; // FOUNDATION.FILE.download only → anti-escalation on task-linked file
  let empEmp = ""; // employee_profile of empUser (assignee of taskA)

  let taskA = ""; // task in A, assignee empEmp — in scope for emp
  let taskOther = ""; // task in A, assignee otherEmp (out of emp's Own scope)
  let taskB = ""; // task in B — cross-tenant

  let cleanFileA = ""; // Clean, linked to taskA — download OK
  let cleanLinkA = "";
  let pendingFileA = ""; // Pending → download 409
  let failedFileA = ""; // Failed → download 409
  let infectedFileA = ""; // Infected → download 409
  let unlinkedCleanFileA = ""; // Clean/Uploaded, NOT linked — hr POST link happy-path
  let empUnlinkedFileA = ""; // Clean/Uploaded, NOT linked — emp POST link to taskA
  let cleanFileOther = ""; // Clean, linked to taskOther — cross-task IDOR / out-of-scope
  let fileB = ""; // Clean, linked to taskB — cross-tenant

  beforeAll(async () => {
    const hash = await hashedPw();
    A = await seedCompany(direct, "tfa5A");
    B = await seedCompany(direct, "tfa5B");

    hrEmail = `hr@${A.slug}.test`;
    hrUserId = await seedUser(direct, A.companyId, hrEmail, hash);
    await grant(direct, A.companyId, hrUserId, FILE_ALL, "Company");

    readerEmail = `reader@${A.slug}.test`;
    const readerUserId = await seedUser(direct, A.companyId, readerEmail, hash);
    await grant(direct, A.companyId, readerUserId, READ_ONLY, "Company");

    noPermEmail = `noperm@${A.slug}.test`;
    await seedUser(direct, A.companyId, noPermEmail, hash);

    const empUserId = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
    empEmail = `emp@${A.slug}.test`;
    empEmp = await seedEmployee(direct, A.companyId, empUserId);
    await grant(direct, A.companyId, empUserId, EMP_UPLOAD, "Own");

    foundationEmail = `fnd@${A.slug}.test`;
    const fndUserId = await seedUser(direct, A.companyId, foundationEmail, hash);
    await grant(direct, A.companyId, fndUserId, FOUNDATION_DL, "Company");

    const otherUserId = await seedUser(direct, A.companyId, `other@${A.slug}.test`, hash);
    const otherEmp = await seedEmployee(direct, A.companyId, otherUserId);

    taskA = await seedTask(direct, A.companyId, empEmp);
    taskOther = await seedTask(direct, A.companyId, otherEmp);

    cleanFileA = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Clean" });
    cleanLinkA = await seedTaskLink(direct, A.companyId, cleanFileA, taskA, hrUserId, "Spec");

    pendingFileA = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Pending" });
    await seedTaskLink(direct, A.companyId, pendingFileA, taskA, hrUserId);
    failedFileA = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Failed" });
    await seedTaskLink(direct, A.companyId, failedFileA, taskA, hrUserId);
    infectedFileA = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Infected" });
    await seedTaskLink(direct, A.companyId, infectedFileA, taskA, hrUserId);

    unlinkedCleanFileA = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Clean" });
    empUnlinkedFileA = await seedFile(direct, A.companyId, empUserId, { scanStatus: "Clean" });

    cleanFileOther = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Clean" });
    await seedTaskLink(direct, A.companyId, cleanFileOther, taskOther, hrUserId);

    taskB = await seedTask(direct, B.companyId, null);
    const bUserId = await seedUser(direct, B.companyId, `bhr@${B.slug}.test`, hash);
    fileB = await seedFile(direct, B.companyId, bUserId, { scanStatus: "Clean" });
    await seedTaskLink(direct, B.companyId, fileB, taskB, bUserId, "B-SECRET");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = moduleRef.createNestApplication();
    nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    nest.useGlobalFilters(new AllExceptionsFilter());
    await nest.init();
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
    if (nest) await nest.close();
  });

  // ── deny-path (PermissionGuard fail-closed, opt-in per route) ─────────────────────────────────

  it("deny: noPerm (no task grant) → GET/POST/DELETE → 403", async () => {
    const token = await login(nest, A.slug, noPermEmail);
    expect((await api(nest).get(`/tasks/${taskA}/files`).set(bearer(token))).status).toBe(403);
    expect(
      (
        await api(nest)
          .post(`/tasks/${taskA}/files`)
          .set(bearer(token))
          .send({ fileId: unlinkedCleanFileA })
      ).status,
    ).toBe(403);
    expect(
      (await api(nest).delete(`/tasks/${taskA}/files/${cleanFileA}`).set(bearer(token))).status,
    ).toBe(403);
  });

  it("deny: reader (read:task only, NO file-upload/delete) → POST/DELETE → 403; GET → 200", async () => {
    const token = await login(nest, A.slug, readerEmail);
    const post = await api(nest)
      .post(`/tasks/${taskA}/files`)
      .set(bearer(token))
      .send({ fileId: unlinkedCleanFileA });
    expect(post.status).toBe(403);
    const del = await api(nest).delete(`/tasks/${taskA}/files/${cleanFileA}`).set(bearer(token));
    expect(del.status).toBe(403);
    const list = await api(nest).get(`/tasks/${taskA}/files`).set(bearer(token));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
  });

  it("deny: emp (read+file-upload@Own, NO file-delete) DELETE own task's file → 403", async () => {
    const token = await login(nest, A.slug, empEmail);
    const del = await api(nest).delete(`/tasks/${taskA}/files/${cleanFileA}`).set(bearer(token));
    expect(del.status).toBe(403);
  });

  // ── IDOR cross-tenant (404, no leak) ───────────────────────────────────────────────────────────

  it("IDOR cross-tenant: hr(A) on task(B) list/metadata/download/DELETE/POST → 404", async () => {
    const token = await login(nest, A.slug, hrEmail);
    expect((await api(nest).get(`/tasks/${taskB}/files`).set(bearer(token))).status).toBe(404);
    expect((await api(nest).get(`/tasks/${taskB}/files/${fileB}`).set(bearer(token))).status).toBe(
      404,
    );
    expect(
      (await api(nest).get(`/tasks/${taskB}/files/${fileB}/download`).set(bearer(token))).status,
    ).toBe(404);
    expect(
      (await api(nest).delete(`/tasks/${taskB}/files/${fileB}`).set(bearer(token))).status,
    ).toBe(404);
    const post = await api(nest)
      .post(`/tasks/${taskB}/files`)
      .set(bearer(token))
      .send({ fileId: unlinkedCleanFileA });
    expect(post.status).toBe(404);
  });

  // ── IDOR cross-task (file not linked to :taskId → 404) ─────────────────────────────────────────

  it("IDOR cross-task: cleanFileOther queried under taskA → 404 (metadata/download/DELETE)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    expect(
      (await api(nest).get(`/tasks/${taskA}/files/${cleanFileOther}`).set(bearer(token))).status,
    ).toBe(404);
    expect(
      (await api(nest).get(`/tasks/${taskA}/files/${cleanFileOther}/download`).set(bearer(token)))
        .status,
    ).toBe(404);
    expect(
      (await api(nest).delete(`/tasks/${taskA}/files/${cleanFileOther}`).set(bearer(token))).status,
    ).toBe(404);
  });

  it("out-of-scope: emp@Own list files of taskOther (not assignee/member) → 404", async () => {
    const token = await login(nest, A.slug, empEmail);
    const list = await api(nest).get(`/tasks/${taskOther}/files`).set(bearer(token));
    expect(list.status).toBe(404);
  });

  it("in-scope: emp@Own list files of taskA (assignee) → 200", async () => {
    const token = await login(nest, A.slug, empEmail);
    const list = await api(nest).get(`/tasks/${taskA}/files`).set(bearer(token));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
  });

  // ── STRICT scan_status guard (409 unless Clean/NotRequired) ────────────────────────────────────

  it("scan Pending → download → 409 NOT_DOWNLOADABLE (no URL)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest)
      .get(`/tasks/${taskA}/files/${pendingFileA}/download`)
      .set(bearer(token));
    expect(res.status).toBe(409);
    expect(res.headers.location).toBeUndefined();
    expect(JSON.stringify(res.body)).toContain("NOT-DOWNLOADABLE");
  });

  it("scan Failed → download → 409 NOT_DOWNLOADABLE (no URL)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest)
      .get(`/tasks/${taskA}/files/${failedFileA}/download`)
      .set(bearer(token));
    expect(res.status).toBe(409);
    expect(res.headers.location).toBeUndefined();
  });

  it("scan Infected → download → 409 NOT_DOWNLOADABLE (no URL)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest)
      .get(`/tasks/${taskA}/files/${infectedFileA}/download`)
      .set(bearer(token));
    expect(res.status).toBe(409);
    expect(res.headers.location).toBeUndefined();
  });

  it("scan Clean → download → 302 + Location URL + file_access_logs Download append", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest)
      .get(`/tasks/${taskA}/files/${cleanFileA}/download`)
      .set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(302);
    expect(typeof res.headers.location).toBe("string");
    expect(res.headers.location).not.toContain("storage_path");
    expect(await countAccessLogs(direct, cleanFileA, "Download")).toBeGreaterThanOrEqual(1);
  });

  // ── resolver fail-closed / NO FOUNDATION.FILE.* escalation ─────────────────────────────────────

  it("no-escalation: FOUNDATION.FILE.download-only user cannot download a TASK-linked file → 403", async () => {
    const token = await login(nest, A.slug, foundationEmail);
    const res = await api(nest).get(`/foundation/files/${cleanFileA}/download`).set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
  });

  // ── happy-path list / metadata / link / delete ─────────────────────────────────────────────────

  it("hr list → 200, sees taskA's linked file (linkId+category), NOT storage internals", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest).get(`/tasks/${taskA}/files`).set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const files = res.body.data as Array<Record<string, unknown>>;
    const found = files.find((f) => f.fileId === cleanFileA);
    expect(found, "clean file must be in the list").toBeDefined();
    expect(found?.linkId).toBe(cleanLinkA);
    expect(found?.category).toBe("Spec");
    const blob = JSON.stringify(found).toLowerCase();
    expect(blob).not.toContain("storage_path");
    expect(blob).not.toContain("storagepath");
    expect(blob).not.toContain("checksum");
    expect(blob).not.toContain("stored_name");
  });

  it("hr metadata GET :fileId (own task) → 200; scanStatus/uploadStatus surfaced", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest).get(`/tasks/${taskA}/files/${cleanFileA}`).set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.fileId).toBe(cleanFileA);
    expect(res.body.data.scanStatus).toBe("Clean");
    expect(res.body.data.uploadStatus).toBe("Uploaded");
  });

  it("hr POST link (Uploaded+Clean) → 201 + file_links.company_id + TASK_FILE_UPLOADED + FileLinked audit", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest)
      .post(`/tasks/${taskA}/files`)
      .set(bearer(token))
      .send({ fileId: unlinkedCleanFileA, category: "Attachment" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.fileId).toBe(unlinkedCleanFileA);
    expect(res.body.data.category).toBe("Attachment");

    const link = await direct.query(
      `SELECT company_id FROM file_links WHERE file_id = $1 AND module_code = 'TASK' AND entity_id = $2`,
      [unlinkedCleanFileA, taskA],
    );
    expect(link.rows[0].company_id).toBe(A.companyId);

    expect(
      await countActivity(direct, A.companyId, taskA, "TASK_FILE_UPLOADED"),
    ).toBeGreaterThanOrEqual(1);
    const audit = await direct.query(
      `SELECT 1 FROM audit_logs WHERE company_id = $1 AND object_type = 'file_link' AND action = 'FileLinked' LIMIT 1`,
      [A.companyId],
    );
    expect(audit.rows.length).toBe(1);

    const list = await api(nest).get(`/tasks/${taskA}/files`).set(bearer(token));
    const ids = (list.body.data as Array<{ fileId: string }>).map((f) => f.fileId);
    expect(ids).toContain(unlinkedCleanFileA);
  });

  it("emp@Own POST link file to taskA (assignee) → 201", async () => {
    const token = await login(nest, A.slug, empEmail);
    const res = await api(nest)
      .post(`/tasks/${taskA}/files`)
      .set(bearer(token))
      .send({ fileId: empUnlinkedFileA });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.fileId).toBe(empUnlinkedFileA);
  });

  it("hr DELETE :fileId → 204 SOFT-delete (file row stays, deleted_at set) + TASK_FILE_DELETED + leaves list", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const victim = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Clean" });
    await seedTaskLink(direct, A.companyId, victim, taskA, hrUserId);

    const del = await api(nest).delete(`/tasks/${taskA}/files/${victim}`).set(bearer(token));
    expect(del.status, JSON.stringify(del.body)).toBe(204);

    const raw = await rawFile(direct, victim);
    expect(raw).toBeDefined();
    expect(raw?.deletedAt).not.toBeNull();
    expect(
      await countActivity(direct, A.companyId, taskA, "TASK_FILE_DELETED"),
    ).toBeGreaterThanOrEqual(1);
    expect(await countAccessLogs(direct, victim, "Delete")).toBeGreaterThanOrEqual(1);

    const list = await api(nest).get(`/tasks/${taskA}/files`).set(bearer(token));
    const ids = (list.body.data as Array<{ fileId: string }>).map((f) => f.fileId);
    expect(ids).not.toContain(victim);
  });

  // ── append-only (BẤT BIẾN #2): task_activity_logs is INSERT-only ───────────────────────────────

  it("append-only: mediaos_app UPDATE/DELETE of a task_activity_logs row is DENIED", async () => {
    const row = await direct.query(
      `SELECT id FROM task_activity_logs WHERE company_id = $1 AND target_type = 'File' LIMIT 1`,
      [A.companyId],
    );
    expect(row.rows.length, "need a File activity row to probe").toBe(1);
    const logId = row.rows[0].id as string;
    await withClient(app, async (c) => {
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
      await expect(
        c.query(`UPDATE task_activity_logs SET action = 'TAMPER' WHERE id = $1`, [logId]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`DELETE FROM task_activity_logs WHERE id = $1`, [logId]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
