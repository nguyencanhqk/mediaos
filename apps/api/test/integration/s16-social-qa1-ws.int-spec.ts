/**
 * S16-SOCIAL-QA-1 (L8) — SỰ KIỆN REALTIME ĐO TRÊN DÂY (plan `docs/plans/S16-SOCIAL-QA-1.md` §4-L8, D21,
 * Bảng 3 các dòng QA1-W).
 *
 *   W-0  tự-kiểm bộ so tập khoá + socket đã ở room        W-4  đổi loại cảm xúc
 *   W-1  `feed:post.created` — tập khoá, giá trị, khoá cấm W-5  bài ẩn / đơn vị / nhóm ⇒ 0 sự kiện
 *   W-2  `feed:comment.created`                            W-6  công ty khác ⇒ 0 sự kiện
 *   W-3  `feed:reaction.changed` — đúng 5 khoá             W-7  thiếu cặp đọc ⇒ không ở room
 *   W-4b thả lại đúng loại đang có ⇒ 0 sự kiện
 *
 * Luật đo:
 *  - Socket client THẬT; payload là thứ đã đi qua dây (không spy emitter — spy thấy payload TRƯỚC khi
 *    schema bóc khoá, và xanh cả khi sự kiện không bao giờ lên dây).
 *  - Thước CHÍNH = TẬP KHOÁ (cả object lồng) đúng-BẰNG một bảng literal viết tay. Bảng chia hai phần:
 *    khoá API-19 §6.1 / §7 nêu tường minh, và khoá tài liệu KHÔNG liệt kê — ghim theo payload quan sát
 *    được (`*_OBSERVED`). Khoá mới lọt vào payload mà chưa vào bảng ⇒ ĐỎ.
 *  - «Nhận 0 sự kiện» chỉ được khẳng định SAU một neo dương phát sau trên CHÍNH socket đó.
 *
 * Thứ tự ca trong file là bắt buộc (các ca dùng chung bài và socket); chạy lẻ bằng `-t` sẽ đỏ.
 */
import { randomUUID } from "node:crypto";
import type { Namespace } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  WS_EVENTS,
  wsFeedCommentCreatedEventSchema,
  wsFeedCompanyPostCreatedEventSchema,
  wsFeedReactionChangedEventSchema,
} from "@mediaos/contracts";
import { chatUserRoomName, feedRoomName } from "../../src/realtime/rooms";
import { hasDb } from "../helpers/integration-db";
import {
  connectReady,
  gatewayNamespace,
  isMember,
  type FeedRecorder,
} from "../helpers/social-group-rooms-fixture";
import {
  FEED_PAIRS,
  addComment,
  bootQa1World,
  createGroup,
  createPost,
  findIdentity,
  reactComment,
  reactPost,
  sharePost,
  type Json,
  type Qa1Actor,
  type Qa1World,
} from "../helpers/social-qa1-kit";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 90_000;
const WAIT_MS = 3_000;

// ─── Bảng khoá LITERAL (viết tay từ tài liệu — KHÔNG suy từ schema) ───────────────────────────────

/** API-19 §6.1 (thẻ bài) trừ các khoá §7 nói KHÔNG lên dây, cộng hai khoá định tuyến của union §7. */
const POST_KEYS_DOCUMENTED = [
  "id",
  "type",
  "audience",
  "groupId",
  "orgUnitId",
  "author",
  "author.employeeId",
  "author.fullName",
  "author.avatarUrl",
  "body",
  "tags",
  "attachments",
  "attachments[].fileId",
  "attachments[].kind",
  "pinned",
  "commentsLocked",
  "likeCount",
  "commentCount",
  "viewCount",
  "editedAt",
  "createdAt",
];
/** Có trên dây nhưng API-19 không liệt kê tường minh — ghim theo quan sát (báo ở kết quả lát). */
const POST_KEYS_OBSERVED = [
  "requiresAck",
  "publishedAt",
  "lastActivityAt",
  "attachments[].fileName",
  "attachments[].sizeBytes",
];

/** API-19 §7 chỉ ghi «DTO bình luận đã mask» — cả bảng là ghim theo quan sát. */
const COMMENT_KEYS_OBSERVED = [
  "id",
  "postId",
  "parentCommentId",
  "author",
  "author.employeeId",
  "author.fullName",
  "author.avatarUrl",
  "body",
  "attachments",
  "attachments[].fileId",
  "attachments[].kind",
  "attachments[].fileName",
  "attachments[].sizeBytes",
  "likeCount",
  "editedAt",
  "createdAt",
];

