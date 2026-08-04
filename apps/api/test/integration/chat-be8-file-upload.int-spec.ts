/**
 * S7-CHAT-BE-8 — presign upload own-scope của CHAT (SPEC-15 §13.5 bước 1-2 · CHAT-FUNC-007).
 *
 * ┌─ CA SỐ 1 LÀ CHỨNG MINH LỖ CÓ THẬT (RED-trước) ───────────────────────────────────────────────┐
 * │ CÙNG một token, CÙNG một payload: `/foundation/files/upload` phải **403** và                   │
 * │ `/chat/files/upload-url` phải **200**. Thiếu vế 403 thì cả suite này chỉ chứng minh "route mới  │
 * │ chạy được", không chứng minh nó ĐÓNG cái gì — và WO sẽ trông như đúng dù lỗ chưa từng tồn tại. │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **CHỦ THỂ KHÔNG PHẢI SUPER ADMIN.** SA giữ `*:*` nên mọi ca deny sẽ xanh-giả (memory
 * `superadmin-not-a-canonical-role`). Chủ thể ở đây được cấp ĐÚNG 9 cặp CHAT thường và **0** cặp
 * `*:foundation-file` — đúng hình dạng quyền của `employee`/`hr`/`manager` trên DB thật.
 *
 * ⚠️ **GIỚI HẠN ĐÃ BIẾT — bước PUT bytes.** Suite chạy KHÔNG cần MinIO (presign S3 là HMAC offline).
 * Vì vậy leg "client PUT bytes lên storage" được thay bằng một câu UPDATE `upload_status='Uploaded'`
 * qua direct pool, rồi `/confirm` đi ĐƯỜNG THẬT: `FileService.confirmUpload` trả 200 idempotent TRƯỚC
 * khi chạm storage khi row đã `Uploaded`. Mọi vế thuộc phạm vi WO này (cặp quyền · owner-check ·
 * routing · cross-tenant · gắn link lúc gửi tin) đều chạy thật; chỉ HAI nhánh của FOUNDATION là không
 * được suite này bao: verify size-mismatch và checksum — chúng thuộc `S2-FND-FILE-2`, không đổi ở WO này.
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
import { CHAT_MESSAGE_ENTITY_TYPE } from "../../src/chat/chat-file.constants";
import { directPool, hasDb } from "../helpers/integration-db";
import { FALLBACK_S3_SECRET } from "../helpers/fixture-secrets";
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
const LOGIN_PW = "Passw0rd!chatbe8";

// Presign S3 là HMAC OFFLINE — không gọi mạng, không cần MinIO chạy. Đặt trước khi dựng app.
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_ACCESS_KEY ??= "mediaos";
process.env.S3_SECRET_KEY ??= FALLBACK_S3_SECRET;
process.env.S3_BUCKET ??= "mediaos-assets";
process.env.S3_FORCE_PATH_STYLE ??= "true";
process.env.S3_REGION ??= "us-east-1";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

/**
 * 9 cặp CHAT thường (seed `0538:406-415`) — và KHÔNG cặp `*:foundation-file` nào.
 *
 * ⚠️ Danh sách này là NỘI DUNG của phép thử, không phải bối cảnh: thêm `upload`/`download`
 * `× foundation-file` vào đây là tự tay vá lỗ mà WO này đang chứng minh, và ca 1 sẽ xanh-giả.
 */
const CHAT_ONLY: PairGrant[] = [
  ["access", "chat", "Company"],
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
  ["recall", "chat-message", "Company"],
  ["pin", "chat-message", "Company"],
];

/** Người CHỈ được xem — dùng để chứng minh cặp gate là `send`, không phải `view`. */
const VIEW_ONLY: PairGrant[] = [
  ["access", "chat", "Company"],
  ["view", "chat-room", "Company"],
];

const UPLOAD_BODY = {
  originalName: "bao-cao.pdf",
  declaredMimeType: "application/pdf",
  sizeBytes: 1024,
};

interface Ctx {
  app: INestApplication;
  direct: Pool;
}

