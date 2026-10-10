/**
 * S16-SOCIAL-QA-1 (L5) — MÃ LỖI SOCIAL ĐO THEO MÃ QUA HTTP (plan `docs/plans/S16-SOCIAL-QA-1.md` Bảng 2,
 * §4-L5, D5 · D6).
 *
 *   QA1-E-01…13   13 khoá trước đây chỉ có ca theo chuỗi số / theo status / chưa có ca: mỗi ca assert
 *                 status + `error.code` + `error.message` bằng HẰNG, cạnh ca cho phép song sinh.
 *   QA1-E-14      404 của bài: bốn nguồn «id không tồn tại · công ty khác · đã xoá · đang ẩn» ⇒ MỘT thân.
 *   QA1-E-X1…X5   mã ngoài SOCIAL trên route SOCIAL + hai khoá bị biên validate chặn trước service.
 *   QA1-E-N1      báo cáo một bài ⇒ người xử lý báo cáo nhận đúng một thông báo.
 *   QA1-E-G1      gỡ một chủ nhóm: còn chủ khác ⇒ 200; chủ duy nhất ⇒ 409 theo mã.
 *   QA1-E-R1…R3   ratchet của bảng `CODE_CASES` (57 khoá ↔ ca đo nó).
 *
 * Các khoá còn lại đã có ca theo mã ở int-spec khác — bảng `test/helpers/social-qa1-code-cases.ts` ghi
 * khoá nào do ca nào gánh, và QA1-E-R2 kiểm từng dòng của bảng đó.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { IDEMPOTENCY_ERROR_CODES, SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { UnprocessableEntityException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OutboxWorker } from "../../src/events/outbox-worker";
import { SocialReactionsService } from "../../src/social/social-reactions.service";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { hasDb } from "../helpers/integration-db";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import {
  OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  acquireOutboxWorkerLock,
} from "../helpers/outbox-worker-lock";
import { CODE_CASES, type Qa1CodeCase } from "../helpers/social-qa1-code-cases";
import { countPostsBy, snapGroup, snapPost } from "../helpers/social-qa1-idor-util";
import {
  EMPLOYEE_FEED_PAIRS,
  FEED_PAIRS,
  ackPost,
  addComment,
  bootQa1World,
  createGroup,
  expectSocial,
  joinGroup,
  newsPost,
  pollPost,
  reportTarget,
  sameErrorBody,
  sharePost,
  type Qa1Actor,
  type Qa1Res,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import { holdRowLock } from "../helpers/social-qa1-kit-race";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;
const VALIDATION_CODE = "VALIDATION-ERR-001";
const INTEGRATION_DIR = __dirname;
const CENSUS_FILE = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "social",
  "social-error-code-census.spec.ts",
);

const lite = (res: { status: number; body: unknown }): Qa1Res => ({
  status: res.status,
  body: res.body as Qa1Res["body"],
});
const dump = (res: { status: number; body: unknown }): string =>
  `${res.status} ${JSON.stringify(res.body)}`;
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe.skipIf(!hasLaneDb)("S16-SOCIAL-QA-1 · L5 · mã lỗi SOCIAL theo MÃ (DB cô lập)", () => {
  let w: Qa1World;
  /** Tác giả nội dung mẫu: 7 cặp nhân viên + cặp tin tức, thuộc đơn vị X. */
  let owner: Qa1Actor;
  /** Đồng nghiệp thường (7 cặp nhân viên), thuộc đơn vị Y. */
  let peer: Qa1Actor;
  /** Có cặp kiểm duyệt bài nhưng KHÔNG có cặp tin tức. */
  let mod: Qa1Actor;
  /** Đủ 15 cặp. */
  let admin: Qa1Actor;
  /** Đủ 15 cặp ở công ty B. */
  let bAdmin: Qa1Actor;
  let unitX: string;

  const A = (): string => w.A.companyId;
  const count = async (sql: string, params: readonly unknown[]): Promise<number> =>
    (await w.direct.query<{ n: number }>(sql, [...params])).rows[0].n;

  /** Một hàng `files` đã tải xong, sạch, của `ownerUserId` — gieo tay: ca đo cổng GẮN tệp, không đo upload. */
  const seedFile = async (
    ownerUserId: string,
    opts: { mime?: string; size?: number } = {},
  ): Promise<string> => {
    const id = randomUUID();
    await w.direct.query(
      `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
                          storage_provider, storage_path, upload_status, scan_status,
                          owner_user_id, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,'MinIO',$7,'Uploaded','Clean',$8,$8)`,
      [
        id,
        A(),
        `f-${id.slice(0, 6)}.png`,
        `stored-${id}`,
        opts.mime ?? "image/png",
        opts.size ?? 1024,
        `${A()}/social/${id}`,
        ownerUserId,
      ],
    );
    return id;
  };
  const postWith = (by: Qa1Actor, attachmentIds: readonly string[]) =>
    w.post(by.token, "/social/posts").send({
      type: "share",
      audience: "company",
      body: `Bài có đính kèm ${randomUUID().slice(0, 8)}`,
      attachmentIds: [...attachmentIds],
    });

  beforeAll(async () => {
    w = await bootQa1World("qa1codes");
    unitX = await w.orgUnit(w.A, "QA1-X");
    const unitY = await w.orgUnit(w.A, "QA1-Y");
    owner = await w.actor(w.A, "owner", {
      pairs: [...EMPLOYEE_FEED_PAIRS, "manage:feed-news"],
      orgUnitId: unitX,
    });
    peer = await w.actor(w.A, "peer", { pairs: EMPLOYEE_FEED_PAIRS, orgUnitId: unitY });
    mod = await w.actor(w.A, "mod", { pairs: [...EMPLOYEE_FEED_PAIRS, "manage:feed-post"] });
    admin = await w.actor(w.A, "admin", { pairs: FEED_PAIRS });
    bAdmin = await w.actor(w.B, "badmin", { pairs: FEED_PAIRS });
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await w?.close();
  });

  // ══════════════ E-01…13 — khoá nhóm C ══════════════

  it("QA1-E-01 · đăng bài ngoài phạm vi được viết ⇒ 403 theo MÃ ở cả hai nhánh (đơn vị khác · nhóm chưa tham gia), không bài nào được ghi", async () => {
    const groupId = (await createGroup(w, owner, "public")).id;
    const toUnit = (by: Qa1Actor) =>
      w
        .post(by.token, "/social/posts")
        .send({ type: "share", audience: "org_unit", orgUnitId: unitX, body: "Bài đơn vị (E-01)" });
    const toGroup = (by: Qa1Actor) =>
      w
        .post(by.token, "/social/posts")
        .send({ type: "share", audience: "group", groupId, body: "Bài nhóm (E-01)" });
    const before = await countPostsBy(w.direct, A(), peer.userId);

    for (const call of [toUnit, toGroup]) {
      expectSocial(
        lite(await call(peer)),
        403,
        SOCIAL_ERR.WRITE_OUT_OF_AUDIENCE,
        SOCIAL_ERROR_CODES.WRITE_OUT_OF_AUDIENCE,
      );
    }
    expect(await countPostsBy(w.direct, A(), peer.userId)).toBe(before);

    // Song sinh: người thuộc đơn vị đăng được; chính người vừa bị từ chối, sau khi tham gia nhóm, đăng được.
    const inUnit = await toUnit(owner);
    expect(inUnit.status, dump(inUnit)).toBe(201);
    await joinGroup(w, peer, groupId);
    const inGroup = await toGroup(peer);
    expect(inGroup.status, dump(inGroup)).toBe(201);
  });

  it("QA1-E-02 · sửa bài của người khác ⇒ 403 theo MÃ, bài không đổi; tác giả ⇒ 200", async () => {
    const postId = (await sharePost(w, owner)).id;
    const edit = (by: Qa1Actor) =>
      w.patch(by.token, `/social/posts/${postId}`).send({ body: "Đã sửa (E-02)" });
    const before = await snapPost(w.direct, A(), postId);

    expectSocial(
      lite(await edit(peer)),
      403,
      SOCIAL_ERR.NOT_CONTENT_OWNER,
      SOCIAL_ERROR_CODES.NOT_CONTENT_OWNER,
    );
    expect(await snapPost(w.direct, A(), postId)).toBe(before);

    const ok = await edit(owner);
    expect(ok.status, dump(ok)).toBe(200);
  });

  it("QA1-E-03 · bình luận vào bài đã khoá bình luận ⇒ 409 theo MÃ, không bình luận nào được ghi; trước khi khoá ⇒ 201", async () => {
    const postId = (await sharePost(w, owner)).id;
    const comment = () =>
      w.post(peer.token, `/social/posts/${postId}/comments`).send({ body: "Bình luận (E-03)" });

    const open = await comment();
    expect(open.status, dump(open)).toBe(201);
    const lock = await w
      .patch(admin.token, `/social/posts/${postId}/moderation`)
      .send({ commentsLocked: true });
    expect(lock.status, dump(lock)).toBe(200);
    const before = await snapPost(w.direct, A(), postId);

    expectSocial(
      lite(await comment()),
      409,
      SOCIAL_ERR.COMMENTS_LOCKED,
      SOCIAL_ERROR_CODES.COMMENTS_LOCKED,
    );
    expect(await snapPost(w.direct, A(), postId)).toBe(before);
  });

  it("QA1-E-04 · đính kèm vượt trần (11 ảnh · 2 video · một tệp quá cỡ) ⇒ 422 theo MÃ ở cả ba nhánh, không bài nào được ghi; đúng trần ⇒ 201", async () => {
    const images = (n: number): Promise<string[]> =>
      Promise.all(Array.from({ length: n }, () => seedFile(owner.userId)));
    const video = (): Promise<string> => seedFile(owner.userId, { mime: "video/mp4" });
    const over: ReadonlyArray<readonly [string, string[]]> = [
      ["11 ảnh", await images(11)],
      ["2 video", [await video(), await video()]],
      ["tệp quá cỡ", [await seedFile(owner.userId, { size: 20 * 1024 * 1024 + 1 })]],
    ];
    const before = await countPostsBy(w.direct, A(), owner.userId);

    for (const [what, ids] of over) {
      const res = lite(await postWith(owner, ids));
      expect(res.status, `${what}: ${dump(res)}`).toBe(422);
      expectSocial(res, 422, SOCIAL_ERR.ATTACHMENT_LIMIT, SOCIAL_ERROR_CODES.ATTACHMENT_LIMIT);
    }
    expect(await countPostsBy(w.direct, A(), owner.userId)).toBe(before);

    const atLimit = await postWith(owner, [
      ...(await images(10)),
      await seedFile(owner.userId, { mime: "video/mp4", size: 20 * 1024 * 1024 }),
    ]);
    expect(atLimit.status, dump(atLimit)).toBe(201);
  });

  it("QA1-E-05 · đính kèm không hợp lệ (tệp của người khác · tệp không tồn tại) ⇒ 422 theo MÃ, cùng một thân, không bài nào được ghi; tệp của mình ⇒ 201", async () => {
    const foreign = await seedFile(peer.userId);
    const before = await countPostsBy(w.direct, A(), owner.userId);

    const notMine = lite(await postWith(owner, [foreign]));
    expectSocial(
      notMine,
      422,
      SOCIAL_ERR.ATTACHMENT_INVALID,
      SOCIAL_ERROR_CODES.ATTACHMENT_INVALID,
    );
    const missing = lite(await postWith(owner, [randomUUID()]));
    expectSocial(
      missing,
      422,
      SOCIAL_ERR.ATTACHMENT_INVALID,
      SOCIAL_ERROR_CODES.ATTACHMENT_INVALID,
    );
    sameErrorBody(notMine, missing, "tệp của người khác so với tệp không tồn tại");
    expect(await countPostsBy(w.direct, A(), owner.userId)).toBe(before);

    // Song sinh: CHÍNH tệp vừa bị từ chối, do chủ của nó gắn ⇒ 201.
    const mine = await postWith(peer, [foreign]);
    expect(mine.status, dump(mine)).toBe(201);
  });

  it("QA1-E-06 · đăng tin tức khi thiếu cặp quản lý tin tức ⇒ 403 theo MÃ, không bài nào được ghi; có cặp ⇒ 201", async () => {
    const news = (by: Qa1Actor) =>
      w
        .post(by.token, "/social/posts")
        .send({ type: "news", audience: "company", body: "Tin (E-06)", requiresAck: false });
    const before = await countPostsBy(w.direct, A(), peer.userId);

    expectSocial(
      lite(await news(peer)),
      403,
      SOCIAL_ERR.NEWS_MANAGE_REQUIRED,
      SOCIAL_ERROR_CODES.NEWS_MANAGE_REQUIRED,
    );
    expect(await countPostsBy(w.direct, A(), peer.userId)).toBe(before);

    const ok = await news(owner);
    expect(ok.status, dump(ok)).toBe(201);
  });

  it("QA1-E-07 · trường kiểm duyệt ngoài cặp đang giữ ⇒ 403 theo MÃ ở cả hai nhánh (ghim tin · lọc bảng tin theo trạng thái); đủ cặp ⇒ 200", async () => {
    const newsId = (await newsPost(w, owner)).id;
    const pin = (by: Qa1Actor) =>
      w.patch(by.token, `/social/posts/${newsId}/moderation`).send({ pinned: true });
    const hiddenFeed = (by: Qa1Actor) => w.get(by.token, "/social/feed?status=hidden");
    const before = await snapPost(w.direct, A(), newsId);

    expectSocial(
      lite(await pin(mod)),
      403,
      SOCIAL_ERR.MODERATION_FIELD_DENIED,
      SOCIAL_ERROR_CODES.MODERATION_FIELD_DENIED,
    );
    expect(await snapPost(w.direct, A(), newsId)).toBe(before);
    expectSocial(
      lite(await hiddenFeed(peer)),
      403,
      SOCIAL_ERR.MODERATION_FIELD_DENIED,
      SOCIAL_ERROR_CODES.MODERATION_FIELD_DENIED,
    );

    const pinned = await pin(admin);
    expect(pinned.status, dump(pinned)).toBe(200);
    const listed = await hiddenFeed(mod);
    expect(listed.status, dump(listed)).toBe(200);
  });

  it("QA1-E-08 · xác nhận đã đọc trên bài không yêu cầu xác nhận ⇒ 409 theo MÃ, không hàng xác nhận nào; tin có yêu cầu ⇒ 201", async () => {
    const plainNews = (await newsPost(w, owner)).id;
    const share = (await sharePost(w, owner)).id;
    const ackNews = (await newsPost(w, owner, { requiresAck: true })).id;

    for (const postId of [plainNews, share]) {
      const before = await snapPost(w.direct, A(), postId);
      expectSocial(
        lite(await w.post(peer.token, `/social/posts/${postId}/ack`)),
        409,
        SOCIAL_ERR.ACK_NOT_APPLICABLE,
        SOCIAL_ERROR_CODES.ACK_NOT_APPLICABLE,
      );
      expect(await snapPost(w.direct, A(), postId)).toBe(before);
    }

    await ackPost(w, peer, ackNews);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM feed_post_acks WHERE company_id = $1 AND post_id = $2`,
        [A(), ackNews],
      ),
    ).toBe(1);
  });

  it("QA1-E-09 · xử lý một báo cáo không tồn tại ⇒ 404 theo MÃ (khác thông điệp của bài / bình luận); báo cáo thật ⇒ 200", async () => {
    const resolve = (id: string) =>
      w.patch(admin.token, `/social/reports/${id}`).send({ status: "resolved" });
    const reportId = (await reportTarget(w, peer, "post", (await sharePost(w, owner)).id)).id;

    expectSocial(
      lite(await resolve(randomUUID())),
      404,
      SOCIAL_ERR.REPORT_NOT_FOUND,
      SOCIAL_ERROR_CODES.REPORT_NOT_FOUND,
    );

    const ok = await resolve(reportId);
    expect(ok.status, dump(ok)).toBe(200);
  });

  it("QA1-E-10 · bình luận không tồn tại / bình luận cha thuộc bài khác ⇒ 404 theo MÃ (khác thông điệp của bài); đúng đối tượng ⇒ thành công", async () => {
    const first = (await sharePost(w, owner)).id;
    const second = (await sharePost(w, owner)).id;
    const mine = (await addComment(w, peer, first)).id;
    const edit = (id: string) =>
      w.patch(peer.token, `/social/comments/${id}`).send({ body: "Đã sửa (E-10)" });
    const reply = (postId: string) =>
      w
        .post(peer.token, `/social/posts/${postId}/comments`)
        .send({ body: "Trả lời (E-10)", parentCommentId: mine });
    const before = await snapPost(w.direct, A(), second);

    expectSocial(
      lite(await edit(randomUUID())),
      404,
      SOCIAL_ERR.COMMENT_NOT_FOUND,
      SOCIAL_ERROR_CODES.COMMENT_NOT_FOUND,
    );
    expectSocial(
      lite(await reply(second)),
      404,
      SOCIAL_ERR.COMMENT_NOT_FOUND,
      SOCIAL_ERROR_CODES.COMMENT_NOT_FOUND,
    );
    expect(await snapPost(w.direct, A(), second)).toBe(before);
    expect(SOCIAL_ERR.COMMENT_NOT_FOUND).not.toBe(SOCIAL_ERR.POST_NOT_FOUND);

    const edited = await edit(mine);
    expect(edited.status, dump(edited)).toBe(200);
    const replied = await reply(first);
    expect(replied.status, dump(replied)).toBe(201);
  });

  it("QA1-E-11 · báo cáo trùng khi báo cáo trước còn mở ⇒ 409 theo MÃ, vẫn đúng một báo cáo; lần đầu ⇒ 201", async () => {
    const postId = (await sharePost(w, owner)).id;
    const report = () =>
      w
        .post(peer.token, "/social/reports")
        .send({ targetType: "post", targetId: postId, reason: "spam" });
    const rows = (): Promise<number> =>
      count(
        `SELECT count(*)::int AS n FROM feed_reports WHERE company_id = $1 AND target_id = $2`,
        [A(), postId],
      );

    const first = await report();
    expect(first.status, dump(first)).toBe(201);

    expectSocial(
      lite(await report()),
      409,
      SOCIAL_ERR.REPORT_DUPLICATE_OPEN,
      SOCIAL_ERROR_CODES.REPORT_DUPLICATE_OPEN,
    );
    expect(await rows()).toBe(1);
  });

  it("QA1-E-12 · bỏ phiếu khi hàng bình chọn bị giữ khoá quá trần chờ ⇒ 409 theo MÃ, không phiếu nào được ghi; nhả khoá ⇒ cùng request 200", async () => {
    const poll = await pollPost(w, owner);
    const vote = () =>
      w
        .put(peer.token, `/social/posts/${poll.id}/poll/vote`)
        .send({ optionIds: [poll.optionIds[0]] });
    const votes = (): Promise<number> =>
      count(
        `SELECT count(*)::int AS n FROM feed_poll_votes v
           JOIN feed_polls x ON x.id = v.poll_id AND x.company_id = v.company_id
          WHERE v.company_id = $1 AND x.post_id = $2`,
        [A(), poll.id],
      );
    // Hâm nóng người gọi (đăng nhập, cache quyền) để request dưới khoá chỉ còn chờ đúng hàng bình chọn.
    const warm = await w.get(peer.token, `/social/posts/${poll.id}/poll/results`);
    expect(warm.status, dump(warm)).toBe(200);

    const held = await holdRowLock(
      { table: "feed_polls", companyId: A(), id: poll.id, by: "post_id" },
      { lockTimeout: "5s" },
    );
    let busy: Qa1Res;
    const startedAt = Date.now();
    try {
      expect(held.lockedRows).toBe(1);
      busy = lite(await vote());
    } finally {
      await held.release();
    }
    const waitedMs = Date.now() - startedAt;

    expectSocial(busy, 409, SOCIAL_ERR.POLL_WRITE_BUSY, SOCIAL_ERROR_CODES.POLL_WRITE_BUSY);
    // Request phải thật sự CHỜ khoá rồi mới bỏ cuộc — trả lời ngay nghĩa là nó không đi qua hàng bị khoá.
    expect(waitedMs, "request trả lời trước khi hết trần chờ khoá").toBeGreaterThanOrEqual(2_500);
    expect(await votes()).toBe(0);

    const ok = await vote();
    expect(ok.status, dump(ok)).toBe(200);
    expect(await votes()).toBe(1);
  }, 30_000);

  it("QA1-E-13 · con trỏ phân trang dùng lại với bộ lọc khác ⇒ 400 theo MÃ; cùng bộ lọc ⇒ 200", async () => {
    await sharePost(w, owner);
    await sharePost(w, owner);
    const page = await w.get(peer.token, "/social/feed?limit=1");
    expect(page.status, dump(page)).toBe(200);
    const cursor = (page.body.data as { nextCursor: string | null }).nextCursor;
    expect(cursor, "trang đầu phải còn trang sau").toEqual(expect.any(String));
    const next = (filter: string) =>
      w.get(peer.token, `/social/feed?limit=1${filter}&cursor=${encodeURIComponent(cursor ?? "")}`);

    for (const filter of ["&type=news", "&sort=latest"]) {
      const res = lite(await next(filter));
      expect(res.status, `${filter}: ${dump(res)}`).toBe(400);
      expectSocial(
        res,
        400,
        SOCIAL_ERR.CURSOR_FILTER_MISMATCH,
        SOCIAL_ERROR_CODES.CURSOR_FILTER_MISMATCH,
      );
    }

    const same = await next("");
    expect(same.status, dump(same)).toBe(200);
  });

  // ══════════════ E-14 — một thân 404 cho bốn nguồn ══════════════

  it("QA1-E-14 · bài không thấy được: id không tồn tại · công ty khác · đã xoá · đang ẩn ⇒ cùng MỘT thân 404; trước đó cùng request ⇒ 200", async () => {
    const read = (by: Qa1Actor, id: string) => w.get(by.token, `/social/posts/${id}`);
    const foreign = (await sharePost(w, bAdmin)).id;
    const trashed = (await sharePost(w, owner)).id;
    const hidden = (await sharePost(w, owner)).id;

    // Neo dương: cả ba bài đều ĐỌC ĐƯỢC bởi người đúng tư cách trước khi đổi trạng thái.
    for (const [who, id] of [
      [bAdmin, foreign],
      [peer, trashed],
      [peer, hidden],
    ] as const) {
      const ok = await read(who, id);
      expect(ok.status, dump(ok)).toBe(200);
    }
    const removed = await w.del(owner.token, `/social/posts/${trashed}`);
    expect(removed.status, dump(removed)).toBe(200);
    const hid = await w
      .patch(admin.token, `/social/posts/${hidden}/moderation`)
      .send({ hidden: true });
    expect(hid.status, dump(hid)).toBe(200);

    const reference = lite(await read(peer, randomUUID()));
    expectSocial(reference, 404, SOCIAL_ERR.POST_NOT_FOUND, SOCIAL_ERROR_CODES.POST_NOT_FOUND);
    for (const [what, id] of [
      ["công ty khác", foreign],
      ["đã xoá", trashed],
      ["đang ẩn", hidden],
    ] as const) {
      sameErrorBody(lite(await read(peer, id)), reference, what);
    }
  });

  // ══════════════ E-X — mã ngoài SOCIAL + khoá bị biên validate chặn ══════════════

  it("QA1-E-X1 · cảm xúc ngoài bộ cho phép bị chặn ở BIÊN ⇒ 400 mã validate chung + nêu trường `emoji`, không hàng cảm xúc nào; giá trị hợp lệ ⇒ 200", async () => {
    const postId = (await sharePost(w, owner)).id;
    const put = (emoji: string) =>
      w.put(peer.token, `/social/posts/${postId}/reaction`).send({ emoji });
    const before = await snapPost(w.direct, A(), postId);

    const res = await put("khong-co-trong-bo");
    expect(res.status, dump(res)).toBe(400);
    expect(res.body.error?.code).toBe(VALIDATION_CODE);
    expect(res.body.error?.code).not.toBe(SOCIAL_ERROR_CODES.REACTION_EMOJI_INVALID);
    const fields = ((res.body.error?.details ?? []) as Array<{ field: string }>).map(
      (d) => d.field,
    );
    expect(fields).toEqual(["emoji"]);
    expect(await snapPost(w.direct, A(), postId)).toBe(before);

    const ok = await put("like");
    expect(ok.status, dump(ok)).toBe(200);
  });

  it("QA1-E-X2 · audience thiếu khoá đi kèm bị chặn ở BIÊN ⇒ 400 mã validate chung + nêu đúng trường thiếu, không bài nào được ghi; đủ khoá ⇒ 201", async () => {
    const groupId = (await createGroup(w, owner, "public")).id;
    const post = (extra: Record<string, string>) =>
      w.post(owner.token, "/social/posts").send({ type: "share", body: "Bài (E-X2)", ...extra });
    const before = await countPostsBy(w.direct, A(), owner.userId);

    for (const [audience, field] of [
      ["group", "groupId"],
      ["org_unit", "orgUnitId"],
    ] as const) {
      const res = await post({ audience });
      expect(res.status, `${audience}: ${dump(res)}`).toBe(400);
      expect(res.body.error?.code).toBe(VALIDATION_CODE);
      expect(res.body.error?.code).not.toBe(SOCIAL_ERROR_CODES.AUDIENCE_KEY_MISSING);
      const fields = ((res.body.error?.details ?? []) as Array<{ field: string }>).map(
        (d) => d.field,
      );
      expect(fields, `${audience}: ${dump(res)}`).toContain(field);
    }
    expect(await countPostsBy(w.direct, A(), owner.userId)).toBe(before);

    const complete: ReadonlyArray<Record<string, string>> = [
      { audience: "group", groupId },
      { audience: "org_unit", orgUnitId: unitX },
    ];
    for (const extra of complete) {
      const ok = await post(extra);
      expect(ok.status, dump(ok)).toBe(201);
    }
  });

  // [O8] Lớp status của phản hồi này do tầng chung của API quyết định (ngoài module SOCIAL) nên ca KHÔNG
  // ghim status cụ thể — chỉ giữ các bất biến đang đúng. Số đo thật nằm ở biên bản nghiệm thu của WO.
  it("QA1-E-X3 · [O8] thân request quá cỡ ⇒ bị từ chối bằng thân lỗi chuẩn, không bài nào được ghi; thân vừa cỡ ⇒ 201", async () => {
    const post = (body: string) =>
      w.post(owner.token, "/social/posts").send({ type: "share", audience: "company", body });
    const before = await countPostsBy(w.direct, A(), owner.userId);
    const huge = "x".repeat(150_000);

    const res = await post(huge);
    expect(res.status, dump(res).slice(0, 400)).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
    expect(res.body.error?.code).toEqual(expect.any(String));
    expect(res.body.error?.message).toEqual(expect.any(String));
    expect(res.body.meta?.request_id).toEqual(expect.any(String));
    expect(
      JSON.stringify(res.body).length,
      "thân lỗi không được dội lại nội dung gửi lên",
    ).toBeLessThan(2_000);
    expect(await countPostsBy(w.direct, A(), owner.userId)).toBe(before);

    const ok = await post("Bài vừa cỡ (E-X3)");
    expect(ok.status, dump(ok)).toBe(201);
  });

  it("QA1-E-X4 · dùng lại khoá idempotency với thân KHÁC ⇒ 409 theo MÃ, không thêm bài; cùng khoá cùng thân ⇒ trả lại chính bài cũ", async () => {
    const key = randomUUID();
    const post = (body: string) =>
      w
        .post(owner.token, "/social/posts")
        .set("Idempotency-Key", key)
        .send({ type: "share", audience: "company", body });

    const first = await post("Bài idempotent (E-X4)");
    expect(first.status, dump(first)).toBe(201);
    const after = await countPostsBy(w.direct, A(), owner.userId);

    const reused = await post("Bài idempotent (E-X4) — thân khác");
    expect(reused.status, dump(reused)).toBe(409);
    expect(reused.body.error?.code).toBe(IDEMPOTENCY_ERROR_CODES.KEY_REUSED);

    const replay = await post("Bài idempotent (E-X4)");
    expect((replay.body.data as { id: string }).id, dump(replay)).toBe(
      (first.body.data as { id: string }).id,
    );
    expect(await countPostsBy(w.direct, A(), owner.userId)).toBe(after);
  });

  it("QA1-E-X5 · gọi THẲNG service cảm xúc (không qua biên) với giá trị ngoài bộ ⇒ ném 422 mang đúng mã SOCIAL; giá trị hợp lệ ⇒ ghi một cảm xúc", async () => {
    const postId = (await sharePost(w, owner)).id;
    const service = w.app.get(SocialReactionsService, { strict: false });
    const user = { id: peer.userId, companyId: A() };
    const reactions = (): Promise<number> =>
      count(
        `SELECT count(*)::int AS n FROM feed_reactions
          WHERE company_id = $1 AND target_type = 'post' AND target_id = $2`,
        [A(), postId],
      );

    const thrown: unknown = await service.putOnPost(user, postId, "khong-co-trong-bo").then(
      () => null,
      (err: unknown) => err,
    );
    expect(thrown).toBeInstanceOf(UnprocessableEntityException);
    const http = thrown as UnprocessableEntityException;
    expect(http.getStatus()).toBe(422);
    expect(http.getResponse()).toEqual({
      code: SOCIAL_ERROR_CODES.REACTION_EMOJI_INVALID,
      message: SOCIAL_ERR.REACTION_EMOJI_INVALID,
    });
    expect(await reactions()).toBe(0);

    await service.putOnPost(user, postId, "like");
    expect(await reactions()).toBe(1);
  });

  // ══════════════ E-N1 · E-G1 ══════════════

  it(
    "QA1-E-N1 · báo cáo một bài ⇒ sự kiện được xử lý xong và người xử lý báo cáo nhận đúng một thông báo",
    async () => {
      const lock = await acquireOutboxWorkerLock("s16-social-qa1-error-codes");
      try {
        const handler = await w.actor(w.A, "handler", {
          pairs: [...EMPLOYEE_FEED_PAIRS, "view:feed-report", "manage:feed-report"],
        });
        const postId = (await sharePost(w, owner)).id;
        const reportId = (await reportTarget(w, peer, "post", postId)).id;

        await drainOutboxUntilSettled({
          worker: w.app.get(OutboxWorker, { strict: false }),
          direct: w.direct,
          companyIds: w.companyIds,
        });

        const events = await w.direct.query<{ status: string }>(
          `SELECT status FROM outbox_events
            WHERE company_id = $1 AND event_type = 'social.post_reported'
              AND payload->>'reportId' = $2`,
          [A(), reportId],
        );
        expect(events.rows.map((r) => r.status)).toEqual(["done"]);
        const notified = await w.direct.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM notifications
            WHERE company_id = $1 AND recipient_user_id = $2
              AND event_code = 'SOCIAL_POST_REPORTED' AND deleted_at IS NULL`,
          [A(), handler.userId],
        );
        expect(notified.rows, JSON.stringify(notified.rows)).toHaveLength(1);
        expect(JSON.stringify(notified.rows[0].payload)).toContain(postId);
      } finally {
        await lock.release();
      }
    },
    OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  );

  it("QA1-E-G1 · gỡ chủ nhóm: là chủ DUY NHẤT ⇒ 409 theo MÃ, nhóm không đổi; còn chủ khác ⇒ 200", async () => {
    const groupId = (await createGroup(w, owner, "public")).id;
    await joinGroup(w, peer, groupId);
    const removeOwner = () =>
      w.del(admin.token, `/social/groups/${groupId}/members/${owner.userId}`);
    const before = await snapGroup(w.direct, A(), groupId);

    expectSocial(
      lite(await removeOwner()),
      409,
      SOCIAL_ERR.GROUP_LAST_OWNER,
      SOCIAL_ERROR_CODES.GROUP_LAST_OWNER,
    );
    expect(await snapGroup(w.direct, A(), groupId)).toBe(before);

    const promoted = await w
      .patch(admin.token, `/social/groups/${groupId}/members/${peer.userId}`)
      .send({ role: "owner" });
    expect(promoted.status, dump(promoted)).toBe(200);
    const ok = await removeOwner();
    expect(ok.status, dump(ok)).toBe(200);
  });

  // ══════════════ Ratchet của bảng CODE_CASES ══════════════

  describe("ratchet · bảng khoá ↔ ca", () => {
    const entries = Object.entries(CODE_CASES) as Array<[string, Qa1CodeCase]>;
    const read = (file: string): string =>
      stripComments(fs.readFileSync(path.join(INTEGRATION_DIR, file), "utf8"));
    /** Đoạn mã từ tên ca tới đầu ca / khối kế tiếp. */
    const caseSlice = (src: string, anchor: string): string => {
      const at = src.indexOf(anchor);
      if (at < 0) return "";
      const rest = src.slice(at);
      const end = rest.search(/\n\s*(?:it|describe)(?:\.\w+)*[(<]/);
      return end < 0 ? rest : rest.slice(0, end);
    };

    it("QA1-E-R1 · bảng phủ ĐÚNG 57 khoá của bảng mã (không thiếu, không thừa) và đúng cơ cấu 52 · 3 · 2", () => {
      const keys = entries.map(([k]) => k).sort();
      expect(keys).toEqual(Object.keys(SOCIAL_ERROR_CODES).sort());
      expect(keys).toEqual(Object.keys(SOCIAL_ERR).sort());
      expect(keys).toHaveLength(57);
      const tally = (kind: Qa1CodeCase["kind"]): number =>
        entries.filter(([, c]) => c.kind === kind).length;
      expect([tally("http"), tally("http-unreachable"), tally("never-thrown")]).toEqual([52, 3, 2]);
    });

    it.each(entries.filter(([, c]) => c.kind !== "never-thrown" && "file" in c && !!c.file))(
      "QA1-E-R2 · %s: file tồn tại, có đúng tên ca, và CA ĐÓ assert bằng hằng mã của khoá",
      (key, entry) => {
        if (entry.kind === "never-thrown" || !entry.file || !entry.anchor) {
          throw new Error(`${key}: dòng bảng thiếu file / anchor`);
        }
        expect(fs.existsSync(path.join(INTEGRATION_DIR, entry.file)), entry.file).toBe(true);
        expect(entry.file, "census chỉ tính file mang chữ social").toMatch(
          /social.*\.int-spec\.ts$/,
        );
        const slice = caseSlice(read(entry.file), entry.anchor);
        expect(slice, `${entry.file} không có ca «${entry.anchor}»`).not.toBe("");
        const byCode = new RegExp(`SOCIAL_ERROR_CODES\\.${key}\\b`).test(slice);
        expect(byCode, `ca «${entry.anchor}» không assert bằng SOCIAL_ERROR_CODES.${key}`).toBe(
          true,
        );
        if (entry.kind === "http-unreachable") {
          expect(slice, `ca «${entry.anchor}» không ghim mã validate chung`).toContain(
            "VALIDATION_CODE",
          );
        }
      },
    );

    it("QA1-E-R3 · hai danh sách tha của bảng khớp hai danh sách tha của census tĩnh; phép dò tên ca không «luôn đúng»", () => {
      const census = stripComments(fs.readFileSync(CENSUS_FILE, "utf8"));
      const block = (name: string): string => {
        const m = census.match(new RegExp(`const ${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`));
        return m ? m[1] : "";
      };
      const keysIn = (text: string): string[] =>
        [...text.matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]).sort();
      const ofKind = (kind: Qa1CodeCase["kind"]): string[] =>
        entries
          .filter(([, c]) => c.kind === kind)
          .map(([k]) => k)
          .sort();

      expect(keysIn(block("HTTP_UNREACHABLE"))).toEqual(ofKind("http-unreachable"));
      expect(keysIn(block("NEVER_THROWN"))).toEqual(ofKind("never-thrown"));
      for (const [key, entry] of entries) {
        if (entry.kind !== "http") expect(entry.why.length, key).toBeGreaterThan(20);
      }

      // Tự-kiểm: tên ca bịa ⇒ rỗng; tên ca thật mà hỏi khoá KHÁC ⇒ không khớp.
      const self = read(path.basename(__filename));
      expect(caseSlice(self, ["QA1-E", "00 ·"].join("-"))).toBe("");
      const e03 = caseSlice(self, "QA1-E-03 ·");
      expect(e03).toMatch(/SOCIAL_ERROR_CODES\.COMMENTS_LOCKED\b/);
      expect(e03).not.toMatch(/SOCIAL_ERROR_CODES\.REPLY_DEPTH\b/);
    });
  });
});
