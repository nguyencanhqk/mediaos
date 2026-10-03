import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS_EVENTS } from "@mediaos/contracts";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import {
  chatUserRoomName,
  feedGroupRoomName,
  feedRoomName,
  feedUserRoomName,
  userRoomName,
} from "./rooms";

/**
 * S16-SOCIAL-BE-2C — room nhóm bảng tin ở tầng EMITTER (plan §5 W1 · N1).
 *
 * Assert theo BỘ CHỌN + ĐÍCH của room-op, KHÔNG theo «có gọi»: một spy suông xanh cả khi lệnh join quét
 * nhầm `userRoomName` — tức kéo socket TRƯỢT cổng `view:feed` vào room nhóm (D-OWNER-2, M2 a′).
 * Khuôn `realtime-emitter.chat.spec.ts` (`syncRoomMembership`).
 */

const COMPANY = "c0000000-0000-0000-0000-00000000000a";
const OTHER_COMPANY = "c0000000-0000-0000-0000-00000000000b";
const GROUP = "61000000-0000-4000-8000-000000000001";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** Nhóm có CHỮ hex (a–f) — `GROUP` toàn số nên `.toUpperCase()` không đổi gì (ca chữ HOA sẽ xanh-rỗng). */
const GROUP_HEX = "6b1f0c2e-9d3a-4e5f-8a7b-c0d1e2f3a4b5";

/**
 * Fake `Server`: ghi THỨ TỰ room-op (`order`) của CẢ HAI kênh — `server.in(...)` (toàn cụm: dưới adapter
 * Valkey = publish, có thể MẤT) và `server.local.in(...)` (cục bộ, đồng bộ — không đi qua pub/sub).
 */
function makeServer() {
  const emit = vi.fn();
  const socketsJoin = vi.fn();
  const socketsLeave = vi.fn();
  const toTargets: unknown[] = [];
  const inTargets: string[] = [];
  const order: string[] = [];
  const opsFor = (kind: "cluster" | "local", selector: string) => ({
    socketsJoin: (target: string) => {
      order.push(`${kind}:join:${selector}>${target}`);
      if (kind === "cluster") socketsJoin(target);
    },
    socketsLeave: (target: string) => {
      order.push(`${kind}:leave:${selector}>${target}`);
      if (kind === "cluster") socketsLeave(target);
    },
  });
  const server = {
    to: vi.fn((t: unknown) => {
      toTargets.push(t);
      return { emit };
    }),
    in: vi.fn((t: string) => {
      inTargets.push(t);
      return opsFor("cluster", t);
    }),
    local: { in: vi.fn((t: string) => opsFor("local", t)) },
  };
  return { server, emit, socketsJoin, socketsLeave, toTargets, inTargets, order };
}

function makeEmitter() {
  const h = makeServer();
  const svc = new RealtimeEmitterService();
  svc.setServer(h.server as never);
  return { svc, ...h };
}

