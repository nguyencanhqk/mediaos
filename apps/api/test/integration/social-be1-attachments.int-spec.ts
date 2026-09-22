/**
 * S16-SOCIAL-BE-1 — đính kèm ảnh/video (plan §2 D18 · §5 R27/R28/R29).
 *
 * ┌─ CA QUAN TRỌNG NHẤT Ở ĐÂY LÀ R28, VÀ NÓ KHÔNG PHẢI VỀ ROUTE SOCIAL ────────────────────────────┐
 * │ Bài `hidden`/`org_unit` đã 404 ở đường REST của SOCIAL (đo ở `social-be1-visibility`). Lỗ THẬT  │
 * │ nằm ở **đường tải của FOUNDATION** (`GET /foundation/files/:id/download-url`): nó gác bằng cặp  │
 * │ `download:foundation-file`, KHÔNG biết gì về bài. Thứ duy nhất nối hai thế giới là               │
 * │ `SocialFileResolver` — và nếu nó không chạy `visiblePostCondition`, thì "cửa bài" khoá mà "cửa   │
 * │ tệp" vẫn mở (memory `read-path-gate-pair-must-match-download-pair`).                            │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
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
const LOGIN_PW = "Passw0rd!socialatt1";

/**
 * ⚠️ `manage:feed-post` CÓ CHỦ ĐÍCH chỉ nằm ở bộ của CHỦ THỂ. Cấp nó cho `tPeer` sẽ làm ca R28
 * DENY xanh-giả theo chiều NGƯỢC: peer thấy được bài `hidden` một cách hợp lệ, resolver cho qua
 * ĐÚNG, và ta sẽ tưởng cổng đường-tải bị thủng trong khi nó đang chạy chuẩn.
 */
const OWNER_PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "manage:feed-post",
  "download:foundation-file",
  "view:foundation-file",
] as const;

