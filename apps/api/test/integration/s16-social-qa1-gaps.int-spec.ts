/**
 * S16-SOCIAL-QA-1 — ca bù sau lượt kiểm toán mutant độc lập (plan `docs/plans/S16-SOCIAL-QA-1.md` §4,
 * dòng «điểm gác cho lượt kiểm toán»). Hai điểm gác chưa có ca nào bắt:
 *
 *   QA1-G-1 / G-2  cờ quản lý bài chỉ bật khi cặp `manage:feed-post` ở phạm vi công ty — người gọi giữ
 *                  cặp CỦA ROUTE ở phạm vi công ty nhưng cặp quản lý bài ở phạm vi hẹp hơn. Bộ sàn scope
 *                  QA1-M-F hạ MỌI cặp cùng lúc nên dừng ở sàn của route trước khi cờ được đọc.
 *   QA1-G-3 / G-4  khôi phục bài (058) đếm lại ba cột `comment_count` · `like_count` · `view_count` từ
 *                  hàng nguồn. Các ca S-8 / S-9 không đổi hàng nguồn giữa lúc xoá và lúc khôi phục nên
 *                  câu đếm lại không đổi kết quả nào quan sát được.
 *
 * Mỗi ca TỪ CHỐI đứng cạnh ca CHO PHÉP trên cùng fixture + cùng request; assert theo MÃ.
 * Dữ liệu dựng QUA API. Ngoại lệ duy nhất, ghi rõ tại chỗ: G-4 gỡ hai hàng nguồn bằng SQL (chỉ hàng của
 * chính bài của ca, trong công ty của spec) — không route nào chạm được hàng nguồn của một bài đang ở
 * thùng rác theo cách tất định cho hai cột đó; G-3 thì tới được hoàn toàn qua HTTP.
 */
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { hasDb } from "../helpers/integration-db";
import { snapPost } from "../helpers/social-qa1-idor-util";
import {
  EMPLOYEE_FEED_PAIRS,
  FEED_PAIRS,
  addComment,
  bootQa1World,
  expectScopeFloorDenied,
  expectSocial,
  reactPost,
  sharePost,
  viewPost,
  type Json,
  type Qa1Actor,
  type Qa1Res,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import { expectCountersReconciled } from "../helpers/social-qa1-kit-counters";
import { fireUnderLock } from "../helpers/social-qa1-kit-race";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 90_000;
const LOCK_TIMEOUT_MS = 30_000;
const MAX_PAGES = 20;

const lite = (res: { status: number; body: unknown }): Qa1Res => ({
  status: res.status,
  body: res.body as Qa1Res["body"],
});
const dump = (res: { status: number; body: unknown }): string =>
  `${res.status} ${JSON.stringify(res.body)}`;
const dataOf = (res: { body: unknown }): Json =>
  ((res.body as { data?: unknown }).data ?? {}) as Json;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-QA-1 · ca bù sau lượt kiểm toán mutant", () => {
  let w: Qa1World;
  /** Đủ 15 cặp ở phạm vi công ty: ẩn bài, xoá bài của người khác, khôi phục. */
  let mod: Qa1Actor;
  /** Tác giả các bài của spec — 7 cặp của nhân viên. */
  let author: Qa1Actor;
  /** Người tương tác — 7 cặp của nhân viên. */
  let peer: Qa1Actor;
  let peer2: Qa1Actor;
  /** 7 cặp của nhân viên (phạm vi công ty) + `manage:feed-post` ở phạm vi `Department`. */
  let narrowMod: Qa1Actor;
  /** Song sinh: CÙNG tập cặp, mọi cặp ở phạm vi công ty. */
  let wideMod: Qa1Actor;

  const A = (): string => w.A.companyId;

  const postCols = async (
    postId: string,
  ): Promise<{ comment: number; like: number; view: number; deleted: boolean }> => {
    const r = await w.direct.query<{
      comment_count: number;
      like_count: number;
      view_count: number;
      deleted: boolean;
    }>(
      `SELECT comment_count, like_count, view_count, deleted_at IS NOT NULL AS deleted
         FROM feed_posts WHERE id = $1 AND company_id = $2`,
      [postId, A()],
    );
    expect(r.rows.length, `feed_posts ${postId}`).toBe(1);
    const row = r.rows[0];
    return {
      comment: Number(row.comment_count),
      like: Number(row.like_count),
      view: Number(row.view_count),
      deleted: row.deleted,
    };
  };

  /** Số hàng NGUỒN thật của ba cột (bình luận sống · cảm xúc trên bài · lượt xem). */
  const sourceCounts = async (
    postId: string,
  ): Promise<{ comment: number; like: number; view: number }> => {
    const r = await w.direct.query<{ comment: number; like: number; view: number }>(
      `SELECT
         (SELECT count(*)::int FROM feed_comments
           WHERE company_id = $2 AND post_id = $1 AND deleted_at IS NULL) AS comment,
         (SELECT count(*)::int FROM feed_reactions
           WHERE company_id = $2 AND target_type = 'post' AND target_id = $1) AS like,
         (SELECT count(*)::int FROM feed_post_views
           WHERE company_id = $2 AND post_id = $1) AS view`,
      [postId, A()],
    );
    return r.rows[0];
  };

  const feedIds = async (by: Qa1Actor, url: string): Promise<Set<string>> => {
    const ids = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const sep = url.includes("?") ? "&" : "?";
      const full: string =
        cursor === null ? url : `${url}${sep}cursor=${encodeURIComponent(cursor)}`;
      const res = await w.get(by.token, full);
      expect(res.status, `${full} ⇒ ${dump(res)}`).toBe(200);
      const data = dataOf(res);
      for (const item of (data.data ?? []) as Json[]) ids.add(item.id as string);
      cursor = (data.nextCursor ?? null) as string | null;
      if (cursor === null) return ids;
    }
    throw new Error(`[QA1-G] ${url}: quá ${MAX_PAGES} trang`);
  };

  const deletePost = async (by: Qa1Actor, postId: string): Promise<void> => {
    const res = await w.del(by.token, `/social/posts/${postId}`);
    expect(res.status, `005 ⇒ ${dump(res)}`).toBe(200);
    expect(dataOf(res)).toEqual({ deleted: true });
  };

  const restorePost = async (postId: string): Promise<void> => {
    const res = await w.post(mod.token, `/recycle-bin/feed-posts/${postId}/restore`);
    expect(res.status, `058 ⇒ ${dump(res)}`).toBe(200);
    expect(dataOf(res).status).toBe("published");
  };

  const detailOf = async (postId: string): Promise<Json> => {
    const res = await w.get(author.token, `/social/posts/${postId}`);
    expect(res.status, `003 ⇒ ${dump(res)}`).toBe(200);
    return dataOf(res);
  };

  beforeAll(async () => {
    w = await bootQa1World("qa1gaps");
    mod = await w.actor(w.A, "mod", { pairs: FEED_PAIRS });
    author = await w.actor(w.A, "author", { pairs: EMPLOYEE_FEED_PAIRS });
    peer = await w.actor(w.A, "peer", { pairs: EMPLOYEE_FEED_PAIRS });
    peer2 = await w.actor(w.A, "peer2", { pairs: EMPLOYEE_FEED_PAIRS });
    narrowMod = await w.actor(w.A, "narrowmod", {
      pairs: [...EMPLOYEE_FEED_PAIRS, "manage:feed-post"],
      scopes: { "manage:feed-post": "Department" },
    });
    wideMod = await w.actor(w.A, "widemod", {
      pairs: [...EMPLOYEE_FEED_PAIRS, "manage:feed-post"],
    });
    // Hâm nóng: mỗi actor một request trước ca giữ khoá (kết nối pool + bộ nhớ đệm quyền).
    for (const a of [mod, author, peer, peer2, narrowMod, wideMod]) {
      const warm = await w.get(a.token, "/social/feed");
      expect(warm.status, `hâm nóng ${a.label}`).toBe(200);
    }
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await w?.close();
  });

  it("QA1-G-1 · cặp quản lý bài ở phạm vi hẹp hơn công ty: bài `hidden` của người khác KHÔNG đọc được (003 ⇒ 404 theo MÃ, lọc `status=hidden` của 001 ⇒ 403 theo MÃ); cùng cặp ở phạm vi công ty ⇒ 200", async () => {
    const hidden = await sharePost(w, author);
    const hide = await w.patch(mod.token, `/social/posts/${hidden.id}/moderation`).send({
      hidden: true,
    });
    expect(hide.status, `006 ⇒ ${dump(hide)}`).toBe(200);

    // Tự kiểm fixture: người gọi THẬT SỰ giữ cặp quản lý bài, chỉ là ở phạm vi hẹp — route 006 (cặp của
    // route = chính cặp đó) từ chối bằng sàn scope, không phải bằng «thiếu cặp».
    const visibleOther = await sharePost(w, author);
    expectScopeFloorDenied(
      lite(
        await w
          .patch(narrowMod.token, `/social/posts/${visibleOther.id}/moderation`)
          .send({ commentsLocked: true }),
      ),
      "006 với cặp quản lý bài ở phạm vi hẹp",
    );
    // … và cặp của route 003 / 001 thì đủ: bài `published` đọc được.
    const open = await w.get(narrowMod.token, `/social/posts/${visibleOther.id}`);
    expect(open.status, `003 bài published ⇒ ${dump(open)}`).toBe(200);

    const detail = (by: Qa1Actor) => w.get(by.token, `/social/posts/${hidden.id}`);
    const hiddenFeed = (by: Qa1Actor) => w.get(by.token, "/social/feed?status=hidden");

    // TỪ CHỐI
    expectSocial(
      lite(await detail(narrowMod)),
      404,
      SOCIAL_ERR.POST_NOT_FOUND,
      SOCIAL_ERROR_CODES.POST_NOT_FOUND,
    );
    expectSocial(
      lite(await hiddenFeed(narrowMod)),
      403,
      SOCIAL_ERR.MODERATION_FIELD_DENIED,
      SOCIAL_ERROR_CODES.MODERATION_FIELD_DENIED,
    );
    const plainFeed = await feedIds(narrowMod, "/social/feed");
    expect(plainFeed.has(visibleOther.id), "neo dương: bảng tin có bài published").toBe(true);
    expect(plainFeed.has(hidden.id), "bảng tin không được chứa bài hidden của người khác").toBe(
      false,
    );

    // CHO PHÉP — cùng request, cùng bài, cặp ở phạm vi công ty.
    const wideDetail = await detail(wideMod);
    expect(wideDetail.status, `003 phạm vi công ty ⇒ ${dump(wideDetail)}`).toBe(200);
    expect(dataOf(wideDetail).id).toBe(hidden.id);
    expect((await feedIds(wideMod, "/social/feed?status=hidden")).has(hidden.id)).toBe(true);
  });

  it("QA1-G-2 · cặp quản lý bài ở phạm vi hẹp hơn công ty: sửa (004) và xoá (005) bài của người khác ⇒ 403 theo MÃ, hàng không đổi; cùng cặp ở phạm vi công ty ⇒ 200", async () => {
    const post = await sharePost(w, author);
    const edit = (by: Qa1Actor) =>
      w.patch(by.token, `/social/posts/${post.id}`).send({ body: "Đã sửa (G-2)" });
    const remove = (by: Qa1Actor) => w.del(by.token, `/social/posts/${post.id}`);
    const before = await snapPost(w.direct, A(), post.id);

    // TỪ CHỐI
    expectSocial(
      lite(await edit(narrowMod)),
      403,
      SOCIAL_ERR.NOT_CONTENT_OWNER,
      SOCIAL_ERROR_CODES.NOT_CONTENT_OWNER,
    );
    expectSocial(
      lite(await remove(narrowMod)),
      403,
      SOCIAL_ERR.NOT_CONTENT_OWNER,
      SOCIAL_ERROR_CODES.NOT_CONTENT_OWNER,
    );
    expect(await snapPost(w.direct, A(), post.id), "hàng bài sau hai lượt từ chối").toBe(before);

    // CHO PHÉP — cùng request, cùng bài.
    const edited = await edit(wideMod);
    expect(edited.status, `004 phạm vi công ty ⇒ ${dump(edited)}`).toBe(200);
    const removed = await remove(wideMod);
    expect(removed.status, `005 phạm vi công ty ⇒ ${dump(removed)}`).toBe(200);
    expect((await postCols(post.id)).deleted).toBe(true);
  });

  it(
    "QA1-G-3 · bình luận bị xoá (017) đúng lúc bài vào thùng rác (005): khôi phục (058) ⇒ `commentCount` = số bình luận còn sống",
    async () => {
      const post = await sharePost(w, author);
      const gone = await addComment(w, peer, post.id);
      await addComment(w, peer2, post.id);
      expect((await postCols(post.id)).comment).toBe(2);

      // 017 đã qua cổng đọc, đang chờ khoá hàng bình luận ⇒ 005 chạy xong trước khi nó đi tiếp.
      const raced = await fireUnderLock(
        { table: "feed_comments", companyId: A(), id: gone.id },
        [() => w.del(peer.token, `/social/comments/${gone.id}`)],
        { whileBlocked: () => deletePost(mod, post.id) },
      );
      expect(raced.queued, "017 phải xếp hàng sau khoá").toBe(true);
      expect(raced.results[0].status, `017 ⇒ ${dump(raced.results[0])}`).toBe(200);

      // Tiền điều kiện của ca (chống xanh-rỗng): bài ở thùng rác, nguồn còn 1 bình luận sống, cột
      // chưa được hạ. Nếu dòng này đỏ thì fixture không còn tạo ra chênh lệch — ca cần dựng lại.
      const trashed = await postCols(post.id);
      expect(trashed.deleted).toBe(true);
      expect((await sourceCounts(post.id)).comment).toBe(1);
      expect(trashed.comment, "tiền điều kiện: cột và nguồn phải đang chênh").toBe(2);

      await restorePost(post.id);

      expect(
        (await detailOf(post.id)).commentCount,
        "003 sau khôi phục: commentCount phải bằng số bình luận còn sống",
      ).toBe(1);
      expect((await postCols(post.id)).comment, "feed_posts.comment_count sau khôi phục").toBe(1);
      await expectCountersReconciled(w.direct, w.companyIds, ["feed_posts.comment_count"]);
    },
    LOCK_TIMEOUT_MS,
  );

  it("QA1-G-4 · hàng nguồn của cảm xúc / lượt xem đổi khi bài ở thùng rác: khôi phục (058) ⇒ `likeCount` và `viewCount` bằng số hàng nguồn (từng cột một)", async () => {
    const post = await sharePost(w, author);
    await reactPost(w, peer, post.id);
    await reactPost(w, peer2, post.id, "love");
    await viewPost(w, peer, post.id);
    await viewPost(w, peer2, post.id);
    const live = await postCols(post.id);
    expect({ like: live.like, view: live.view }).toEqual({ like: 2, view: 2 });

    await deletePost(mod, post.id);

    // Ngoại lệ «dựng qua API» (xem đầu file): gỡ MỘT cảm xúc + MỘT lượt xem của `peer` trên chính
    // bài này, khi bài đang ở thùng rác.
    const delReaction = await w.direct.query(
      `DELETE FROM feed_reactions
        WHERE company_id = $1 AND target_type = 'post' AND target_id = $2 AND user_id = $3`,
      [A(), post.id, peer.userId],
    );
    expect(delReaction.rowCount, "fixture: gỡ đúng 1 cảm xúc").toBe(1);
    const delView = await w.direct.query(
      `DELETE FROM feed_post_views WHERE company_id = $1 AND post_id = $2 AND user_id = $3`,
      [A(), post.id, peer.userId],
    );
    expect(delView.rowCount, "fixture: gỡ đúng 1 lượt xem").toBe(1);
    const trashed = await postCols(post.id);
    expect(trashed.deleted).toBe(true);
    expect({ like: trashed.like, view: trashed.view }, "tiền điều kiện: cột chưa đổi").toEqual({
      like: 2,
      view: 2,
    });
    expect(await sourceCounts(post.id)).toEqual({ comment: 0, like: 1, view: 1 });

    await restorePost(post.id);

    const restored = await postCols(post.id);
    expect(restored.like, "feed_posts.like_count sau khôi phục").toBe(1);
    expect(restored.view, "feed_posts.view_count sau khôi phục").toBe(1);
    const detail = await detailOf(post.id);
    expect(detail.likeCount, "003 sau khôi phục: likeCount").toBe(1);
    expect(detail.viewCount, "003 sau khôi phục: viewCount").toBe(1);
    await expectCountersReconciled(w.direct, w.companyIds, [
      "feed_posts.like_count",
      "feed_posts.view_count",
    ]);
  });
});