describe("RealtimeEmitterService — room nhóm bảng tin (S16-SOCIAL-BE-2C)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  // ─── W1 — bộ chọn của join/leave ───────────────────────────────────────────────
  it("🔒 W1a syncFeedGroupMembership('join') quét FEED-USER-room — socket trượt view:feed không bị kéo vào nhóm", () => {
    const { svc, server, socketsJoin, socketsLeave, inTargets, order } = makeEmitter();

    svc.syncFeedGroupMembership(COMPANY, GROUP, USER, "join");

    // `userRoomName` chứa MỌI socket đã xác thực (đích NOTI) — kể cả socket đã trượt cổng `view:feed`.
    // `chatUserRoomName` là room đánh dấu của CỔNG KHÁC (`view:chat-room`): người có chat mà không có
    // feed sẽ bị kéo vào room nhóm nếu nhầm hai room đánh dấu.
    expect(server.in).not.toHaveBeenCalledWith(userRoomName(COMPANY, USER));
    expect(server.in).not.toHaveBeenCalledWith(chatUserRoomName(COMPANY, USER));
    expect(inTargets).toEqual([feedUserRoomName(COMPANY, USER)]);
    expect(socketsJoin).toHaveBeenCalledWith(feedGroupRoomName(COMPANY, GROUP));
    expect(socketsLeave).not.toHaveBeenCalled();
    // Join KHÔNG có vế cục bộ: join mất dưới Valkey chỉ là thiếu badge (fail-closed), không phải rò.
    expect(order).toEqual([
      `cluster:join:${feedUserRoomName(COMPANY, USER)}>${feedGroupRoomName(COMPANY, GROUP)}`,
    ]);
  });

  it("🔒 W1b leave quét user-room (RỘNG HƠN), CỤC BỘ TRƯỚC rồi mới toàn cụm — lệnh cục bộ không đi qua pub/sub nên KHÔNG mất được", () => {
    // FULL gate lượt 1 (MEDIUM — security-reviewer + silent-failure-hunter): dưới redis-adapter 8.3.0,
    // `socketsLeave` không cờ `local` CHỈ publish REMOTE_LEAVE; node giữ socket chỉ áp khi NHẬN LẠI qua
    // kết nối SUBSCRIBE (pub/sub at-most-once). Sub rớt ⇒ CẢ HAI lần leave của 036/039 mất VĨNH VIỄN.
    const { svc, server, socketsJoin, socketsLeave, order } = makeEmitter();

    svc.syncFeedGroupMembership(COMPANY, GROUP, USER, "leave");

    const sel = userRoomName(COMPANY, USER);
    const target = feedGroupRoomName(COMPANY, GROUP);
    expect(order).toEqual([`local:leave:${sel}>${target}`, `cluster:leave:${sel}>${target}`]);
    expect(server.in).not.toHaveBeenCalledWith(feedUserRoomName(COMPANY, USER));
    expect(socketsLeave).toHaveBeenCalledWith(target);
    expect(socketsJoin).not.toHaveBeenCalled();
  });

  it("🔒 W1d id CHỮ HOA (route `ParseUUIDPipe` trả nguyên văn) ⇒ room-op dùng id CHỮ THƯỜNG — khớp room gateway dựng từ DB/JWT", () => {
    // FULL gate lượt 1 (HIGH — database-reviewer): Postgres so uuid KHÔNG phân biệt hoa thường nên ghi DB
    // của `039`/`036` vẫn thành công; tên room là CHUỖI ⇒ leave với id chữ HOA không khớp room nào ⇒
    // người bị gỡ ở lại room nhóm kín (fail-OPEN). Khuôn `audiencePairKey` (`social-mentions.ts`).
    const { svc, order } = makeEmitter();
    const [C, G, U] = [COMPANY, GROUP_HEX, USER].map((s) => s.toUpperCase()) as [
      string,
      string,
      string,
    ];

    svc.syncFeedGroupMembership(C, G, U, "leave");
    svc.syncFeedGroupMembership(C, G, U, "join");

    const target = feedGroupRoomName(COMPANY, GROUP_HEX);
    expect(order).toEqual([
      `local:leave:${userRoomName(COMPANY, USER)}>${target}`,
      `cluster:leave:${userRoomName(COMPANY, USER)}>${target}`,
      `cluster:join:${feedUserRoomName(COMPANY, USER)}>${target}`,
    ]);
  });

  it("W1c chưa setServer (REALTIME_ENABLED=false / gateway chưa init) ⇒ no-op, KHÔNG ném", () => {
    const svc = new RealtimeEmitterService();
    expect(() => {
      svc.syncFeedGroupMembership(COMPANY, GROUP, USER, "join");
      svc.syncFeedGroupMembership(COMPANY, GROUP, USER, "leave");
    }).not.toThrow();
  });

  /**
   * ⚠️ CHỈ đo nhánh NÉM ĐỒNG BỘ (vd lỗi lập trình, server dở dang). Lỗi THẬT của adapter Valkey — publish
   * reject / thông điệp mất — là BẤT ĐỒNG BỘ, KHÔNG BAO GIỜ rơi vào `catch` của emitter (FULL gate lượt 1,
   * silent-failure-hunter LOW: bản cũ của ca này đọc như thể room-op hỏng luôn để lại dấu `warn`). Lưới cho
   * lệnh MẤT là vế CỤC BỘ (W1b + `realtime-emitter.feed.io.spec.ts`), không phải log.
   */
  it("lệnh room NÉM ĐỒNG BỘ ⇒ nuốt, KHÔNG ném lên caller (caller có thể đang ở trong tx — Q-LEAVE)", () => {
    const { svc, server } = makeEmitter();
    server.in.mockImplementation(() => {
      throw new Error("adapter down");
    });

    expect(() => svc.syncFeedGroupMembership(COMPANY, GROUP, USER, "leave")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("vế CỤC BỘ ném ⇒ log ERROR (vế an ninh) NHƯNG vế toàn cụm VẪN chạy — hai nghĩa vụ độc lập", () => {
    const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { svc, server, order } = makeEmitter();
    server.local.in.mockImplementation(() => {
      throw new Error("local adapter down");
    });

    expect(() => svc.syncFeedGroupMembership(COMPANY, GROUP, USER, "leave")).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      `cluster:leave:${userRoomName(COMPANY, USER)}>${feedGroupRoomName(COMPANY, GROUP)}`,
    ]);
  });

  // ─── N1 — tên room ─────────────────────────────────────────────────────────────
  it("N1 tên room: tiền tố tenant · room đánh dấu feed KHÁC room đánh dấu chat và user-room", () => {
    expect(feedGroupRoomName(COMPANY, GROUP)).toBe(`co:${COMPANY}:feedgroup:${GROUP}`);
    expect(feedGroupRoomName(COMPANY, GROUP)).not.toBe(feedGroupRoomName(OTHER_COMPANY, GROUP));
    expect(feedUserRoomName(COMPANY, USER)).not.toBe(feedUserRoomName(OTHER_COMPANY, USER));
    const markers = new Set([
      feedUserRoomName(COMPANY, USER),
      userRoomName(COMPANY, USER),
      chatUserRoomName(COMPANY, USER),
    ]);
    expect(markers.size).toBe(3);
  });

  it("CHAT `syncRoomMembership` KHÔNG đổi hành vi sau khi rút lõi chung (D-OWNER-2 tái dùng cơ chế)", () => {
    // Lưới hồi quy đầy đủ ở `realtime-emitter.chat.spec.ts`; ca này chỉ chốt rằng lõi chung không làm
    // nhánh CHAT quét nhầm room đánh dấu của FEED.
    const { svc, server } = makeEmitter();
    svc.syncRoomMembership(COMPANY, GROUP, USER, "join");
    expect(server.in).not.toHaveBeenCalledWith(feedUserRoomName(COMPANY, USER));
  });
});

