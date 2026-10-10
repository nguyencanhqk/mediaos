/**
 * S16-SOCIAL-QA-1 (L0) — CA KHÓI của bộ đồ nghề QA SOCIAL (plan `docs/plans/S16-SOCIAL-QA-1.md` §4-L0).
 *
 * Tám lát sau dựng trên `test/helpers/social-qa1-kit.ts` + `social-qa1-kit-race.ts`; hai file đó đóng
 * băng sau lát này, nên ở đây đo CHÍNH đồ nghề: một helper đối soát không bao giờ báo lệch, một hàm
 * assert từ chối không phân biệt được hai loại 403, hay một harness giữ khoá không chặn được request
 * đều là «xanh mà rỗng» cho mọi lát sau.
 *
 *   K-1  thế giới 2 công ty + app đang nghe          K-5  đối soát BÁO lệch ở từng cột (7 cột)
 *   K-2  đủ 9 vai canonical + tổ hợp hai vai         K-6  ba hàm assert 403 phân biệt được nhau
 *   K-3  hàng rào cặp quyền ném trước khi chạm DB    K-7  harness giữ khoá hàng
 *   K-4  mọi hàm dựng dữ liệu + đối soát rỗng        K-8  PRNG · mapLimit · stripVolatile · findIdentity
 */
