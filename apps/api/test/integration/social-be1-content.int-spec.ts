/**
 * S16-SOCIAL-BE-1 — quy tắc NỘI DUNG: bình luận 1 cấp · khoá bình luận · bộ đếm atomic · xoá mềm ⇄
 * khôi phục · mention bỏ-im-lặng + outbox NOTI · mass-assignment · trần độ dài · idempotency.
 * (plan §5 R8/R9/R14/R15/R17/R18/R19/R20/R21/R25/R30 · §6.)
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
import { DatabaseService } from "../../src/db/db.service";
import { restorePostTx } from "../../src/social/social-counters";
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
const LOGIN_PW = "Passw0rd!socialcnt1";

const PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "manage:feed-post",
  "manage:feed-news",
] as const;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-1 quy tắc nội dung + bộ đếm (DB cô lập)", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let tAuthor = "";
  let tPeer = "";
  let tThird = "";
  let peerUserId = "";
  let thirdUserId = "";
  let outsiderUserId = "";

  let postId = "";
  let orgUnitId = "";
  let unitId = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const put = (t: string, u: string) => auth(t)(http().put(u));
  const del = (t: string, u: string) => auth(t)(http().delete(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));

  async function makeUser(
    label: string,
    hash: string,
    unit: string | null,
  ): Promise<{ token: string; userId: string }> {
    const email = `${label}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, 'active', 'offline', $4)`,
      [A.companyId, userId, unit, `EMP-${randomUUID().slice(0, 6)}`],
    );
    const roleId = await seedRole(direct, A.companyId, `soccnt-${randomUUID().slice(0, 8)}`);
    for (const key of PAIRS) {
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
    // ⚠️ BẮT BUỘC vì ca R17 chạy 3 request supertest trong MỘT `Promise.all`: không có server đang
    // lắng nghe, supertest tự dựng server tạm cho TỪNG request trên CÙNG một app, và response ĐẦU
    // TIÊN về sẽ đóng server dùng chung ⇒ hai request kia đứt giữa chừng (memory
    // `supertest-closes-shared-server-on-first-response`). Cổng `supertest-listen-ratchet` ép dòng này.
    // KHÔNG được "sửa" bằng cách đổi Promise.all thành vòng await tuần tự — chạy tuần tự thì ca R17
    // không còn đo được lost-update nữa, tức mất đúng thứ nó sinh ra để đo.
    await app.listen(0);
    db = app.get(DatabaseService);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "soccnt");
    companyIds.push(A.companyId);

    const u = await direct.query(
      `INSERT INTO org_units (company_id, name, status) VALUES ($1, 'Tổ A', 'active') RETURNING id`,
      [A.companyId],
    );
    unitId = u.rows[0].id;
    const u2 = await direct.query(
      `INSERT INTO org_units (company_id, name, status) VALUES ($1, 'Tổ B', 'active') RETURNING id`,
      [A.companyId],
    );
    orgUnitId = u2.rows[0].id;

    const author = await makeUser("cauthor", hash, unitId);
    tAuthor = author.token;
    const peer = await makeUser("cpeer", hash, unitId);
    tPeer = peer.token;
    peerUserId = peer.userId;
    const third = await makeUser("cthird", hash, unitId);
    tThird = third.token;
    thirdUserId = third.userId;
    // Người thuộc đơn vị KHÁC — dùng cho ca mention-ngoài-audience.
    const outsider = await makeUser("coutsider", hash, orgUnitId);
    outsiderUserId = outsider.userId;

    const p = await post(tAuthor, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài gốc để bình luận",
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    postId = p.body.data.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ══════════════ R8 / R9 — luật bình luận ══════════════

  describe("R8/R9 — khoá bình luận & một cấp", () => {
    it("R9 DENY: trả lời vào một TRẢ LỜI ⇒ 422 SOCIAL-ERR-005", async () => {
      const root = await post(tPeer, `/social/posts/${postId}/comments`).send({ body: "gốc" });
      expect(root.status).toBe(201);
      const reply = await post(tPeer, `/social/posts/${postId}/comments`).send({
        body: "trả lời cấp 1",
        parentCommentId: root.body.data.id,
      });
      expect(reply.status, JSON.stringify(reply.body)).toBe(201);

      const deep = await post(tPeer, `/social/posts/${postId}/comments`).send({
        body: "trả lời cấp 2",
        parentCommentId: reply.body.data.id,
      });
      expect(deep.status, JSON.stringify(deep.body)).toBe(422);
      expect(JSON.stringify(deep.body)).toContain("SOCIAL-ERR-005");
    });

    it("R9 ALLOW đối chứng: trả lời vào bình luận GỐC ⇒ 201 (1 cấp hợp lệ)", async () => {
      const root = await post(tPeer, `/social/posts/${postId}/comments`).send({ body: "gốc 2" });
      const reply = await post(tThird, `/social/posts/${postId}/comments`).send({
        body: "trả lời hợp lệ",
        parentCommentId: root.body.data.id,
      });
      expect(reply.status, JSON.stringify(reply.body)).toBe(201);
      expect(reply.body.data.parentCommentId).toBe(root.body.data.id);
    });

    it("DENY: `parentCommentId` thuộc bài KHÁC ⇒ 404 (không đẻ bình luận mồ côi trỏ chéo bài)", async () => {
      const other = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "Bài khác",
      });
      const foreign = await post(tAuthor, `/social/posts/${other.body.data.id}/comments`).send({
        body: "bình luận bài khác",
      });
      expect(foreign.status).toBe(201);

      const res = await post(tPeer, `/social/posts/${postId}/comments`).send({
        body: "trỏ chéo bài",
        parentCommentId: foreign.body.data.id,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("R8 DENY: bài đã KHOÁ bình luận ⇒ 409 SOCIAL-ERR-004", async () => {
      const locked = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "Bài sẽ khoá bình luận",
      });
      const lid = locked.body.data.id as string;
      expect(
        (await patch(tAuthor, `/social/posts/${lid}/moderation`).send({ commentsLocked: true }))
          .status,
      ).toBe(200);

      const res = await post(tPeer, `/social/posts/${lid}/comments`).send({ body: "thử" });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-004");

      // ALLOW đối chứng: mở khoá rồi bình luận ⇒ 201.
      expect(
        (await patch(tAuthor, `/social/posts/${lid}/moderation`).send({ commentsLocked: false }))
          .status,
      ).toBe(200);
      expect((await post(tPeer, `/social/posts/${lid}/comments`).send({ body: "ok" })).status).toBe(
        201,
      );
    });
  });

  // ══════════════ R14 / R15 / R30 — biên DTO ══════════════

  describe("R14/R15/R30 — biên DTO của `POST /social/posts`", () => {
    it("R14 DENY: `type='poll'` (thuộc BE-2) ⇒ 400 Zod, KHÔNG 500, KHÔNG tạo hàng", async () => {
      const before = await countPosts();
      for (const type of ["poll", "idea", "kudos"]) {
        const res = await post(tAuthor, "/social/posts").send({
          type,
          audience: "company",
          body: "x",
        });
        expect(res.status, `${type}: ${JSON.stringify(res.body)}`).toBe(400);
      }
      expect(await countPosts()).toBe(before);
    });

    it("R15 DENY: body mang `status`/`pinned`/`likeCount` ⇒ 400 (allowlist `.strict()`)", async () => {
      const res = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "mass assignment",
        status: "published",
        pinned: true,
        likeCount: 999,
      });
      // `.strict()` TỪ CHỐI khoá lạ thay vì im lặng bỏ qua — người gửi biết ngay là nó không có tác dụng.
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it("R15 ALLOW đối chứng: CÙNG payload BỎ 3 khoá đó ⇒ 201 với default ĐÚNG", async () => {
      const res = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "mass assignment (đã bỏ khoá lạ)",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.pinned).toBe(false);
      expect(res.body.data.likeCount).toBe(0);
      expect(res.body.data.commentCount).toBe(0);
      expect(res.body.data.viewCount).toBe(0);
      expect(res.body.data.status).toBe("published");
    });

    it("R30 DENY: `body` vượt 4000 ký tự ⇒ 400 (trần sản phẩm, mirror chat.ts:323)", async () => {
      const res = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "x".repeat(4001),
      });
      expect(res.status).toBe(400);
    });

    it("R30 ALLOW đối chứng: đúng 4000 ký tự ⇒ 201", async () => {
      const res = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "y".repeat(4000),
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(201);
    });

    it("R30 — trần cũng áp cho BÌNH LUẬN", async () => {
      expect(
        (await post(tPeer, `/social/posts/${postId}/comments`).send({ body: "z".repeat(4001) }))
          .status,
      ).toBe(400);
      expect(
        (await post(tPeer, `/social/posts/${postId}/comments`).send({ body: "z".repeat(4000) }))
          .status,
      ).toBe(201);
    });

    it("`body` toàn khoảng trắng ⇒ 400 (trim rồi mới đo `min(1)`)", async () => {
      const res = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "   \n  ",
      });
      expect(res.status).toBe(400);
    });
  });

  // ══════════════ R25 — hashtag ══════════════

  it("R25 — hashtag tiếng Việt CÓ DẤU lưu đúng, lowercase, `usage_count` tăng", async () => {
    const res = await post(tAuthor, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Thông báo #TuyểnDụng đợt mới #q4",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.tags.sort()).toEqual(["q4", "tuyểndụng"]);

    const rows = await direct.query(
      `SELECT tag, usage_count FROM feed_tags WHERE company_id = $1 AND tag = 'tuyểndụng'`,
      [A.companyId],
    );
    expect(rows.rows.length).toBe(1);
    expect(Number(rows.rows[0].usage_count)).toBeGreaterThan(0);
  });

  // ══════════════ R19 / §6 — mention bỏ im lặng + outbox NOTI ══════════════

  describe("R19 / §6 — mention & outbox", () => {
    it("DENY-mềm: mention người NGOÀI audience ⇒ 201 + `droppedMentions[]` + 0 hàng mention", async () => {
      const res = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "org_unit",
        orgUnitId: unitId,
        body: "Bài của Tổ A",
        mentionedUserIds: [outsiderUserId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.droppedMentions.length).toBe(1);

      const rows = await direct.query(
        `SELECT count(*)::int AS n FROM feed_mentions
          WHERE target_id = $1 AND mentioned_user_id = $2`,
        [res.body.data.id, outsiderUserId],
      );
      expect(rows.rows[0].n, "mention ngoài audience KHÔNG được ghi").toBe(0);
    });

    it("ALLOW đối chứng: mention người TRONG audience ⇒ hàng mention THẬT + outbox `social.mentioned`", async () => {
      const res = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "org_unit",
        orgUnitId: unitId,
        body: "Bài của Tổ A (mention hợp lệ)",
        mentionedUserIds: [peerUserId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.droppedMentions).toEqual([]);

      const mentions = await direct.query(
        `SELECT mentioned_user_id FROM feed_mentions WHERE target_id = $1`,
        [res.body.data.id],
      );
      expect(mentions.rows.map((r) => r.mentioned_user_id)).toEqual([peerUserId]);

      const outbox = await direct.query(
        `SELECT payload FROM outbox_events
          WHERE company_id = $1 AND event_type = 'social.mentioned'
            AND payload->>'targetId' = $2`,
        [A.companyId, res.body.data.id],
      );
      expect(outbox.rows.length, "phải có ĐÚNG 1 event cho 1 người được nhắc").toBe(1);
      // Biến template PHẢI khớp `variables_schema` của 0581 — thiếu là NOTI dead-letter câm.
      const payload = outbox.rows[0].payload;
      expect(payload.actor_name).toBeTruthy();
      expect(payload.post_id).toBe(res.body.data.id);
      expect(payload.target_type_label).toBe("bài viết");
      // KHÔNG nội dung bài trong payload NOTI (kênh khác, không qua vị từ visibility nào).
      expect(JSON.stringify(payload)).not.toContain("mention hợp lệ");
    });

    it("TỰ nhắc CHÍNH MÌNH bị bỏ (không ai cần thông báo về việc mình vừa gõ tên mình)", async () => {
      const me = await direct.query(`SELECT id FROM users WHERE company_id = $1 AND email = $2`, [
        A.companyId,
        `cauthor@${A.slug}.test`,
      ]);
      const res = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "tự nhắc",
        mentionedUserIds: [me.rows[0].id],
      });
      expect(res.status).toBe(201);
      expect(res.body.data.droppedMentions.length).toBe(1);
    });

    it("bình luận vào bài NGƯỜI KHÁC ⇒ outbox `social.post_commented`; tự bình luận bài mình ⇒ KHÔNG", async () => {
      const c = await post(tPeer, `/social/posts/${postId}/comments`).send({ body: "chúc mừng" });
      expect(c.status).toBe(201);
      const hit = await direct.query(
        `SELECT count(*)::int AS n FROM outbox_events
          WHERE company_id = $1 AND event_type = 'social.post_commented'
            AND payload->>'commentId' = $2`,
        [A.companyId, c.body.data.id],
      );
      expect(hit.rows[0].n).toBe(1);

      const own = await post(tAuthor, `/social/posts/${postId}/comments`).send({ body: "tự nói" });
      expect(own.status).toBe(201);
      const none = await direct.query(
        `SELECT count(*)::int AS n FROM outbox_events
          WHERE company_id = $1 AND event_type = 'social.post_commented'
            AND payload->>'commentId' = $2`,
        [A.companyId, own.body.data.id],
      );
      expect(none.rows[0].n).toBe(0);
    });

    it("trả lời bình luận NGƯỜI KHÁC ⇒ outbox `social.comment_replied`", async () => {
      const root = await post(tPeer, `/social/posts/${postId}/comments`).send({
        body: "gốc reply",
      });
      const reply = await post(tThird, `/social/posts/${postId}/comments`).send({
        body: "trả lời",
        parentCommentId: root.body.data.id,
      });
      expect(reply.status).toBe(201);
      const rows = await direct.query(
        `SELECT payload FROM outbox_events
          WHERE company_id = $1 AND event_type = 'social.comment_replied'
            AND payload->>'commentId' = $2`,
        [A.companyId, reply.body.data.id],
      );
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].payload.parentAuthorUserId).toBe(peerUserId);
    });

    it("SỬA bài giữ nguyên mention cũ ⇒ KHÔNG bắn lại thông báo (mỗi lần Lưu không đẻ 1 NOTI)", async () => {
      const created = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bài có mention",
        mentionedUserIds: [thirdUserId],
      });
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;

      const countFor = async () =>
        Number(
          (
            await direct.query(
              `SELECT count(*)::int AS n FROM outbox_events
                WHERE company_id = $1 AND event_type = 'social.mentioned'
                  AND payload->>'targetId' = $2`,
              [A.companyId, id],
            )
          ).rows[0].n,
        );
      expect(await countFor()).toBe(1);

      const edited = await patch(tAuthor, `/social/posts/${id}`).send({
        body: "bài có mention (đã sửa)",
        mentionedUserIds: [thirdUserId],
      });
      expect(edited.status).toBe(200);
      expect(await countFor(), "mention CŨ không được bắn lại").toBe(1);
    });
  });

  // ══════════════ R17 / R18 — bộ đếm ══════════════

  describe("R17/R18 — bộ đếm atomic & xoá mềm ⇄ khôi phục", () => {
    it("R17 — N lượt thích ĐỒNG THỜI ⇒ `like_count` BẰNG ĐÚNG `COUNT(*)` (không lost update)", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "đếm đồng thời",
      });
      const id = p.body.data.id as string;

      // Ba request chồng nhau THẬT (Promise.all), không tuần tự.
      const results = await Promise.all([
        put(tAuthor, `/social/posts/${id}/reaction`).send({ emoji: "like" }),
        put(tPeer, `/social/posts/${id}/reaction`).send({ emoji: "love" }),
        put(tThird, `/social/posts/${id}/reaction`).send({ emoji: "haha" }),
      ]);
      for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);

      const row = await direct.query(
        `SELECT p.like_count,
                (SELECT count(*) FROM feed_reactions r
                  WHERE r.company_id = p.company_id AND r.target_type = 'post' AND r.target_id = p.id)
                  AS actual
           FROM feed_posts p WHERE p.id = $1`,
        [id],
      );
      expect(Number(row.rows[0].like_count)).toBe(Number(row.rows[0].actual));
      expect(Number(row.rows[0].actual)).toBe(3);
    });

    it("gỡ cảm xúc giảm đúng 1; gỡ LẦN HAI là no-op (không âm)", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "gỡ cảm xúc",
      });
      const id = p.body.data.id as string;
      await put(tPeer, `/social/posts/${id}/reaction`).send({ emoji: "like" });
      expect((await del(tPeer, `/social/posts/${id}/reaction`)).status).toBe(200);
      expect((await del(tPeer, `/social/posts/${id}/reaction`)).status).toBe(200);

      const row = await direct.query(`SELECT like_count FROM feed_posts WHERE id = $1`, [id]);
      expect(Number(row.rows[0].like_count)).toBe(0);
    });

    it("lượt xem ghi LẦN ĐẦU; reload KHÔNG tăng và KHÔNG đẩy `last_activity_at`", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "đếm lượt xem",
      });
      const id = p.body.data.id as string;
      const before = await direct.query(`SELECT last_activity_at FROM feed_posts WHERE id = $1`, [
        id,
      ]);

      expect((await post(tPeer, `/social/posts/${id}/view`)).status).toBe(201);
      expect((await post(tPeer, `/social/posts/${id}/view`)).status).toBe(201);
      expect((await post(tThird, `/social/posts/${id}/view`)).status).toBe(201);

      const row = await direct.query(
        `SELECT view_count, last_activity_at FROM feed_posts WHERE id = $1`,
        [id],
      );
      expect(Number(row.rows[0].view_count), "2 người xem, 1 người xem 2 lần").toBe(2);
      expect(
        new Date(row.rows[0].last_activity_at).getTime(),
        "lượt xem KHÔNG biến «Hoạt động mới» thành «vừa có người mở ra xem»",
      ).toBe(new Date(before.rows[0].last_activity_at).getTime());
    });

    it("bình luận LÀM tăng `comment_count` và ĐẨY `last_activity_at`", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "đếm bình luận",
      });
      const id = p.body.data.id as string;
      const before = await direct.query(`SELECT last_activity_at FROM feed_posts WHERE id = $1`, [
        id,
      ]);

      expect((await post(tPeer, `/social/posts/${id}/comments`).send({ body: "a" })).status).toBe(
        201,
      );
      const row = await direct.query(
        `SELECT comment_count, last_activity_at FROM feed_posts WHERE id = $1`,
        [id],
      );
      expect(Number(row.rows[0].comment_count)).toBe(1);
      expect(new Date(row.rows[0].last_activity_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.rows[0].last_activity_at).getTime(),
      );
    });

    it("xoá mềm bình luận ⇒ `comment_count` giảm + mention/cảm xúc của nó được dọn theo", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "dọn theo",
      });
      const id = p.body.data.id as string;
      const c = await post(tPeer, `/social/posts/${id}/comments`).send({
        body: "sẽ bị xoá",
        mentionedUserIds: [thirdUserId],
      });
      const cid = c.body.data.id as string;
      expect(
        (await put(tThird, `/social/comments/${cid}/reaction`).send({ emoji: "like" })).status,
      ).toBe(200);

      expect((await del(tPeer, `/social/comments/${cid}`)).status).toBe(200);

      const post2 = await direct.query(`SELECT comment_count FROM feed_posts WHERE id = $1`, [id]);
      expect(Number(post2.rows[0].comment_count)).toBe(0);
      const m = await direct.query(
        `SELECT count(*)::int AS n FROM feed_mentions WHERE target_id = $1`,
        [cid],
      );
      expect(m.rows[0].n, "mention của bình luận đã xoá phải được dọn").toBe(0);
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM feed_reactions WHERE target_id = $1`,
        [cid],
      );
      expect(r.rows[0].n, "cảm xúc của bình luận đã xoá phải được dọn").toBe(0);
    });

    it("R18 — xoá mềm bài rồi `restorePostTx()` ⇒ bài + ĐỦ đếm/quan hệ quay lại", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "khôi phục #phuchoi",
      });
      const id = p.body.data.id as string;
      await post(tPeer, `/social/posts/${id}/comments`).send({ body: "bình luận sống" });
      await put(tPeer, `/social/posts/${id}/reaction`).send({ emoji: "like" });
      await post(tThird, `/social/posts/${id}/view`);

      const beforeTag = await tagUsage("phuchoi");
      expect((await del(tAuthor, `/social/posts/${id}`)).status).toBe(200);
      expect((await get(tAuthor, `/social/posts/${id}`)).status).toBe(404);
      expect(await tagUsage("phuchoi"), "xoá mềm HẠ usage_count của thẻ").toBe(beforeTag - 1);

      // ⚠️ Gọi HÀM THẬT, không `UPDATE … SET deleted_at = NULL` bằng tay: ca test chỉ flip cột sẽ
      // xanh mà không chứng minh gì về tính đối xứng của bộ đếm (plan §2 D10).
      const restored = await db.withTenant(A.companyId, (tx) => restorePostTx(tx, A.companyId, id));
      expect(restored).toBe(true);

      const seen = await get(tAuthor, `/social/posts/${id}`);
      expect(seen.status, JSON.stringify(seen.body)).toBe(200);
      expect(seen.body.data.commentCount).toBe(1);
      expect(seen.body.data.likeCount).toBe(1);
      expect(seen.body.data.viewCount).toBe(1);
      expect(await tagUsage("phuchoi"), "khôi phục TRẢ LẠI usage_count").toBe(beforeTag);
    });
  });

  // ══════════════ R20 / R21 — idempotency ══════════════

  describe("R20/R21 — `@Idempotent()` trên 002/015", () => {
    it("R21 — CÙNG key + CÙNG body ⇒ replay, KHÔNG tạo hàng thứ hai", async () => {
      const key = randomUUID();
      const body = { type: "share", audience: "company", body: "idempotent 1" };
      const first = await post(tAuthor, "/social/posts").set("Idempotency-Key", key).send(body);
      expect(first.status, JSON.stringify(first.body)).toBe(201);

      const replay = await post(tAuthor, "/social/posts").set("Idempotency-Key", key).send(body);
      expect([200, 201]).toContain(replay.status);
      expect(replay.body.data.id, "replay trả CHÍNH hàng cũ").toBe(first.body.data.id);

      const rows = await direct.query(
        `SELECT count(*)::int AS n FROM feed_posts WHERE company_id = $1 AND body = $2`,
        [A.companyId, "idempotent 1"],
      );
      expect(rows.rows[0].n).toBe(1);
    });

    it("R20 — CÙNG key + body KHÁC ⇒ 409 KEY_REUSED", async () => {
      const key = randomUUID();
      const a = await post(tAuthor, "/social/posts")
        .set("Idempotency-Key", key)
        .send({ type: "share", audience: "company", body: "idempotent A" });
      expect(a.status).toBe(201);

      const b = await post(tAuthor, "/social/posts")
        .set("Idempotency-Key", key)
        .send({ type: "share", audience: "company", body: "idempotent B (khác)" });
      expect(b.status, JSON.stringify(b.body)).toBe(409);
    });

    it("R21 — cũng áp cho `POST …/comments`", async () => {
      const key = randomUUID();
      const body = { body: "bình luận idempotent" };
      const first = await post(tPeer, `/social/posts/${postId}/comments`)
        .set("Idempotency-Key", key)
        .send(body);
      expect(first.status).toBe(201);
      const replay = await post(tPeer, `/social/posts/${postId}/comments`)
        .set("Idempotency-Key", key)
        .send(body);
      expect(replay.body.data.id).toBe(first.body.data.id);
    });
  });

  // ══════════════ §6 — audit của kiểm duyệt ══════════════

  it("§6 — MỖI TRƯỜNG kiểm duyệt đổi = MỘT dòng audit riêng `{postId, field, from, to}`", async () => {
    const p = await post(tAuthor, "/social/posts").send({
      type: "news",
      audience: "company",
      body: "Tin để kiểm duyệt",
    });
    const id = p.body.data.id as string;

    const res = await patch(tAuthor, `/social/posts/${id}/moderation`).send({
      hidden: true,
      pinned: true,
      commentsLocked: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = await direct.query(
      `SELECT action, metadata FROM audit_logs
        WHERE company_id = $1 AND object_type = 'feed_post' AND object_id = $2
        ORDER BY action`,
      [A.companyId, id],
    );
    expect(rows.rows.length, "3 trường đổi ⇒ 3 dòng, không phải 1 dòng gộp").toBe(3);
    const fields = rows.rows.map((r) => r.metadata.field).sort();
    expect(fields).toEqual(["commentsLocked", "hidden", "pinned"]);
    for (const r of rows.rows) {
      expect(r.metadata.from).toBe(false);
      expect(r.metadata.to).toBe(true);
      // Payload audit KHÔNG chứa nội dung bài (API-19 §8).
      expect(JSON.stringify(r.metadata)).not.toContain("Tin để kiểm duyệt");
    }
  });

  it("§6 — đổi một trường về ĐÚNG giá trị cũ ⇒ KHÔNG ghi audit (không đẻ tiếng ồn)", async () => {
    const p = await post(tAuthor, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "không đổi gì",
    });
    const id = p.body.data.id as string;
    expect(
      (await patch(tAuthor, `/social/posts/${id}/moderation`).send({ hidden: false })).status,
    ).toBe(200);
    const rows = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND object_id = $2`,
      [A.companyId, id],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  // ══════════════ Lưu bài + danh sách người thả cảm xúc (008-010, 013) ══════════════
  //
  // ⚠️ Bốn route dưới đây từng KHÔNG có bằng chứng test HTTP nào và bị cổng
  // `route-http-coverage.e2e-spec.ts` bắt (ratchet "chưa phủ = 0"). Chúng là đường ghi/đọc THẬT của
  // người dùng, không phải route phụ — thiếu test ở đây nghĩa là 4/19 route của WO chưa ai chạm.

  /**
   * Audit cho SỬA nội dung của NGƯỜI KHÁC — 004/016 (FULL gate PR #530 HIGH-2, owner ký 22/09/2026).
   *
   * Plan §4 trước đó ghi audit `—` cho hai route này, nên code KHỚP plan; cái sai là chính dòng plan.
   * Lập luận đổi: đường XOÁ cùng module ĐÃ vào sổ, và sửa `body` của người khác **xoá dấu vết còn
   * sạch hơn xoá bài** — `body` bị ghi đè, `updated_by`/`edited_at` cũng bị ghi đè, rồi lần tác giả
   * tự sửa tiếp ghi đè NỐT hai cột đó ⇒ không còn gì cho biết ai đã viết lại lời của họ.
   *
   * `assertCanMutateContent` vốn ĐÃ trả cờ `asManager` đúng cho việc này (docblock của nó nói thẳng
   * "caller dùng nó để quyết định có ghi audit_logs hay không"); bản đầu bỏ rơi giá trị trả về.
   */
  describe("§6 / HIGH-2 — SỬA nội dung người khác vào sổ audit, sửa của MÌNH thì không", () => {
    async function auditRowsFor(objectId: string) {
      const r = await direct.query(
        `SELECT action, object_type, metadata FROM audit_logs
          WHERE company_id = $1 AND object_id = $2 ORDER BY created_at`,
        [A.companyId, objectId],
      );
      return r.rows as {
        action: string;
        object_type: string;
        metadata: Record<string, unknown>;
      }[];
    }

    it("004 — quản lý sửa bài của người khác ⇒ 1 dòng `social.post.update`", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bai cua tac gia se bi quan ly sua",
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      const id = p.body.data.id as string;

      const res = await patch(tPeer, `/social/posts/${id}`).send({
        body: "quan ly viet lai",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const rows = await auditRowsFor(id);
      expect(rows.length, "sửa nội dung người khác PHẢI vào sổ").toBe(1);
      expect(rows[0].action).toBe("social.post.update");
      expect(rows[0].object_type).toBe("feed_post");
      expect(rows[0].metadata.postId).toBe(id);
      expect(typeof rows[0].metadata.authorUserId).toBe("string");
      // Payload audit KHÔNG chở nội dung bài (API-19 §8) — cả body cũ lẫn body mới.
      const meta = JSON.stringify(rows[0].metadata);
      expect(meta).not.toContain("quan ly viet lai");
      expect(meta).not.toContain("bai cua tac gia se bi quan ly sua");
    });

    it("004 — tác giả sửa bài CỦA MÌNH ⇒ 0 dòng audit (không đẻ tiếng ồn)", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bai cua tac gia tu sua",
      });
      const id = p.body.data.id as string;
      expect((await patch(tAuthor, `/social/posts/${id}`).send({ body: "tu sua" })).status).toBe(
        200,
      );
      expect(await auditRowsFor(id)).toEqual([]);
    });

    it("016 — quản lý sửa bình luận của người khác ⇒ 1 dòng `social.comment.update`", async () => {
      const c = await post(tAuthor, `/social/posts/${postId}/comments`).send({
        body: "binh luan cua tac gia",
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      const cid = c.body.data.id as string;

      const res = await patch(tPeer, `/social/comments/${cid}`).send({
        body: "quan ly sua hoc",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const rows = await auditRowsFor(cid);
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe("social.comment.update");
      expect(rows[0].object_type).toBe("feed_comment");
      expect(rows[0].metadata.postId).toBe(postId);
    });

    it("016 — chủ bình luận tự sửa ⇒ 0 dòng audit", async () => {
      const c = await post(tAuthor, `/social/posts/${postId}/comments`).send({
        body: "binh luan tu sua",
      });
      const cid = c.body.data.id as string;
      expect(
        (await patch(tAuthor, `/social/comments/${cid}`).send({ body: "tu sua" })).status,
      ).toBe(200);
      expect(await auditRowsFor(cid)).toEqual([]);
    });
  });
  describe("008/009/010 — lưu bài là trạng thái CÁ NHÂN", () => {
    it("lưu → xuất hiện ở /social/saved của CHÍNH mình, KHÔNG ở của người khác", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bài để lưu",
      });
      const id = p.body.data.id as string;

      const saved = await post(tPeer, `/social/posts/${id}/save`);
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
      expect(saved.body.data.savedByMe).toBe(true);

      const mine = await get(tPeer, "/social/saved");
      expect(mine.status, JSON.stringify(mine.body)).toBe(200);
      expect((mine.body.data.data as Array<{ id: string }>).map((x) => x.id)).toContain(id);

      const other = await get(tThird, "/social/saved");
      expect(other.status).toBe(200);
      expect(
        (other.body.data.data as Array<{ id: string }>).map((x) => x.id),
        "lưu của người này KHÔNG được lọt sang danh sách của người kia",
      ).not.toContain(id);
    });

    it("lưu HAI LẦN là no-op (PK tổ hợp) — không đẻ hàng thứ hai", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "lưu hai lần",
      });
      const id = p.body.data.id as string;
      expect((await post(tPeer, `/social/posts/${id}/save`)).status).toBe(201);
      expect((await post(tPeer, `/social/posts/${id}/save`)).status).toBe(201);

      const rows = await direct.query(
        `SELECT count(*)::int AS n FROM feed_saved_posts WHERE company_id = $1 AND post_id = $2`,
        [A.companyId, id],
      );
      expect(rows.rows[0].n).toBe(1);
    });

    it("bỏ lưu → biến khỏi /social/saved; bỏ lưu LẦN HAI vẫn thành công (đường GỠ không chặt)", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bỏ lưu",
      });
      const id = p.body.data.id as string;
      await post(tPeer, `/social/posts/${id}/save`);

      const first = await del(tPeer, `/social/posts/${id}/save`);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.data.savedByMe).toBe(false);
      expect((await del(tPeer, `/social/posts/${id}/save`)).status).toBe(200);

      const mine = await get(tPeer, "/social/saved");
      expect((mine.body.data.data as Array<{ id: string }>).map((x) => x.id)).not.toContain(id);
    });

    it("DENY: lưu một bài KHÔNG thấy được ⇒ 404 (cổng bài áp cả cho thao tác cá nhân)", async () => {
      expect((await post(tPeer, `/social/posts/${randomUUID()}/save`)).status).toBe(404);
    });

    it("cờ savedByMe trên thẻ bài là projection THEO ACTOR", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "co savedByMe",
      });
      const id = p.body.data.id as string;
      await post(tPeer, `/social/posts/${id}/save`);

      expect((await get(tPeer, `/social/posts/${id}`)).body.data.savedByMe).toBe(true);
      expect(
        (await get(tThird, `/social/posts/${id}`)).body.data.savedByMe,
        "cờ của người này không được rò sang người kia",
      ).toBe(false);
    });
  });

  describe("013 — danh sách người đã thả cảm xúc", () => {
    it("trả danh tính NHÂN SỰ + emoji, KHÔNG có userId", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "ai da tha",
      });
      const id = p.body.data.id as string;
      expect(
        (await put(tPeer, `/social/posts/${id}/reaction`).send({ emoji: "like" })).status,
      ).toBe(200);
      expect(
        (await put(tThird, `/social/posts/${id}/reaction`).send({ emoji: "love" })).status,
      ).toBe(200);

      const res = await get(tAuthor, `/social/posts/${id}/reactions`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect([...res.body.data.map((r: { emoji: string }) => r.emoji)].sort()).toEqual([
        "like",
        "love",
      ]);
      // Cùng luật với `feedAuthorSchema`: danh tính nhân sự, KHÔNG khoá tài khoản.
      expect(JSON.stringify(res.body.data)).not.toContain(peerUserId);
      expect(JSON.stringify(res.body.data)).not.toContain(thirdUserId);
      for (const r of res.body.data) expect(Object.keys(r)).not.toContain("userId");
    });

    it("DENY: đọc danh sách của bài KHÔNG thấy được ⇒ 404", async () => {
      expect((await get(tPeer, `/social/posts/${randomUUID()}/reactions`)).status).toBe(404);
    });
  });

  async function countPosts(): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM feed_posts WHERE company_id = $1`,
      [A.companyId],
    );
    return Number(r.rows[0].n);
  }

  async function tagUsage(tag: string): Promise<number> {
    const r = await direct.query(
      `SELECT usage_count FROM feed_tags WHERE company_id = $1 AND tag = $2`,
      [A.companyId, tag],
    );
    return r.rows.length ? Number(r.rows[0].usage_count) : 0;
  }
});
