/**
 * S5-TASK-COVER-1 — Ảnh bìa công việc (CROWN: kiểm soát truy cập tệp + IDOR + tenant + đồng thời).
 * App NestJS THẬT (AppModule) + supertest ⇒ đi trọn chuỗi guard (JwtAuthGuard → CompanyGuard → 2FA →
 * PermissionGuard → TaskFilesController → TaskFileService), engine permission THẬT, không mock.
 *
 * Ảnh bìa = dòng `file_links` Attachment của CHÍNH task được bật `is_primary`. KHÔNG có link_type
 * 'Cover' (giá trị đó không nằm trong CHECK chk_file_links_link_type).
 *
 * Tính chất then chốt được khoá ở đây:
 *   · deny: file không thuộc task → 404 · cross-tenant → 404 · thiếu file-upload:task → 403
 *   · không phải ảnh → 415 · chưa Uploaded → 409 · scan chưa sạch → 409 (ngưỡng CHẶT Clean|NotRequired,
 *     KHÔNG chỉ ≠Infected — bìa hiển thị cho mọi người đọc task nên không được lỏng hơn đường tải)
 *   · ĐỘC QUYỀN: tệp còn link sống ở entity KHÁC ⇒ 409 khi đặt, và KHÔNG BAO GIỜ được ký khi đọc.
 *     Đây là chốt chống LEO THANG ĐỌC: đường tải thật đi qua FilePolicy.decideForLinkedFile =
 *     AND-khắt-khe-nhất trên MỌI link, nên tệp link cả vào HR/Employee cả vào task đang 403 khi tải;
 *     thiếu vị từ này nó sẽ hiện làm ảnh bìa cho cả board.
 *   · đúng MỘT bìa mỗi task (unique index), thay bìa không để lại 2 primary, không 500
 *   · primary MỒ CÔI (tệp bị soft-delete nhưng link còn is_primary=true) vẫn hạ được ⇒ đặt bìa mới OK
 *   · route `/files/cover` KHÔNG bị `@Delete(":fileId")` che
 *   · audit_logs có dòng object_type='file_link' cho mỗi lần đổi/gỡ bìa
 *   · DTO KHÔNG BAO GIỜ chứa storage_path
 *
 * Gate `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env trỏ DATABASE_URL vào DB chung
 * làm hasDb=true ⇒ CHỈ chạy trên lane DB cô lập, nếu không sẽ đỏ-giả.
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

const PASSWORD = "Passw0rd!cover1";
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

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

type Pair = [action: string, resourceType: string];
const FULL: Pair[] = [
  ["read", "task"],
  ["file-upload", "task"],
  ["file-delete", "task"],
];
const READ_ONLY: Pair[] = [["read", "task"]];
const SENSITIVE = new Set(["delete", "export", "view", "view-report"]);

async function grant(
  direct: Pool,
  companyId: string,
  userId: string,
  pairs: Pair[],
  scope: "Own" | "Company" = "Company",
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `qa-cover-${scope}-${userId.slice(0, 8)}`);
  for (const [action, resourceType] of pairs) {
    const permId = await seedPermissionCatalog(direct, action, resourceType, SENSITIVE.has(action));
    await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

async function seedTask(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO tasks (company_id, task_type, title, task_status)
     VALUES ($1, 'office', 'cover-task', 'Todo') RETURNING id`,
    [companyId],
  );
  return r.rows[0].id as string;
}

/** Seed 1 `files` row. Mặc định: ẢNH + Uploaded + Clean (tức là hợp lệ để làm bìa). */
async function seedFile(
  direct: Pool,
  companyId: string,
  uploadedBy: string,
  opts?: { scanStatus?: string; uploadStatus?: string; mimeType?: string },
): Promise<string> {
  const fileId = randomUUID();
  await direct.query(
    `INSERT INTO files
       (id, company_id, original_name, stored_name, mime_type, file_size_bytes, storage_provider,
        storage_path, upload_status, scan_status, uploaded_by, owner_user_id)
     VALUES ($1,$2,'cover.png',$3,$4,2048,'MinIO',$5,$6,$7,$8,$8)`,
    // `stored_name` PHẢI là tham số RIÊNG dù giá trị trùng `id`: dùng lại $1 cho cả cột uuid lẫn cột
    // varchar làm Postgres không suy được một kiểu chung ⇒ "inconsistent types deduced for parameter $1".
    [
      fileId,
      companyId,
      fileId,
      opts?.mimeType ?? "image/png",
      `${companyId}/files/${fileId}`,
      opts?.uploadStatus ?? "Uploaded",
      opts?.scanStatus ?? "Clean",
      uploadedBy,
    ],
  );
  return fileId;
}

