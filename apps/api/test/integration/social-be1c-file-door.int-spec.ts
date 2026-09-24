/**
 * S16-SOCIAL-BE-1C — cửa đăng ký tệp đính kèm của bảng tin (`SOCIAL-API-054/055`, plan §3).
 *
 * ┌─ CA SỐ 1 LÀ CHỨNG MINH LỖ CÓ THẬT (RED-trước) ────────────────────────────────────────────────┐
 * │ CÙNG token, CÙNG payload: `/foundation/files/upload` phải **403** và `/social/files/upload-url` │
 * │ phải **200**. Thiếu vế 403 thì suite chỉ chứng minh "route mới chạy được", không chứng minh nó  │
 * │ ĐÓNG cái gì — WO sẽ trông như đúng dù lỗ chưa từng tồn tại (khuôn `chat-be8-file-upload`).      │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 🔴 HAI CẶP CA LÀ LÝ DO D1 TỒN TẠI — ĐỪNG "ĐƠN GIẢN HOÁ" CHÚNG ĐI ────────────────────────────┐
 * │ `postOnly`  (`view:feed` + `create:feed-post`, KHÔNG `-comment`): `target='post'` → 200 ·        │
 * │                                                                   `target='comment'` → 403      │
 * │ `commentOnly` (`view:feed` + `create:feed-comment`, KHÔNG `-post`): ngược lại.                   │
 * │                                                                                                 │
 * │ Bốn ca đó đo ĐÚNG thứ một cặp tĩnh trên decorator KHÔNG diễn đạt được. Ai đổi decorator thành    │
 * │ `create:feed-post` "cho chặt" sẽ thấy `commentOnly` 403 ở CẢ HAI target — tức chặn nhầm một vai  │
 * │ vẫn bình luận được bằng chữ. Mỗi ca DENY có ca ALLOW của CHÍNH vai đó đứng cạnh, nên không ca    │
 * │ nào xanh-rỗng (memory `ca-deny-rong-thieu-allow`).                                              │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **CHỦ THỂ KHÔNG PHẢI SUPER ADMIN** — SA giữ `*:*` nên mọi ca deny xanh-giả (memory
 * `superadmin-not-a-canonical-role`). Mọi vai ở đây là vai TUỲ BIẾN cấp đúng số cặp cần đo; KHÔNG
 * sửa `role_permissions` của vai canonical (đóng dấu lên lane DB dùng chung).
 *
 * ⚠️ **GIỚI HẠN ĐÃ BIẾT — bước PUT bytes.** Suite chạy KHÔNG cần MinIO (presign S3 là HMAC offline).
 * Leg "client PUT bytes" được thay bằng một câu UPDATE `upload_status='Uploaded'` qua direct pool,
 * rồi `/confirm` đi ĐƯỜNG THẬT (`confirmUpload` trả 200 idempotent TRƯỚC khi chạm storage khi row đã
 * `Uploaded`). Hai nhánh verify size-mismatch/checksum của FOUNDATION không đổi ở WO này.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
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
import { SOCIAL_ERR } from "../../src/social/social.errors";
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

// Presign S3 là HMAC OFFLINE — không gọi mạng, không cần MinIO chạy. Đặt TRƯỚC khi dựng app.
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_ACCESS_KEY ??= "mediaos";
process.env.S3_SECRET_KEY ??= FALLBACK_S3_SECRET;
process.env.S3_BUCKET ??= "mediaos-assets";
process.env.S3_FORCE_PATH_STYLE ??= "true";
process.env.S3_REGION ??= "us-east-1";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!socbe1c";

/**
 * Bộ cặp của từng vai — **NỘI DUNG của phép thử, không phải bối cảnh.**
 *
 * ⚠️ Thêm `upload`/`download` × `foundation-file` vào bất kỳ dòng nào là tự tay vá lỗ mà ca 1 đang
 * chứng minh ⇒ ca 1 xanh-giả. Thêm cặp `create:feed-*` còn thiếu vào `postOnly`/`commentOnly` là xoá
 * sạch ý nghĩa của bốn ca D1.
 */