describe.skipIf(!hasLaneDb)(
  "S7-CHAT-BE-8 — presign upload own-scope (DB cô lập, đường thật)",
  () => {
    const ctx = {} as Ctx;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let uSender = "";
    let uMate = "";
    let uViewer = "";
    let uB = "";
    let tSender = "";
    let tMate = "";
    let tViewer = "";
    let tB = "";
    let room = "";

    const direct = (): Pool => ctx.direct;
    const authPost = (t: string, u: string) =>
      request(ctx.app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);

    async function grant(companyId: string, userId: string, label: string, pairs: PairGrant[]) {
      const roleId = await seedRole(direct(), companyId, `chatbe8-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope] of pairs) {
        const permId = await seedPermissionCatalog(direct(), action, resource, false);
        await seedRolePermission(direct(), roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct(), userId, roleId, companyId);
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(ctx.app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** Đăng ký tệp qua ĐƯỜNG THẬT của WO này. Trả `fileId`. */
    async function registerFile(token: string, body = UPLOAD_BODY): Promise<string> {
      const res = await authPost(token, "/chat/files/upload-url").send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.fileId as string;
    }

    /**
     * Thay cho bước "client PUT bytes lên storage" (xem GIỚI HẠN ĐÃ BIẾT ở đầu file).
     *
     * KHÔNG phải cách lách owner-check: câu này chỉ đổi `upload_status`, `owner_user_id` giữ nguyên giá
     * trị mà `FileService.upload` đã đặt — chính vế mà `/confirm` và `findOwnedFiles` sẽ soi.
     */
    async function fakePutBytes(fileId: string): Promise<void> {
      await direct().query(`UPDATE files SET upload_status = 'Uploaded' WHERE id = $1`, [fileId]);
    }

    async function fileRow(fileId: string): Promise<Record<string, unknown> | undefined> {
      const r = await direct().query(
        `SELECT company_id, owner_user_id, uploaded_by, visibility, upload_status, mime_type, storage_path
         FROM files WHERE id = $1`,
        [fileId],
      );
      return r.rows[0] as Record<string, unknown> | undefined;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      ctx.app = moduleRef.createNestApplication();
      ctx.app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      ctx.app.useGlobalFilters(new AllExceptionsFilter());
      await ctx.app.init();

      ctx.direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(ctx.direct, "chatbe8a");
      B = await seedCompany(ctx.direct, "chatbe8b");
      companyIds.push(A.companyId, B.companyId);

      const mk = (n: string) => seedUser(ctx.direct, A.companyId, `${n}@${A.slug}.test`, hash);
      uSender = await mk("sender");
      uMate = await mk("mate");
      uViewer = await mk("viewer");
      uB = await seedUser(ctx.direct, B.companyId, `bob@${B.slug}.test`, hash);

      await grant(A.companyId, uSender, "sender", CHAT_ONLY);
      await grant(A.companyId, uMate, "mate", CHAT_ONLY);
      await grant(A.companyId, uViewer, "viewer", VIEW_ONLY);
      await grant(B.companyId, uB, "b", CHAT_ONLY);

      tSender = await login(A.slug, `sender@${A.slug}.test`);
      tMate = await login(A.slug, `mate@${A.slug}.test`);
      tViewer = await login(A.slug, `viewer@${A.slug}.test`);
      tB = await login(B.slug, `bob@${B.slug}.test`);

      const res = await authPost(tSender, "/chat/rooms").send({
        name: "Phòng gửi tệp",
        memberUserIds: [uMate],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      room = res.body.data.id as string;
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(ctx.direct, companyIds);
      await ctx.direct.end();
      await ctx.app.close();
    });

    // ── Ca 1: lỗ có thật, và WO này đóng nó ────────────────────────────────────

    it("ca 1 (RED-trước): CÙNG token — /foundation/files/upload 403, /chat/files/upload-url 200", async () => {
      // Vế đỏ: đây CHÍNH LÀ lý do WO tồn tại. Chủ thể có đủ 9 cặp CHAT nhưng 0 cặp foundation-file, nên
      // đường upload của FOUNDATION đóng sập ở `PermissionGuard` — tức CHAT-FUNC-007 chết với đa số user.
      const denied = await authPost(tSender, "/foundation/files/upload").send(UPLOAD_BODY);
      expect(denied.status, JSON.stringify(denied.body)).toBe(403);

      // Vế xanh: cùng người, cùng payload, qua cửa CHAT.
      const ok = await authPost(tSender, "/chat/files/upload-url").send(UPLOAD_BODY);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.fileId).toEqual(expect.any(String));
      expect(ok.body.data.uploadStatus).toBe("Pending");
      expect(typeof ok.body.data.uploadUrl).toBe("string");
      expect(typeof ok.body.data.expiresAt).toBe("string");
      // BẤT BIẾN #2.3 — response KHÔNG được mang storage_path/checksum ra ngoài.
      expect(Object.keys(ok.body.data).sort()).toEqual([
        "expiresAt",
        "fileId",
        "uploadStatus",
        "uploadUrl",
      ]);

      const row = await fileRow(ok.body.data.fileId as string);
      expect(row?.owner_user_id).toBe(uSender);
      expect(row?.uploaded_by).toBe(uSender);
      expect(row?.company_id).toBe(A.companyId);
      expect(row?.visibility).toBe("Private");
      expect(row?.upload_status).toBe("Pending");
    });

    // ── Cặp quyền ──────────────────────────────────────────────────────────────

    it("ca 2: chỉ có `view:chat-room` (không `send`) → upload-url 403", async () => {
      const res = await authPost(tViewer, "/chat/files/upload-url").send(UPLOAD_BODY);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("ca 3: chỉ có `view:chat-room` → confirm 403 (gate đứng TRƯỚC mọi truy vấn)", async () => {
      const fileId = await registerFile(tSender);
      const res = await authPost(tViewer, `/chat/files/${fileId}/confirm`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      // Không có nhánh nào đổi trạng thái trước khi guard chạy.
      expect((await fileRow(fileId))?.upload_status).toBe("Pending");
    });

    // ── Owner-check ở confirm (đai chống IDOR) ─────────────────────────────────

    it("ca 4: confirm tệp NGƯỜI KHÁC đăng ký → 403, và tệp KHÔNG đổi trạng thái", async () => {
      // `mate` có ĐẦY ĐỦ `send:chat-message` — nên 403 ở đây CHỈ có thể đến từ owner-check, không phải
      // từ cặp quyền. Đó là điều ca này phải phân biệt được.
      const fileId = await registerFile(tSender);
      const res = await authPost(tMate, `/chat/files/${fileId}/confirm`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect((await fileRow(fileId))?.upload_status).toBe("Pending");
    });

    it("ca 5: confirm fileId không tồn tại → 404", async () => {
      const res = await authPost(tSender, `/chat/files/${randomUUID()}/confirm`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("ca 6: confirm XUYÊN TENANT — người ở B confirm tệp của A → 404 (RLS + lọc company)", async () => {
      const fileId = await registerFile(tSender);
      const res = await authPost(tB, `/chat/files/${fileId}/confirm`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect((await fileRow(fileId))?.upload_status).toBe("Pending");
    });

    // ── Trọn luồng §13.5 ───────────────────────────────────────────────────────

    it("ca 7: TRỌN LUỒNG — upload-url → confirm → gửi tin kèm fileIds → tin có đính kèm ký được", async () => {
      const fileId = await registerFile(tSender, {
        originalName: "anh.png",
        declaredMimeType: "image/png",
        sizeBytes: 2048,
      });
      await fakePutBytes(fileId);

      const confirmed = await authPost(tSender, `/chat/files/${fileId}/confirm`).send({});
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      expect(confirmed.body.data).toMatchObject({ fileId, uploadStatus: "Uploaded" });

      const sent = await authPost(tSender, `/chat/rooms/${room}/messages`).send({
        body: "gửi kèm ảnh",
        clientMessageId: randomUUID(),
        fileIds: [fileId],
      });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      expect(sent.body.data.attachmentCount).toBe(1);
      expect(sent.body.data.messageType).toBe("file");
      expect(sent.body.data.attachments).toHaveLength(1);
      // URL ký được ⇒ toàn bộ đường ĐỌC của BE-3 (link → resolver → presign) vẫn chạy với tệp đi qua cửa
      // CHAT. Nếu chỉ ghi được mà không ký được thì tính năng vẫn chết, chỉ chết ở đầu kia.
      expect(typeof sent.body.data.attachments[0].url).toBe("string");
      expect(sent.body.data.attachments[0].isImage).toBe(true);

      const links = await direct().query(
        `SELECT module_code, entity_type, entity_id, link_type, created_by FROM file_links
        WHERE file_id = $1 AND deleted_at IS NULL`,
        [fileId],
      );
      expect(links.rows).toHaveLength(1);
      expect(links.rows[0].module_code).toBe("CHAT");
      expect(links.rows[0].entity_type).toBe(CHAT_MESSAGE_ENTITY_TYPE);
      expect(links.rows[0].entity_id).toBe(sent.body.data.id);
      expect(links.rows[0].created_by).toBe(uSender);
    });

    it("ca 8: người KHÁC không mượn được tệp vừa qua cửa CHAT → 403 CHAT-ERR-015 (chốt tại nguồn còn nguyên)", async () => {
      const fileId = await registerFile(tSender, {
        originalName: "rieng-tu.pdf",
        declaredMimeType: "application/pdf",
        sizeBytes: 512,
      });
      await fakePutBytes(fileId);
      expect((await authPost(tSender, `/chat/files/${fileId}/confirm`).send({})).status).toBe(200);

      // `mate` cùng phòng, có `send:chat-message`, tệp đã Uploaded — vế duy nhất chặn là `owner_user_id`
      // trong SQL của `findOwnedFiles`. WO này KHÔNG được nới nó.
      const res = await authPost(tMate, `/chat/rooms/${room}/messages`).send({
        body: "mượn tệp người khác",
        clientMessageId: randomUUID(),
        fileIds: [fileId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).toContain("CHAT-ERR-015");
    });

    // ── Biên input ─────────────────────────────────────────────────────────────

    it("ca 9: client tự khai `visibility`/`moduleCode`/`entityId` → BỊ BỎ (schema hẹp, server ép Private)", async () => {
      const res = await authPost(tSender, "/chat/files/upload-url").send({
        ...UPLOAD_BODY,
        visibility: "Public",
        moduleCode: "HR",
        entityType: "Employee",
        entityId: randomUUID(),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const row = await fileRow(res.body.data.fileId as string);
      expect(row?.visibility).toBe("Private");

      // Dòng audit phải nói FOUNDATION/File — nhận `moduleCode` từ client là để client tự khai tệp của
      // mình thuộc entity module khác trong một bảng append-only không sửa lại được.
      const audit = await direct().query(
        `SELECT module_code, entity_type FROM audit_logs
        WHERE object_type = 'file' AND object_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [res.body.data.fileId],
      );
      expect(audit.rows[0]?.module_code).toBe("FOUNDATION");
      expect(audit.rows[0]?.entity_type).toBe("File");
    });

    it("ca 10: MIME ngoài allowlist → 415, KHÔNG ghi row `files` nào", async () => {
      const before = await direct().query(
        `SELECT count(*)::int AS n FROM files WHERE company_id = $1`,
        [A.companyId],
      );
      const res = await authPost(tSender, "/chat/files/upload-url").send({
        originalName: "script.sh",
        declaredMimeType: "application/x-sh",
        sizeBytes: 10,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(415);
      const after = await direct().query(
        `SELECT count(*)::int AS n FROM files WHERE company_id = $1`,
        [A.companyId],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it("ca 11: `:id` không phải UUID → 400 (ParseUUIDPipe), không rơi vào nhánh 404/403", async () => {
      const res = await authPost(tSender, "/chat/files/khong-phai-uuid/confirm").send({});
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });
  },
);
