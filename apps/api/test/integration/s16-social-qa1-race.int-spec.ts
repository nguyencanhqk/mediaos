/**
 * S16-SOCIAL-QA-1 (L6) — ĐUA TẤT ĐỊNH trên các đường ghi có cột đếm + đối soát 7 cột
 * (plan `docs/plans/S16-SOCIAL-QA-1.md` §4-L6, Bảng 3 các dòng QA1-R).
 *
 * Khuôn (plan D7): giữ `FOR UPDATE` trên hàng CHA bằng pool riêng → phóng N request → chờ tới khi đúng
 * N phiên bị CHÍNH holder chặn → nhả → đọc CỘT đếm từ DB (thân của route cảm xúc trả COUNT thật nên
 * không dùng làm thước). Không `sleep`, không trông vào may rủi của `Promise.all`.
 *
 *   R-0   tự-kiểm harness + lượt đối chứng không khoá     R-6   cùng cử tri, hai lựa chọn
 *   R-1   5 người thả cảm xúc một bài                     R-8   5 người vào nhóm mở
 *   R-2   cùng người, cùng emoji ×2                       R-9   cùng người vào nhóm ×2
 *   R-3   5 người thả cảm xúc một bình luận               R-10  3 yêu cầu vào nhóm kín
 *   R-4   cùng người xem ×2                               R-11  xoá cùng một bài ×2
 *   R-5   3 cử tri, poll một-lựa-chọn                     R-12  đối soát cuối spec
 *   (R-7 = `POLL_WRITE_BUSY`, nằm ở spec mã lỗi dưới mã QA1-E-12 — không lặp ở đây.)
 *
 * ⚠️ «Harness không kịp» (`Qa1HarnessTimeout`) KHÔNG phải kết quả của sản phẩm. `race()` bên dưới tách
 * hai thứ: request không xếp hàng được MÀ cột đếm lệch ⇒ đỏ bằng thông điệp đối soát (lỗi sản phẩm);
 * request không xếp hàng được mà cột đếm khớp ⇒ ném lại lỗi mang nhãn `QA1-HARNESS` (chạy lại ca).
 */
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { hasDb } from "../helpers/integration-db";
import {
  EMPLOYEE_FEED_PAIRS,
  addComment,
  approveMember,
  bootQa1World,
  createGroup,
  expectSocial,
  pollPost,
  sharePost,
  uniqueTag,
  type Json,
  type Qa1Actor,
  type Qa1Res,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import { QA1_COUNTER_COLUMNS, expectCountersReconciled } from "../helpers/social-qa1-kit-counters";
import {
  Qa1HarnessTimeout,
  fireUnderLock,
  holdRowLock,
  type FireUnderLockOptions,
  type FireUnderLockResult,
  type Qa1LockTarget,
} from "../helpers/social-qa1-kit-race";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 90_000;
const LOCK_TIMEOUT_MS = 30_000;
/** Số request của một ca đua thường (plan D7; pool app `max: 20`). */
const RACERS = 5;
/** Đường ghi poll: sản phẩm tự đặt `lock_timeout` 3 s ⇒ ít request hơn, nhả sớm hơn (plan D7). */
const POLL_RACERS = 3;
const POLL_WAIT_MS = 1_500;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-QA-1 · L6 · đua tất định + đối soát cột đếm", () => {
  let w: Qa1World;
  /** Tác giả bài / chủ nhóm — 7 cặp của nhân viên. */
  let host: Qa1Actor;
  /** Năm người thao tác đồng thời — 7 cặp của nhân viên. */
  let racers: Qa1Actor[];

  const readCol = async (table: string, column: string, id: string): Promise<number> => {
    const r = await w.direct.query<{ n: number }>(
      `SELECT ${column} AS n FROM ${table} WHERE id = $1 AND company_id = $2`,
      [id, w.A.companyId],
    );
    expect(r.rows.length, `${table} ${id}`).toBe(1);
    return Number(r.rows[0].n);
  };

  const countRows = async (fromWhere: string, params: readonly unknown[]): Promise<number> => {
    const r = await w.direct.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${fromWhere}`, [
      w.A.companyId,
      ...params,
    ]);
    return r.rows[0].n;
  };

  const postTarget = (postId: string): Qa1LockTarget => ({
    table: "feed_posts",
    companyId: w.A.companyId,
    id: postId,
  });

  const statusesOf = (results: readonly Qa1Res[]): number[] => results.map((r) => r.status);
  const dataOf = (res: Qa1Res): Json => (res.body.data ?? {}) as Json;

  /**
   * `fireUnderLock` + tách lỗi HARNESS khỏi lỗi SẢN PHẨM: khi request không xếp hàng được sau khoá,
   * soát cột đếm trước — lệch thì đỏ bằng thông điệp đối soát, khớp thì ném lại lỗi `QA1-HARNESS`.
   */
  const race = async <T>(
    target: Qa1LockTarget,
    fire: ReadonlyArray<() => PromiseLike<T>>,
    opts: FireUnderLockOptions = {},
  ): Promise<FireUnderLockResult<T>> => {
    try {
      return await fireUnderLock(target, fire, opts);
    } catch (err) {
      if (err instanceof Qa1HarnessTimeout) {
        await expectCountersReconciled(w.direct, w.companyIds);
      }
      throw err;
    }
  };

  beforeAll(async () => {
    w = await bootQa1World("qa1race");
    host = await w.actor(w.A, "host", { pairs: EMPLOYEE_FEED_PAIRS });
    racers = [];
    for (let i = 0; i < RACERS; i += 1) {
      racers.push(await w.actor(w.A, `racer${i}`, { pairs: EMPLOYEE_FEED_PAIRS }));
    }
    // Hâm nóng: mỗi actor một request TRƯỚC mọi ca giữ khoá (kết nối pool + bộ nhớ đệm quyền).
    for (const a of [host, ...racers]) {
      const warm = await w.get(a.token, "/social/feed");
      expect(warm.status, `hâm nóng ${a.label}`).toBe(200);
    }
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await w?.close();
  });

  it(
    "QA1-R-0 · harness: chỉ báo «đã xếp hàng» khi ĐÚNG N phiên bị chính holder chặn; lượt không khoá cho cùng kết quả",
    async () => {
      const locked = await sharePost(w, host);
      const bystander = await sharePost(w, host);
      const control = await sharePost(w, host);
      const pair = racers.slice(0, 2);
      const put = (a: Qa1Actor, postId: string) =>
        w.put(a.token, `/social/posts/${postId}/reaction`).send({ emoji: "like" });

      const hold = await holdRowLock(postTarget(locked.id));
      let other: Awaited<ReturnType<typeof holdRowLock>> | undefined;
      let settled: Promise<PromiseSettledResult<Qa1Res>[]> | undefined;
      try {
        other = await holdRowLock(postTarget(bystander.id));

        // Chưa phóng gì: 0 phiên bị chặn, và «chờ 1» phải hết trần.
        expect(await hold.countBlocked()).toBe(0);
        expect(await hold.waitBlocked(1, { exact: true, timeoutMs: 150 })).toBe(false);

        settled = Promise.allSettled(pair.map((a) => Promise.resolve(put(a, locked.id))));
        const queued = await hold.waitBlocked(2, { exact: true, timeoutMs: 3_000 });
        if (!queued) {
          throw new Qa1HarnessTimeout(
            `R-0: 2 request không xếp hàng sau khoá bài trong 3000 ms (đang chặn ${await hold.countBlocked()})`,
          );
        }
        // Đúng 2 — không phải 3, không phải «đúng 1»; «ít nhất 1» thì thoả.
        expect(await hold.waitBlocked(3, { exact: true, timeoutMs: 150 })).toBe(false);
        expect(await hold.waitBlocked(1, { exact: true, timeoutMs: 150 })).toBe(false);
        expect(await hold.waitBlocked(1, { timeoutMs: 150 })).toBe(true);
        // Holder của một hàng KHÁC không nhận vơ phiên đang chờ hàng này.
        expect(await other.countBlocked()).toBe(0);
      } finally {
        await hold.release();
        await other?.release();
        if (settled) await settled;
      }

      const done = await settled;
      expect(done.map((s) => (s.status === "fulfilled" ? s.value.status : s.status))).toEqual([
        200, 200,
      ]);

      // Đối chứng: cùng hai người, cùng request, KHÔNG giữ khoá ⇒ cùng trạng thái cuối.
      const free = await Promise.all(pair.map((a) => put(a, control.id)));
      expect(statusesOf(free)).toEqual([200, 200]);
      await expectCountersReconciled(w.direct, w.companyIds, ["feed_posts.like_count"]);
      expect(await readCol("feed_posts", "like_count", locked.id)).toBe(2);
      expect(await readCol("feed_posts", "like_count", control.id)).toBe(2);
      expect(await readCol("feed_posts", "like_count", bystander.id)).toBe(0);
    },
    LOCK_TIMEOUT_MS,
  );

  it(
    "QA1-R-1 · 5 người thả cảm xúc cùng một bài dưới khoá hàng bài ⇒ cột like_count == COUNT == 5",
    async () => {
      const post = await sharePost(w, host);
      expect(await readCol("feed_posts", "like_count", post.id)).toBe(0);

      const raced = await race(
        postTarget(post.id),
        racers.map(
          (a) => () => w.put(a.token, `/social/posts/${post.id}/reaction`).send({ emoji: "like" }),
        ),
      );

      // Đối soát TRƯỚC (thông điệp đỏ nêu `bảng.cột`), rồi mới tới các neo số tuyệt đối.
      await expectCountersReconciled(w.direct, w.companyIds, ["feed_posts.like_count"]);
      expect(raced.blocked, "cả 5 request phải xếp hàng sau khoá").toBe(RACERS);
      expect(statusesOf(raced.results)).toEqual([200, 200, 200, 200, 200]);
      expect(await readCol("feed_posts", "like_count", post.id)).toBe(RACERS);
      expect(
        await countRows(
          `feed_reactions WHERE company_id = $1 AND target_type = 'post' AND target_id = $2`,
          [post.id],
        ),
      ).toBe(RACERS);
    },
    LOCK_TIMEOUT_MS,
  );

  it(
    "QA1-R-2 · cùng một người, 2 request cùng emoji ⇒ 200 + 200, đúng 1 hàng cảm xúc, cột +1",
    async () => {
      const post = await sharePost(w, host);
      const who = racers[0];
      expect(await readCol("feed_posts", "like_count", post.id)).toBe(0);

      const fire = () =>
        w.put(who.token, `/social/posts/${post.id}/reaction`).send({ emoji: "love" });
      const raced = await race(postTarget(post.id), [fire, fire]);

      await expectCountersReconciled(w.direct, w.companyIds, ["feed_posts.like_count"]);
      expect(raced.blocked).toBe(2);
      expect(statusesOf(raced.results)).toEqual([200, 200]);
      expect(await readCol("feed_posts", "like_count", post.id)).toBe(1);
      expect(
        await countRows(
          `feed_reactions WHERE company_id = $1 AND target_type = 'post' AND target_id = $2 AND user_id = $3`,
          [post.id, who.userId],
        ),
      ).toBe(1);
    },
    LOCK_TIMEOUT_MS,
  );

  it(
    "QA1-R-3 · 5 người thả cảm xúc cùng một BÌNH LUẬN dưới khoá hàng bình luận ⇒ feed_comments.like_count == COUNT == 5",
    async () => {
      const post = await sharePost(w, host);
      const comment = await addComment(w, host, post.id);
      expect(await readCol("feed_comments", "like_count", comment.id)).toBe(0);

      const raced = await race(
        { table: "feed_comments", companyId: w.A.companyId, id: comment.id },
        racers.map(
          (a) => () =>
            w.put(a.token, `/social/comments/${comment.id}/reaction`).send({ emoji: "like" }),
        ),
      );

      await expectCountersReconciled(w.direct, w.companyIds, ["feed_comments.like_count"]);
      expect(raced.blocked).toBe(RACERS);
      expect(statusesOf(raced.results)).toEqual([200, 200, 200, 200, 200]);
      expect(await readCol("feed_comments", "like_count", comment.id)).toBe(RACERS);
      // Cảm xúc trên bình luận không cộng vào cột của BÀI.
      expect(await readCol("feed_posts", "like_count", post.id)).toBe(0);
    },
    LOCK_TIMEOUT_MS,
  );

  it(
    "QA1-R-4 · cùng một người xem 2 lần đồng thời ⇒ view_count +1; đúng MỘT thân mang viewCount",
    async () => {
      const post = await sharePost(w, host);
      const who = racers[1];
      expect(await readCol("feed_posts", "view_count", post.id)).toBe(0);

      const fire = () => w.post(who.token, `/social/posts/${post.id}/view`);
      const raced = await race(postTarget(post.id), [fire, fire]);

      await expectCountersReconciled(w.direct, w.companyIds, ["feed_posts.view_count"]);
      expect(raced.blocked).toBe(2);
      expect(statusesOf(raced.results)).toEqual([201, 201]);
      expect(await readCol("feed_posts", "view_count", post.id)).toBe(1);

      const bodies = raced.results.map(dataOf);
      const withCount = bodies.filter((b) => "viewCount" in b);
      expect(withCount, "lượt ghi được hàng mang viewCount, lượt lặp thì không").toHaveLength(1);
      expect(withCount[0]?.viewCount).toBe(1);
    },
    LOCK_TIMEOUT_MS,
  );

  it(
    "QA1-R-5 · poll một-lựa-chọn: 3 cử tri dưới khoá hàng poll ⇒ 3 × 200; TỪNG lựa chọn vote_count == COUNT; tổng 3",
    async () => {
      const poll = await pollPost(w, host);
      const voters = racers.slice(0, POLL_RACERS);
      // Hâm nóng trên CHÍNH bài poll trước khi giữ khoá.
      for (const v of voters) {
        expect((await w.get(v.token, `/social/posts/${poll.id}`)).status).toBe(200);
      }
      const picks = [poll.optionIds[0], poll.optionIds[1], poll.optionIds[0]];

      const raced = await race(
        { table: "feed_polls", companyId: w.A.companyId, id: poll.id, by: "post_id" },
        voters.map(
          (v, i) => () =>
            w.put(v.token, `/social/posts/${poll.id}/poll/vote`).send({ optionIds: [picks[i]] }),
        ),
        { waitMs: POLL_WAIT_MS },
      );

      await expectCountersReconciled(w.direct, w.companyIds, ["feed_poll_options.vote_count"]);
      expect(raced.blocked).toBe(POLL_RACERS);
      expect(statusesOf(raced.results)).toEqual([200, 200, 200]);
      const perOption = await Promise.all(
        poll.optionIds.map((id) => readCol("feed_poll_options", "vote_count", id)),
      );
      expect(perOption).toEqual([2, 1, 0]);
      expect(perOption.reduce((a, b) => a + b, 0)).toBe(POLL_RACERS);
    },
    LOCK_TIMEOUT_MS,
  );

  it(
    "QA1-R-6 · cùng một cử tri, 2 request hai lựa chọn khác nhau ⇒ không 5xx, cuối cùng đúng 1 hàng phiếu",
    async () => {
      const poll = await pollPost(w, host);
      const voter = racers[3];
      expect((await w.get(voter.token, `/social/posts/${poll.id}`)).status).toBe(200);

      const raced = await race(
        { table: "feed_polls", companyId: w.A.companyId, id: poll.id, by: "post_id" },
        [poll.optionIds[0], poll.optionIds[1]].map(
          (optionId) => () =>
            w
              .put(voter.token, `/social/posts/${poll.id}/poll/vote`)
              .send({ optionIds: [optionId] }),
        ),
        { waitMs: POLL_WAIT_MS },
      );

      await expectCountersReconciled(w.direct, w.companyIds, ["feed_poll_options.vote_count"]);
      expect(raced.blocked).toBe(2);
      const statuses = statusesOf(raced.results);
      for (const s of statuses) expect(s, `status ${statuses.join(" + ")}`).toBeLessThan(500);
      expect(statuses, "ít nhất một lượt ghi được phiếu").toContain(200);

      const votes = await w.direct.query<{ option_id: string }>(
        `SELECT v.option_id FROM feed_poll_votes v JOIN feed_polls p
            ON p.id = v.poll_id AND p.company_id = v.company_id
          WHERE v.company_id = $1 AND p.post_id = $2 AND v.user_id = $3`,
        [w.A.companyId, poll.id, voter.userId],
      );
      expect(votes.rows.length).toBe(1);
      expect(poll.optionIds.slice(0, 2)).toContain(votes.rows[0].option_id);
      const perOption = await Promise.all(
        poll.optionIds.map((id) => readCol("feed_poll_options", "vote_count", id)),
      );
      expect(perOption.reduce((a, b) => a + b, 0)).toBe(1);
      expect(await readCol("feed_poll_options", "vote_count", votes.rows[0].option_id)).toBe(1);
    },
    LOCK_TIMEOUT_MS,
  );

  const groupTarget = (groupId: string): Qa1LockTarget => ({
    table: "feed_groups",
    companyId: w.A.companyId,
    id: groupId,
  });
  const membersOf = (groupId: string, status: "active" | "pending"): Promise<number> =>
    countRows(`feed_group_members WHERE company_id = $1 AND group_id = $2 AND status = $3`, [
      groupId,
      status,
    ]);

  it(
    "QA1-R-8 · nhóm mở: 5 người tham gia đồng thời dưới khoá hàng nhóm ⇒ 5 × 201; member_count == COUNT active == trước + 5",
    async () => {
      const group = await createGroup(w, host, "public");
      const before = await readCol("feed_groups", "member_count", group.id);

      const raced = await race(
        groupTarget(group.id),
        racers.map((a) => () => w.post(a.token, `/social/groups/${group.id}/join`)),
      );

      await expectCountersReconciled(w.direct, w.companyIds, ["feed_groups.member_count"]);
      expect(before, "người tạo nhóm đã được đếm").toBe(1);
      expect(raced.blocked).toBe(RACERS);
      expect(statusesOf(raced.results)).toEqual([201, 201, 201, 201, 201]);
      expect(await readCol("feed_groups", "member_count", group.id)).toBe(before + RACERS);
      expect(await membersOf(group.id, "active")).toBe(before + RACERS);
    },
    LOCK_TIMEOUT_MS,
  );

  it(
    "QA1-R-9 · cùng một người tham gia 2 lần đồng thời ⇒ đúng một 201 + một 409 theo MÃ; cột +1",
    async () => {
      const group = await createGroup(w, host, "public");
      const who = racers[2];
      const before = await readCol("feed_groups", "member_count", group.id);

      const fire = () => w.post(who.token, `/social/groups/${group.id}/join`);
      const raced = await race(groupTarget(group.id), [fire, fire]);

      await expectCountersReconciled(w.direct, w.companyIds, ["feed_groups.member_count"]);
      expect(raced.blocked).toBe(2);
      expect([...statusesOf(raced.results)].sort()).toEqual([201, 409]);
      const loser = raced.results.find((r) => r.status === 409) as Qa1Res;
      expectSocial(
        loser,
        409,
        SOCIAL_ERR.GROUP_MEMBERSHIP_EXISTS,
        SOCIAL_ERROR_CODES.GROUP_MEMBERSHIP_EXISTS,
      );
      expect(await readCol("feed_groups", "member_count", group.id)).toBe(before + 1);
      expect(
        await countRows(
          `feed_group_members WHERE company_id = $1 AND group_id = $2 AND user_id = $3`,
          [group.id, who.userId],
        ),
      ).toBe(1);
    },
    LOCK_TIMEOUT_MS,
  );

  it(
    "QA1-R-10 · nhóm kín: 3 yêu cầu đồng thời ⇒ 3 hàng pending, member_count KHÔNG đổi; duyệt 1 ⇒ +1",
    async () => {
      const group = await createGroup(w, host, "private");
      const askers = racers.slice(0, 3);
      const before = await readCol("feed_groups", "member_count", group.id);

      const raced = await race(
        groupTarget(group.id),
        askers.map((a) => () => w.post(a.token, `/social/groups/${group.id}/join`)),
      );

      await expectCountersReconciled(w.direct, w.companyIds, ["feed_groups.member_count"]);
      expect(raced.blocked).toBe(3);
      expect(statusesOf(raced.results)).toEqual([201, 201, 201]);
      expect(raced.results.map((r) => dataOf(r).myStatus)).toEqual([
        "pending",
        "pending",
        "pending",
      ]);
      expect(await membersOf(group.id, "pending")).toBe(3);
      expect(await readCol("feed_groups", "member_count", group.id)).toBe(before);

      // Đối chứng: cột CÓ nhúc nhích khi một yêu cầu được duyệt.
      await approveMember(w, host, group.id, askers[0].userId);
      await expectCountersReconciled(w.direct, w.companyIds, ["feed_groups.member_count"]);
      expect(await readCol("feed_groups", "member_count", group.id)).toBe(before + 1);
      expect(await membersOf(group.id, "pending")).toBe(2);
    },
    LOCK_TIMEOUT_MS,
  );

  it(
    "QA1-R-11 · xoá cùng một bài 2 lần đồng thời ⇒ không 5xx; usage_count của thẻ −1 đúng MỘT lần",
    async () => {
      const tag = uniqueTag("race");
      const post = await sharePost(w, host, `Bài sẽ xoá #${tag}`);
      const tagRow = await w.direct.query<{ tag_id: string }>(
        `SELECT tag_id FROM feed_post_tags WHERE company_id = $1 AND post_id = $2`,
        [w.A.companyId, post.id],
      );
      expect(tagRow.rows.length).toBe(1);
      const tagId = tagRow.rows[0].tag_id;
      // Bài thứ hai cùng thẻ: cột bắt đầu ở 2, nên «trừ hai lần» hạ về 0 chứ không bị CHECK chặn.
      await sharePost(w, host, `Bài giữ lại #${tag}`);
      expect(await readCol("feed_tags", "usage_count", tagId)).toBe(2);

      const fire = () => w.del(host.token, `/social/posts/${post.id}`);
      const raced = await race(postTarget(post.id), [fire, fire]);

      await expectCountersReconciled(w.direct, w.companyIds, ["feed_tags.usage_count"]);
      expect(raced.blocked).toBe(2);
      const statuses = statusesOf(raced.results);
      for (const s of statuses) expect([200, 404], `status ${statuses.join(" + ")}`).toContain(s);
      expect(statuses).toContain(200);
      expect(await readCol("feed_tags", "usage_count", tagId)).toBe(1);
      expect(
        await countRows(`feed_posts WHERE company_id = $1 AND id = $2 AND deleted_at IS NOT NULL`, [
          post.id,
        ]),
      ).toBe(1);
      // Tuần tự sau đó: bài đã xoá ⇒ 404 theo MÃ.
      expectSocial(
        await w.del(host.token, `/social/posts/${post.id}`),
        404,
        SOCIAL_ERR.POST_NOT_FOUND,
        SOCIAL_ERROR_CODES.POST_NOT_FOUND,
      );
      expect(await readCol("feed_tags", "usage_count", tagId)).toBe(1);
    },
    LOCK_TIMEOUT_MS,
  );

  it("QA1-R-12 · cuối spec: đối soát cả 7 cột đếm ⇒ không cột nào lệch, cột nào cũng có hàng được soát", async () => {
    const report = await expectCountersReconciled(w.direct, w.companyIds, QA1_COUNTER_COLUMNS);
    expect(report.drifts).toEqual([]);
    // Neo dương: các ca trên thật sự đã ghi — không phải «0 = 0» trên bảng rỗng.
    expect(
      await countRows(`feed_reactions WHERE company_id = $1`, []),
      "số hàng cảm xúc của công ty A",
    ).toBeGreaterThanOrEqual(2 * RACERS + 5);
    expect(await countRows(`feed_poll_votes WHERE company_id = $1`, [])).toBe(POLL_RACERS + 1);
    expect(
      await countRows(`feed_group_members WHERE company_id = $1 AND status = 'active'`, []),
    ).toBe(3 + RACERS + 1 + 1);
  });
});