async function linkToTask(
  direct: Pool,
  companyId: string,
  fileId: string,
  taskId: string,
  createdBy: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO file_links
       (company_id, file_id, module_code, entity_type, entity_id, link_type, access_scope,
        is_primary, created_by)
     VALUES ($1,$2,'TASK','task',$3,'Attachment','Company',false,$4) RETURNING id`,
    [companyId, fileId, taskId, createdBy],
  );
  return r.rows[0].id as string;
}

/** Link cùng một tệp vào một entity KHÁC (mô phỏng ảnh chụp hợp đồng vừa gắn HR vừa gắn task). */
async function linkToOtherEntity(
  direct: Pool,
  companyId: string,
  fileId: string,
  createdBy: string,
): Promise<void> {
  await direct.query(
    `INSERT INTO file_links
       (company_id, file_id, module_code, entity_type, entity_id, link_type, access_scope,
        is_primary, created_by)
     VALUES ($1,$2,'HR','Employee',$3,'Document','Owner',false,$4)`,
    [companyId, fileId, randomUUID(), createdBy],
  );
}

async function primaryCount(direct: Pool, taskId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM file_links
      WHERE entity_id = $1 AND module_code='TASK' AND entity_type='task'
        AND is_primary = true AND deleted_at IS NULL`,
    [taskId],
  );
  return r.rows[0].n as number;
}

