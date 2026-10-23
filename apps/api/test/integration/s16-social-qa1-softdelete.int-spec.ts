/**
 * S16-SOCIAL-QA-1 (L7) — XOÁ MỀM trên sáu bề mặt + vòng ẩn + khôi phục
 * (plan `docs/plans/S16-SOCIAL-QA-1.md` §4-L7, D8, Bảng 3 các dòng QA1-S).
 *
 * MỘT bài `news` + `requiresAck` (từ khoá riêng + hai hashtag riêng, đã được lưu / thích / bình luận /
 * xem) đi qua cả vòng đời: ẩn → hiện → xoá → khôi phục (`published`) → tác giả tự xoá → khôi phục
 * (`hidden`). Mỗi bề mặt được ĐO HAI LẦN trên chính bài đó: «THẤY / đếm = n» trước, «KHÔNG thấy / giảm
 * đúng phần của bài» sau. Luôn xoá QUA route 005 — xoá tay bằng SQL bỏ qua cột đếm thẻ.
 *
 *   S-H   vòng ẩn (006)                       S-7   bốn route trên bài đã xoá ⇒ 404
 *   S-1   feed 001 + chi tiết 003             S-X1  đối soát cột đếm ngay sau khi xoá
 *   S-2   đếm: tin chưa xác nhận (020)        S-8   người kiểm duyệt xoá → 058 ⇒ `published`
 *   S-3   tìm kiếm 023                        S-9   tác giả tự xoá → 058 ⇒ `hidden`
 *   S-4   thẻ: `feed?tag=` + `usageCount`     S-G   xoá nhóm (034) — vế người KHÔNG phải tác giả
 *   S-5   bài đã lưu 010                      S-C   xoá bình luận (017)
 *   S-6   nguồn widget tương tác tuần (O1)    S-X   đối soát cuối spec
 *
 * Sáu bề mặt là sáu phép đo RỜI nhau: (2) đọc `unackedCount`, (6) đọc hàng tuần hiện tại của 052 và
 * gọi thẳng hàm nguồn của widget (chưa có route DASH — widget thật sẽ cần ca riêng của WO DASH).
 */
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SocialStatsService } from "../../src/social/social-stats.service";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { hasDb } from "../helpers/integration-db";
import {
  EMPLOYEE_FEED_PAIRS,
  FEED_PAIRS,
  addComment,
  ackPost,
  bootQa1World,
  createGroup,
  expectSocial,
  joinAsActiveMember,
  newsPost,
  reactComment,
  reactPost,
  savePost,
  sharePost,
  uniqueTag,
  viewPost,
  type Json,
  type Qa1Actor,
  type Qa1Made,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import { expectCountersReconciled } from "../helpers/social-qa1-kit-counters";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 90_000;
const MAX_PAGES = 20;

/** Phần của bài chính trong số liệu tuần: 1 bài · 1 bình luận · 2 cảm xúc (người xem + người thứ hai). */
const MAIN_POST_SHARE = { posts: 1, comments: 1, reactions: 2 } as const;

interface PersonalSnap {
  feed: boolean;
  detail: number;
  newsList: boolean;
  unackedOnly: boolean;
  unackedCount: number;
  search: boolean;
  tagFeed: boolean;
  saved: boolean;
}

interface SharedSnap {
  /** `usageCount` của thẻ DÙNG CHUNG với một bài khác (đọc qua 024). */
  tagUsage: number;
  /** Hàng tuần hiện tại của 052. */
  week: { posts: number; comments: number; reactions: number };
  /** Cùng số, lấy bằng lời gọi thẳng hàm nguồn của widget. */
  widget: { posts: number; comments: number; reactions: number };
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-QA-1 · L7 · xoá mềm trên sáu bề mặt", () => {
  let w: Qa1World;
  /** Đủ 15 cặp ở phạm vi công ty: kiểm duyệt, khôi phục, đọc thống kê. */
  let mod: Qa1Actor;
  /** Tác giả bài chính: 7 cặp của nhân viên + quyền đăng tin. */
  let author: Qa1Actor;
  /** Người xem thường (lưu / thích / bình luận / xem bài chính). */
  let viewer: Qa1Actor;
  /** Người thứ hai — làm vế «đúng mã thành công» của S-7 trước khi xoá. */
  let peer: Qa1Actor;

  let main: Qa1Made;
  /** Bài thứ hai mang CÙNG thẻ dùng chung — neo dương của `feed?tag=` sau khi bài chính biến mất. */
  let sibling: Qa1Made;
  let keyword: string;
  let sharedTag: string;
  let soloTag: string;

  let beforeViewer: PersonalSnap;
  let beforeAuthor: PersonalSnap;
  let beforeShared: SharedSnap;

  const dataOf = (body: unknown): Json => ((body as { data?: unknown }).data ?? {}) as Json;

  /** Đi hết các trang keyset của một route danh sách bài, trả tập id. */
  const listIds = async (token: string, url: string): Promise<Set<string>> => {
    const ids = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const sep = url.includes("?") ? "&" : "?";
      const full: string =
        cursor === null ? url : `${url}${sep}cursor=${encodeURIComponent(cursor)}`;
      const res = await w.get(token, full);
      expect(res.status, `${full} ⇒ ${JSON.stringify(res.body)}`).toBe(200);
      const data = dataOf(res.body);
      for (const item of (data.data ?? []) as Json[]) ids.add(item.id as string);
      cursor = (data.nextCursor ?? null) as string | null;
      if (cursor === null) return ids;
    }
    throw new Error(`[QA1-S] ${url}: quá ${MAX_PAGES} trang`);
  };

  const unackedCountOf = async (who: Qa1Actor): Promise<number> => {
    const res = await w.get(who.token, "/social/news?countOnly=true");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const data = dataOf(res.body);
    expect(data.data, "countOnly ⇒ danh sách rỗng").toEqual([]);
    expect(typeof data.unackedCount).toBe("number");
    return data.unackedCount as number;
  };

  const tagUsageOf = async (tag: string): Promise<number | null> => {
    const res = await w.get(viewer.token, `/social/tags?q=${tag}&limit=100`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = (dataOf(res.body).data ?? []) as Array<{ tag: string; usageCount: number }>;
    const hit = rows.filter((r) => r.tag === tag);
    expect(hit.length, `thẻ ${tag} xuất hiện nhiều hơn một lần`).toBeLessThanOrEqual(1);
    return hit.length === 1 ? hit[0].usageCount : null;
  };

  const personal = async (who: Qa1Actor, postId = main.id): Promise<PersonalSnap> => ({
    feed: (await listIds(who.token, "/social/feed?limit=50")).has(postId),
    detail: (await w.get(who.token, `/social/posts/${postId}`)).status,
    newsList: (await listIds(who.token, "/social/news?limit=50")).has(postId),
    unackedOnly: (await listIds(who.token, "/social/news?limit=50&unackedOnly=true")).has(postId),
    unackedCount: await unackedCountOf(who),
    search: (await listIds(who.token, `/social/search?q=${keyword}`)).has(postId),
    tagFeed: (await listIds(who.token, `/social/feed?tag=${sharedTag}`)).has(postId),
    saved: (await listIds(who.token, "/social/saved")).has(postId),
  });

  const shared = async (): Promise<SharedSnap> => {
    const res = await w.get(mod.token, "/social/stats/engagement");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const totals = (dataOf(res.body).weekTotals ?? []) as Array<{
      weekStart: string;
      posts: number;
      comments: number;
      reactions: number;
    }>;
    expect(totals.length, "052 mặc định trả đủ 8 tuần").toBe(8);
    const current = totals[totals.length - 1];
    const direct = await w.app
      .get(SocialStatsService)
      .weeklyEngagementForWidget({ id: mod.userId, companyId: w.A.companyId });
    expect(direct.weekStart, "hàm nguồn của widget trả đúng tuần cuối của 052").toBe(
      current.weekStart,
    );
    const usage = await tagUsageOf(sharedTag);
    expect(usage, `thẻ dùng chung ${sharedTag} phải có mặt ở 024`).not.toBeNull();
    return {
      tagUsage: usage ?? -1,
      week: { posts: current.posts, comments: current.comments, reactions: current.reactions },
      widget: { posts: direct.posts, comments: direct.comments, reactions: direct.reactions },
    };
  };

  const less = (
    base: SharedSnap["week"],
    share: { posts: number; comments: number; reactions: number },
  ): SharedSnap["week"] => ({
    posts: base.posts - share.posts,
    comments: base.comments - share.comments,
    reactions: base.reactions - share.reactions,
  });

  const SEEN: Omit<PersonalSnap, "unackedCount"> = {
    feed: true,
    detail: 200,
    newsList: true,
    unackedOnly: true,
    search: true,
    tagFeed: true,
    saved: true,
  };
  const GONE: Omit<PersonalSnap, "unackedCount"> = {
    feed: false,
    detail: 404,
    newsList: false,
    unackedOnly: false,
    search: false,
    tagFeed: false,
    saved: false,
  };

  const readPostCols = async (
    postId: string,
  ): Promise<{ like: number; comment: number; view: number; status: string }> => {
    const r = await w.direct.query<{
      like_count: number;
      comment_count: number;
      view_count: number;
      status: string;
    }>(
      `SELECT like_count, comment_count, view_count, status FROM feed_posts
        WHERE id = $1 AND company_id = $2`,
      [postId, w.A.companyId],
    );
    expect(r.rows.length, `feed_posts ${postId}`).toBe(1);
    const row = r.rows[0];
    return {
      like: Number(row.like_count),
      comment: Number(row.comment_count),
      view: Number(row.view_count),
      status: row.status,
    };
  };

  const deletePost = async (by: Qa1Actor, postId: string): Promise<void> => {
    const res = await w.del(by.token, `/social/posts/${postId}`);
    expect(res.status, `005 ⇒ ${JSON.stringify(res.body)}`).toBe(200);
    expect(dataOf(res.body)).toEqual({ deleted: true });
  };

  const restorePost = async (by: Qa1Actor, postId: string): Promise<string> => {
    const res = await w.post(by.token, `/recycle-bin/feed-posts/${postId}/restore`);
    expect(res.status, `058 ⇒ ${JSON.stringify(res.body)}`).toBe(200);
    const data = dataOf(res.body);
    expect(data.id).toBe(postId);
    return data.status as string;
  };

  const setHidden = async (postId: string, hidden: boolean): Promise<void> => {
    const res = await w.patch(mod.token, `/social/posts/${postId}/moderation`).send({ hidden });
    expect(res.status, `006 ⇒ ${JSON.stringify(res.body)}`).toBe(200);
  };

  beforeAll(async () => {
    w = await bootQa1World("qa1sdel");
    mod = await w.actor(w.A, "mod", { pairs: FEED_PAIRS });
    author = await w.actor(w.A, "author", {
      pairs: [...EMPLOYEE_FEED_PAIRS, "manage:feed-news"],
    });
    viewer = await w.actor(w.A, "viewer", { pairs: EMPLOYEE_FEED_PAIRS });
    peer = await w.actor(w.A, "peer", { pairs: EMPLOYEE_FEED_PAIRS });

    keyword = uniqueTag("qakw");
    sharedTag = uniqueTag("qashared");
    soloTag = uniqueTag("qasolo");
    main = await newsPost(w, author, {
      text: `Tin ${keyword} #${sharedTag} #${soloTag}`,
      requiresAck: true,
    });
    sibling = await sharePost(w, author, `Bài kèm #${sharedTag}`);

    // Tương tác của người xem trên bài chính (KHÔNG xác nhận đọc — để còn nằm trong số «chưa xác nhận»).
    await savePost(w, viewer, main.id);
    await reactPost(w, viewer, main.id);
    await addComment(w, viewer, main.id);
    await viewPost(w, viewer, main.id);
    await savePost(w, author, main.id);
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await w?.close();
  });

  it("QA1-S-7a · trước khi xoá: 014 · 008 · 011 · 021 trên bài chính trả đúng mã thành công", async () => {
    const list = await w.get(peer.token, `/social/posts/${main.id}/comments`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(((dataOf(list.body).data ?? []) as Json[]).length).toBe(1);
    // Các hàm của kit ném nếu mã khác 201 (008) · 200 (011) · 201 (021).
    await savePost(w, peer, main.id);
    await reactPost(w, peer, main.id, "love");
    const ack = await ackPost(w, peer, main.id);
    expect(ack.firstTime).toBe(true);

    expect(await readPostCols(main.id)).toEqual({
      like: MAIN_POST_SHARE.reactions,
      comment: MAIN_POST_SHARE.comments,
      view: 1,
      status: "published",
    });
  });

  it("QA1-S-0 · neo dương: trước mọi thao tác, cả sáu bề mặt đều THẤY bài chính", async () => {
    beforeViewer = await personal(viewer);
    beforeAuthor = await personal(author);
    beforeShared = await shared();

    expect(beforeViewer).toEqual({ ...SEEN, unackedCount: 1 });
    expect(beforeAuthor).toEqual({ ...SEEN, unackedCount: 1 });
    expect(beforeShared.tagUsage, "bài chính + bài kèm").toBe(2);
    expect(await tagUsageOf(soloTag), "thẻ chỉ bài chính dùng").toBe(1);
    expect(beforeShared.week.posts).toBeGreaterThanOrEqual(2);
    expect(beforeShared.week.comments).toBeGreaterThanOrEqual(MAIN_POST_SHARE.comments);
    expect(beforeShared.week.reactions).toBeGreaterThanOrEqual(MAIN_POST_SHARE.reactions);
    expect(beforeShared.widget, "widget == hàng tuần hiện tại của 052").toEqual(beforeShared.week);
    // Neo của thẻ: bài kèm cũng nằm trong `feed?tag=`.
    expect((await listIds(viewer.token, `/social/feed?tag=${sharedTag}`)).has(sibling.id)).toBe(
      true,
    );
  });

  it("QA1-S-H · ẩn bài (006): người thường mất ở mọi bề mặt đọc, tác giả vẫn thấy; thẻ và số liệu tuần KHÔNG đổi", async () => {
    await setHidden(main.id, true);
    expect((await readPostCols(main.id)).status).toBe("hidden");

    expect(await personal(viewer), "người thường").toEqual({ ...GONE, unackedCount: 0 });
    expect(await personal(author), "tác giả vẫn thấy bài của mình").toEqual(beforeAuthor);
    const modView = await w.get(mod.token, `/social/posts/${main.id}`);
    expect(modView.status, "người kiểm duyệt đọc được bài ẩn").toBe(200);
    expect(dataOf(modView.body).status).toBe("hidden");

    const hiddenShared = await shared();
    expect(hiddenShared.tagUsage, "ẩn KHÔNG trừ lượt dùng thẻ").toBe(beforeShared.tagUsage);
    expect(hiddenShared.week, "bài ẩn vẫn tính vào số liệu tuần").toEqual(beforeShared.week);
    expect(hiddenShared.widget).toEqual(beforeShared.week);

    // Vòng ngược: hiện lại ⇒ mọi bề mặt về đúng ảnh chụp ban đầu.
    await setHidden(main.id, false);
    expect(await personal(viewer), "sau khi hiện lại").toEqual(beforeViewer);
    expect(await shared()).toEqual(beforeShared);
  });

  describe("sau khi người kiểm duyệt xoá bài qua 005", () => {
    let afterViewer: PersonalSnap;
    let afterShared: SharedSnap;

    beforeAll(async () => {
      await deletePost(mod, main.id);
      afterViewer = await personal(viewer);
      afterShared = await shared();
    });

    it("QA1-S-1 · feed 001 + chi tiết 003: trước THẤY, sau KHÔNG (003 ⇒ 404 theo mã)", async () => {
      expect([beforeViewer.feed, beforeViewer.detail]).toEqual([true, 200]);
      expect([afterViewer.feed, afterViewer.detail]).toEqual([false, 404]);
      expectSocial(
        await w.get(viewer.token, `/social/posts/${main.id}`),
        404,
        SOCIAL_ERR.POST_NOT_FOUND,
        SOCIAL_ERROR_CODES.POST_NOT_FOUND,
      );
      // Người kiểm duyệt cũng không đọc được bài đã xoá qua 003 hay qua bộ lọc trạng thái của feed.
      expectSocial(
        await w.get(mod.token, `/social/posts/${main.id}`),
        404,
        SOCIAL_ERR.POST_NOT_FOUND,
        SOCIAL_ERROR_CODES.POST_NOT_FOUND,
      );
      for (const status of ["published", "hidden"]) {
        const ids = await listIds(mod.token, `/social/feed?limit=50&status=${status}`);
        expect(ids.has(main.id), `feed?status=${status}`).toBe(false);
      }
      // Neo: bài kèm (không bị xoá) vẫn ở feed của cùng người xem.
      expect((await listIds(viewer.token, "/social/feed?limit=50")).has(sibling.id)).toBe(true);
    });

    it("QA1-S-2 · đếm tin chưa xác nhận (020): 1 → 0, cả ở danh sách lẫn dạng `countOnly`", async () => {
      expect([beforeViewer.unackedCount, beforeViewer.newsList, beforeViewer.unackedOnly]).toEqual([
        1,
        true,
        true,
      ]);
      expect([afterViewer.unackedCount, afterViewer.newsList, afterViewer.unackedOnly]).toEqual([
        0,
        false,
        false,
      ]);
    });

    it("QA1-S-3 · tìm kiếm 023 theo từ khoá riêng: trước THẤY, sau KHÔNG", async () => {
      expect(beforeViewer.search).toBe(true);
      expect(afterViewer.search).toBe(false);
      expect((await listIds(viewer.token, `/social/search?q=${keyword}`)).size).toBe(0);
    });

    it("QA1-S-4 · thẻ: `feed?tag=` hết trả bài, `usageCount` của thẻ giảm đúng 1", async () => {
      expect([beforeViewer.tagFeed, beforeShared.tagUsage]).toEqual([true, 2]);
      expect(afterShared.tagUsage, "usageCount của thẻ dùng chung sau khi xoá bài chính").toBe(1);
      expect(afterViewer.tagFeed).toBe(false);
      // Neo dương: bài kèm vẫn được `feed?tag=` trả — bộ lọc không rỗng vì lý do khác.
      expect([...(await listIds(viewer.token, `/social/feed?tag=${sharedTag}`))]).toEqual([
        sibling.id,
      ]);
      // Thẻ chỉ bài chính dùng: lượt dùng về 0 (có còn được liệt kê hay không thì ca này không ghim).
      expect(await tagUsageOf(soloTag)).toSatisfy((n: number | null) => n === null || n === 0);
      expect((await listIds(viewer.token, `/social/feed?tag=${soloTag}`)).size).toBe(0);
      const col = await w.direct.query<{ tag: string; usage_count: number }>(
        `SELECT tag, usage_count FROM feed_tags WHERE company_id = $1 AND tag = ANY($2::text[])
          ORDER BY tag`,
        [w.A.companyId, [sharedTag, soloTag]],
      );
      expect(
        Object.fromEntries(col.rows.map((r) => [r.tag, Number(r.usage_count)])),
        "cột feed_tags.usage_count",
      ).toEqual({ [sharedTag]: 1, [soloTag]: 0 });
    });

    it("QA1-S-5 · bài đã lưu 010: trước THẤY, sau KHÔNG (hàng lưu vẫn còn trong DB)", async () => {
      expect(beforeViewer.saved).toBe(true);
      expect(afterViewer.saved).toBe(false);
      const kept = await w.direct.query(
        `SELECT 1 FROM feed_saved_posts WHERE company_id = $1 AND post_id = $2 AND user_id = $3`,
        [w.A.companyId, main.id, viewer.userId],
      );
      expect(kept.rowCount, "xoá mềm không dọn hàng lưu — khôi phục là hiện lại").toBe(1);
    });

    it("QA1-S-6 · nguồn widget tương tác tuần [O1]: hàng tuần của 052 và hàm nguồn cùng giảm đúng phần của bài", async () => {
      const expected = less(beforeShared.week, MAIN_POST_SHARE);
      expect(afterShared.week, "hàng tuần hiện tại của 052").toEqual(expected);
      expect(afterShared.widget, "lời gọi thẳng hàm nguồn của widget").toEqual(expected);
    });

    it("QA1-S-7 · 014 · 008 · 011 · 021 trên bài đã xoá ⇒ 404 SOCIAL-ERR-001", async () => {
      const calls = [
        w.get(peer.token, `/social/posts/${main.id}/comments`),
        w.post(peer.token, `/social/posts/${main.id}/save`),
        w.put(peer.token, `/social/posts/${main.id}/reaction`).send({ emoji: "like" }),
        w.post(peer.token, `/social/posts/${main.id}/ack`),
      ];
      for (const call of calls) {
        expectSocial(await call, 404, SOCIAL_ERR.POST_NOT_FOUND, SOCIAL_ERROR_CODES.POST_NOT_FOUND);
      }
    });

    it("QA1-S-X1 · đối soát cột đếm ngay sau khi xoá: không cột nào lệch", async () => {
      await expectCountersReconciled(w.direct, w.companyIds, ["feed_tags.usage_count"]);
    });
  });

  it("QA1-S-8 · người kiểm duyệt xoá bài đang `published` → 058 ⇒ về `published`, sáu bề mặt thấy lại, cột đếm đúng", async () => {
    expect(await restorePost(mod, main.id)).toBe("published");
    await expectCountersReconciled(w.direct, w.companyIds);

    expect(await personal(viewer), "người xem thấy lại đúng như ban đầu").toEqual(beforeViewer);
    expect(await shared(), "thẻ + số liệu tuần về như ban đầu").toEqual(beforeShared);
    expect(await tagUsageOf(soloTag)).toBe(1);
    expect(await readPostCols(main.id)).toEqual({
      like: MAIN_POST_SHARE.reactions,
      comment: MAIN_POST_SHARE.comments,
      view: 1,
      status: "published",
    });
  });

  it("QA1-S-9 · TÁC GIẢ tự xoá → 058 ⇒ về `hidden`: tác giả + người kiểm duyệt thấy, đồng nghiệp KHÔNG", async () => {
    // Đối chứng: chính đồng nghiệp này đang thấy bài (trạng thái sau S-8).
    expect((await w.get(viewer.token, `/social/posts/${main.id}`)).status).toBe(200);

    await deletePost(author, main.id);
    expect(await restorePost(mod, main.id)).toBe("hidden");
    await expectCountersReconciled(w.direct, w.companyIds);

    const mine = await w.get(author.token, `/social/posts/${main.id}`);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(dataOf(mine.body).status).toBe("hidden");
    expect(await personal(author), "tác giả").toEqual(beforeAuthor);
    expect((await w.get(mod.token, `/social/posts/${main.id}`)).status).toBe(200);

    expectSocial(
      await w.get(viewer.token, `/social/posts/${main.id}`),
      404,
      SOCIAL_ERR.POST_NOT_FOUND,
      SOCIAL_ERROR_CODES.POST_NOT_FOUND,
    );
    expect(await personal(viewer), "đồng nghiệp").toEqual({ ...GONE, unackedCount: 0 });
    // Khôi phục đếm lại lượt dùng thẻ như nhau ở cả hai trạng thái.
    expect((await shared()).tagUsage).toBe(beforeShared.tagUsage);
  });

  it("QA1-S-G · xoá nhóm (034): thành viên KHÔNG phải tác giả mất bài nhóm ở `feed?groupId=` · 003 · 010 · 020", async () => {
    const owner = await w.actor(w.A, "gowner", { pairs: EMPLOYEE_FEED_PAIRS });
    const member = await w.actor(w.A, "gmember", { pairs: EMPLOYEE_FEED_PAIRS });
    const group = await createGroup(w, owner, "private");
    await joinAsActiveMember(w, owner, author, group.id);
    await joinAsActiveMember(w, owner, member, group.id);
    const groupNews = await newsPost(w, author, {
      text: `Tin nhóm ${uniqueTag("qagrp")}`,
      audience: "group",
      groupId: group.id,
    });
    await savePost(w, member, groupNews.id);

    const see = async (): Promise<{
      groupFeed: boolean;
      detail: number;
      saved: boolean;
      news: boolean;
    }> => ({
      groupFeed: (await listIds(member.token, `/social/feed?groupId=${group.id}`)).has(
        groupNews.id,
      ),
      detail: (await w.get(member.token, `/social/posts/${groupNews.id}`)).status,
      saved: (await listIds(member.token, "/social/saved")).has(groupNews.id),
      news: (await listIds(member.token, "/social/news?limit=50")).has(groupNews.id),
    });

    expect(await see(), "trước khi xoá nhóm").toEqual({
      groupFeed: true,
      detail: 200,
      saved: true,
      news: true,
    });

    const del = await w.del(owner.token, `/social/groups/${group.id}`);
    expect(del.status, `034 ⇒ ${JSON.stringify(del.body)}`).toBe(200);

    expect(await see(), "sau khi xoá nhóm").toEqual({
      groupFeed: false,
      detail: 404,
      saved: false,
      news: false,
    });
    expectSocial(
      await w.get(member.token, `/social/posts/${groupNews.id}`),
      404,
      SOCIAL_ERR.POST_NOT_FOUND,
      SOCIAL_ERROR_CODES.POST_NOT_FOUND,
    );
    // Xoá nhóm không đánh dấu từng bài: hàng bài vẫn `published`, chỉ đường đọc bị che.
    expect((await readPostCols(groupNews.id)).status).toBe("published");
  });

  it("QA1-S-C · xoá bình luận (017): 014 hết trả, `comment_count` −1, cảm xúc của nó bị dọn", async () => {
    const post = await sharePost(w, author);
    const kept = await addComment(w, peer, post.id);
    const doomed = await addComment(w, viewer, post.id);
    await reactComment(w, peer, doomed.id);
    await reactComment(w, author, kept.id);

    const commentIds = async (): Promise<string[]> => {
      const res = await w.get(peer.token, `/social/posts/${post.id}/comments`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return ((dataOf(res.body).data ?? []) as Json[]).map((c) => c.id as string).sort();
    };
    const reactionRows = async (commentId: string): Promise<number> => {
      const r = await w.direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM feed_reactions
          WHERE company_id = $1 AND target_type = 'comment' AND target_id = $2`,
        [w.A.companyId, commentId],
      );
      return r.rows[0].n;
    };

    expect(await commentIds()).toEqual([kept.id, doomed.id].sort());
    expect((await readPostCols(post.id)).comment).toBe(2);
    expect(await reactionRows(doomed.id)).toBe(1);

    const del = await w.del(viewer.token, `/social/comments/${doomed.id}`);
    expect(del.status, `017 ⇒ ${JSON.stringify(del.body)}`).toBe(200);

    expect(await commentIds(), "bình luận còn lại vẫn được trả").toEqual([kept.id]);
    expect((await readPostCols(post.id)).comment).toBe(1);
    expect(await reactionRows(doomed.id), "cảm xúc của bình luận đã xoá").toBe(0);
    expect(await reactionRows(kept.id), "cảm xúc của bình luận còn lại không bị đụng").toBe(1);
    const card = await w.get(peer.token, `/social/posts/${post.id}`);
    expect(dataOf(card.body).commentCount).toBe(1);
    // Thả cảm xúc lên bình luận đã xoá ⇒ không còn đích.
    expectSocial(
      await w.put(peer.token, `/social/comments/${doomed.id}/reaction`).send({ emoji: "like" }),
      404,
      SOCIAL_ERR.COMMENT_NOT_FOUND,
      SOCIAL_ERROR_CODES.COMMENT_NOT_FOUND,
    );
  });

  it("QA1-S-X · đối soát cuối spec: 7 cột đếm khớp COUNT thật", async () => {
    const report = await expectCountersReconciled(w.direct, w.companyIds, [
      "feed_posts.like_count",
      "feed_posts.comment_count",
      "feed_posts.view_count",
      "feed_comments.like_count",
      "feed_tags.usage_count",
      "feed_groups.member_count",
    ]);
    expect(report.drifts).toEqual([]);
  });
});
