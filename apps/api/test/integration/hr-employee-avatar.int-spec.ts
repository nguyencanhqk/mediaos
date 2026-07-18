/**
 * S5-HR-AVATAR-1 (lane hravatar) — HR-managed employee avatar integration (Postgres THẬT, DB CÔ LẬP).
 *
 * PHỦ (mirror me-preferences-avatar.int-spec.ts avatar suite, own-scope → HR-managed):
 *   deny thiếu update:employee → 403 trên upload-url/POST/DELETE · NV không tồn tại → 404 · cross-tenant
 *   (fileId thuộc company KHÁC) → 404 (RLS 0-row, KHÔNG lộ tồn tại) · file do NHÂN VIÊN KHÁC upload (owner ≠
 *   HR) → 403 (chống forge) · happy E2E qua MinIO (storageReady probe, mirror files-e2e-confirm.int-spec.ts):
 *   upload-url→PUT→POST /hr/employees/:id/avatar → avatar_url=fileId + file_links(created_by=HR) + GET detail
 *   avatarUrl ký · DELETE gỡ (link soft-deleted + avatar_url null).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate):
 *     bash scripts/lane-db-setup.sh hravatar → export LANE_DB=mediaos_hravatar →
 *     pnpm --filter @mediaos/api test -- hr-employee-avatar
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
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

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!hravatar-1-inttests-1";

/** (action, resourceType) — khớp NGUYÊN VĂN mig 0444 (update:employee). */
const PAIR = {
  employeeUpdate: ["update", "employee"] as const,
  employeeRead: ["read", "employee"] as const,
};

async function insertEmployee(
  direct: Pool,
  companyId: string,
  userId: string,
  code: string,
): Promise<string> {
  const r = await direct.query(
    "INSERT INTO employee_profiles (company_id, user_id, status, employee_code) VALUES ($1,$2,'active',$3) RETURNING id",
    [companyId, userId, code],
  );
  return r.rows[0].id as string;
}

async function insertFile(
  direct: Pool,
  companyId: string,
  ownerId: string,
  opts: { mime?: string; uploadStatus?: string } = {},
): Promise<string> {
  const fileId = randomUUID();
  await direct.query(
    `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
       storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
     VALUES ($1,$2,'avatar.png',$3,$4,10,'MinIO',$5,'Private',$6,'NotRequired',$7,$7)`,
    [
      fileId,
      companyId,
      `${fileId}-avatar.png`,
      opts.mime ?? "image/png",
      `${companyId}/files/${fileId}`,
      opts.uploadStatus ?? "Uploaded",
      ownerId,
    ],
  );
  return fileId;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}