import { randomUUID } from "node:crypto";
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { hasDb } from "../helpers/integration-db";
import {
  CANONICAL_ROLES,
  EMPLOYEE_FEED_PAIRS,
  FEED_PAIRS,
  ackPost,
  addComment,
  assertQa1PairKeys,
  bootQa1World,
  countFeedCatalogRows,
  createGroup,
  expectGuardDenied,
  expectScopeFloorDenied,
  expectSocial,
  expectUnauthenticated,
  findIdentity,
  ideaPost,
  joinAsActiveMember,
  joinGroup,
  kudosPost,
  localDateParts,
  newsPost,
  pollPost,
  reactComment,
  reactPost,
  reportTarget,
  sameErrorBody,
  savePost,
  sharePost,
  stripVolatile,
  uniqueTag,
  viewPost,
  votePoll,
  type Qa1Actor,
  type Qa1Pair,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import {
  QA1_COUNTER_COLUMNS,
  expectCountersReconciled,
  formatDrift,
  reconcileSocialCounters,
  type Qa1CounterColumn,
} from "../helpers/social-qa1-kit-counters";
import {
  Qa1HarnessTimeout,
  fireUnderLock,
  holdRowLock,
  mapLimit,
  mulberry32,
} from "../helpers/social-qa1-kit-race";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 90_000;
const LOCK_TIMEOUT_MS = 30_000;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-QA-1 · L0 · bộ đồ nghề QA + ca khói (DB cô lập)", () => {
  let w: Qa1World;
  /** Đủ 15 cặp feed @Company. */
  let full: Qa1Actor;
  /** 7 cặp của nhân viên, thuộc đơn vị `ou`. */
  let emp: Qa1Actor;
  /** Thiếu `create:feed-post` ⇒ 002 dừng ở tầng 1. */
  let reader: Qa1Actor;
  /** Có `create:feed-post` nhưng @Department ⇒ 002 dừng ở sàn scope (tầng 2). */
  let floored: Qa1Actor;
  /** Người của công ty B. */
  let other: Qa1Actor;
  let ou: string;

  /** Hàng mang 7 cột đếm, dựng ở K-4 và dùng lại ở K-5 / K-7. */
  const rows = {} as {
    postId: string;
    commentId: string;
    tagId: string;
    groupId: string;
    optionId: string;
  };

  const readCount = async (table: string, column: string, id: string): Promise<number> => {
    const r = await w.direct.query<{ n: number }>(
      `SELECT ${column} AS n FROM ${table} WHERE id = $1 AND company_id = $2`,
      [id, w.A.companyId],
    );
    expect(r.rows.length, `${table} ${id}`).toBe(1);
    return Number(r.rows[0].n);
  };

  beforeAll(async () => {
    w = await bootQa1World("qa1smoke");
    ou = await w.orgUnit(w.A, "Don vi");
    full = await w.actor(w.A, "full", { pairs: FEED_PAIRS });
    emp = await w.actor(w.A, "emp", { pairs: EMPLOYEE_FEED_PAIRS, orgUnitId: ou });
    reader = await w.actor(w.A, "reader", { pairs: ["view:feed"] });
    floored = await w.actor(w.A, "floored", {
      pairs: ["view:feed", "create:feed-post"],
      scopes: { "create:feed-post": "Department" },
      orgUnitId: ou,
    });
    other = await w.actor(w.B, "other", { pairs: FEED_PAIRS });
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await w?.close();
  });

  it("QA1-K-1 · thế giới có 2 công ty tách biệt và app đang nghe", async () => {
    expect(w.A.companyId).not.toBe(w.B.companyId);
    expect(w.companyIds).toEqual([w.A.companyId, w.B.companyId]);
    expect(w.port).toBeGreaterThan(0);

    expectUnauthenticated(await w.get(null, "/social/feed"));
    const feed = await w.get(emp.token, "/social/feed");
    expect(feed.status, JSON.stringify(feed.body)).toBe(200);

    // Bài của A: người của A đọc được (neo dương), người của B thì không.
    const post = await sharePost(w, emp);
    expect((await w.get(full.token, `/social/posts/${post.id}`)).status).toBe(200);
    expectSocial(
      await w.get(other.token, `/social/posts/${post.id}`),
      404,
      SOCIAL_ERR.POST_NOT_FOUND,
      SOCIAL_ERROR_CODES.POST_NOT_FOUND,
    );
  });

  it("QA1-K-2 · gắn được đủ 9 vai canonical (đúng 1 hàng vai hệ thống mỗi vai) + tổ hợp hai vai", async () => {
    expect(CANONICAL_ROLES).toHaveLength(9);
    const systemRolesOf = async (userId: string): Promise<string[]> => {
      const r = await w.direct.query<{ name: string }>(
        `SELECT ro.name FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
          WHERE ur.user_id = $1 AND ur.company_id = $2 AND ro.company_id IS NULL
          ORDER BY ro.name`,
        [userId, w.A.companyId],
      );
      return r.rows.map((x) => x.name);
    };

    const byRole = {} as Record<(typeof CANONICAL_ROLES)[number], Qa1Actor>;
    for (const role of CANONICAL_ROLES) {
      byRole[role] = await w.actor(w.A, `c-${role}`, { canonical: role });
      expect(await systemRolesOf(byRole[role].userId), role).toEqual([role]);
    }

    // Vai có cặp feed đọc được bảng tin; vai không có cặp nào dừng ở tầng 1.
    expect((await w.get(byRole.employee.token, "/social/feed")).status).toBe(200);
    expect((await w.get(byRole["company-admin"].token, "/social/feed")).status).toBe(200);
    expectGuardDenied(await w.get(byRole["payroll-officer"].token, "/social/feed"));
    expectGuardDenied(await w.get(byRole["hr-manager"].token, "/social/feed"));

    const combo = await w.actor(w.A, "c-combo", { canonical: ["payroll-officer", "employee"] });
    expect(await systemRolesOf(combo.userId)).toEqual(["employee", "payroll-officer"]);
    expect((await w.get(combo.token, "/social/feed")).status).toBe(200);
  });

  it("QA1-K-3 · hàng rào cặp quyền ném với key gõ sai / wildcard TRƯỚC khi chạm DB", async () => {
    const usersOfA = async (): Promise<number> =>
      (
        await w.direct.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM users WHERE company_id = $1`,
          [w.A.companyId],
        )
      ).rows[0].n;
    const catalogBefore = await countFeedCatalogRows(w.direct);
    const usersBefore = await usersOfA();

    // Neo dương: danh sách literal KHỚP catalog (đủ 15 cặp, mỗi cặp đúng 1 hàng) và qua được hàng rào.
    expect(() => assertQa1PairKeys(FEED_PAIRS)).not.toThrow();
    for (const pair of FEED_PAIRS) {
      const [action, resource] = pair.split(":");
      const r = await w.direct.query(
        `SELECT 1 FROM permissions WHERE action = $1 AND resource_type = $2`,
        [action, resource],
      );
      expect(r.rows.length, pair).toBe(1);
    }

    const bad = (keys: string[]) => keys as unknown as Qa1Pair[];
    expect(() => assertQa1PairKeys(["view:feed-reports"])).toThrow(/view:feed-reports/);
    await expect(
      w.actor(w.A, "typo", { pairs: bad(["view:feed", "view:feed-reports"]) }),
    ).rejects.toThrow(/view:feed-reports/);
    await expect(w.actor(w.A, "wild", { pairs: bad(["*:feed-post"]) })).rejects.toThrow(
      /ngoài danh sách cho phép/,
    );
    await expect(w.actor(w.A, "wild2", { pairs: bad(["view:feed-*"]) })).rejects.toThrow(
      /ngoài danh sách cho phép/,
    );
    await expect(
      w.actor(w.A, "scope", { pairs: ["view:feed"], scopes: { "manage:feed-post": "Company" } }),
    ).rejects.toThrow(/không nằm trong pairs/);

    expect(await usersOfA(), "lời gọi bị hàng rào chặn không được tạo tài khoản").toBe(usersBefore);
    expect(await countFeedCatalogRows(w.direct), "catalog feed không đổi").toBe(catalogBefore);
  });

  it("QA1-K-4 · mọi hàm dựng dữ liệu chạy được qua API và đối soát 7 cột đếm RỖNG", async () => {
    const tag = uniqueTag();
    const share = await sharePost(w, emp, `Bài có thẻ #${tag}`);
    expect(share.data.tags).toEqual([tag]);
    const unitPost = await sharePost(w, emp, undefined, { audience: "org_unit", orgUnitId: ou });
    expect(unitPost.data.audience).toBe("org_unit");

    const news = await newsPost(w, full, { requiresAck: true });
    await ackPost(w, emp, news.id);
    const idea = await ideaPost(w, emp);
    expect(idea.data.type).toBe("idea");
    const kudos = await kudosPost(w, emp, [full.employeeId as string]);
    expect(kudos.data.type).toBe("kudos");
    expect((await savePost(w, full, share.id)).savedByMe).toBe(true);

    const comment = await addComment(w, full, share.id);
    await addComment(w, emp, share.id, undefined, comment.id);
    await reactPost(w, full, share.id);
    await reactPost(w, emp, share.id, "love");
    await reactComment(w, emp, comment.id);
    const firstView = await viewPost(w, full, share.id);
    const repeatView = await viewPost(w, full, share.id);

    const group = await createGroup(w, emp, "public");
    expect((await joinGroup(w, full, group.id)).myStatus).toBe("active");
    const closed = await createGroup(w, emp, "private");
    expect((await joinGroup(w, full, closed.id)).myStatus).toBe("pending");
    await joinAsActiveMember(w, emp, reader, closed.id);
    const groupPost = await sharePost(w, emp, undefined, { audience: "group", groupId: group.id });
    expect(groupPost.data.groupId).toBe(group.id);

    const poll = await pollPost(w, emp);
    expect(poll.optionIds).toHaveLength(3);
    await votePoll(w, full, poll.id, [poll.optionIds[0]]);
    await votePoll(w, emp, poll.id, [poll.optionIds[1]]);
    const report = await reportTarget(w, full, "post", share.id);
    expect(report.id).toMatch(/^[0-9a-f-]{36}$/);

    // Đối soát TRƯỚC (thông điệp đỏ nêu `bảng.cột`), rồi mới tới các neo số tuyệt đối.
    const report7 = await expectCountersReconciled(w.direct, w.companyIds, QA1_COUNTER_COLUMNS);
    expect(Object.keys(report7.checked).sort()).toEqual([...QA1_COUNTER_COLUMNS].sort());
    expect(firstView.viewCount).toBe(1);
    expect(repeatView, "lượt xem lặp không mang viewCount").not.toHaveProperty("viewCount");

    const tagRow = await w.direct.query<{ tag_id: string }>(
      `SELECT tag_id FROM feed_post_tags WHERE post_id = $1 AND company_id = $2`,
      [share.id, w.A.companyId],
    );
    expect(tagRow.rows.length).toBe(1);
    Object.assign(rows, {
      postId: share.id,
      commentId: comment.id,
      tagId: tagRow.rows[0].tag_id,
      groupId: group.id,
      optionId: poll.optionIds[0],
    });

    // Neo dương: các cột thật sự KHÁC 0 — «0 = 0» không chứng minh được gì.
    expect(await readCount("feed_posts", "like_count", rows.postId)).toBe(2);
    expect(await readCount("feed_posts", "comment_count", rows.postId)).toBe(2);
    expect(await readCount("feed_posts", "view_count", rows.postId)).toBe(1);
    expect(await readCount("feed_comments", "like_count", rows.commentId)).toBe(1);
    expect(await readCount("feed_tags", "usage_count", rows.tagId)).toBe(1);
    expect(await readCount("feed_groups", "member_count", rows.groupId)).toBe(2);
    expect(await readCount("feed_groups", "member_count", closed.id)).toBe(2);
    expect(await readCount("feed_poll_options", "vote_count", rows.optionId)).toBe(1);
  });

  const SKEW: ReadonlyArray<{
    column: Qa1CounterColumn;
    table: string;
    col: string;
    id: () => string;
  }> = [
    {
      column: "feed_posts.like_count",
      table: "feed_posts",
      col: "like_count",
      id: () => rows.postId,
    },
    {
      column: "feed_posts.comment_count",
      table: "feed_posts",
      col: "comment_count",
      id: () => rows.postId,
    },
    {
      column: "feed_posts.view_count",
      table: "feed_posts",
      col: "view_count",
      id: () => rows.postId,
    },
    {
      column: "feed_comments.like_count",
      table: "feed_comments",
      col: "like_count",
      id: () => rows.commentId,
    },
    {
      column: "feed_tags.usage_count",
      table: "feed_tags",
      col: "usage_count",
      id: () => rows.tagId,
    },
    {
      column: "feed_groups.member_count",
      table: "feed_groups",
      col: "member_count",
      id: () => rows.groupId,
    },
    {
      column: "feed_poll_options.vote_count",
      table: "feed_poll_options",
      col: "vote_count",
      id: () => rows.optionId,
    },
  ];

  it("QA1-K-5 · bảng tự-kiểm phủ ĐỦ 7 cột của helper đối soát", () => {
    expect(SKEW.map((s) => s.column)).toEqual([...QA1_COUNTER_COLUMNS]);
  });

  it.each(SKEW)(
    "QA1-K-5 · đối soát BÁO lệch khi tự làm lệch $column trong công ty mình",
    async ({ column, table, col, id }) => {
      const rowId = id();
      expect(rowId, "K-4 phải dựng hàng trước").toBeTruthy();
      const bump = (delta: number) =>
        w.direct.query(
          `UPDATE ${table} SET ${col} = ${col} + $1 WHERE id = $2 AND company_id = $3`,
          [delta, rowId, w.A.companyId],
        );
      const before = await readCount(table, col, rowId);

      expect((await bump(1)).rowCount).toBe(1);
      try {
        const skewed = await reconcileSocialCounters(w.direct, w.companyIds);
        expect(skewed.drifts.map(formatDrift)).toEqual([
          `${column} id=${rowId} stored=${before + 1} actual=${before}`,
        ]);
        expect(skewed.drifts[0]?.companyId).toBe(w.A.companyId);
        await expect(expectCountersReconciled(w.direct, w.companyIds)).rejects.toThrow();
        // Lệch của công ty A không được hiện khi chỉ soát công ty B.
        expect((await reconcileSocialCounters(w.direct, [w.B.companyId])).drifts).toEqual([]);
      } finally {
        await bump(-1);
      }
      expect((await reconcileSocialCounters(w.direct, w.companyIds)).drifts).toEqual([]);
    },
  );

  it("QA1-K-6 · ba hàm assert 403 phân biệt được tầng 1 · sàn scope · mã SOCIAL (kèm ca cho phép)", async () => {
    const body = { type: "share", audience: "company", body: "Bài thử từ chối" };
    const threw = (fn: () => void): boolean => {
      try {
        fn();
        return false;
      } catch {
        return true;
      }
    };

    // Cho phép (cùng request): đủ cặp @Company ⇒ 201.
    expect((await w.post(emp.token, "/social/posts").send(body)).status).toBe(201);

    // Tầng 1 — thiếu cặp của decorator.
    const tier1 = await w.post(reader.token, "/social/posts").send(body);
    expectGuardDenied(tier1);
    expect(
      threw(() => expectScopeFloorDenied(tier1)),
      "tầng 1 không được qua assert sàn scope",
    ).toBe(true);

    // Tầng 2 — có cặp nhưng dưới sàn Company.
    const floor = await w.post(floored.token, "/social/posts").send(body);
    expectScopeFloorDenied(floor);
    expect(
      threw(() => expectGuardDenied(floor)),
      "403 tầng 2 không được qua assert tầng 1",
    ).toBe(true);

    // Tầng 2 — mang mã SOCIAL (nhân viên đăng tin tức).
    const coded = await w
      .post(emp.token, "/social/posts")
      .send({ type: "news", audience: "company", body: "Tin thử" });
    expectSocial(
      coded,
      403,
      SOCIAL_ERR.NEWS_MANAGE_REQUIRED,
      SOCIAL_ERROR_CODES.NEWS_MANAGE_REQUIRED,
    );
    expect(
      threw(() => expectGuardDenied(coded)),
      "403 mang mã SOCIAL không phải tầng 1",
    ).toBe(true);
    expect(
      threw(() => expectScopeFloorDenied(coded)),
      "403 mang mã SOCIAL không phải sàn scope",
    ).toBe(true);
    expect(
      threw(() =>
        expectSocial(
          coded,
          403,
          SOCIAL_ERR.NOT_CONTENT_OWNER,
          SOCIAL_ERROR_CODES.NOT_CONTENT_OWNER,
        ),
      ),
      "expectSocial phải đỏ với khoá anh em",
    ).toBe(true);
    // Cho phép song sinh của ca tin tức.
    expect((await newsPost(w, full)).data.type).toBe("news");

    // sameErrorBody: hai id bịa cho cùng một thân; 404 và 403 thì không.
    const ghostA = await w.get(emp.token, `/social/posts/${randomUUID()}`);
    const ghostB = await w.get(emp.token, `/social/posts/${randomUUID()}`);
    expect(ghostA.status).toBe(404);
    sameErrorBody(ghostA, ghostB);
    expect(threw(() => sameErrorBody(ghostA, tier1))).toBe(true);
  });

  it(
    "QA1-K-7 · harness giữ khoá hàng: request ghi xếp hàng sau khoá, request đọc thì không",
    async () => {
      const post = await sharePost(w, emp);
      const target = { table: "feed_posts", companyId: w.A.companyId, id: post.id } as const;

      // Hâm nóng kết nối của hai actor trước khi giữ khoá.
      expect((await w.get(full.token, `/social/posts/${post.id}`)).status).toBe(200);
      expect((await w.get(reader.token, `/social/posts/${post.id}`)).status).toBe(200);

      const raced = await fireUnderLock(target, [
        () => w.put(full.token, `/social/posts/${post.id}/reaction`).send({ emoji: "like" }),
        () => w.put(reader.token, `/social/posts/${post.id}/reaction`).send({ emoji: "like" }),
      ]);
      expect(raced.blocked, "cả hai request phải bị holder chặn").toBe(2);
      expect(raced.queued).toBe(true);
      expect(raced.results.map((r) => r.status)).toEqual([200, 200]);
      expect(await readCount("feed_posts", "like_count", post.id)).toBe(2);

      // Đối chứng: request chỉ-đọc trả lời khi khoá còn giữ.
      const seen = await fireUnderLock(
        target,
        [() => w.get(full.token, `/social/posts/${post.id}`)],
        {
          mode: "observe",
        },
      );
      expect(seen.queued).toBe(false);
      expect(seen.results[0]?.status).toBe(200);

      // Đòi «bị chặn» với một request không bao giờ bị chặn ⇒ lỗi HARNESS có nhãn, không phải kết quả.
      await expect(
        fireUnderLock(target, [() => w.get(full.token, `/social/posts/${post.id}`)], {
          waitMs: 400,
        }),
      ).rejects.toBeInstanceOf(Qa1HarnessTimeout);

      // `whileBlocked` chạy trong tx giữ khoá và được COMMIT.
      const marked = await fireUnderLock(
        target,
        [() => w.put(emp.token, `/social/posts/${post.id}/reaction`).send({ emoji: "wow" })],
        {
          whileBlocked: async (c) => {
            await c.query(`UPDATE feed_posts SET comments_locked = true WHERE id = $1`, [post.id]);
          },
        },
      );
      expect(marked.results[0]?.status).toBe(200);
      const locked = await w.direct.query<{ comments_locked: boolean }>(
        `SELECT comments_locked FROM feed_posts WHERE id = $1`,
        [post.id],
      );
      expect(locked.rows[0]?.comments_locked).toBe(true);

      // Đích không tồn tại ⇒ ném (không «đua với không khí»); khoá nhả được nhiều lần.
      await expect(holdRowLock({ ...target, id: randomUUID() })).rejects.toThrow(/không hàng nào/);
      const hold = await holdRowLock(target);
      expect(hold.lockedRows).toBe(1);
      expect(await hold.countBlocked()).toBe(0);
      await hold.release();
      await hold.release();

      await expectCountersReconciled(w.direct, w.companyIds, ["feed_posts.like_count"]);
    },
    LOCK_TIMEOUT_MS,
  );

  it("QA1-K-8 · PRNG tất định · mapLimit giữ thứ tự và trần song song · stripVolatile · findIdentity", async () => {
    const seq = (seed: number): number[] => {
      const rnd = mulberry32(seed);
      return Array.from({ length: 8 }, () => rnd());
    };
    expect(seq(0x51a1c0de)).toEqual(seq(0x51a1c0de));
    expect(seq(0x51a1c0de)).not.toEqual(seq(0x51a1c0df));
    expect(seq(7).every((x) => x >= 0 && x < 1)).toBe(true);

    let running = 0;
    let peak = 0;
    const doubled = await mapLimit([5, 4, 3, 2, 1, 0], 2, async (n, i) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((res) => setTimeout(res, n * 3));
      running -= 1;
      return n * 2 + i * 100;
    });
    expect(doubled).toEqual([10, 108, 206, 304, 402, 500]);
    expect(peak).toBe(2);
    expect(await mapLimit([], 4, async (x: number) => x)).toEqual([]);

    const id = randomUUID();
    const sample = {
      meta: { request_id: "r-1", timestamp: "2026-10-09T01:02:03.000Z" },
      data: {
        id,
        createdAt: "2026-10-09T01:02:03.456+07:00",
        note: `bài ${id} lúc 2026-01-02T03:04:05Z`,
      },
    };
    expect(stripVolatile(sample)).toEqual({
      data: { id, createdAt: "<ts>", note: `bài ${id} lúc <ts>` },
    });
    expect(stripVolatile(sample, { uuids: true })).toEqual({
      data: { id: "<uuid>", createdAt: "<ts>", note: "bài <uuid> lúc <ts>" },
    });
    // Sau khi bỏ UUID + mốc ISO, một regex «năm» không còn khớp nhầm. Mẫu ở trên là literal cố định
    // (mọi mốc đều năm 2026), nên phép kiểm dùng đúng literal đó — không phụ thuộc ngày chạy.
    expect(JSON.stringify(sample)).toContain("2026");
    expect(JSON.stringify(stripVolatile(sample, { uuids: true }))).not.toContain("2026");
    expect(localDateParts(new Date(2031, 0, 9)).mmdd).toBe("01-09");

    // findIdentity: tự-kiểm DƯƠNG trên thẻ bài của chính tác giả, ÂM với danh tính người khác.
    const card = (await sharePost(w, emp)).data;
    const own = findIdentity(card, [emp.employeeId as string]);
    expect(own).toEqual([`$.author.employeeId=${emp.employeeId}`]);
    expect(findIdentity(card, [emp.fullName])).toEqual([
      `$.author.fullName=${emp.fullName.toLowerCase()}`,
    ]);
    expect(findIdentity(card, [full.employeeId as string, full.userId, full.email, ""])).toEqual(
      [],
    );
    expect(findIdentity({ [emp.userId]: 1 }, [emp.userId])).toEqual([
      `$.{${emp.userId}}=${emp.userId}`,
    ]);
    expect(findIdentity(card, [emp.userId]), "thẻ bài không chở userId").toEqual([]);
  });
});