/** API-19 §7: `{ targetType, targetId, postId, likeCount, reactions[] }` — đúng 5 khoá. */
const REACTION_KEYS_DOCUMENTED = ["targetType", "targetId", "postId", "likeCount", "reactions"];
/** Khoá của phần tử `reactions[]` — §7 không liệt kê; ghim theo quan sát. */
const REACTION_ITEM_KEYS_OBSERVED = ["reactions[].emoji", "reactions[].count"];

/** Khoá theo-người-xem / khối chi tiết KHÔNG được có trên `feed:post.created`. */
const POST_FORBIDDEN = [
  "myReaction",
  "savedByMe",
  "isMine",
  "mentions",
  "status",
  "kudos",
  "poll",
  "idea",
  "attachments[].url",
];
const COMMENT_FORBIDDEN = ["myReaction", "isMine", "mentions", "attachments[].url"];

// ─── Bộ so tập khoá ───────────────────────────────────────────────────────────────────────────────

/** Mọi đường khoá của một giá trị JSON (`a`, `a.b`, `a[].b`), đã sắp xếp, không trùng. */
function keyPaths(value: unknown, prefix = "", out: Set<string> = new Set()): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keyPaths(item, `${prefix}[]`, out);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Json)) {
      const path = prefix === "" ? k : `${prefix}.${k}`;
      out.add(path);
      keyPaths(v, path, out);
    }
  }
  return [...out].sort();
}

const sorted = (...lists: readonly string[][]): string[] => [...new Set(lists.flat())].sort();

/** Chênh lệch giữa tập khoá thật và bảng: `[]` cả hai phía = khớp. */
function keyDiff(
  payload: unknown,
  table: readonly string[],
): { extra: string[]; missing: string[] } {
  const actual = new Set(keyPaths(payload));
  const want = new Set(table);
  return {
    extra: [...actual].filter((k) => !want.has(k)).sort(),
    missing: [...want].filter((k) => !actual.has(k)).sort(),
  };
}

// ─── Máy ghi sự kiện ──────────────────────────────────────────────────────────────────────────────