async function coverAuditCount(direct: Pool, linkId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM audit_logs
      WHERE object_type = 'file_link' AND object_id = $1 AND action = 'FileLinkPrimaryChanged'`,
    [linkId],
  );
  return r.rows[0].n as number;
}

/** coverUrl mà GET /tasks/:id trả về. */
async function coverUrlOf(app: INestApplication, token: string, taskId: string) {
  const res = await api(app).get(`/tasks/${taskId}`).set(bearer(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.coverUrl as string | null;
}

describe.skipIf(!hasLaneDb)(
  "S5-TASK-COVER-1 ảnh bìa công việc (HTTP, engine permission thật)",
  () => {
    const direct = directPool();
    const app = appPool();
    let nest: INestApplication;

    let A: SeededTenant;
    let B: SeededTenant;
    let hrEmail = "";
    let hrUserId = "";
    let readerEmail = ""; // read:task only → 403 khi đặt/gỡ bìa

    let taskA = "";
    let taskA2 = "";
    let taskB = "";

    let imgOne = ""; // ảnh hợp lệ, link taskA
    let imgTwo = ""; // ảnh hợp lệ thứ hai, link taskA (để test THAY bìa)
    let pdfFile = ""; // không phải ảnh → 415
    let pendingFile = ""; // uploadStatus Pending → 409
    let infectedFile = ""; // scan Infected → 409
    let scanPendingFile = ""; // scan Pending → 409 (ngưỡng CHẶT, không chỉ ≠Infected)
    let sharedFile = ""; // link CẢ taskA CẢ HR/Employee → 409 + không bao giờ được ký
    let sharedLinkId = "";
    let orphanFile = ""; // link is_primary=true nhưng files đã soft-delete (primary MỒ CÔI)
    let otherTaskFile = ""; // link taskA2 — dùng qua /tasks/{taskA}/... → 404 (cross-task)
    let bFile = ""; // tenant B → 404

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "cov1A");
      B = await seedCompany(direct, "cov1B");

      hrEmail = `hr@${A.slug}.test`;
      hrUserId = await seedUser(direct, A.companyId, hrEmail, hash);
      await grant(direct, A.companyId, hrUserId, FULL, "Company");

      readerEmail = `reader@${A.slug}.test`;
      const readerId = await seedUser(direct, A.companyId, readerEmail, hash);
      await grant(direct, A.companyId, readerId, READ_ONLY, "Company");

      taskA = await seedTask(direct, A.companyId);
      taskA2 = await seedTask(direct, A.companyId);

      imgOne = await seedFile(direct, A.companyId, hrUserId);
      await linkToTask(direct, A.companyId, imgOne, taskA, hrUserId);
      imgTwo = await seedFile(direct, A.companyId, hrUserId);
      await linkToTask(direct, A.companyId, imgTwo, taskA, hrUserId);

      pdfFile = await seedFile(direct, A.companyId, hrUserId, { mimeType: "application/pdf" });
      await linkToTask(direct, A.companyId, pdfFile, taskA, hrUserId);

      pendingFile = await seedFile(direct, A.companyId, hrUserId, { uploadStatus: "Pending" });
      await linkToTask(direct, A.companyId, pendingFile, taskA, hrUserId);

      infectedFile = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Infected" });
      await linkToTask(direct, A.companyId, infectedFile, taskA, hrUserId);

      scanPendingFile = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Pending" });
      await linkToTask(direct, A.companyId, scanPendingFile, taskA, hrUserId);

      sharedFile = await seedFile(direct, A.companyId, hrUserId);
      sharedLinkId = await linkToTask(direct, A.companyId, sharedFile, taskA, hrUserId);
      await linkToOtherEntity(direct, A.companyId, sharedFile, hrUserId);

      // Primary MỒ CÔI: bật cờ bìa rồi soft-delete FILE (link vẫn sống với is_primary=true) — đúng thứ
      // `TaskFileService.delete` để lại, vì nó chỉ soft-delete bảng `files`.
      orphanFile = await seedFile(direct, A.companyId, hrUserId);
      const orphanLink = await linkToTask(direct, A.companyId, orphanFile, taskA2, hrUserId);
      await direct.query(`UPDATE file_links SET is_primary = true WHERE id = $1`, [orphanLink]);
      await direct.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [orphanFile]);

      otherTaskFile = await seedFile(direct, A.companyId, hrUserId);
      await linkToTask(direct, A.companyId, otherTaskFile, taskA2, hrUserId);

      taskB = await seedTask(direct, B.companyId);
      const bUser = await seedUser(direct, B.companyId, `bhr@${B.slug}.test`, hash);
      bFile = await seedFile(direct, B.companyId, bUser);
      await linkToTask(direct, B.companyId, bFile, taskB, bUser);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();
    });

    afterAll(async () => {
      // ĐÓNG APP TRƯỚC khi dọn tenant. Đảo thứ tự (dọn trước, close sau) là flake đã biết
      // "app.close-order": outbox worker/consumer còn sống ghi thêm audit_logs mang actor_user_id
      // TRONG LÚC cleanup xoá users ⇒ vỡ FK audit_logs_actor_user_id_fkey, CI đỏ ngẫu nhiên.
      if (nest) await nest.close();
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
    });

    // ── deny-path ────────────────────────────────────────────────────────────────────────────────

    it("thiếu file-upload:task ⇒ 403 cho CẢ đặt lẫn gỡ bìa", async () => {
      const token = await login(nest, A.slug, readerEmail);
      expect(
        (await api(nest).post(`/tasks/${taskA}/files/${imgOne}/cover`).set(bearer(token))).status,
      ).toBe(403);
      expect(
        (await api(nest).delete(`/tasks/${taskA}/files/cover`).set(bearer(token))).status,
      ).toBe(403);
    });

    it("tệp KHÔNG thuộc task này ⇒ 404 (cross-task IDOR, không lộ tồn tại)", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const res = await api(nest)
        .post(`/tasks/${taskA}/files/${otherTaskFile}/cover`)
        .set(bearer(token));
      expect(res.status).toBe(404);
    });

    it("tệp CROSS-TENANT ⇒ 404 (RLS 0-row)", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const res = await api(nest).post(`/tasks/${taskA}/files/${bFile}/cover`).set(bearer(token));
      expect(res.status).toBe(404);
    });

    it("task CROSS-TENANT ⇒ 404", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const res = await api(nest).post(`/tasks/${taskB}/files/${bFile}/cover`).set(bearer(token));
      expect(res.status).toBe(404);
    });

    // ── validate tệp ─────────────────────────────────────────────────────────────────────────────

    it("KHÔNG phải ảnh ⇒ 415 (không phải 400)", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const res = await api(nest).post(`/tasks/${taskA}/files/${pdfFile}/cover`).set(bearer(token));
      expect(res.status).toBe(415);
    });

    it("chưa Uploaded ⇒ 409", async () => {
      const token = await login(nest, A.slug, hrEmail);
      expect(
        (await api(nest).post(`/tasks/${taskA}/files/${pendingFile}/cover`).set(bearer(token)))
          .status,
      ).toBe(409);
    });

    it("scan Infected ⇒ 409", async () => {
      const token = await login(nest, A.slug, hrEmail);
      expect(
        (await api(nest).post(`/tasks/${taskA}/files/${infectedFile}/cover`).set(bearer(token)))
          .status,
      ).toBe(409);
    });

    it("scan Pending ⇒ 409 — ngưỡng CHẶT Clean|NotRequired, KHÔNG chỉ ≠Infected", async () => {
      const token = await login(nest, A.slug, hrEmail);
      expect(
        (await api(nest).post(`/tasks/${taskA}/files/${scanPendingFile}/cover`).set(bearer(token)))
          .status,
      ).toBe(409);
    });

    // ── ĐỘC QUYỀN (chống leo thang đọc) ──────────────────────────────────────────────────────────

    it("tệp còn link sống ở entity KHÁC ⇒ 409 khi đặt bìa", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const res = await api(nest)
        .post(`/tasks/${taskA}/files/${sharedFile}/cover`)
        .set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(409);
    });

    it("dù cờ is_primary bị bật VÒNG QUA service, đường ĐỌC vẫn KHÔNG ký tệp dùng chung", async () => {
      // Mô phỏng đúng lỗ đã phân tích: `is_primary` là cột ĐA-NGƯỜI-GHI (POST /foundation/files/:id/links
      // nhận isPrimary verbatim) ⇒ đường đọc PHẢI tự phòng vệ, không dựa vào việc setCover đã chặn.
      await direct.query(`UPDATE file_links SET is_primary = false WHERE entity_id = $1`, [taskA]);
      await direct.query(`UPDATE file_links SET is_primary = true WHERE id = $1`, [sharedLinkId]);

      const token = await login(nest, A.slug, hrEmail);
      expect(await coverUrlOf(nest, token, taskA)).toBeNull();

      await direct.query(`UPDATE file_links SET is_primary = false WHERE id = $1`, [sharedLinkId]);
    });

    // ── happy path + bất biến 1-bìa ──────────────────────────────────────────────────────────────

    it("đặt bìa ⇒ 2xx, coverUrl là URL ĐÃ KÝ, và có dòng audit file_link", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const res = await api(nest).post(`/tasks/${taskA}/files/${imgOne}/cover`).set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      expect(res.body.data.isCover).toBe(true);
      // DTO KHÔNG BAO GIỜ lộ đường dẫn lưu trữ.
      expect(JSON.stringify(res.body)).not.toContain("storage_path");
      expect(JSON.stringify(res.body)).not.toContain("storagePath");

      const url = await coverUrlOf(nest, token, taskA);
      expect(url).toBeTruthy();
      // URL đã KÝ chứ không phải chuỗi bất kỳ — phải mang tham số chữ ký.
      expect(url).toMatch(/[?&](X-Amz-Signature|signature|sig)=/i);

      const linkRow = await direct.query(
        `SELECT id FROM file_links WHERE entity_id=$1 AND file_id=$2 AND deleted_at IS NULL`,
        [taskA, imgOne],
      );
      expect(await coverAuditCount(direct, linkRow.rows[0].id)).toBeGreaterThan(0);
    });

    it("đặt bìa MỚI thay bìa cũ ⇒ vẫn ĐÚNG 1 primary, không 500", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const res = await api(nest).post(`/tasks/${taskA}/files/${imgTwo}/cover`).set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      expect(await primaryCount(direct, taskA)).toBe(1);
    });

    it("đặt lại CHÍNH bìa hiện tại ⇒ idempotent, vẫn 1 primary", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const res = await api(nest).post(`/tasks/${taskA}/files/${imgTwo}/cover`).set(bearer(token));
      expect(res.status).toBeLessThan(300);
      expect(await primaryCount(direct, taskA)).toBe(1);
    });

    it("hai lời gọi đặt bìa ĐỒNG THỜI ⇒ không 500, không 2 primary", async () => {
      // KHÔNG assert "một 200 một 409": nếu advisory lock chạy ĐÚNG thì T2 chờ xong sẽ đọc primary MỚI
      // rồi hạ/nâng ⇒ CẢ HAI đều thành công. Assert cứng 409 sẽ RED khi code đúng và cám dỗ người sửa
      // đi nới lock. Chỉ assert BẤT BIẾN.
      const token = await login(nest, A.slug, hrEmail);
      const [r1, r2] = await Promise.all([
        api(nest).post(`/tasks/${taskA}/files/${imgOne}/cover`).set(bearer(token)),
        api(nest).post(`/tasks/${taskA}/files/${imgTwo}/cover`).set(bearer(token)),
      ]);
      expect(r1.status).not.toBe(500);
      expect(r2.status).not.toBe(500);
      expect([r1.status, r2.status].some((s) => s < 300)).toBe(true);
      expect(await primaryCount(direct, taskA)).toBe(1);
    });

    it("primary MỒ CÔI (tệp đã soft-delete) vẫn hạ được ⇒ đặt bìa mới OK, đúng 1 primary", async () => {
      // Nếu findPrimaryLinkTx join `files` + lọc deleted_at thì primary này VÔ HÌNH ⇒ 23505 → 500.
      expect(await primaryCount(direct, taskA2)).toBe(1); // mồ côi đang chiếm chỗ
      const token = await login(nest, A.slug, hrEmail);
      const res = await api(nest)
        .post(`/tasks/${taskA2}/files/${otherTaskFile}/cover`)
        .set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      expect(await primaryCount(direct, taskA2)).toBe(1);
    });

    // ── gỡ bìa + route ───────────────────────────────────────────────────────────────────────────

    it("gỡ bìa ⇒ 204, coverUrl về null; gỡ lần nữa vẫn 204 (idempotent, KHÔNG 404)", async () => {
      const token = await login(nest, A.slug, hrEmail);
      expect(
        (await api(nest).delete(`/tasks/${taskA}/files/cover`).set(bearer(token))).status,
      ).toBe(204);
      expect(await coverUrlOf(nest, token, taskA)).toBeNull();
      expect(
        (await api(nest).delete(`/tasks/${taskA}/files/cover`).set(bearer(token))).status,
      ).toBe(204);
    });

    it("DELETE /files/cover KHÔNG bị @Delete(':fileId') che", async () => {
      // Nếu bị che, "cover" rơi vào remove() làm fileId ⇒ 404/500 ở tầng uuid thay vì 204.
      const token = await login(nest, A.slug, hrEmail);
      const res = await api(nest).delete(`/tasks/${taskA}/files/cover`).set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });

    it("task chưa có bìa ⇒ coverUrl null (fail-soft, không 500)", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const fresh = await seedTask(direct, A.companyId);
      expect(await coverUrlOf(nest, token, fresh)).toBeNull();
    });
  },
);