const BOTH_PAIRS = ["view:feed", "create:feed-post", "create:feed-comment"] as const;
const POST_ONLY_PAIRS = ["view:feed", "create:feed-post"] as const;
const COMMENT_ONLY_PAIRS = ["view:feed", "create:feed-comment"] as const;
/** Đọc được bảng tin nhưng KHÔNG viết được gì — sàn tầng-1 qua, tầng-2 chặn. */
const READ_ONLY_PAIRS = ["view:feed"] as const;
/** Không cả `view:feed` — bị `PermissionGuard` chặn ở TẦNG 1, trước khi service chạy một dòng. */
const NO_FEED_PAIRS = ["create:feed-post"] as const;

const UPLOAD_BODY = {
  originalName: "anh-bai-viet.png",
  declaredMimeType: "image/png",
  sizeBytes: 2048,
};

describe.skipIf(!hasLaneDb)(
  "S16-SOCIAL-BE-1C cửa đăng ký tệp — gate theo target (DB cô lập)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let tBoth = "";
    let tPostOnly = "";
    let tCommentOnly = "";
    let tReadOnly = "";
    let tNoFeed = "";
    let bothUserId = "";
    let otherUserId = "";
    let tOther = "";

    const http = () => request(app.getHttpServer());
    const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);

    async function makeUser(
      label: string,
      hash: string,
      pairs: readonly string[],
    ): Promise<{ token: string; userId: string }> {
      const email = `${label}@${A.slug}.test`;
      const userId = await seedUser(direct, A.companyId, email, hash);
      await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status, work_type, employee_code)
       VALUES ($1, $2, 'active', 'offline', $3)`,
        [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
      );
      const roleId = await seedRole(direct, A.companyId, `socbe1c-${randomUUID().slice(0, 8)}`);
      for (const key of pairs) {
        const [action, resource] = key.split(":") as [string, string];
        const permId = await seedPermissionCatalog(direct, action, resource, false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, roleId, A.companyId);
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return { token: res.body.data.accessToken as string, userId };
    }

    /** Đăng ký tệp qua ĐƯỜNG THẬT của WO này. Trả `fileId`. */
    async function registerFile(
      token: string,
      target: "post" | "comment" = "post",
    ): Promise<string> {
      const res = await post(token, "/social/files/upload-url").send({ ...UPLOAD_BODY, target });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.fileId as string;
    }

    /** Thay cho "client PUT bytes" — chỉ đổi `upload_status`, `owner_user_id` giữ NGUYÊN. */
    async function fakePutBytes(fileId: string): Promise<void> {
      await direct.query(`UPDATE files SET upload_status = 'Uploaded' WHERE id = $1`, [fileId]);
    }

    async function fileRow(fileId: string): Promise<Record<string, unknown> | undefined> {
      const r = await direct.query(
        `SELECT upload_status, owner_user_id, visibility, is_temporary
         FROM files WHERE id = $1`,
        [fileId],
      );
      return r.rows[0];
    }

    /** 0 link ⇒ tệp INERT: không đường tải nào ký được URL cho nó (`signOne` chặn ở `links.length === 0`). */
  async function countLinks(fileId: string): Promise<number> {
      const r = await direct.query(`SELECT count(*)::int AS n FROM file_links WHERE file_id = $1`, [
        fileId,
      ]);
      return r.rows[0].n as number;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "socbe1c");
      companyIds.push(A.companyId);

      const both = await makeUser("both", hash, BOTH_PAIRS);
      tBoth = both.token;
      bothUserId = both.userId;
      tPostOnly = (await makeUser("postonly", hash, POST_ONLY_PAIRS)).token;
      tCommentOnly = (await makeUser("commentonly", hash, COMMENT_ONLY_PAIRS)).token;
      tReadOnly = (await makeUser("readonly", hash, READ_ONLY_PAIRS)).token;
      tNoFeed = (await makeUser("nofeed", hash, NO_FEED_PAIRS)).token;
      const other = await makeUser("other", hash, BOTH_PAIRS);
      tOther = other.token;
      otherUserId = other.userId;
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length) await cleanupTenants(direct, companyIds);
    });

    // ══════════════ 1 — lỗ có thật: cửa FOUNDATION đóng, cửa SOCIAL mở ══════════════

    describe("1 — RED-trước: cùng token, hai cửa hai kết quả", () => {
      it("DENY cửa FOUNDATION (`upload:foundation-file`) ⇒ 403; ALLOW cửa SOCIAL ⇒ 200", async () => {
        const denied = await post(tBoth, "/foundation/files/upload").send(UPLOAD_BODY);
        expect(denied.status, `lỗ đã tự lành? ${JSON.stringify(denied.body)}`).toBe(403);

        const ok = await post(tBoth, "/social/files/upload-url").send({
          ...UPLOAD_BODY,
          target: "post",
        });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        expect(ok.body.data.fileId).toEqual(expect.any(String));
        expect(typeof ok.body.data.uploadUrl).toBe("string");

        // Tệp SERVER-SET `Private`, chưa gắn entity nào, và INERT (0 link).
        const row = await fileRow(ok.body.data.fileId as string);
        expect(row?.visibility).toBe("Private");
        expect(row?.upload_status).toBe("Pending");
        expect(row?.owner_user_id).toBe(bothUserId);
        // `target` KHÔNG được ghi xuống `files` — nó là đầu vào của cổng quyền, không phải sự thật về
        // tệp (jsdoc `SocialFilesService.createUploadUrl`). Ghi bừa vào đây là làm bẩn dấu vết điều tra.
        expect(row?.module_code ?? null).toBeNull();
        expect(row?.entity_type ?? null).toBeNull();
        expect(await countLinks(ok.body.data.fileId as string)).toBe(0);
      });
    });

    // ══════════════ 2 — D1: cặp quyền theo `target` ══════════════

    describe("2 — D1: vai lệch một cặp mở được ĐÚNG nửa cửa", () => {
      it("ALLOW: vai có CẢ HAI cặp mở được cả hai target", async () => {
        await expect(registerFile(tBoth, "post")).resolves.toEqual(expect.any(String));
        await expect(registerFile(tBoth, "comment")).resolves.toEqual(expect.any(String));
      });

      it("DENY: `postOnly` + target=comment ⇒ 403 FILE_TARGET_COMMENT_DENIED", async () => {
        const res = await post(tPostOnly, "/social/files/upload-url").send({
          ...UPLOAD_BODY,
          target: "comment",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.FILE_TARGET_COMMENT_DENIED);
      });

      it("ALLOW (cạnh ca trên): `postOnly` + target=post ⇒ 200", async () => {
        await expect(registerFile(tPostOnly, "post")).resolves.toEqual(expect.any(String));
      });

      it("DENY: `commentOnly` + target=post ⇒ 403 FILE_TARGET_POST_DENIED", async () => {
        const res = await post(tCommentOnly, "/social/files/upload-url").send({
          ...UPLOAD_BODY,
          target: "post",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.FILE_TARGET_POST_DENIED);
      });

      it("ALLOW (cạnh ca trên): `commentOnly` + target=comment ⇒ 200", async () => {
        await expect(registerFile(tCommentOnly, "comment")).resolves.toEqual(expect.any(String));
      });

      it("DENY: chỉ `view:feed` (sàn qua, tầng-2 chặn) ⇒ 403 ở CẢ HAI target", async () => {
        for (const target of ["post", "comment"] as const) {
          const res = await post(tReadOnly, "/social/files/upload-url").send({
            ...UPLOAD_BODY,
            target,
          });
          expect(res.status, `${target}: ${JSON.stringify(res.body)}`).toBe(403);
        }
      });

      it("DENY: KHÔNG có `view:feed` ⇒ 403 ở TẦNG 1 (guard), dù có `create:feed-post`", async () => {
        const res = await post(tNoFeed, "/social/files/upload-url").send({
          ...UPLOAD_BODY,
          target: "post",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        // Tầng 1 phát chuỗi của `PermissionGuard`, KHÔNG phải thông điệp tầng-2 — nếu thấy thông điệp
        // tầng-2 ở đây nghĩa là decorator đã rơi mất và service đang gác một mình.
        expect(JSON.stringify(res.body)).not.toContain(SOCIAL_ERR.FILE_TARGET_POST_DENIED);
      });

      it("`target` sai kiểu / vắng ⇒ 400 của Zod (hình dạng sai, không phải chuyện quyền)", async () => {
        const missing = await post(tBoth, "/social/files/upload-url").send(UPLOAD_BODY);
        expect(missing.status, JSON.stringify(missing.body)).toBe(400);
        const bogus = await post(tBoth, "/social/files/upload-url").send({
          ...UPLOAD_BODY,
          target: "poll",
        });
        expect(bogus.status, JSON.stringify(bogus.body)).toBe(400);
      });
    });

    // ══════════════ 3 — confirm: owner-check + cùng luật target ══════════════

    describe("3 — confirm own-scope", () => {
      it("DENY (IDOR): confirm tệp của NGƯỜI KHÁC ⇒ 403, tệp vẫn `Pending`", async () => {
        const fileId = await registerFile(tBoth, "post");
        await fakePutBytes(fileId);
        // ⚠️ `fakePutBytes` đặt `Uploaded` để ca ALLOW ở dưới đi được ĐƯỜNG THẬT. Ca DENY này vì vậy
        // KHÔNG đo được `upload_status` sau đó — nó đo bằng MÃ 403 + việc `other` không sở hữu tệp.
        const res = await post(tOther, `/social/files/${fileId}/confirm`).send({ target: "post" });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.FILE_NOT_OWNED);
        expect((await fileRow(fileId))?.owner_user_id).toBe(bothUserId);
        expect((await fileRow(fileId))?.owner_user_id).not.toBe(otherUserId);
      });

      it("ALLOW (cạnh ca trên): chủ tệp confirm ⇒ 200", async () => {
        const fileId = await registerFile(tBoth, "post");
        await fakePutBytes(fileId);
        const res = await post(tBoth, `/social/files/${fileId}/confirm`).send({ target: "post" });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect((await fileRow(fileId))?.upload_status).toBe("Uploaded");
      });

      it("DENY: confirm gác CÙNG luật target — `postOnly` confirm với target=comment ⇒ 403", async () => {
        const fileId = await registerFile(tPostOnly, "post");
        await fakePutBytes(fileId);
        const res = await post(tPostOnly, `/social/files/${fileId}/confirm`).send({
          target: "comment",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.FILE_TARGET_COMMENT_DENIED);
      });

      it("ALLOW (cạnh ca trên): CÙNG tệp, CÙNG vai, target=post ⇒ 200", async () => {
        const fileId = await registerFile(tPostOnly, "post");
        await fakePutBytes(fileId);
        const res = await post(tPostOnly, `/social/files/${fileId}/confirm`).send({
          target: "post",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("confirm tệp LẠ ⇒ 404 (không phân biệt 'không có' với 'của người khác' bằng 404-vs-403 ở đây)", async () => {
        const res = await post(tBoth, `/social/files/${randomUUID()}/confirm`).send({
          target: "post",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(404);
      });

      it("`:id` không phải UUID ⇒ 400 (ParseUUIDPipe cấp method)", async () => {
        const res = await post(tBoth, "/social/files/khong-phai-uuid/confirm").send({
          target: "post",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
      });
    });

    // ══════════════ 4 — tệp qua cửa này GẮN ĐƯỢC vào nội dung của chính mình ══════════════

    describe("4 — nối trọn đường: cửa mới → đính kèm thật", () => {
      it("ALLOW: tệp đăng ký qua cửa mới gắn được vào bài của chính mình (201 + 1 link)", async () => {
        const fileId = await registerFile(tBoth, "post");
        await fakePutBytes(fileId);
        const confirmed = await post(tBoth, `/social/files/${fileId}/confirm`).send({
          target: "post",
        });
        expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);

        const created = await post(tBoth, "/social/posts").send({
          type: "share",
          audience: "company",
          body: "bài có ảnh đi qua cửa mới",
          attachmentIds: [fileId],
        });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        expect(await countLinks(fileId)).toBe(1);
      });

      it("DENY: tệp người khác đăng ký vẫn KHÔNG gắn được (vế 2 của canLinkFile còn nguyên)", async () => {
        const foreign = await registerFile(tOther, "post");
        await fakePutBytes(foreign);
        await post(tOther, `/social/files/${foreign}/confirm`).send({ target: "post" });

        const res = await post(tBoth, "/social/posts").send({
          type: "share",
          audience: "company",
          body: "mượn tệp người khác qua cửa mới",
          attachmentIds: [foreign],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-007");
        expect(await countLinks(foreign)).toBe(0);
      });
    });
  },
);