const PEER_PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "download:foundation-file",
  "view:foundation-file",
] as const;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-1 đính kèm — gate LINK + gate ĐỌC (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let tOwner = "";
  let tPeer = "";
  let ownerUserId = "";
  let peerUserId = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));

  /** Một hàng `files` đã Uploaded+Clean, thuộc `ownerUserId`. Gieo tay — ta đang đo GATE, không đo upload. */
  async function seedFile(
    owner: string,
    opts: { mime?: string; size?: number } = {},
  ): Promise<string> {
    const id = randomUUID();
    await direct.query(
      `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
                          storage_provider, storage_path, upload_status, scan_status,
                          owner_user_id, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,'MinIO',$7,'Uploaded','Clean',$8,$8)`,
      [
        id,
        A.companyId,
        `f-${id.slice(0, 6)}.png`,
        `stored-${id}`,
        opts.mime ?? "image/png",
        opts.size ?? 1024,
        // ⚠️ Khoá lưu trữ PHẢI bắt đầu bằng `<companyId>/` — `assertKeyInTenant` (storage-key.ts:107)
        // từ chối mọi khoá ngoài tiền tố tenant, và lỗi đó nổ ở tầng STORAGE (500) TRƯỚC khi ta kịp
        // đọc được kết luận của policy ⇒ ca test nói sai chỗ hỏng.
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
    const roleId = await seedRole(direct, A.companyId, `socatt-${randomUUID().slice(0, 8)}`);
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "socatt");
    companyIds.push(A.companyId);

    const owner = await makeUser("attowner", hash, OWNER_PAIRS);
    tOwner = owner.token;
    ownerUserId = owner.userId;
    const peer = await makeUser("attpeer", hash, PEER_PAIRS);
    tPeer = peer.token;
    peerUserId = peer.userId;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ══════════════ R27 — LINK chỉ tệp của CHÍNH MÌNH ══════════════

  describe("R27 — gate LINK", () => {
    it("DENY: gắn tệp của NGƯỜI KHÁC ⇒ 422, và KHÔNG tạo bài lẫn link", async () => {
      const foreign = await seedFile(peerUserId);
      const before = await countPosts();

      const res = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "mượn tệp người khác",
        attachmentIds: [foreign],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-007");

      // Cả transaction phải rollback — bài KHÔNG được tồn tại mà thiếu đính kèm.
      expect(await countPosts(), "transaction phải rollback trọn vẹn").toBe(before);
      expect(await countLinks(foreign)).toBe(0);
    });

    it("ALLOW đối chứng: gắn tệp của CHÍNH MÌNH ⇒ 201 + link THẬT", async () => {
      const mine = await seedFile(ownerUserId);
      const res = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "tệp của tôi",
        attachmentIds: [mine],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.attachments.length).toBe(1);
      expect(res.body.data.attachments[0].fileId).toBe(mine);
      expect(res.body.data.attachments[0].kind, "kind suy từ mime ở SERVER").toBe("image");
      expect(await countLinks(mine)).toBe(1);
    });

    it("DENY: tệp ĐÃ TỪNG có link ⇒ 422 (đóng đường tái-link để phục hồi tệp đã thu hồi)", async () => {
      const f = await seedFile(ownerUserId);
      const first = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "lần 1",
        attachmentIds: [f],
      });
      expect(first.status).toBe(201);

      const second = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "lần 2 — tái dùng tệp",
        attachmentIds: [f],
      });
      expect(second.status, JSON.stringify(second.body)).toBe(422);
    });

    it("DENY: tệp `upload_status='Pending'` ⇒ 422 (gắn placeholder chưa có bytes)", async () => {
      const id = randomUUID();
      await direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
                            storage_provider, storage_path, upload_status, scan_status,
                            owner_user_id, uploaded_by)
         VALUES ($1,$2,'p.png','sp','image/png',10,'MinIO',$3,'Pending','Clean',$4,$4)`,
        [id, A.companyId, `${A.companyId}/social/${id}`, ownerUserId],
      );
      const res = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "tệp pending",
        attachmentIds: [id],
      });
      expect(res.status).toBe(422);
    });

    it("DENY: `fileId` KHÔNG TỒN TẠI ⇒ 422, cùng thông điệp (không phân biệt với 'không phải của bạn')", async () => {
      const res = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "tệp ma",
        attachmentIds: [randomUUID()],
      });
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-007");
    });
  });

  // ══════════════ R29 — giới hạn SPEC-16 §16 ══════════════

  describe("R29 — giới hạn số lượng / dung lượng", () => {
    it("DENY: >10 ảnh ⇒ 400 ở DTO (trần mảng) — chặn TRƯỚC khi chạm DB", async () => {
      const ids = await Promise.all(Array.from({ length: 12 }, () => seedFile(ownerUserId)));
      const res = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "quá nhiều ảnh",
        attachmentIds: ids,
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(400);
    });

    it("DENY: 11 ảnh (lọt trần mảng 11) ⇒ 422 ở service (trần ẢNH là 10)", async () => {
      const ids = await Promise.all(Array.from({ length: 11 }, () => seedFile(ownerUserId)));
      const res = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "11 ảnh",
        attachmentIds: ids,
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-007");
    });

    it("DENY: 2 video ⇒ 422 (trần VIDEO là 1)", async () => {
      const ids = await Promise.all([
        seedFile(ownerUserId, { mime: "video/mp4" }),
        seedFile(ownerUserId, { mime: "video/mp4" }),
      ]);
      const res = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "2 video",
        attachmentIds: ids,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
    });

    it("DENY: tệp > 20MB ⇒ 422", async () => {
      const big = await seedFile(ownerUserId, { size: 20 * 1024 * 1024 + 1 });
      const res = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "tệp quá lớn",
        attachmentIds: [big],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
    });

    it("ALLOW đối chứng: ĐÚNG giới hạn (10 ảnh + 1 video, mỗi tệp ≤20MB) ⇒ 201", async () => {
      const ids = [
        ...(await Promise.all(Array.from({ length: 10 }, () => seedFile(ownerUserId)))),
        await seedFile(ownerUserId, { mime: "video/mp4", size: 20 * 1024 * 1024 }),
      ];
      const res = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "đúng giới hạn",
        attachmentIds: ids,
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      expect(res.body.data.attachments.length).toBe(11);
    });
  });

  // ══════════════ R28 — ĐƯỜNG TẢI FOUNDATION không lách được cổng bài ══════════════

  describe("R28 — cổng ĐƯỜNG TẢI = cổng MÀN HÌNH", () => {
    let hiddenPostFileId = "";
    let visiblePostFileId = "";

    beforeAll(async () => {
      visiblePostFileId = await seedFile(ownerUserId);
      const visible = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bài công khai có tệp",
        attachmentIds: [visiblePostFileId],
      });
      expect(visible.status, JSON.stringify(visible.body)).toBe(201);

      hiddenPostFileId = await seedFile(ownerUserId);
      const hidden = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bài sẽ ẩn có tệp",
        attachmentIds: [hiddenPostFileId],
      });
      expect(hidden.status, JSON.stringify(hidden.body)).toBe(201);
      expect(
        (
          await patch(tOwner, `/social/posts/${hidden.body.data.id}/moderation`).send({
            hidden: true,
          })
        ).status,
      ).toBe(200);
    });

    it("DENY: người thường tải tệp của bài `hidden` qua ĐƯỜNG FOUNDATION ⇒ 403/404", async () => {
      // ⚠️ Đây là lỗ mà `SocialFileResolver` sinh ra để bịt. Cặp `download:foundation-file` mà actor
      // CÓ sẵn là đủ cho route này; thứ duy nhất chặn là resolver chạy `visiblePostCondition`.
      const res = await get(tPeer, `/foundation/files/${hiddenPostFileId}/download-url`);
      expect([403, 404]).toContain(res.status);
    });

    it("ALLOW đối chứng: CÙNG route, tệp của bài THẤY ĐƯỢC ⇒ không bị resolver từ chối", async () => {
      // Neo chống-xanh-rỗng: nếu route này từ chối MỌI tệp SOCIAL (vd resolver chưa đăng ký ⇒
      // `deny-no-resolver`), ca deny ở trên sẽ xanh vì lý do hoàn toàn khác.
      const res = await get(tPeer, `/foundation/files/${visiblePostFileId}/download-url`);
      // Assert 200 + CÓ URL, KHÔNG phải `không-nằm-trong-[403,404]`: dạng phủ định đó coi 500 là
      // "đạt", và một lỗi 500 ở tầng storage đã từng làm ca này xanh trong khi policy chưa hề chạy.
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(typeof res.body.data.url).toBe("string");
    });

    it("TÁC GIẢ vẫn tải được tệp của chính bài `hidden` của mình", async () => {
      const res = await get(tOwner, `/foundation/files/${hiddenPostFileId}/download-url`);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(typeof res.body.data.url).toBe("string");
    });
  });

  // ══════════════ 016 — đính kèm trên ĐƯỜNG SỬA bình luận (FULL gate #530) ══════════════

  /**
   * `SOCIAL-API-016` `PATCH /social/comments/{id}` — route này TRƯỚC ĐÂY không có MỘT ca test HTTP
   * nào, và `update()` bỏ rơi `dto.attachmentIds` TRONG IM LẶNG: DTO `.strict()` KHAI BÁO trường đó
   * (`social-api.ts` `updateFeedCommentSchema`) nên client gửi lên được 200 sạch, không lỗi, không
   * log — mà tập đính kèm KHÔNG HỀ đổi. D18 liệt kê 016 trong nhóm phải đồng bộ (002/004/015/016).
   *
   * ⚠️ VÌ SAO `route-http-coverage` KHÔNG bắt được lỗ này: nó quét TĨNH ở CẤP FILE — gom tập verb và
   * tập path riêng rẽ rồi giao nhau. `social-be1-content.int-spec.ts` có `.patch(` (route 004) VÀ có
   * chuỗi `/social/comments/${x}` (ca DELETE) ⇒ 016 được TÍNH là "covered" dù chưa ai PATCH nó lần
   * nào. Đúng chiều false-positive mà docblock của chính cổng đó cảnh báo là "SAI CHIỀU NGUY HIỂM".
   */
  describe("016 — sửa bình luận: đính kèm đồng bộ THẬT + gate vẫn chạy trên đường sửa", () => {
    let postId = "";

    beforeAll(async () => {
      const p = await post(tOwner, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bài chứa bình luận có đính kèm",
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      postId = p.body.data.id;
    });

    /** Bình luận của `tOwner` mang sẵn 1 tệp đính kèm. */
    async function commentWithFile(): Promise<{
      commentId: string;
      fileId: string;
    }> {
      const fileId = await seedFile(ownerUserId);
      const c = await post(tOwner, `/social/posts/${postId}/comments`).send({
        body: "bình luận có ảnh",
        attachmentIds: [fileId],
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      expect(await countLiveLinks(fileId)).toBe(1);
      return { commentId: c.body.data.id, fileId };
    }

    it("THAY đính kèm: tệp MỚI được link, tệp CŨ bị gỡ — không phải 200 rỗng", async () => {
      const { commentId, fileId: oldFile } = await commentWithFile();
      const newFile = await seedFile(ownerUserId);

      const res = await patch(tOwner, `/social/comments/${commentId}`).send({
        body: "sửa + đổi ảnh",
        attachmentIds: [newFile],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      // Hai vế này là CHÍNH ca: bản trước để cả hai sai cùng lúc (mới=0, cũ=1) mà vẫn trả 200.
      expect(await countLiveLinks(newFile), "tệp MỚI phải được link").toBe(1);
      expect(await countLiveLinks(oldFile), "tệp CŨ phải bị gỡ link").toBe(0);
      // …và gỡ bằng XOÁ MỀM, không hard-delete (bất biến §2): hàng vẫn còn để vế 5 còn đo được.
      expect(await countLinks(oldFile), "hàng link cũ vẫn còn — xoá mềm").toBe(1);
    });

    it("attachmentIds mảng RỖNG = BỎ HẾT đính kèm (không được coi là 'không đề cập')", async () => {
      const { commentId, fileId } = await commentWithFile();
      const res = await patch(tOwner, `/social/comments/${commentId}`).send({
        body: "bỏ hết ảnh",
        attachmentIds: [],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await countLiveLinks(fileId)).toBe(0);
    });

    it("KHÔNG gửi attachmentIds ⇒ giữ nguyên tập đính kèm (sửa chữ không được làm mất ảnh)", async () => {
      const { commentId, fileId } = await commentWithFile();
      const res = await patch(tOwner, `/social/comments/${commentId}`).send({
        body: "chỉ sửa chữ",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await countLiveLinks(fileId)).toBe(1);
    });

    it("DENY: đường SỬA cũng chạy gate LINK — gắn tệp của NGƯỜI KHÁC ⇒ 422, tệp cũ GIỮ nguyên", async () => {
      const { commentId, fileId: mine } = await commentWithFile();
      const foreign = await seedFile(peerUserId);

      const res = await patch(tOwner, `/social/comments/${commentId}`).send({
        body: "thử gắn tệp người khác",
        attachmentIds: [foreign],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(await countLinks(foreign), "tệp ngoại lai KHÔNG được link").toBe(0);
      // Tx phải roll back trọn: không được gỡ tệp cũ RỒI mới vấp gate ⇒ mất trắng đính kèm.
      expect(await countLiveLinks(mine), "tệp cũ phải CÒN SỐNG — tx roll back trọn").toBe(1);
    });

    it("DENY: người KHÁC (không manage:feed-post) sửa bình luận của tôi ⇒ 403 SOCIAL-ERR-003", async () => {
      const { commentId } = await commentWithFile();
      const res = await patch(tPeer, `/social/comments/${commentId}`).send({
        body: "tôi sửa hộ",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-003");
    });

    it("ALLOW đối chứng: manage:feed-post sửa được bình luận của người khác", async () => {
      // Neo chống-xanh-rỗng cho ca DENY ngay trên: nếu 016 từ chối MỌI ai thì ca đó vẫn xanh.
      const c = await post(tPeer, `/social/posts/${postId}/comments`).send({
        body: "bình luận của peer",
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      const res = await patch(tOwner, `/social/comments/${c.body.data.id}`).send({
        body: "quản lý sửa",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.body).toBe("quản lý sửa");
    });
  });
  async function countPosts(): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM feed_posts WHERE company_id = $1`,
      [A.companyId],
    );
    return Number(r.rows[0].n);
  }

  async function countLinks(fileId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM file_links WHERE company_id = $1 AND file_id = $2`,
      [A.companyId, fileId],
    );
    return Number(r.rows[0].n);
  }

  /**
   * Link CÒN SỐNG. Tách khỏi `countLinks` CÓ CHỦ ĐÍCH: `syncLinksTx` gỡ link bằng **xoá mềm**
   * (`deleted_at`, bất biến CLAUDE.md §2 "không hard-delete"), nên hàng vẫn nằm đó — và `countLinks`
   * PHẢI tiếp tục đếm cả hàng đã gỡ vì nó là phép đo của vế 5 ("tệp ĐÃ TỪNG có link" ⇒ 422). Đo
   * "đã gỡ chưa" bằng `countLinks` là đo sai cột: nó không bao giờ về 0.
   */
  async function countLiveLinks(fileId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM file_links
        WHERE company_id = $1 AND file_id = $2 AND deleted_at IS NULL`,
      [A.companyId, fileId],
    );
    return Number(r.rows[0].n);
  }
});