function bearer(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

describe.skipIf(!runDb)("S5-HR-AVATAR-1 HR-managed employee avatar (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let pw: string;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  let seq = 0;

  async function makeHrUser(
    tenant: SeededTenant,
    pairs: (readonly [string, string])[],
  ): Promise<{ userId: string; token: string }> {
    const tag = `hr${++seq}-${randomUUID().slice(0, 6)}`;
    const email = `${tag}-${tenant.slug}@x.test`;
    const userId = await seedUser(direct, tenant.companyId, email, pw);
    const roleId = await seedRole(direct, tenant.companyId, `hravatar-${tag}`);
    for (const [action, rt] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, rt, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, tenant.companyId);

    const login = await api(app)
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    return { userId, token: login.body.data.accessToken as string };
  }

  async function makeTargetEmployee(
    tenant: SeededTenant,
  ): Promise<{ userId: string; employeeId: string }> {
    const tag = `emp-${++seq}-${randomUUID().slice(0, 6)}`;
    const userId = await seedUser(direct, tenant.companyId, `${tag}@x.test`, pw);
    const employeeId = await insertEmployee(direct, tenant.companyId, userId, `E-${tag}`);
    return { userId, employeeId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    pw = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "hravatar-a");
    B = await seedCompany(direct, "hravatar-b");
    companyIds.push(A.companyId, B.companyId);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  it("deny — thiếu update:employee → 403 trên upload-url/POST/DELETE", async () => {
    const hr = await makeHrUser(A, [PAIR.employeeRead]); // KHÔNG cấp update:employee
    const target = await makeTargetEmployee(A);

    const upload = await api(app)
      .post(`/hr/employees/${target.employeeId}/avatar/upload-url`)
      .set(...bearer(hr.token))
      .send({ originalName: "a.png", declaredMimeType: "image/png", sizeBytes: 10 });
    expect(upload.status).toBe(403);

    const set = await api(app)
      .post(`/hr/employees/${target.employeeId}/avatar`)
      .set(...bearer(hr.token))
      .send({ fileId: randomUUID() });
    expect(set.status).toBe(403);

    const del = await api(app)
      .delete(`/hr/employees/${target.employeeId}/avatar`)
      .set(...bearer(hr.token));
    expect(del.status).toBe(403);
  });

  it("NV không tồn tại → 404 trên upload-url/POST/DELETE (KHÔNG lộ oracle)", async () => {
    const hr = await makeHrUser(A, [PAIR.employeeUpdate]);
    const ghostId = randomUUID();

    const upload = await api(app)
      .post(`/hr/employees/${ghostId}/avatar/upload-url`)
      .set(...bearer(hr.token))
      .send({ originalName: "a.png", declaredMimeType: "image/png", sizeBytes: 10 });
    expect(upload.status, JSON.stringify(upload.body)).toBe(404);

    const set = await api(app)
      .post(`/hr/employees/${ghostId}/avatar`)
      .set(...bearer(hr.token))
      .send({ fileId: randomUUID() });
    expect(set.status, JSON.stringify(set.body)).toBe(404);

    const del = await api(app)
      .delete(`/hr/employees/${ghostId}/avatar`)
      .set(...bearer(hr.token));
    expect(del.status, JSON.stringify(del.body)).toBe(404);
  });

  it("cross-tenant — fileId thuộc company B → 404 (RLS 0-row, HR company A KHÔNG thấy)", async () => {
    const hr = await makeHrUser(A, [PAIR.employeeUpdate]);
    const target = await makeTargetEmployee(A);
    const otherUserInB = await seedUser(
      direct,
      B.companyId,
      `xt-${randomUUID().slice(0, 6)}@x.test`,
      pw,
    );
    const fileIdInB = await insertFile(direct, B.companyId, otherUserInB);

    const res = await api(app)
      .post(`/hr/employees/${target.employeeId}/avatar`)
      .set(...bearer(hr.token))
      .send({ fileId: fileIdInB });
    expect(res.status, JSON.stringify(res.body)).toBe(404);

    const row = await direct.query(`SELECT avatar_url FROM employee_profiles WHERE id = $1`, [
      target.employeeId,
    ]);
    expect(row.rows[0].avatar_url).toBeNull();
  });

  it("file do NHÂN VIÊN KHÁC upload (owner ≠ HR) → 403 (chống forge), avatar KHÔNG đổi", async () => {
    const hr = await makeHrUser(A, [PAIR.employeeUpdate]);
    const target = await makeTargetEmployee(A);
    const fileId = await insertFile(direct, A.companyId, target.userId); // owner = target, KHÔNG phải HR

    const res = await api(app)
      .post(`/hr/employees/${target.employeeId}/avatar`)
      .set(...bearer(hr.token))
      .send({ fileId });
    expect(res.status, JSON.stringify(res.body)).toBe(403);

    const row = await direct.query(`SELECT avatar_url FROM employee_profiles WHERE id = $1`, [
      target.employeeId,
    ]);
    expect(row.rows[0].avatar_url).toBeNull();
  });

  it("happy (DB-only) — file ẢNH Uploaded owned-by-HR → 201, avatar_url=fileId, link created_by=HR; DELETE gỡ", async () => {
    const hr = await makeHrUser(A, [PAIR.employeeUpdate]);
    const target = await makeTargetEmployee(A);
    const fileId = await insertFile(direct, A.companyId, hr.userId);

    const res = await api(app)
      .post(`/hr/employees/${target.employeeId}/avatar`)
      .set(...bearer(hr.token))
      .send({ fileId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.fileId).toBe(fileId);

    const emp = await direct.query(`SELECT avatar_url FROM employee_profiles WHERE id = $1`, [
      target.employeeId,
    ]);
    expect(emp.rows[0].avatar_url).toBe(fileId);

    const link = await direct.query(
      `SELECT link_type, module_code, entity_type, entity_id, created_by FROM file_links
        WHERE company_id = $1 AND file_id = $2 AND deleted_at IS NULL`,
      [A.companyId, fileId],
    );
    expect(link.rows.length).toBe(1);
    expect(link.rows[0].link_type).toBe("Avatar");
    expect(link.rows[0].module_code).toBe("ME");
    expect(link.rows[0].entity_type).toBe("avatar");
    expect(link.rows[0].entity_id).toBe(target.employeeId);
    expect(link.rows[0].created_by).toBe(hr.userId);

    const del = await api(app)
      .delete(`/hr/employees/${target.employeeId}/avatar`)
      .set(...bearer(hr.token));
    expect(del.status).toBe(204);

    const empAfter = await direct.query(`SELECT avatar_url FROM employee_profiles WHERE id = $1`, [
      target.employeeId,
    ]);
    expect(empAfter.rows[0].avatar_url).toBeNull();

    const linkAfter = await direct.query(
      `SELECT deleted_at FROM file_links WHERE company_id = $1 AND file_id = $2`,
      [A.companyId, fileId],
    );
    expect(linkAfter.rows[0].deleted_at).not.toBeNull();
  });

  it("replace 2 lần (fileA→fileB) — stale link soft-deleted TRƯỚC insert ⇒ KHÔNG đụng uq_file_links_primary (không 409/500); avatar_url=fileB, 1 link SỐNG", async () => {
    const hr = await makeHrUser(A, [PAIR.employeeUpdate]);
    const target = await makeTargetEmployee(A);
    const fileA = await insertFile(direct, A.companyId, hr.userId);
    const fileB = await insertFile(direct, A.companyId, hr.userId);

    const setA = await api(app)
      .post(`/hr/employees/${target.employeeId}/avatar`)
      .set(...bearer(hr.token))
      .send({ fileId: fileA });
    expect(setA.status, JSON.stringify(setA.body)).toBe(201);

    // Set lần 2 khi ĐÃ có avatar: stale (fileA) phải soft-delete TRƯỚC insert (fileB) ⇒ không đụng unique
    // is_primary/entity-file — 201, KHÔNG 409/500.
    const setB = await api(app)
      .post(`/hr/employees/${target.employeeId}/avatar`)
      .set(...bearer(hr.token))
      .send({ fileId: fileB });
    expect(setB.status, JSON.stringify(setB.body)).toBe(201);

    const emp = await direct.query(`SELECT avatar_url FROM employee_profiles WHERE id = $1`, [
      target.employeeId,
    ]);
    expect(emp.rows[0].avatar_url).toBe(fileB);

    // Đúng 1 link SỐNG = fileB; link fileA đã soft-delete.
    const active = await direct.query(
      `SELECT file_id FROM file_links WHERE company_id = $1 AND module_code = 'ME' AND entity_type = 'avatar'
         AND entity_id = $2 AND deleted_at IS NULL`,
      [A.companyId, target.employeeId],
    );
    expect(active.rows.length).toBe(1);
    expect(active.rows[0].file_id).toBe(fileB);

    const staleA = await direct.query(
      `SELECT deleted_at FROM file_links WHERE company_id = $1 AND file_id = $2`,
      [A.companyId, fileA],
    );
    expect(staleA.rows[0].deleted_at).not.toBeNull();
  });

  it("DELETE khi chưa có avatar → 204 idempotent", async () => {
    const hr = await makeHrUser(A, [PAIR.employeeUpdate]);
    const target = await makeTargetEmployee(A);
    const res = await api(app)
      .delete(`/hr/employees/${target.employeeId}/avatar`)
      .set(...bearer(hr.token));
    expect(res.status, JSON.stringify(res.body)).toBe(204);
  });

  // ── E2E thật qua MinIO (skip nếu storage chưa sẵn sàng — mirror me-preferences-avatar.int-spec.ts) ──
  describe("E2E qua MinIO (storageReady probe)", () => {
    let storageReady = false;

    beforeAll(async () => {
      process.env.S3_ENDPOINT ??= "http://localhost:9000";
      process.env.S3_ACCESS_KEY ??= "mediaos";
      process.env.S3_SECRET_KEY ??= "changeme_dev_only";
      process.env.S3_BUCKET ??= "mediaos-assets";
      process.env.S3_FORCE_PATH_STYLE ??= "true";
      process.env.S3_REGION ??= "us-east-1";
      try {
        const s3 = new S3Client({
          endpoint: process.env.S3_ENDPOINT,
          region: process.env.S3_REGION,
          forcePathStyle: true,
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY!,
            secretAccessKey: process.env.S3_SECRET_KEY!,
          },
        });
        await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
        storageReady = true;
      } catch (err) {
        const name = (err as { name?: string }).name;
        storageReady = name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists";
      }
    });

    it("upload-url→PUT→POST /hr/employees/:id/avatar→GET detail avatarUrl ký; DELETE gỡ", async (ctx) => {
      if (!storageReady) return ctx.skip();

      const hr = await makeHrUser(A, [PAIR.employeeUpdate, PAIR.employeeRead]);
      const target = await makeTargetEmployee(A);
      const bytes = Buffer.from("hravatar-1-e2e", "utf8");

      const reg = await api(app)
        .post(`/hr/employees/${target.employeeId}/avatar/upload-url`)
        .set(...bearer(hr.token))
        .send({
          originalName: "avatar.png",
          declaredMimeType: "image/png",
          sizeBytes: bytes.length,
        });
      expect(reg.status, JSON.stringify(reg.body)).toBe(201);
      const fileId = reg.body.data.fileId as string;
      expect(reg.body.data.uploadUrl).toMatch(/^https?:\/\//);

      const put = await fetch(reg.body.data.uploadUrl as string, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: bytes,
      });
      expect(put.ok, `presigned PUT failed: ${put.status}`).toBe(true);

      const set = await api(app)
        .post(`/hr/employees/${target.employeeId}/avatar`)
        .set(...bearer(hr.token))
        .send({ fileId });
      expect(set.status, JSON.stringify(set.body)).toBe(201);
      expect(set.body.data.fileId).toBe(fileId);

      const row = await direct.query(`SELECT avatar_url FROM employee_profiles WHERE id = $1`, [
        target.employeeId,
      ]);
      expect(row.rows[0].avatar_url).toBe(fileId);

      const detail = await api(app)
        .get(`/hr/employees/${target.employeeId}`)
        .set(...bearer(hr.token));
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      expect(detail.body.data.avatarUrl).toMatch(/^https?:\/\//);

      const del = await api(app)
        .delete(`/hr/employees/${target.employeeId}/avatar`)
        .set(...bearer(hr.token));
      expect(del.status).toBe(204);

      const rowAfter = await direct.query(
        `SELECT avatar_url FROM employee_profiles WHERE id = $1`,
        [target.employeeId],
      );
      expect(rowAfter.rows[0].avatar_url).toBeNull();
    });
  });
});
