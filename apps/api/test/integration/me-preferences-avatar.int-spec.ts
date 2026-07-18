/**
 * S5-ME-BE-2 (lane mebe2) — ME preferences + avatar integration (Postgres THẬT, DB CÔ LẬP).
 *
 * Đóng `it.todo` ở `me-user-preferences-seed.int-spec.ts` (X — "ME-BE: GET/PATCH /me/preferences chỉ đụng
 * pref của token-resolved user"): RLS+FORCE (mig 0495) CHỈ cô lập TENANT (không có GUC user) ⇒ IDOR
 * cross-user PHẢI chứng minh ở đây, trên đường HTTP thật (JwtAuthGuard → PermissionGuard → withTenant).
 *
 * PHỦ:
 *   Preferences — deny thiếu view/update:user-preference → 403 · IDOR (PATCH của A KHÔNG đụng row B, dù
 *     cùng tenant) · cross-tenant (RLS) · upsert idempotent (2 lần PATCH → 1 row, giá trị lần 2) ·
 *     appearance enum sai → 400 · ME-DEC-008 timezone override: company CHƯA bật policy → 422
 *     ME-ERR-TIMEZONE-OVERRIDE-DENIED, bật `me.allow_user_timezone_override=true` → 200 ghi được, revert về
 *     null luôn được phép bất kể policy.
 *   Avatar — deny thiếu update:avatar → 403 · unlinked-employee → 409 ME-ERR-UNLINKED-EMPLOYEE · file
 *     KHÔNG phải ảnh → 415 · file thuộc user khác (IDOR — chống gắn avatar bằng file người khác upload) →
 *     403 · DELETE khi chưa có avatar → 204 idempotent · E2E thật qua MinIO (storageReady probe, mirror
 *     files-e2e-confirm.int-spec.ts) khi `.env` có S3_*, else chỉ DENY/CONTRACT chạy (E2E tự skip).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate):
 *     bash scripts/lane-db-setup.sh mebe2 → export LANE_DB=mediaos_mebe2 →
 *     pnpm --filter @mediaos/api test -- me-preferences-avatar
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
const LOGIN_PW = "Passw0rd!me-be2-inttests-1";

/** (action, resourceType) — khớp NGUYÊN VĂN mig 0495 (D). */
const PAIR = {
  prefView: ["view", "user-preference"] as const,
  prefUpdate: ["update", "user-preference"] as const,
  avatarUpdate: ["update", "avatar"] as const,
  // S5-ME-BE-4 — GET /me/avatar gate access:me (READ, mig 0495). MUTATION upload-url/confirm giữ update:avatar.
  meAccess: ["access", "me"] as const,
  // Bổ trợ RIÊNG cho test avatar E2E (register/confirm qua /foundation/files/* — seed CHỈ company-admin có
  // theo mặc định thật, mirror files-e2e-confirm.int-spec.ts seed 1 role custom đủ 3 cặp cho test).
  fileUpload: ["upload", "foundation-file"] as const,
  fileView: ["view", "foundation-file"] as const,
  fileDownload: ["download", "foundation-file"] as const,
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

function api(app: INestApplication) {
  return request(app.getHttpServer());
}
function bearer(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

describe.skipIf(!runDb)("S5-ME-BE-2 ME preferences + avatar (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let pw: string;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  let seq = 0;

  async function makeUser(
    tenant: SeededTenant,
    pairs: (readonly [string, string])[],
    opts: { withEmployee?: boolean; empCode?: string; scope?: "Own" | "Company" } = {},
  ): Promise<{ userId: string; token: string; employeeId: string | null }> {
    const tag = `u${++seq}-${randomUUID().slice(0, 6)}`;
    const email = `${tag}-${tenant.slug}@x.test`;
    const userId = await seedUser(direct, tenant.companyId, email, pw);
    const roleId = await seedRole(direct, tenant.companyId, `mebe2-${tag}`);
    for (const [action, rt] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, rt, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", opts.scope ?? "Own");
    }
    await seedUserRole(direct, userId, roleId, tenant.companyId);

    let employeeId: string | null = null;
    if (opts.withEmployee !== false) {
      employeeId = await insertEmployee(
        direct,
        tenant.companyId,
        userId,
        opts.empCode ?? `E-${tag}`,
      );
    }

    const login = await api(app)
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    return { userId, token: login.body.data.accessToken as string, employeeId };
  }

  async function prefRow(companyId: string, userId: string) {
    const r = await direct.query(
      `SELECT theme, locale, timezone, date_format, time_format, default_landing, density
         FROM user_preferences WHERE company_id = $1 AND user_id = $2`,
      [companyId, userId],
    );
    return r.rows[0] as Record<string, unknown> | undefined;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    pw = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "mebe2-a");
    B = await seedCompany(direct, "mebe2-b");
    companyIds.push(A.companyId, B.companyId);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ═══════════════════════════ Preferences ═══════════════════════════

  describe("preferences", () => {
    it("deny — thiếu view/update:user-preference → 403 trên GET/PATCH/appearance", async () => {
      const { token } = await makeUser(A, []); // KHÔNG cấp cặp preference nào
      const g = await api(app)
        .get("/me/preferences")
        .set(...bearer(token));
      expect(g.status).toBe(403);
      const p = await api(app)
        .patch("/me/preferences")
        .set(...bearer(token))
        .send({ theme: "dark" });
      expect(p.status).toBe(403);
      const pa = await api(app)
        .patch("/me/preferences/appearance")
        .set(...bearer(token))
        .send({ theme: "dark" });
      expect(pa.status).toBe(403);
    });

    it("upsert idempotent — PATCH 2 lần cùng user → 1 row, giá trị = lần 2; GET phản ánh đúng", async () => {
      const { token, userId } = await makeUser(A, [PAIR.prefView, PAIR.prefUpdate]);

      const first = await api(app)
        .patch("/me/preferences")
        .set(...bearer(token))
        .send({ theme: "light", locale: "vi", density: "compact" });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.data.theme).toBe("light");

      const second = await api(app)
        .patch("/me/preferences")
        .set(...bearer(token))
        .send({ theme: "dark", locale: "en" });
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      expect(second.body.data.theme).toBe("dark");
      expect(second.body.data.locale).toBe("en");
      // density KHÔNG gửi lần 2 ⇒ giữ nguyên giá trị lần 1 (partial patch, KHÔNG bị xoá).
      expect(second.body.data.density).toBe("compact");

      const row = await prefRow(A.companyId, userId);
      expect(row?.theme).toBe("dark");

      const get = await api(app)
        .get("/me/preferences")
        .set(...bearer(token));
      expect(get.status).toBe(200);
      expect(get.body.data.theme).toBe("dark");
      expect(get.body.data.locale).toBe("en");
      expect(get.body.data.density).toBe("compact");

      // Đúng 1 row/user (UNIQUE company_id,user_id chặn nhân đôi).
      const count = await direct.query(
        `SELECT count(*)::int AS n FROM user_preferences WHERE company_id = $1 AND user_id = $2`,
        [A.companyId, userId],
      );
      expect(count.rows[0].n).toBe(1);
    });

    it("GET user chưa từng PATCH → mọi field null (chưa override, kế thừa default)", async () => {
      const { token } = await makeUser(A, [PAIR.prefView]);
      const res = await api(app)
        .get("/me/preferences")
        .set(...bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.theme).toBeNull();
      expect(res.body.data.locale).toBeNull();
      expect(res.body.data.timezone).toBeNull();
    });

    it("IDOR — PATCH của A KHÔNG đụng row của B (cùng tenant, RLS không cô lập user)", async () => {
      const a = await makeUser(A, [PAIR.prefView, PAIR.prefUpdate]);
      const b = await makeUser(A, [PAIR.prefView, PAIR.prefUpdate]);

      await api(app)
        .patch("/me/preferences")
        .set(...bearer(b.token))
        .send({ theme: "dark" });
      const patchA = await api(app)
        .patch("/me/preferences")
        .set(...bearer(a.token))
        .send({ theme: "light" });
      expect(patchA.status).toBe(200);
      expect(patchA.body.data.theme).toBe("light");

      // B's row KHÔNG bị đổi bởi PATCH của A — mọi mutation khoá theo token-resolved user_id (controller
      // KHÔNG khai @Param owner ⇒ không có cách nào A truyền user_id của B).
      const rowB = await prefRow(A.companyId, b.userId);
      expect(rowB?.theme).toBe("dark");
      const rowA = await prefRow(A.companyId, a.userId);
      expect(rowA?.theme).toBe("light");
    });

    it("cross-tenant — token tenant A KHÔNG đọc/ghi pref user cùng-id ở tenant B", async () => {
      const a = await makeUser(A, [PAIR.prefView, PAIR.prefUpdate]);
      // Plant 1 row ở B (chỉ để chắc chắn có dữ liệu tồn tại nếu RLS rò).
      const uB = await seedUser(
        direct,
        B.companyId,
        `mebe2-xt-${randomUUID().slice(0, 6)}@x.test`,
        pw,
      );
      await direct.query(
        `INSERT INTO user_preferences (company_id, user_id, theme) VALUES ($1,$2,'dark')`,
        [B.companyId, uB],
      );

      const get = await api(app)
        .get("/me/preferences")
        .set(...bearer(a.token));
      expect(get.status).toBe(200);
      expect(get.body.data.theme).toBeNull(); // A chưa có row ở company A — KHÔNG lộ row B.
    });

    it("appearance — enum sai (theme rác) → 400", async () => {
      const { token } = await makeUser(A, [PAIR.prefUpdate]);
      const res = await api(app)
        .patch("/me/preferences/appearance")
        .set(...bearer(token))
        .send({ theme: "neon" });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it("ME-DEC-008 — company CHƯA bật policy → PATCH timezone → 422 ME-ERR-TIMEZONE-OVERRIDE-DENIED; bật cờ → 200; revert null luôn OK", async () => {
      const { token } = await makeUser(A, [PAIR.prefUpdate]);

      const denied = await api(app)
        .patch("/me/preferences/appearance")
        .set(...bearer(token))
        .send({ timezone: "Asia/Ho_Chi_Minh" });
      expect(denied.status, JSON.stringify(denied.body)).toBe(422);
      expect(denied.body.error.code).toBe("ME-ERR-TIMEZONE-OVERRIDE-DENIED");

      // Set null (revert-to-inherit) KHÔNG cần policy — luôn cho phép dù company chưa bật cờ.
      const revert = await api(app)
        .patch("/me/preferences/appearance")
        .set(...bearer(token))
        .send({ timezone: null });
      expect(revert.status, JSON.stringify(revert.body)).toBe(200);
      expect(revert.body.data.timezone).toBeNull();

      await direct.query(
        `INSERT INTO company_settings (company_id, setting_key, setting_value, value_type, category, status)
         VALUES ($1, 'me.allow_user_timezone_override', 'true'::jsonb, 'Boolean', 'General', 'Active')`,
        [A.companyId],
      );
      try {
        const allowed = await api(app)
          .patch("/me/preferences/appearance")
          .set(...bearer(token))
          .send({ timezone: "Asia/Ho_Chi_Minh" });
        expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
        expect(allowed.body.data.timezone).toBe("Asia/Ho_Chi_Minh");

        const badTz = await api(app)
          .patch("/me/preferences/appearance")
          .set(...bearer(token))
          .send({ timezone: "Not/A_Real_Zone" });
        expect(badTz.status, JSON.stringify(badTz.body)).toBe(400);
      } finally {
        await direct.query(
          `DELETE FROM company_settings WHERE company_id = $1 AND setting_key = 'me.allow_user_timezone_override'`,
          [A.companyId],
        );
      }
    });
  });

  // ═══════════════════════════ Avatar ═══════════════════════════

  describe("avatar", () => {
    it("deny — thiếu update:avatar → 403 trên POST/DELETE", async () => {
      const { token } = await makeUser(A, []);
      const post = await api(app)
        .post("/me/avatar")
        .set(...bearer(token))
        .send({ fileId: randomUUID() });
      expect(post.status).toBe(403);
      const del = await api(app)
        .delete("/me/avatar")
        .set(...bearer(token));
      expect(del.status).toBe(403);
    });

    it("unlinked-employee — POST/DELETE → 409 ME-ERR-UNLINKED-EMPLOYEE", async () => {
      const { token } = await makeUser(A, [PAIR.avatarUpdate], { withEmployee: false });
      const post = await api(app)
        .post("/me/avatar")
        .set(...bearer(token))
        .send({ fileId: randomUUID() });
      expect(post.status, JSON.stringify(post.body)).toBe(409);
      expect(post.body.error.code).toBe("ME-ERR-UNLINKED-EMPLOYEE");

      const del = await api(app)
        .delete("/me/avatar")
        .set(...bearer(token));
      expect(del.status, JSON.stringify(del.body)).toBe(409);
      expect(del.body.error.code).toBe("ME-ERR-UNLINKED-EMPLOYEE");
    });

    it("DELETE khi chưa có avatar → 204 idempotent (không lỗi)", async () => {
      const { token } = await makeUser(A, [PAIR.avatarUpdate]);
      const res = await api(app)
        .delete("/me/avatar")
        .set(...bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });

    it("IDOR — file thuộc user KHÁC (owner_user_id ≠ actor) → 403, avatar KHÔNG đổi", async () => {
      const owner = await makeUser(A, [PAIR.avatarUpdate]);
      const attacker = await makeUser(A, [PAIR.avatarUpdate]);

      const fileId = randomUUID();
      await direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
           storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
         VALUES ($1,$2,'avatar.png',$3,'image/png',10,'MinIO',$4,'Private','Uploaded','NotRequired',$5,$5)`,
        [
          fileId,
          A.companyId,
          `${fileId}-avatar.png`,
          `${A.companyId}/files/${fileId}`,
          owner.userId,
        ],
      );

      const res = await api(app)
        .post("/me/avatar")
        .set(...bearer(attacker.token))
        .send({ fileId });
      expect(res.status, JSON.stringify(res.body)).toBe(403);

      const row = await direct.query(`SELECT avatar_url FROM employee_profiles WHERE id = $1`, [
        attacker.employeeId,
      ]);
      expect(row.rows[0].avatar_url).toBeNull();
    });

    it("file KHÔNG phải ảnh (mime text/plain) → 415, avatar KHÔNG đổi", async () => {
      const u = await makeUser(A, [PAIR.avatarUpdate]);
      const fileId = randomUUID();
      await direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
           storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
         VALUES ($1,$2,'note.txt',$3,'text/plain',4,'MinIO',$4,'Private','Uploaded','NotRequired',$5,$5)`,
        [fileId, A.companyId, `${fileId}-note.txt`, `${A.companyId}/files/${fileId}`, u.userId],
      );

      const res = await api(app)
        .post("/me/avatar")
        .set(...bearer(u.token))
        .send({ fileId });
      expect(res.status, JSON.stringify(res.body)).toBe(415);
      expect(res.body.error.code).toBe("FOUNDATION-FILE-ERR-MIME");
    });

    it("file chưa confirm (uploadStatus=Pending) → 409, avatar KHÔNG đổi", async () => {
      const u = await makeUser(A, [PAIR.avatarUpdate]);
      const fileId = randomUUID();
      await direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
           storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
         VALUES ($1,$2,'avatar.png',$3,'image/png',10,'MinIO',$4,'Private','Pending','NotRequired',$5,$5)`,
        [fileId, A.companyId, `${fileId}-avatar.png`, `${A.companyId}/files/${fileId}`, u.userId],
      );

      const res = await api(app)
        .post("/me/avatar")
        .set(...bearer(u.token))
        .send({ fileId });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
    });

    it("happy (DB-only, KHÔNG cần MinIO) — file ẢNH đã Uploaded + owned by self → 201, avatar_url=fileId, file_links Avatar; DELETE gỡ", async () => {
      const u = await makeUser(A, [PAIR.avatarUpdate]);
      const fileId = randomUUID();
      await direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
           storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
         VALUES ($1,$2,'avatar.png',$3,'image/png',10,'MinIO',$4,'Private','Uploaded','NotRequired',$5,$5)`,
        [fileId, A.companyId, `${fileId}-avatar.png`, `${A.companyId}/files/${fileId}`, u.userId],
      );

      const res = await api(app)
        .post("/me/avatar")
        .set(...bearer(u.token))
        .send({ fileId });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.fileId).toBe(fileId);
      expect(res.body.data.downloadUrl).toBeTruthy();

      const emp = await direct.query(`SELECT avatar_url FROM employee_profiles WHERE id = $1`, [
        u.employeeId,
      ]);
      expect(emp.rows[0].avatar_url).toBe(fileId);

      const link = await direct.query(
        `SELECT link_type, module_code, entity_type, entity_id FROM file_links
          WHERE company_id = $1 AND file_id = $2 AND deleted_at IS NULL`,
        [A.companyId, fileId],
      );
      expect(link.rows.length).toBe(1);
      expect(link.rows[0].link_type).toBe("Avatar");
      expect(link.rows[0].module_code).toBe("ME");
      expect(link.rows[0].entity_type).toBe("avatar");
      expect(link.rows[0].entity_id).toBe(u.employeeId);

      const del = await api(app)
        .delete("/me/avatar")
        .set(...bearer(u.token));
      expect(del.status).toBe(204);

      const empAfter = await direct.query(
        `SELECT avatar_url FROM employee_profiles WHERE id = $1`,
        [u.employeeId],
      );
      expect(empAfter.rows[0].avatar_url).toBeNull();

      const linkAfter = await direct.query(
        `SELECT deleted_at FROM file_links WHERE company_id = $1 AND file_id = $2`,
        [A.companyId, fileId],
      );
      expect(linkAfter.rows[0].deleted_at).not.toBeNull();
    });

    // ═══════════ S5-ME-BE-4 — upload-url / confirm / GET own-scope wrapper (DB-only) ═══════════

    describe("S5-ME-BE-4 upload-url / confirm / GET (own-scope wrapper)", () => {
      it("upload-url — thiếu update:avatar → 403", async () => {
        const { token } = await makeUser(A, []);
        const res = await api(app)
          .post("/me/avatar/upload-url")
          .set(...bearer(token))
          .send({ originalName: "a.png", declaredMimeType: "image/png", sizeBytes: 10 });
        expect(res.status).toBe(403);
      });

      it("upload-url — unlinked-employee → 409 ME-ERR-UNLINKED-EMPLOYEE (chặn TRƯỚC register)", async () => {
        const { token } = await makeUser(A, [PAIR.avatarUpdate], { withEmployee: false });
        const res = await api(app)
          .post("/me/avatar/upload-url")
          .set(...bearer(token))
          .send({ originalName: "a.png", declaredMimeType: "image/png", sizeBytes: 10 });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error.code).toBe("ME-ERR-UNLINKED-EMPLOYEE");
      });

      it("upload-url — declaredMimeType KHÔNG phải ảnh → 415 (KHÔNG chạm storage)", async () => {
        const { token } = await makeUser(A, [PAIR.avatarUpdate]);
        const res = await api(app)
          .post("/me/avatar/upload-url")
          .set(...bearer(token))
          .send({ originalName: "note.txt", declaredMimeType: "text/plain", sizeBytes: 4 });
        expect(res.status, JSON.stringify(res.body)).toBe(415);
        expect(res.body.error.code).toBe("FOUNDATION-FILE-ERR-MIME");
      });

      it("confirm — thiếu update:avatar → 403", async () => {
        const { token } = await makeUser(A, []);
        const res = await api(app)
          .post("/me/avatar/confirm")
          .set(...bearer(token))
          .send({ fileId: randomUUID() });
        expect(res.status).toBe(403);
      });

      it("confirm — file không tồn tại → 404", async () => {
        const { token } = await makeUser(A, [PAIR.avatarUpdate]);
        const res = await api(app)
          .post("/me/avatar/confirm")
          .set(...bearer(token))
          .send({ fileId: randomUUID() });
        expect(res.status, JSON.stringify(res.body)).toBe(404);
      });

      it("confirm — IDOR file DO NGƯỜI KHÁC upload → 403 TRƯỚC khi chạm storage (owner-check trước)", async () => {
        const owner = await makeUser(A, [PAIR.avatarUpdate]);
        const attacker = await makeUser(A, [PAIR.avatarUpdate]);
        const fileId = randomUUID();
        // File Pending (chưa PUT bytes) owned by `owner`. Owner-check đứng trước confirm ⇒ 403 KHÔNG cần storage.
        await direct.query(
          `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
             storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
           VALUES ($1,$2,'avatar.png',$3,'image/png',10,'MinIO',$4,'Private','Pending','NotRequired',$5,$5)`,
          [
            fileId,
            A.companyId,
            `${fileId}-avatar.png`,
            `${A.companyId}/files/${fileId}`,
            owner.userId,
          ],
        );
        const res = await api(app)
          .post("/me/avatar/confirm")
          .set(...bearer(attacker.token))
          .send({ fileId });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("GET /me/avatar — thiếu access:me → 403", async () => {
        const { token } = await makeUser(A, [PAIR.avatarUpdate]); // có update:avatar nhưng KHÔNG access:me
        const res = await api(app)
          .get("/me/avatar")
          .set(...bearer(token));
        expect(res.status).toBe(403);
      });

      it("GET /me/avatar — chưa có avatar → 200 data=null (fail-soft)", async () => {
        const { token } = await makeUser(A, [PAIR.meAccess]);
        const res = await api(app)
          .get("/me/avatar")
          .set(...bearer(token));
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data).toBeNull();
      });

      it("GET /me/avatar — unlinked → 200 data=null (KHÔNG 409 trên read)", async () => {
        const { token } = await makeUser(A, [PAIR.meAccess], { withEmployee: false });
        const res = await api(app)
          .get("/me/avatar")
          .set(...bearer(token));
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data).toBeNull();
      });

      it("GET /me/avatar — cross-tenant: token A KHÔNG thấy avatar user tenant B", async () => {
        const a = await makeUser(A, [PAIR.meAccess]);
        // Plant avatar_url ở employee của 1 user tenant B — A không được thấy (A đọc employee của CHÍNH mình).
        const uB = await makeUser(B, [PAIR.meAccess], {
          empCode: `xt-${randomUUID().slice(0, 6)}`,
        });
        await direct.query(`UPDATE employee_profiles SET avatar_url = $1 WHERE id = $2`, [
          randomUUID(),
          uB.employeeId,
        ]);
        const res = await api(app)
          .get("/me/avatar")
          .set(...bearer(a.token));
        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull(); // A chưa có avatar — KHÔNG lộ của B.
      });
    });

    // ── E2E thật qua MinIO (skip nếu storage chưa sẵn sàng — mirror files-e2e-confirm.int-spec.ts) ──
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

      it("register→PUT→confirm→POST /me/avatar → Uploaded avatar thật qua storage", async (ctx) => {
        if (!storageReady) return ctx.skip();

        // Role RIÊNG cho test: cần cả cặp ME (Own) + foundation-file (Company) để hoàn tất phase
        // register/confirm — gap thật (chỉ company-admin có sẵn *:foundation-file, xem docs/plans/
        // S5-ME-BE-2.md "Nợ để lại") không chặn CONTRACT chính của WO (gắn avatar qua update:avatar Own).
        const u = await makeUser(A, [PAIR.avatarUpdate]);
        const fileRole = await seedRole(
          direct,
          A.companyId,
          `mebe2-file-${randomUUID().slice(0, 6)}`,
        );
        for (const [action, rt] of [PAIR.fileUpload, PAIR.fileView, PAIR.fileDownload]) {
          const permId = await seedPermissionCatalog(direct, action, rt, false);
          await seedRolePermission(direct, fileRole, permId, "ALLOW", "Company");
        }
        await seedUserRole(direct, u.userId, fileRole, A.companyId);

        const bytes = Buffer.from("me-be2-avatar-e2e", "utf8");
        const reg = await api(app)
          .post("/foundation/files/upload")
          .set(...bearer(u.token))
          .send({
            originalName: "avatar.png",
            declaredMimeType: "image/png",
            sizeBytes: bytes.length,
            visibility: "Private",
          });
        expect(reg.status, JSON.stringify(reg.body)).toBe(201);
        const fileId = reg.body.data.fileId as string;

        const put = await fetch(reg.body.data.uploadUrl as string, {
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          body: bytes,
        });
        expect(put.ok, `presigned PUT failed: ${put.status}`).toBe(true);

        const confirm = await api(app)
          .post(`/foundation/files/${fileId}/confirm`)
          .set(...bearer(u.token))
          .send({});
        expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);

        const avatar = await api(app)
          .post("/me/avatar")
          .set(...bearer(u.token))
          .send({ fileId });
        expect(avatar.status, JSON.stringify(avatar.body)).toBe(201);
        expect(avatar.body.data.fileId).toBe(fileId);
        expect(avatar.body.data.downloadUrl).toMatch(/^https?:\/\//);

        const row = await direct.query(`SELECT avatar_url FROM employee_profiles WHERE id = $1`, [
          u.employeeId,
        ]);
        expect(row.rows[0].avatar_url).toBe(fileId);
      });

      it("S5-ME-BE-4 GAP-CLOSED — user CHỈ update:avatar + access:me (0 foundation-file): upload-url→PUT→confirm→POST→GET trọn vẹn", async (ctx) => {
        if (!storageReady) return ctx.skip();

        // KHÔNG seed foundation-file — chứng minh đóng "Nợ để lại" S5-ME-BE-2: role thường tự upload+confirm+
        // hiển-thị avatar HOÀN TOÀN qua đường ME own-scope, KHÔNG cần *:foundation-file.
        const u = await makeUser(A, [PAIR.avatarUpdate, PAIR.meAccess]);
        const bytes = Buffer.from("me-be4-gap-closed", "utf8");

        const reg = await api(app)
          .post("/me/avatar/upload-url")
          .set(...bearer(u.token))
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

        const confirm = await api(app)
          .post("/me/avatar/confirm")
          .set(...bearer(u.token))
          .send({ fileId });
        expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);

        const set = await api(app)
          .post("/me/avatar")
          .set(...bearer(u.token))
          .send({ fileId });
        expect(set.status, JSON.stringify(set.body)).toBe(201);
        expect(set.body.data.fileId).toBe(fileId);

        const get = await api(app)
          .get("/me/avatar")
          .set(...bearer(u.token));
        expect(get.status, JSON.stringify(get.body)).toBe(200);
        expect(get.body.data.fileId).toBe(fileId);
        expect(get.body.data.downloadUrl).toMatch(/^https?:\/\//);
      });

      it("S5-ME-BE-4 confirm — bytes CHƯA PUT → 422 CONFIRM-ABSENT (surface, không nuốt)", async (ctx) => {
        if (!storageReady) return ctx.skip();
        const u = await makeUser(A, [PAIR.avatarUpdate]);
        const reg = await api(app)
          .post("/me/avatar/upload-url")
          .set(...bearer(u.token))
          .send({ originalName: "avatar.png", declaredMimeType: "image/png", sizeBytes: 12 });
        expect(reg.status, JSON.stringify(reg.body)).toBe(201);
        const fileId = reg.body.data.fileId as string;
        // KHÔNG PUT bytes → confirm phải thất bại CONFIRM-ABSENT (object không tồn tại trong storage).
        const confirm = await api(app)
          .post("/me/avatar/confirm")
          .set(...bearer(u.token))
          .send({ fileId });
        expect(confirm.status, JSON.stringify(confirm.body)).toBe(422);
        expect(confirm.body.error.code).toBe("FOUNDATION-FILE-ERR-CONFIRM-ABSENT");
      });
    });
  });
});
