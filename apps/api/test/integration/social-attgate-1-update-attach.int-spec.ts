/**
 * S16-SOCIAL-ATTGATE-1 — cổng cặp `create:feed-*` trên ĐƯỜNG GẮN TỆP (plan D-1 lối (f) · §3A).
 *
 * ┌─ LỖ ĐANG ĐÓNG ────────────────────────────────────────────────────────────────────────────────┐
 * │ `assertLinkableFilesTx` chép vế 2-5 của `SocialFileResolver.canLinkFile` nhưng BỎ vế 6a (cặp   │
 * │ `create` theo đích). `canLinkFile` chỉ chạy trên `POST /foundation/files/:id/links` (cặp       │
 * │ `link:foundation-file` — nhân viên thường KHÔNG có) ⇒ nhánh đó CHẾT. Đường FE thật đi là       │
 * │ route ghi nội dung → `syncLinksTx`. Hai route TẠO (`002`/`015`) được cặp `create:feed-*` ép ở  │
 * │ CẢ HAI tầng (decorator + `resolveActor`), nhưng hai route SỬA (`004`/`016`) chỉ gác `view:feed`│
 * │ + (tác giả ∨ `manage:feed-post`) ⇒ vai kiểm duyệt KHÔNG có `create:feed-post` vẫn gắn được tệp.│
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **NGUỒN TỆP của `R_MOD_NOCREATE` phải gieo THẲNG bằng `seedFile`, KHÔNG qua `054`** (plan F-3):
 * cửa `054` gác `assertFileTarget` → `create:feed-post`, tức vai này KHÔNG lấy nổi tệp của chính
 * mình qua đường thật — điều đó pin ở `social-be1c-file-door.int-spec.ts:259` («chỉ `view:feed` ⇒
 * 403 ở CẢ HAI target»), KHÔNG ở file này. Nếu mượn tệp của người khác cho ca RED thì nó
 * trùng khít G18 và mutant «gỡ cổng» sẽ ra **422** (vế 2 — sở hữu) chứ không phải 200 ⇒ ca đỏ vì
 * LÝ DO KHÁC, phép đo cổng vô hiệu.
 *
 * ⚠️ **THÊM `create:feed-post` VÀO `R_MOD_NOCREATE` LÀ TỰ TAY XOÁ SẠCH WO NÀY.** Vai đó cố ý giữ
 * `manage:feed-post` mà KHÔNG giữ cặp `create:feed-*` nào — đó là toàn bộ nội dung phép đo.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */

import { randomUUID } from "node:crypto";
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
import { SOCIAL_ERR } from "../../src/social/social.errors";
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

const hasLaneDb = hasDb && !!process.env.LANE_DB;
// CLAUDE.md §5 — fixture giống-secret GHÉP CHUỖI, không viết literal high-entropy một mạch:
// literal như vậy trip rule gitleaks `generic-api-key` và làm ĐỎ OAN cả PR lẫn lịch sử nhánh.
const LOGIN_PW = ["Passw0rd!attgate", "1"].join("");

/** Tác giả: đủ cả hai cặp `create` — vai "người dùng thường" của module. */
const AUTHOR_PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "download:foundation-file",
  "view:foundation-file",
] as const;

/**
 * 🔴 VAI CỦA CA RED CHÍNH: kiểm duyệt viên KHÔNG có cặp `create:feed-*` nào.
 * Đọc được bảng tin, sửa/xoá được nội dung người khác — nhưng không được ĐĂNG.
 */
const MOD_NOCREATE_PAIRS = [
  "view:feed",
  "manage:feed-post",
  "download:foundation-file",
  "view:foundation-file",
] as const;

/** ALLOW đối chứng của ca RED: y hệt vai trên NHƯNG có thêm hai cặp `create`. */
const MOD_FULL_PAIRS = [
  "view:feed",
  "manage:feed-post",
  "create:feed-post",
  "create:feed-comment",
  "download:foundation-file",
  "view:foundation-file",
] as const;