/**
 * S16-SOCIAL-BE-2C — W3: `emitFeedPostCreated` ĐỊNH TUYẾN theo payload ĐÃ PARSE (plan §4.2, bất biến 7).
 *
 * Hai luật, cả hai đo bằng `toTargets` (đích thật của `.to()`), không bằng «có emit»:
 *   • đích suy từ `audience` của payload SAU `.parse()` — company ⇒ room công ty, group ⇒ room NHÓM, không
 *     bao giờ cả hai;
 *   • parse ném ⇒ KHÔNG chạm `.to()` (`toTargets = []`). Code BE-1 gọi `.to(feed)` TRƯỚC khi `build()`
 *     (chứa `.parse`) được tính (M27) — vô hại khi đích cố định, nhưng là lỗ khi đích suy từ payload.
 */
describe("RealtimeEmitterService.emitFeedPostCreated — định tuyến theo audience (S16-SOCIAL-BE-2C W3)", () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  /**
   * FULL gate lượt 1 (silent-failure-hunter LOW): parse ném ở đây = hợp đồng builder ↔ union TRÔI (builder
   * dựng payload để parse ĐƯỢC) ⇒ ERROR kèm bài nào · audience nào · nhóm nào. Thiếu ba khoá đó thì mất
   * toàn bộ fan-out nhóm chỉ để lại một chuỗi `failed` không truy được về bài.
   */
  const expectDriftLogged = (postId: string, audience: string, groupId: string | null) => {
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "emitFeedPostCreated failed",
      expect.objectContaining({ companyId: COMPANY, postId, audience, groupId }),
    );
  };

  const POST_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const base = {
    id: POST_ID,
    type: "share",
    orgUnitId: null,
    author: { employeeId: null, fullName: "A", avatarUrl: null },
    body: "x",
    tags: [],
    attachments: [],
    pinned: false,
    commentsLocked: false,
    requiresAck: false,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    editedAt: null,
    publishedAt: "2026-10-02T00:00:00.000Z",
    lastActivityAt: "2026-10-02T00:00:00.000Z",
    createdAt: "2026-10-02T00:00:00.000Z",
  };
  const companyPost = { ...base, audience: "company", groupId: null };
  const groupPost = { ...base, audience: "group", groupId: GROUP };

  it("W3a bài company ⇒ đích ĐÚNG room công ty, 1 emit (neo hồi quy)", () => {
    const { svc, emit, toTargets } = makeEmitter();
    svc.emitFeedPostCreated(COMPANY, companyPost as never);
    expect(toTargets).toEqual([feedRoomName(COMPANY)]);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      WS_EVENTS.FEED_POST_CREATED,
      expect.objectContaining({ id: POST_ID }),
    );
  });

  it("🔒 W3b bài group ⇒ đích CHỈ room nhóm — KHÔNG room công ty", () => {
    const { svc, emit, toTargets } = makeEmitter();
    svc.emitFeedPostCreated(COMPANY, groupPost as never);
    expect(toTargets).toEqual([feedGroupRoomName(COMPANY, GROUP)]);
    expect(toTargets.flat()).not.toContain(feedRoomName(COMPANY));
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("🔒 W3c bài org_unit ⇒ parse ném ⇒ KHÔNG chạm `.to()`, 0 emit, ERROR có ngữ cảnh, KHÔNG ném", () => {
    const { svc, emit, toTargets } = makeEmitter();
    expect(() =>
      svc.emitFeedPostCreated(COMPANY, { ...base, audience: "org_unit", groupId: null } as never),
    ).not.toThrow();
    expect(toTargets).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
    expectDriftLogged(POST_ID, "org_unit", null);
  });

  it("🔒 W3d bài group THIẾU groupId ⇒ không định tuyến được ⇒ `toTargets = []`, 0 emit, ERROR có ngữ cảnh", () => {
    const { svc, emit, toTargets } = makeEmitter();
    expect(() =>
      svc.emitFeedPostCreated(COMPANY, { ...groupPost, groupId: null } as never),
    ).not.toThrow();
    expect(toTargets).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
    expectDriftLogged(POST_ID, "group", null);
  });

  it("W3e payload group mang khoá theo-actor/khối/URL ⇒ khoá đó bị BÓC khỏi thứ phát ra", () => {
    const { svc, emit } = makeEmitter();
    svc.emitFeedPostCreated(COMPANY, {
      ...groupPost,
      status: "published",
      myReaction: "like",
      savedByMe: true,
      isMine: true,
      poll: { myVote: ["22222222-2222-4222-8222-222222222222"] },
      attachments: [
        {
          fileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          kind: "image",
          fileName: "a.png",
          sizeBytes: 10,
          url: "https://signed.example/secret",
        },
      ],
    } as never);

    const payload = emit.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(payload).toBeDefined();
    // Neo dương: parse thành công VÀ là đúng bài nhóm (không phải payload rỗng xanh mọi vế âm).
    expect(payload?.id).toBe(POST_ID);
    expect(payload?.groupId).toBe(GROUP);
    for (const k of ["status", "myReaction", "savedByMe", "isMine", "poll"]) {
      expect(payload).not.toHaveProperty(k);
    }
    const att = (payload?.attachments as Record<string, unknown>[])[0];
    expect(att?.fileId).toBe("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(att).not.toHaveProperty("url");
    expect(JSON.stringify(payload)).not.toContain("signed.example");
  });

  /**
   * S16-SOCIAL-AVATARPRESIGN-1 (D3-b) — TẦNG HAI ở emitter: `.parse()` qua `wsFeedAuthorSchema`
   * (`.transform` ⇒ `null`) ép `author.avatarUrl` về `null` cho CẢ HAI biến thể, kể cả khi nguồn
   * (`buildWsPostCreatedEvent` → `wsAuthorOf`) hồi quy và để lọt URL ĐÃ KÝ của REST. Đo trên thứ THẬT SỰ
   * phát vào room (`emit`) + đích (`toTargets`), không trên đầu ra schema.
   */
  it.each([
    ["company", companyPost, feedRoomName(COMPANY)],
    ["group", groupPost, feedGroupRoomName(COMPANY, GROUP)],
  ] as const)(
    "🔒 W3f biến thể %s — `author.avatarUrl` ĐÃ KÝ lọt tới emitter ⇒ room nhận `null` (D3-b tầng 2)",
    (_aud, post, room) => {
      const { svc, emit, toTargets } = makeEmitter();
      const signed = `https://minio.example/a.png?X-Amz-Signature=${"ab".repeat(32)}`;

      svc.emitFeedPostCreated(COMPANY, {
        ...post,
        author: { employeeId: USER, fullName: "A", avatarUrl: signed },
      } as never);

      // Neo dương: parse thành công, phát ĐÚNG một lần vào ĐÚNG room của biến thể.
      expect(toTargets).toEqual([room]);
      expect(emit).toHaveBeenCalledTimes(1);
      const payload = emit.mock.calls[0]?.[1] as { author?: Record<string, unknown> } | undefined;
      expect(payload?.author?.fullName, "neo: tác giả còn nguyên").toBe("A");
      expect(payload?.author?.avatarUrl, "URL ký lên room").toBeNull();
      expect(JSON.stringify(payload)).not.toContain("X-Amz-Signature");
    },
  );
});
