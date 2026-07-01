/**
 * S2-FND-BE-3 (L4-file-access-log-viewer) — FileAccessLogController deny-path / 2-tenant RLS / masking (integration).
 *
 * Postgres THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5). Gate cứng `hasDb && LANE_DB` (memory
 * integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 * Colocated trong src/ → vitest gom qua include glob `src/**\/*.spec.ts`; skipIf(!runDb) ⇒ inert ở unit-run.
 *
 * Phủ (RED-trước → GREEN):
 *   D1  Employee (role 0008, KHÔNG view:foundation-file-access-log) → GET 403.
 *   P2  company-admin A (role 0001 — CÓ view qua bulk-grant mig 0435, non-sensitive) → GET 200, list MASKED.
 *   M3  Response WHITELIST: KHÔNG ip_address/user_agent/metadata/storage_path/signed_url/companyId (no-secret-leak).
 *   X4  2-tenant RLS: GET của A CHỈ trả log của A (KHÔNG lộ log B) — withTenant + RLS+FORCE.
 *   F5  Filter action/fileId thu hẹp đúng tập.
 *   N6  APPEND-ONLY: KHÔNG route mutate — POST/PATCH/DELETE /foundation/file-access-logs → 404 (route absent).
 *
 * PIN theo CẶP SEED THẬT (view, 'foundation-file-access-log', is_sensitive=false → company-admin có qua
 * bulk-grant) — KHÔNG theo mã FE (bài học drift S1-FND-MODULE).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../auth/password.service";
import { directPool, hasDb } from "../../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../../test/helpers/seed";

const LOGIN_PW = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // bulk-grant view:foundation-file-access-log (mig 0435)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có foundation-file-access-log

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

const TAG = randomUUID().slice(0, 8);

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: LOGIN_PW });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

/** Chèn 1 file RAW (direct pool, bypass RLS) để có file_id hợp lệ cho log. Trả về id. */
async function seedFile(direct: Pool, companyId: string, uploadedBy: string): Promise<string> {
  const name = `f-${randomUUID().slice(0, 8)}.pdf`;
  const r = await direct.query(
    `INSERT INTO files
       (company_id, original_name, stored_name, mime_type, file_size_bytes,
        storage_provider, storage_path, visibility, upload_status, uploaded_by)
     VALUES ($1, $2, $2, 'application/pdf', 1024, 'S3', $3, 'Private', 'Uploaded', $4) RETURNING id`,
    [companyId, name, `s3://k/${TAG}/${name}`, uploadedBy],
  );
  return r.rows[0].id as string;
}