interface Recorder extends FeedRecorder {
  comments: Json[];
  reactions: Json[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Chờ tới khi `pick()` trả giá trị; hết giờ ⇒ NÉM kèm `what` (không bao giờ xanh im lặng). */
async function waitFor<T>(
  pick: () => T | undefined,
  what: string,
  timeoutMs = WAIT_MS,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = pick();
    if (hit !== undefined) return hit;
    await sleep(20);
  }
  throw new Error(`hết giờ chờ sự kiện: ${what}`);
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-QA-1 · L8 · sự kiện realtime trên dây", () => {
  let w: Qa1World;
  let nsp: Namespace;
  const open: ClientSocket[] = [];

  /** Tác giả: đủ 15 cặp feed (đăng mọi loại, ẩn bài) + cửa tệp. Thuộc đơn vị `unitId`. */
  let author: Qa1Actor;
  /** Người nghe thường của công ty A — đọc feed, bình luận, thả cảm xúc. */
  let listener: Qa1Actor;
  /** Người thứ hai thả cảm xúc (để có neo «phát sau» mà không đổi hàng của `listener`). */
  let second: Qa1Actor;
  /** Không có cặp đọc feed — chỉ có tín hiệu sẵn sàng của socket. */
  let nofeed: Qa1Actor;
  /** Người nghe của công ty B. */
  let outsider: Qa1Actor;

  let rec: Recorder;
  let recNoFeed: Recorder;
  let recB: Recorder;

  let unitId = "";
  /** Bài công ty của W-1 — dùng tiếp cho W-2 · W-3 · W-4. */
  let mainPostId = "";
  let mainPostWire: Json = {};
  /** Mọi id (bài · bình luận) của công ty A mà socket công ty B không được thấy. */
  const idsOfA: string[] = [];
  /** Số sự kiện cảm xúc của `mainPostId` trên socket `rec` — chụp ở W-4a, đọc ở W-4. */
  let changeEvents: Json[] = [];

  const dataOf = (body: unknown): Json => ((body as { data?: unknown }).data ?? {}) as Json;

  async function connect(a: Qa1Actor): Promise<Recorder> {
    const base = await connectReady(w.port, nsp, a.token, a.tenant.companyId, a.userId, open);
    const out: Recorder = { ...base, comments: [], reactions: [] };
    base.socket.on(WS_EVENTS.FEED_COMMENT_CREATED, (p: Json) => out.comments.push(p));
    base.socket.on(WS_EVENTS.FEED_REACTION_CHANGED, (p: Json) => out.reactions.push(p));
    return out;
  }

  /** Một hàng tệp đã tải xong + sạch, thuộc `owner` (không chạm kho lưu trữ nào). */
  async function seedFile(owner: Qa1Actor): Promise<string> {
    const id = randomUUID();
    await w.direct.query(
      `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
                          storage_provider, storage_path, upload_status, scan_status,
                          owner_user_id, uploaded_by)
       VALUES ($1,$2,$3,$4,'image/png',2048,'MinIO',$5,'Uploaded','Clean',$6,$6)`,
      [
        id,
        owner.tenant.companyId,
        `anh-${id.slice(0, 6)}.png`,
        `stored-${id}`,
        `${owner.tenant.companyId}/social/${id}`,
        owner.userId,
      ],
    );
    return id;
  }

  const postEvent = (r: Recorder, id: string): Json | undefined => r.posts.find((p) => p.id === id);
  const commentEvent = (r: Recorder, id: string): Json | undefined =>
    r.comments.find((c) => c.id === id);
  const reactionsOf = (r: Recorder, targetId: string): Json[] =>
    r.reactions.filter((e) => e.targetId === targetId);

  /**
   * Neo dương của CẢ BA loại sự kiện, phát SAU mọi thứ trước nó: một bài công ty mới + một bình luận
   * + một cảm xúc trên bài đó, chờ cả ba tới `r`. Trả id bài neo.
   */
  async function anchor(r: Recorder, by: Qa1Actor, reactor: Qa1Actor): Promise<string> {
    const post = await sharePost(w, by, `Bài neo ${randomUUID().slice(0, 8)}`);
    const comment = await addComment(w, by, post.id);
    await reactPost(w, reactor, post.id);
    await waitFor(() => postEvent(r, post.id), `neo bài ${post.id}`);
    await waitFor(() => commentEvent(r, comment.id), `neo bình luận ${comment.id}`);
    await waitFor(() => reactionsOf(r, post.id)[0], `neo cảm xúc ${post.id}`);
    return post.id;
  }

  /**
   * ĐỔI loại cảm xúc của `author` trên một bài và một bình luận của nó (`like` → `love`), kèm neo
   * dương rằng hàng ĐÃ đổi thật — để «0 sự kiện» đo sau đó phủ cả nhánh đổi loại.
   */
  async function expectSwitched(postId: string, commentId: string, name: string): Promise<void> {
    const onPost = await reactPost(w, author, postId, "love");
    expect(onPost.reactions, `bài ${name}: hàng đã đổi loại`).toEqual([
      { emoji: "love", count: 1, mine: true },
    ]);
    const onComment = await reactComment(w, author, commentId, "love");
    expect(onComment.reactions, `bình luận của bài ${name}: hàng đã đổi loại`).toEqual([
      { emoji: "love", count: 1, mine: true },
    ]);
  }

  beforeAll(async () => {
    w = await bootQa1World("qa1ws");
    nsp = gatewayNamespace(w.app);
    unitId = await w.orgUnit(w.A, "Đơn vị WS");
    author = await w.actor(w.A, "author", {
      pairs: [...FEED_PAIRS, "view:chat-room", "view:foundation-file", "download:foundation-file"],
      orgUnitId: unitId,
    });
    listener = await w.actor(w.A, "listener", {
      pairs: ["view:feed", "create:feed-post", "create:feed-comment", "view:chat-room"],
    });
    second = await w.actor(w.A, "second", { pairs: ["view:feed", "create:feed-post"] });
    nofeed = await w.actor(w.A, "nofeed", { pairs: ["view:chat-room"] });
    outsider = await w.actor(w.B, "outsider", {
      pairs: ["view:feed", "create:feed-post", "create:feed-comment", "view:chat-room"],
    });
    rec = await connect(listener);
    recNoFeed = await connect(nofeed);
    recB = await connect(outsider);
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    for (const s of open) s.disconnect();
    await w?.close();
  });

  it("QA1-W-0 tự-kiểm: bộ so báo khoá thừa lẫn khoá thiếu; socket người nghe đã ở room trước khi đăng", async () => {
    const sample = { a: 1, b: { c: 2 }, d: [{ e: 3 }, { e: 4, f: 5 }] };
    expect(keyPaths(sample)).toEqual(["a", "b", "b.c", "d", "d[].e", "d[].f"]);
    expect(keyDiff(sample, ["a", "b", "b.c", "d", "d[].e", "d[].f"])).toEqual({
      extra: [],
      missing: [],
    });
    expect(
      keyDiff({ ...sample, la: true }, ["a", "b", "b.c", "d", "d[].e", "d[].f"]).extra,
    ).toEqual(["la"]);
    expect(keyDiff({ a: 1 }, ["a", "b"]).missing).toEqual(["b"]);
    // Khoá lồng trong phần tử mảng cũng bị bắt.
    expect(keyDiff({ d: [{ e: 1, la: 2 }] }, ["d", "d[].e"]).extra).toEqual(["d[].la"]);

    expect(await isMember(nsp, feedRoomName(w.A.companyId), rec), "người nghe ở room feed").toBe(
      true,
    );
    expect(await isMember(nsp, feedRoomName(w.B.companyId), recB), "người nghe B ở room B").toBe(
      true,
    );
  });

  it("QA1-W-1 `feed:post.created` bài công ty: tập khoá đúng-bằng bảng tay, giá trị bằng DTO của 003, không khoá theo-người-xem", async () => {
    const fileId = await seedFile(author);
    const made = await createPost(w, author, {
      type: "share",
      audience: "company",
      body: `Bài đo dây ${randomUUID().slice(0, 8)} #qa1ws`,
      attachmentIds: [fileId],
      mentionedUserIds: [listener.userId],
    });
    mainPostId = made.id;
    idsOfA.push(made.id);

    const wire = await waitFor(() => postEvent(rec, made.id), `bài ${made.id}`);
    mainPostWire = wire;
    expect(
      rec.posts.filter((p) => p.id === made.id),
      "đúng MỘT sự kiện cho bài",
    ).toHaveLength(1);

    // Thước chính: tập khoá.
    const table = sorted(POST_KEYS_DOCUMENTED, POST_KEYS_OBSERVED);
    expect(keyDiff(wire, table), `tập khoá trên dây: ${keyPaths(wire).join(", ")}`).toEqual({
      extra: [],
      missing: [],
    });
    // Tự-kiểm bộ so trên CHÍNH payload này: một khoá lạ phải bị báo.
    expect(keyDiff({ ...wire, khoaLa: 1 }, table).extra).toEqual(["khoaLa"]);
    const paths = keyPaths(wire);
    for (const banned of POST_FORBIDDEN) expect(paths, `khoá cấm ${banned}`).not.toContain(banned);
    expect((wire.author as Json).avatarUrl).toBeNull();
    expect(wire.audience).toBe("company");
    expect(wire.groupId).toBeNull();
    expect(wire.orgUnitId).toBeNull();
    expect(findIdentity(wire, [author.userId, listener.userId]), "không id tài khoản nào").toEqual(
      [],
    );

    // Giá trị khoá chung với DTO REST của người nghe.
    const rest = await w.get(listener.token, `/social/posts/${made.id}`);
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
    const dto = dataOf(rest.body);
    // Neo dương của các khoá «vắng trên dây»: REST của cùng bài CÓ chúng.
    expect(dto.mentions, "REST mang mentions").toHaveLength(1);
    expect(dto).toHaveProperty("isMine", false);
    expect(dto).toHaveProperty("savedByMe", false);
    expect(dto).toHaveProperty("myReaction", null);
    for (const k of [
      "id",
      "type",
      "audience",
      "groupId",
      "orgUnitId",
      "body",
      "tags",
      "pinned",
      "commentsLocked",
      "requiresAck",
      "likeCount",
      "commentCount",
      "viewCount",
      "editedAt",
      "createdAt",
      "publishedAt",
      "lastActivityAt",
    ]) {
      expect(wire[k], `giá trị khoá ${k}`).toEqual(dto[k]);
    }
    expect(wire.tags).toEqual(["qa1ws"]);
    const wireAuthor = wire.author as Json;
    const restAuthor = dto.author as Json;
    expect(wireAuthor.employeeId).toBe(restAuthor.employeeId);
    expect(wireAuthor.employeeId).toBe(author.employeeId);
    expect(wireAuthor.fullName).toBe(restAuthor.fullName);
    const wireAtt = wire.attachments as Json[];
    const restAtt = dto.attachments as Json[];
    expect(wireAtt).toHaveLength(1);
    expect(restAtt).toHaveLength(1);
    expect(restAtt[0]).toHaveProperty("url");
    for (const k of ["fileId", "kind", "fileName", "sizeBytes"]) {
      expect(wireAtt[0]![k], `đính kèm · ${k}`).toEqual(restAtt[0]![k]);
    }
    expect(wireAtt[0]!.fileId).toBe(fileId);

    // Kiểm phụ: schema WS ở chế độ strict nhận payload trên dây.
    expect(wsFeedCompanyPostCreatedEventSchema.strict().safeParse(wire).success).toBe(true);
  });

  it("QA1-W-2 `feed:comment.created` trên bài công ty: tập khoá đúng-bằng bảng, giá trị bằng DTO của 014", async () => {
    const fileId = await seedFile(author);
    const res = await w.post(author.token, `/social/posts/${mainPostId}/comments`).send({
      body: `Bình luận đo dây ${randomUUID().slice(0, 8)}`,
      attachmentIds: [fileId],
      mentionedUserIds: [listener.userId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const commentId = dataOf(res.body).id as string;
    idsOfA.push(commentId);

    const wire = await waitFor(() => commentEvent(rec, commentId), `bình luận ${commentId}`);
    expect(rec.comments.filter((c) => c.id === commentId)).toHaveLength(1);
    expect(keyDiff(wire, COMMENT_KEYS_OBSERVED), `tập khoá: ${keyPaths(wire).join(", ")}`).toEqual({
      extra: [],
      missing: [],
    });
    const paths = keyPaths(wire);
    for (const banned of COMMENT_FORBIDDEN) {
      expect(paths, `khoá cấm ${banned}`).not.toContain(banned);
    }
    expect((wire.author as Json).avatarUrl).toBeNull();
    expect(findIdentity(wire, [author.userId, listener.userId])).toEqual([]);

    const list = await w.get(listener.token, `/social/posts/${mainPostId}/comments`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const page = list.body as { data?: { data?: Json[] } | Json[] };
    const rows = (Array.isArray(page.data) ? page.data : (page.data?.data ?? [])) as Json[];
    const dto = rows.find((c) => c.id === commentId);
    expect(dto, "014 trả bình luận vừa tạo").toBeDefined();
    expect(dto!.mentions, "REST mang mentions").toHaveLength(1);
    expect(dto).toHaveProperty("isMine", false);
    for (const k of [
      "id",
      "postId",
      "parentCommentId",
      "body",
      "likeCount",
      "editedAt",
      "createdAt",
    ]) {
      expect(wire[k], `giá trị khoá ${k}`).toEqual(dto![k]);
    }
    expect(wire.postId).toBe(mainPostId);
    expect((wire.author as Json).employeeId).toBe((dto!.author as Json).employeeId);
    expect((wire.author as Json).fullName).toBe((dto!.author as Json).fullName);
    const wireAtt = wire.attachments as Json[];
    expect(wireAtt).toHaveLength(1);
    expect(wireAtt[0]!.fileId).toBe(fileId);
    expect((dto!.attachments as Json[])[0]).toHaveProperty("url");

    expect(wsFeedCommentCreatedEventSchema.strict().safeParse(wire).success).toBe(true);
  });

  it("QA1-W-3 `feed:reaction.changed`: đúng 5 khoá, `likeCount` = số hàng thật, không danh tính người thả", async () => {
    const before = reactionsOf(rec, mainPostId).length;
    expect(before, "chưa có sự kiện cảm xúc nào của bài").toBe(0);
    await reactPost(w, listener, mainPostId, "like");
    const wire = await waitFor(() => reactionsOf(rec, mainPostId)[0], `cảm xúc bài ${mainPostId}`);

    expect(Object.keys(wire).sort()).toEqual([...REACTION_KEYS_DOCUMENTED].sort());
    expect(
      keyDiff(wire, sorted(REACTION_KEYS_DOCUMENTED, REACTION_ITEM_KEYS_OBSERVED)),
      `tập khoá: ${keyPaths(wire).join(", ")}`,
    ).toEqual({ extra: [], missing: [] });
    expect(keyPaths(wire)).not.toContain("reactions[].mine");
    expect(
      findIdentity(wire, [listener.userId, listener.employeeId ?? "", listener.email]),
    ).toEqual([]);

    const n = await w.direct.query(
      `SELECT count(*)::int AS n FROM feed_reactions
        WHERE company_id = $1 AND target_type = 'post' AND target_id = $2`,
      [w.A.companyId, mainPostId],
    );
    expect(n.rows[0].n).toBe(1);
    expect(wire).toEqual({
      targetType: "post",
      targetId: mainPostId,
      postId: mainPostId,
      likeCount: 1,
      reactions: [{ emoji: "like", count: 1 }],
    });
    expect(wsFeedReactionChangedEventSchema.strict().safeParse(wire).success).toBe(true);

    // Cùng loại sự kiện với đích là BÌNH LUẬN: `postId` trỏ bài cha.
    const comment = await addComment(w, author, mainPostId);
    idsOfA.push(comment.id);
    await reactComment(w, listener, comment.id, "wow");
    const onComment = await waitFor(
      () => reactionsOf(rec, comment.id)[0],
      `cảm xúc bình luận ${comment.id}`,
    );
    expect(onComment).toEqual({
      targetType: "comment",
      targetId: comment.id,
      postId: mainPostId,
      likeCount: 1,
      reactions: [{ emoji: "wow", count: 1 }],
    });
  });

  it("QA1-W-4a đổi loại cảm xúc: REST trả tổng hợp mới; sự kiện neo phát sau vẫn tới", async () => {
    // Lượt thả ĐẦU của `listener` (W-3) đã phát đúng 1 sự kiện trên socket này.
    expect(reactionsOf(rec, mainPostId), "neo dương: lượt thả đầu").toHaveLength(1);

    const changed = await reactPost(w, listener, mainPostId, "love");
    expect(changed.likeCount).toBe(1);
    expect(changed.reactions).toEqual([{ emoji: "love", count: 1, mine: true }]);

    // Neo phát SAU: người thứ hai thả cảm xúc lên cùng bài.
    await reactPost(w, second, mainPostId, "haha");
    await waitFor(
      () => reactionsOf(rec, mainPostId).find((e) => e.likeCount === 2),
      "neo sau khi đổi loại",
    );
    // Mọi sự kiện của bài nằm GIỮA lượt thả đầu và neo.
    changeEvents = reactionsOf(rec, mainPostId)
      .filter((e) => e.likeCount === 1)
      .slice(1);
    const anchorEvent = reactionsOf(rec, mainPostId).find((e) => e.likeCount === 2)!;
    expect(anchorEvent.reactions).toEqual(
      expect.arrayContaining([
        { emoji: "love", count: 1 },
        { emoji: "haha", count: 1 },
      ]),
    );
  });

  // Lượt đổi loại là một thay đổi của tổng hợp theo loại (`reactions[]`) dù `likeCount` giữ nguyên ⇒
  // room phải nhận ĐÚNG 1 sự kiện mang tổng hợp mới (API-19 §7; QA1-BUG-1 đã vá ở repository). Đọc
  // `changeEvents` do W-4a gom: các sự kiện của bài nằm GIỮA lượt thả đầu và neo phát sau.
  it("QA1-W-4 · đổi loại cảm xúc ⇒ đúng 1 sự kiện mang tổng hợp mới", () => {
    expect(
      changeEvents,
      "số sự kiện phát cho lượt đổi loại (giữa lượt thả đầu và neo)",
    ).toHaveLength(1);
    expect(changeEvents[0]).toEqual({
      targetType: "post",
      targetId: mainPostId,
      postId: mainPostId,
      likeCount: 1,
      reactions: [{ emoji: "love", count: 1 }],
    });
  });

  // Ca song sinh của W-4: thả lại ĐÚNG loại đang có không đổi tổng hợp nào ⇒ không có gì để phát.
  // Cùng khuôn đếm: mọi sự kiện của bài nằm GIỮA mốc chụp và một neo dương phát sau.
  it("QA1-W-4b · thả lại đúng loại đang có ⇒ REST 200 tổng hợp không đổi, 0 sự kiện", async () => {
    // Trạng thái vào ca (do W-4a để lại): `listener` đang thả `love`, `second` đang thả `haha`.
    const seenBefore = reactionsOf(rec, mainPostId).length;

    const repeated = await reactPost(w, listener, mainPostId, "love");
    expect(repeated.likeCount, "tổng số không đổi").toBe(2);
    expect(repeated.reactions, "tổng hợp theo loại không đổi").toEqual(
      expect.arrayContaining([
        { emoji: "love", count: 1, mine: true },
        { emoji: "haha", count: 1, mine: false },
      ]),
    );
    expect(repeated.reactions).toHaveLength(2);

    // Neo phát SAU: người thứ ba thả cảm xúc lên cùng bài.
    await reactPost(w, author, mainPostId, "wow");
    const anchorEvent = await waitFor(
      () => reactionsOf(rec, mainPostId).find((e) => e.likeCount === 3),
      "neo sau lượt thả lại",
    );
    const between = reactionsOf(rec, mainPostId)
      .slice(seenBefore)
      .filter((e) => e !== anchorEvent);
    expect(
      between,
      "số sự kiện phát cho lượt thả lại đúng loại (giữa mốc chụp và neo)",
    ).toHaveLength(0);
  });

  it("QA1-W-5 bài ẩn · bài đơn vị · bình luận và cảm xúc trên bài nhóm ⇒ 0 sự kiện tới room công ty", async () => {
    // (a) Bài công ty: thả cảm xúc khi còn hiển thị (neo dương), rồi ẨN, rồi tương tác tiếp.
    const hidden = await sharePost(w, author, `Bài sẽ ẩn ${randomUUID().slice(0, 8)}`);
    idsOfA.push(hidden.id);
    await waitFor(() => postEvent(rec, hidden.id), "bài sắp ẩn — khi còn hiển thị");
    await reactPost(w, author, hidden.id, "like");
    await waitFor(() => reactionsOf(rec, hidden.id)[0], "cảm xúc trước khi ẩn");
    const hide = await w.patch(author.token, `/social/posts/${hidden.id}/moderation`).send({
      hidden: true,
    });
    expect(hide.status, JSON.stringify(hide.body)).toBe(200);
    const eventsBeforeHide = reactionsOf(rec, hidden.id).length;
    const commentsBeforeHide = rec.comments.filter((c) => c.postId === hidden.id).length;
    // Gỡ cảm xúc trên bài đã ẩn: REST 200 (đường gỡ không bị siết) nhưng không được phát.
    const removed = await w.del(author.token, `/social/posts/${hidden.id}/reaction`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(dataOf(removed.body).likeCount, "hàng cảm xúc đã bị gỡ thật").toBe(0);
    // Thả lại + bình luận trên bài ẩn bởi người còn thấy bài: status nào cũng không được phát.
    const again = await w.put(author.token, `/social/posts/${hidden.id}/reaction`).send({
      emoji: "love",
    });
    expect(again.status, JSON.stringify(again.body)).toBeLessThan(500);
    // ĐỔI loại trên bài ẩn (nhánh «đổi loại» cũng phải đi qua cùng lưới hiển thị).
    const switched = await w.put(author.token, `/social/posts/${hidden.id}/reaction`).send({
      emoji: "haha",
    });
    expect(switched.status, JSON.stringify(switched.body)).toBe(again.status);
    if (again.status === 200) {
      // Neo dương: lượt đổi loại ĐÃ ghi thật — «0 sự kiện» bên dưới không phải vì request bị từ chối.
      expect(dataOf(switched.body).reactions, "bài ẩn: hàng đã đổi loại").toEqual([
        { emoji: "haha", count: 1, mine: true },
      ]);
    }
    const hiddenComment = await w.post(author.token, `/social/posts/${hidden.id}/comments`).send({
      body: "Bình luận trên bài ẩn",
    });
    expect(hiddenComment.status, JSON.stringify(hiddenComment.body)).toBeLessThan(500);

    // (b) Bài đơn vị: đăng + bình luận + cảm xúc.
    const unitPost = await sharePost(w, author, `Bài đơn vị ${randomUUID().slice(0, 8)}`, {
      audience: "org_unit",
      orgUnitId: unitId,
    });
    idsOfA.push(unitPost.id);
    const unitComment = await addComment(w, author, unitPost.id);
    idsOfA.push(unitComment.id);
    await reactPost(w, author, unitPost.id, "like");
    await reactComment(w, author, unitComment.id, "like");
    await expectSwitched(unitPost.id, unitComment.id, "đơn vị");

    // (c) Bài nhóm (nợ S16-SOCIAL-RTGROUPCR-1 — ghim hiện trạng): bình luận + cảm xúc không phát.
    const group = await createGroup(w, author, "public");
    const groupPost = await sharePost(w, author, `Bài nhóm ${randomUUID().slice(0, 8)}`, {
      audience: "group",
      groupId: group.id,
    });
    idsOfA.push(groupPost.id);
    const groupComment = await addComment(w, author, groupPost.id);
    idsOfA.push(groupComment.id);
    await reactPost(w, author, groupPost.id, "like");
    await reactComment(w, author, groupComment.id, "like");
    await expectSwitched(groupPost.id, groupComment.id, "nhóm");

    // Neo dương của cả ba loại sự kiện, phát SAU mọi thứ ở trên, trên CHÍNH socket này.
    idsOfA.push(await anchor(rec, author, second));

    expect(reactionsOf(rec, hidden.id), "cảm xúc trên bài ĐÃ ẨN không được phát").toHaveLength(
      eventsBeforeHide,
    );
    expect(
      rec.comments.filter((c) => c.postId === hidden.id),
      "bình luận trên bài ĐÃ ẨN không được phát",
    ).toHaveLength(commentsBeforeHide);
    for (const [name, post, comment] of [
      ["đơn vị", unitPost.id, unitComment.id],
      ["nhóm", groupPost.id, groupComment.id],
    ] as const) {
      expect(postEvent(rec, post), `bài ${name}: không phát tới room công ty`).toBeUndefined();
      expect(commentEvent(rec, comment), `bình luận trên bài ${name}`).toBeUndefined();
      expect(reactionsOf(rec, post), `cảm xúc trên bài ${name}`).toHaveLength(0);
      expect(reactionsOf(rec, comment), `cảm xúc trên bình luận của bài ${name}`).toHaveLength(0);
      expect(
        rec.reactions.filter((e) => e.postId === post),
        `mọi sự kiện cảm xúc mang postId của bài ${name}`,
      ).toHaveLength(0);
    }
  });

  it("QA1-W-6 socket của công ty khác nhận 0 sự kiện của công ty này; sự kiện của chính nó phát sau vẫn tới", async () => {
    const ownAnchor = await anchor(recB, outsider, outsider);

    expect(idsOfA.length, "đã có dữ liệu của công ty A để soát").toBeGreaterThanOrEqual(8);
    expect(
      recB.posts.map((p) => p.id),
      "bài tới socket B",
    ).toEqual([ownAnchor]);
    expect(
      recB.comments.map((c) => c.postId),
      "bình luận tới socket B",
    ).toEqual([ownAnchor]);
    expect(
      recB.reactions.map((e) => e.postId),
      "cảm xúc tới socket B",
    ).toEqual([ownAnchor]);
    const all = [...recB.posts, ...recB.comments, ...recB.reactions];
    expect(findIdentity(all, [...idsOfA, w.A.companyId, author.employeeId ?? ""])).toEqual([]);
    // Chiều ngược lại: socket A không nhận sự kiện của B.
    expect(postEvent(rec, ownAnchor), "socket A không nhận bài của B").toBeUndefined();
    expect(rec.reactions.filter((e) => e.postId === ownAnchor)).toHaveLength(0);
    // Tự-kiểm bộ dò: payload A đã ghi ở W-1 chứa id bài A.
    expect(findIdentity(mainPostWire, [mainPostId]).length).toBeGreaterThan(0);
  });

  it("QA1-W-7 socket thiếu cặp đọc bảng tin không ở room; người có cặp thì ở", async () => {
    const room = feedRoomName(w.A.companyId);
    // Rào thứ tự: socket này ĐÃ xong khâu vào room (tín hiệu sẵn sàng), nên «không ở room» là kết luận.
    expect(
      await isMember(nsp, chatUserRoomName(w.A.companyId, nofeed.userId), recNoFeed),
      "socket thiếu cặp đã sẵn sàng",
    ).toBe(true);
    expect(await isMember(nsp, room, recNoFeed), "thiếu cặp đọc ⇒ không ở room").toBe(false);
    expect(await isMember(nsp, room, rec), "có cặp đọc ⇒ ở room").toBe(true);
    // Suốt cả file, socket này không nhận sự kiện bảng tin nào (socket cùng công ty thì nhận ≥ 3 bài).
    expect(rec.posts.length).toBeGreaterThanOrEqual(3);
    expect([...recNoFeed.posts, ...recNoFeed.comments, ...recNoFeed.reactions]).toEqual([]);
    const denied = await w.get(nofeed.token, "/social/feed");
    expect(denied.status).toBe(403);
  });
});