/** Chỉ tạo được BÀI — dùng cho ca tách tầng ở đường TẠO bình luận. */
const POST_ONLY_PAIRS = ["view:feed", "create:feed-post"] as const;

/** Chỉ tạo được BÌNH LUẬN — dùng cho ca tách tầng ở đường TẠO bài. */
const COMMENT_ONLY_PAIRS = ["view:feed", "create:feed-comment"] as const;

describe.skipIf(!hasLaneDb)(
  "S16-SOCIAL-ATTGATE-1 — cặp `create:feed-*` trên đường GẮN tệp (DB cô lập)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let tAuthor = "";
    let tMod = "";
    let tModFull = "";
    let tPostOnly = "";
    let tCommentOnly = "";
    let authorUserId = "";
    let modUserId = "";
    let modFullUserId = "";

    const http = () => request(app.getHttpServer());
    const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
    const post = (t: string, u: string) => auth(t)(http().post(u));
    const patch = (t: string, u: string) => auth(t)(http().patch(u));
    const del = (t: string, u: string) => auth(t)(http().delete(u));

    /** Một hàng `files` Uploaded+Clean thuộc `owner`. Gieo tay — ta đo GATE, không đo upload (F-3). */
    async function seedFile(owner: string): Promise<string> {
      const id = randomUUID();
      await direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
                            storage_provider, storage_path, upload_status, scan_status,
                            owner_user_id, uploaded_by)
         VALUES ($1,$2,$3,$4,'image/png',1024,'MinIO',$5,'Uploaded','Clean',$6,$6)`,
        [
          id,
          A.companyId,
          `f-${id.slice(0, 6)}.png`,
          `stored-${id}`,
          `${A.companyId}/social/${id}`,
          owner,
        ],
      );
      return id;
    }

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
      const roleId = await seedRole(direct, A.companyId, `attgate-${randomUUID().slice(0, 8)}`);
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

    async function countLiveLinks(fileId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM file_links WHERE file_id = $1 AND deleted_at IS NULL`,
        [fileId],
      );
      return r.rows[0].n as number;
    }

    /** Audit của ĐÚNG bài đó (F-7: đếm tuyệt đối trên lane DB dùng chung là bẫy). */
    /**
     * TỔNG hàng link (KHÔNG lọc `deleted_at`). Cần cho ca G8: `countLiveLinks === 0` một mình
     * KHÔNG phân biệt được xoá MỀM với hard-delete — hai thứ cho kết quả y hệt, mà bất biến
     * CLAUDE.md §2 cấm cái sau. (FULL gate 24/09/2026, `database-reviewer` F6.)
     */
    async function countLinks(fileId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM file_links WHERE file_id = $1`,
        [fileId],
      );
      return r.rows[0].n as number;
    }

    /** `deleted_by` của hàng link đã gỡ — vết «ai gỡ» (F3). */
    async function deletedByOf(fileId: string): Promise<string | null> {
      const r = await direct.query(
        `SELECT deleted_by FROM file_links WHERE file_id = $1 AND deleted_at IS NOT NULL LIMIT 1`,
        [fileId],
      );
      return (r.rows[0]?.deleted_by as string | null) ?? null;
    }

    async function countPostUpdateAudit(postId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
          WHERE action = 'social.post.update' AND object_id = $1`,
        [postId],
      );
      return r.rows[0].n as number;
    }

    /** Bài của TÁC GIẢ, kèm một tệp của chính tác giả. */
    async function postWithFile(): Promise<{ postId: string; fileId: string }> {
      const fileId = await seedFile(authorUserId);
      const res = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bài có ảnh",
        attachmentIds: [fileId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return { postId: res.body.data.id as string, fileId };
    }

    /** Bình luận của TÁC GIẢ trên bài của TÁC GIẢ, kèm một tệp. */
    async function commentWithFile(): Promise<{ commentId: string; fileId: string }> {
      const { postId } = await postWithFile();
      const fileId = await seedFile(authorUserId);
      const res = await post(tAuthor, `/social/posts/${postId}/comments`).send({
        body: "bình luận có ảnh",
        attachmentIds: [fileId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return { commentId: res.body.data.id as string, fileId };
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "attgate");
      companyIds.push(A.companyId);

      const author = await makeUser("agauthor", hash, AUTHOR_PAIRS);
      tAuthor = author.token;
      authorUserId = author.userId;
      const mod = await makeUser("agmod", hash, MOD_NOCREATE_PAIRS);
      tMod = mod.token;
      modUserId = mod.userId;
      const modFull = await makeUser("agmodfull", hash, MOD_FULL_PAIRS);
      tModFull = modFull.token;
      modFullUserId = modFull.userId;
      tPostOnly = (await makeUser("agpostonly", hash, POST_ONLY_PAIRS)).token;
      tCommentOnly = (await makeUser("agcommentonly", hash, COMMENT_ONLY_PAIRS)).token;
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length) await cleanupTenants(direct, companyIds);
    });

    // ═══════════ G5/G11 — CA RED CHÍNH: THÊM tệp mới trên đường SỬA ═══════════

    describe("G5/G11 — đường SỬA đòi cặp `create` khi THÊM tệp mới", () => {
      it("G5 DENY 004: kiểm duyệt KHÔNG có create:feed-post THÊM tệp vào bài người khác ⇒ 403", async () => {
        const { postId } = await postWithFile();
        const mine = await seedFile(modUserId);

        const res = await patch(tMod, `/social/posts/${postId}`).send({
          body: "kiểm duyệt thêm ảnh",
          attachmentIds: [mine],
        });

        // Mutant «gỡ cổng» phải ra 200 ở đây. Nếu ra 422 ⇒ tệp gieo SAI CHỦ (F-3), phép đo vô hiệu.
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.FILE_TARGET_POST_DENIED);
        expect(await countLiveLinks(mine), "tệp KHÔNG được link").toBe(0);
      });

      it("G11 DENY 016: cùng vai THÊM tệp vào bình luận người khác ⇒ 403 hằng COMMENT (khác G5)", async () => {
        const { commentId } = await commentWithFile();
        const mine = await seedFile(modUserId);

        const res = await patch(tMod, `/social/comments/${commentId}`).send({
          body: "kiểm duyệt thêm ảnh",
          attachmentIds: [mine],
        });

        expect(res.status, JSON.stringify(res.body)).toBe(403);
        // Hằng KHÁC G5: đổi bảng cặp thành cặp post cố định ⇒ ca này đỏ vì THÔNG ĐIỆP.
        expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.FILE_TARGET_COMMENT_DENIED);
        expect(await countLiveLinks(mine), "tệp KHÔNG được link").toBe(0);
      });
    });

    // ═══════════ G6/G7/G8/G9/G10 — ALLOW đứng cạnh, chống deny-rỗng ═══════════

    describe("G6-G10 — 004: cái gì VẪN phải chạy được", () => {
      it("G6 ALLOW: cùng vai sửa CHỮ (không gửi attachmentIds) ⇒ 200", async () => {
        const { postId, fileId } = await postWithFile();
        const res = await patch(tMod, `/social/posts/${postId}`).send({ body: "chỉ sửa chữ" });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(await countLiveLinks(fileId), "sửa chữ không được làm mất ảnh").toBe(1);
      });

      it("G7 ALLOW: gửi LẠI đúng danh sách hiện có (0 tệp MỚI) ⇒ 200 — ca phân biệt (f) với (a)", async () => {
        const { postId, fileId } = await postWithFile();
        const res = await patch(tMod, `/social/posts/${postId}`).send({
          body: "giữ nguyên ảnh",
          attachmentIds: [fileId],
        });
        // Đổi điều kiện cổng sang «danh sách non-empty» ⇒ ca này ĐỎ (403). Đây là lý do tồn tại của nó.
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(await countLiveLinks(fileId)).toBe(1);
      });

      it("G8 ALLOW: kiểm duyệt GỠ HẾT đính kèm (mảng rỗng) ⇒ 200 — quyền gỡ ảnh vi phạm còn nguyên", async () => {
        const { postId, fileId } = await postWithFile();
        const res = await patch(tMod, `/social/posts/${postId}`).send({
          body: "gỡ ảnh vi phạm",
          attachmentIds: [],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(await countLiveLinks(fileId), "link không còn sống").toBe(0);
        // Hai vế dưới là chỗ ca này THẬT SỰ đo: hard-delete cũng cho `countLiveLinks === 0`.
        expect(await countLinks(fileId), "hàng link vẫn còn — XOÁ MỀM (bất biến §2)").toBe(1);
        expect(await deletedByOf(fileId), "phải ghi AI gỡ (F3)").toBe(modUserId);
      });

      it("G9 ALLOW: vai CÓ create:feed-post THÊM tệp vào bài người khác ⇒ 200 (thứ ép là cặp create)", async () => {
        const { postId } = await postWithFile();
        const mine = await seedFile(modFullUserId);
        const res = await patch(tModFull, `/social/posts/${postId}`).send({
          body: "quản lý có quyền đăng, thêm ảnh",
          attachmentIds: [mine],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(await countLiveLinks(mine)).toBe(1);
      });

      it("G10 ALLOW: TÁC GIẢ sửa bài của mình + thêm tệp mới ⇒ 200 (chống hồi quy đường thường)", async () => {
        const { postId } = await postWithFile();
        const mine = await seedFile(authorUserId);
        const res = await patch(tAuthor, `/social/posts/${postId}`).send({
          body: "tôi thêm ảnh",
          attachmentIds: [mine],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(await countLiveLinks(mine)).toBe(1);
      });
    });

    describe("G12-G14 — 016: cái gì VẪN phải chạy được", () => {
      it("G12 ALLOW: cùng vai sửa CHỮ bình luận người khác ⇒ 200", async () => {
        const { commentId, fileId } = await commentWithFile();
        const res = await patch(tMod, `/social/comments/${commentId}`).send({ body: "sửa chữ" });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(await countLiveLinks(fileId)).toBe(1);
      });

      it("G13 ALLOW: vai CÓ create:feed-comment THÊM tệp vào bình luận người khác ⇒ 200", async () => {
        const { commentId } = await commentWithFile();
        const mine = await seedFile(modFullUserId);
        const res = await patch(tModFull, `/social/comments/${commentId}`).send({
          body: "thêm ảnh",
          attachmentIds: [mine],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(await countLiveLinks(mine)).toBe(1);
      });

      it("G14 ALLOW: TÁC GIẢ sửa bình luận của mình + thêm tệp ⇒ 200", async () => {
        const { commentId } = await commentWithFile();
        const mine = await seedFile(authorUserId);
        const res = await patch(tAuthor, `/social/comments/${commentId}`).send({
          body: "tôi thêm ảnh",
          attachmentIds: [mine],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(await countLiveLinks(mine)).toBe(1);
      });
    });

    // ═══════════ G15 — cú ném nằm TRONG tx ⇒ rollback trọn lượt sửa ═══════════

    describe("G15 — D-7 rollback", () => {
      it("G15: lượt sửa bị từ chối để lại ZERO dấu vết (body · link · audit của CHÍNH bài đó)", async () => {
        const { postId, fileId: oldFile } = await postWithFile();
        const mine = await seedFile(modUserId);
        const auditBefore = await countPostUpdateAudit(postId);
        const bodyBefore = (
          await direct.query(`SELECT body FROM feed_posts WHERE id = $1`, [postId])
        ).rows[0].body as string;

        const res = await patch(tMod, `/social/posts/${postId}`).send({
          body: "THÂN BÀI MỚI KHÔNG ĐƯỢC GHI",
          attachmentIds: [oldFile, mine],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);

        const bodyAfter = (
          await direct.query(`SELECT body FROM feed_posts WHERE id = $1`, [postId])
        ).rows[0].body as string;
        // Ném NGOÀI tx ⇒ body đã bị ghi đè ⇒ ca này đỏ ở đúng vế này.
        expect(bodyAfter, "body KHÔNG được đổi — tx phải roll back trọn").toBe(bodyBefore);
        expect(await countLiveLinks(mine), "tệp mới KHÔNG được link").toBe(0);
        expect(await countLiveLinks(oldFile), "tệp cũ phải CÒN SỐNG").toBe(1);
        expect(await countPostUpdateAudit(postId), "không được đẻ dòng audit").toBe(auditBefore);
      });
    });

    // ═══════════ G16/G17 — đường XOÁ KHÔNG bị siết (đính chính 017 vs 016) ═══════════

    describe("G16/G17 — D-8: 005/017 không đi qua cổng", () => {
      it("G17: kiểm duyệt XOÁ bài người khác ⇒ 200 (005 không gọi syncLinksTx)", async () => {
        const { postId } = await postWithFile();
        const res = await del(tMod, `/social/posts/${postId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("G16: kiểm duyệt XOÁ bình luận người khác ⇒ 200 (017 là DELETE, KHÔNG bị siết)", async () => {
        const { commentId } = await commentWithFile();
        const res = await del(tMod, `/social/comments/${commentId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });
    });

    // ═══════════ G18 — thứ tự cổng: quyền TRƯỚC sở hữu ═══════════

    describe("G18 — cổng quyền chạy TRƯỚC vế sở hữu", () => {
      it("G18: vai thiếu cặp create gắn tệp của NGƯỜI KHÁC ⇒ 403 (KHÔNG phải 422)", async () => {
        const { postId } = await postWithFile();
        const foreign = await seedFile(authorUserId);

        const res = await patch(tMod, `/social/posts/${postId}`).send({
          body: "tệp người khác",
          attachmentIds: [foreign],
        });
        // Đảo thứ tự trong `syncLinksTx` ⇒ 422 ⇒ ca này đỏ. ALLOW-đối-chứng của nó nằm ở
        // `social-be1-attachments.int-spec.ts:445-457` (vai CÓ cặp create ⇒ 422 vì sở hữu).
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.FILE_TARGET_POST_DENIED);
      });
    });

    // ═══════════ G2/G4 — đường TẠO: cặp bị ép ở CẢ HAI tầng (F-4) ═══════════

    describe("G2/G4 — đường TẠO giữ nguyên, và ai ép nó", () => {
      it("G2 DENY 002: vai chỉ có create:feed-comment tạo BÀI ⇒ 403 chặn ở GUARD (tầng 1)", async () => {
        const res = await post(tCommentOnly, "/social/posts").send({
          type: "share",
          audience: "company",
          body: "không được đăng",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        // Assert THÔNG ĐIỆP để tách tầng: `resolveActor` (tầng 2) ném chuỗi KHÁC hẳn, nên một
        // assert «403» trần sẽ xanh trong cả hai thế giới (plan F-4).
        expect(JSON.stringify(res.body)).toContain("Permission denied");
      });

      it("G4 DENY 015: vai chỉ có create:feed-post tạo BÌNH LUẬN ⇒ 403 chặn ở GUARD (tầng 1)", async () => {
        const { postId } = await postWithFile();
        const res = await post(tPostOnly, `/social/posts/${postId}/comments`).send({
          body: "không được bình luận",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain("Permission denied");
      });

      it("G1/G3 ALLOW: tác giả tạo bài + bình luận kèm tệp của mình ⇒ 201 + link THẬT", async () => {
        const { commentId, fileId } = await commentWithFile();
        expect(commentId).toBeTruthy();
        expect(await countLiveLinks(fileId)).toBe(1);
      });
    });
  },
);