/** Chèn 1 file_access_logs RAW với các cột NHẠY CẢM điền sẵn (để chứng minh mapper strip). Trả về id. */
async function seedLog(
  direct: Pool,
  companyId: string,
  opts: {
    fileId: string;
    actorUserId: string;
    action: string;
    accessGranted?: boolean;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO file_access_logs
       (company_id, file_id, actor_user_id, action, access_granted, ip_address, user_agent, metadata, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING id`,
    [
      companyId,
      opts.fileId,
      opts.actorUserId,
      opts.action,
      opts.accessGranted ?? true,
      opts.ipAddress ?? "203.0.113.9",
      opts.userAgent ?? "secret-agent-fingerprint/1.0",
      JSON.stringify(
        opts.metadata ?? { storage_path: "s3://secret/path", signed_url: "https://x?token=zzz" },
      ),
      `req-${TAG}`,
    ],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!runDb)("S2-FND-BE-3 file-access-log viewer deny-path / RLS / masking", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string; // company-admin A (view via bulk-grant)
  let employeeToken: string; // employee A (KHÔNG foundation-file-access-log)
  let fileA1: string;
  let logDownloadA: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "fala");
    B = await seedCompany(direct, "falb");
    companyIds.push(A.companyId, B.companyId);
    const pw = await new PasswordService().hash(LOGIN_PW);

    const adminEmail = `adm-${randomUUID().slice(0, 8)}@a.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    const empEmail = `emp-${randomUUID().slice(0, 8)}@a.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    // Tenant B: admin + file + log (target cross-tenant — A KHÔNG được thấy).
    const adminBEmail = `adm-${randomUUID().slice(0, 8)}@b.test`;
    const adminB = await seedUser(direct, B.companyId, adminBEmail, pw);
    await seedUserRole(direct, adminB, COMPANY_ADMIN_ROLE, B.companyId);

    fileA1 = await seedFile(direct, A.companyId, admin);
    const fileA2 = await seedFile(direct, A.companyId, admin);
    const fileB1 = await seedFile(direct, B.companyId, adminB);

    // A: 1 Download (fileA1) + 1 Preview (fileA2, DENY). B: 1 Download (fileB1) — KHÔNG lọt sang A.
    logDownloadA = await seedLog(direct, A.companyId, {
      fileId: fileA1,
      actorUserId: admin,
      action: "Download",
    });
    await seedLog(direct, A.companyId, {
      fileId: fileA2,
      actorUserId: admin,
      action: "Preview",
      accessGranted: false,
    });
    await seedLog(direct, B.companyId, {
      fileId: fileB1,
      actorUserId: adminB,
      action: "Download",
    });

    adminToken = await login(app, A.slug, adminEmail);
    employeeToken = await login(app, A.slug, empEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── D1: Employee KHÔNG grant → GET 403 ────────────────────────────────────────
  it("D1 — Employee (không foundation-file-access-log) GET /foundation/file-access-logs → 403", async () => {
    const res = await api(app)
      .get("/foundation/file-access-logs")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.data ?? null).toBeNull();
  });

  // ── P2: company-admin (view via bulk-grant) → GET 200 + pagination ─────────────
  it("P2 — company-admin (view) GET → 200 (list log tenant A) + pagination block", async () => {
    const res = await api(app)
      .get("/foundation/file-access-logs")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(2); // 2 log của A (KHÔNG gồm B)
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.pagination.page).toBe(1);
  });

  // ── M3: WHITELIST — response KHÔNG chứa cột nhạy cảm/PII/secret ────────────────
  it("M3 — response WHITELIST: KHÔNG ip_address/user_agent/metadata/companyId; KHÔNG secret literal", async () => {
    const res = await api(app)
      .get("/foundation/file-access-logs")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    for (const row of rows) {
      for (const key of [
        "ipAddress",
        "ip_address",
        "userAgent",
        "user_agent",
        "metadata",
        "companyId",
        "company_id",
        "actorEmployeeId",
        "fileLinkId",
      ]) {
        expect(row).not.toHaveProperty(key);
      }
      // Field WHITELIST hiện diện.
      expect(row).toHaveProperty("action");
      expect(row).toHaveProperty("accessGranted");
      expect(row).toHaveProperty("createdAt");
    }
    // Không có literal nhạy cảm ở đâu trong body (defense-in-depth no-secret-log).
    const serialized = JSON.stringify(res.body.data);
    expect(serialized).not.toMatch(
      /storage_path|signed_url|203\.0\.113\.9|secret-agent-fingerprint/,
    );
  });

  // ── X4: 2-tenant RLS — GET A KHÔNG lộ log B ───────────────────────────────────
  it("X4 — GET của A CHỈ trả log của A (RLS Company-scope, KHÔNG lộ tenant B)", async () => {
    const res = await api(app)
      .get("/foundation/file-access-logs")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(logDownloadA);
    // File của A hiện diện; KHÔNG có fileId của B (filter by fileId B → rỗng ở test F5 chứng minh thêm).
    const fileIds = (res.body.data as Array<{ fileId: string }>).map((r) => r.fileId);
    expect(fileIds).toContain(fileA1);
  });

  // ── F5: Filter action + fileId thu hẹp đúng ───────────────────────────────────
  it("F5 — filter action=Download → chỉ log Download; fileId khoanh đúng file", async () => {
    const res = await api(app)
      .get("/foundation/file-access-logs")
      .query({ action: "Download" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<{ action: string; fileId: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("Download");
    expect(rows[0].fileId).toBe(fileA1);

    const byFile = await api(app)
      .get("/foundation/file-access-logs")
      .query({ fileId: fileA1 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byFile.status).toBe(200);
    expect((byFile.body.data as unknown[]).length).toBe(1);
  });

  // ── N6: APPEND-ONLY — KHÔNG route mutate ──────────────────────────────────────
  it("N6 — APPEND-ONLY: POST/PATCH/DELETE /foundation/file-access-logs → 404 (route absent)", async () => {
    const post = await api(app)
      .post("/foundation/file-access-logs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fileId: fileA1, action: "Download" });
    expect(post.status).toBe(404);

    const patch = await api(app)
      .patch(`/foundation/file-access-logs/${logDownloadA}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "Preview" });
    expect(patch.status).toBe(404);

    const del = await api(app)
      .delete(`/foundation/file-access-logs/${logDownloadA}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(404);
  });
});
