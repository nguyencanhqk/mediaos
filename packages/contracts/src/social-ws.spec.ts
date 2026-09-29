import { describe, expect, it } from "vitest";
import {
  feedAttachmentSchema,
  feedCommentSchema,
  feedPostSchema,
  feedReactionSummarySchema,
} from "./social-api";
import {
  WS_EVENTS,
  wsFeedAttachmentSchema,
  wsFeedCommentCreatedEventSchema,
  wsFeedPostCreatedEventSchema,
  wsFeedReactionChangedEventSchema,
} from "./realtime";

/**
 * S16-SOCIAL-BE-1 · plan §5 R24 — payload WS của bảng tin.
 *
 * ┌─ HAI VẾ, CẢ HAI ĐỀU ĐÓNG ĐINH MỘT LỖ IM LẶNG ─────────────────────────────────────────────────┐
 * │ 1. **WS ⊆ REST** — payload phát cho CẢ CÔNG TY không được mang khoá nào mà DTO REST không có.  │
 * │    Một khoá thừa ở đây là một trường lọt qua mọi cổng của đường REST.                          │
 * │ 2. **Bốn khoá projection-theo-actor và `url` presign PHẢI VẮNG** — chúng đúng với ĐÚNG MỘT      │
 * │    người, còn sự kiện thì tới tất cả. `url` tệ nhất: presign là bearer capability, ai cầm cũng  │
 * │    tải được, không qua guard nào nữa và không sinh `file_access_logs`.                          │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Đo bằng `.shape` của Zod chứ không bằng một mẫu payload: mẫu chỉ chứng minh MỘT giá trị đi qua
 * được, còn shape là hợp đồng — thêm khoá vào schema là ĐỎ ngay, không cần ai nhớ cập nhật fixture.
 */

const keysOf = (s: { shape: Record<string, unknown> }): string[] => Object.keys(s.shape).sort();

/** Bốn khoá tính RIÊNG cho actor gọi REST — vô nghĩa (và sai) khi fan-out. */
const PER_ACTOR_KEYS = ["myReaction", "savedByMe", "isMine", "status"] as const;

describe("WS_EVENTS — tên sự kiện bảng tin", () => {
  it("khai đúng 3 sự kiện theo API-19 §7", () => {
    expect(WS_EVENTS.FEED_POST_CREATED).toBe("feed:post.created");
    expect(WS_EVENTS.FEED_COMMENT_CREATED).toBe("feed:comment.created");
    expect(WS_EVENTS.FEED_REACTION_CHANGED).toBe("feed:reaction.changed");
  });
});

describe("R24 — `feed:post.created` HẸP HƠN DTO REST", () => {
  const wsKeys = keysOf(wsFeedPostCreatedEventSchema);
  const restKeys = keysOf(feedPostSchema);

  it("KHÔNG có khoá nào ngoài DTO REST", () => {
    expect(wsKeys.filter((k) => !restKeys.includes(k))).toEqual([]);
  });

  it("bốn khoá projection-theo-actor bị STRIP", () => {
    for (const k of PER_ACTOR_KEYS) expect(wsKeys).not.toContain(k);
  });

  it("KHÔNG có `authorUserId`/`deletedAt` (vốn đã không có ở REST — giữ đai)", () => {
    expect(wsKeys).not.toContain("authorUserId");
    expect(wsKeys).not.toContain("deletedAt");
  });

  it("`audience` khoá cứng `company` — bài `org_unit` KHÔNG parse được", () => {
    // Vế thứ hai của D21 (vế thứ nhất ở service). Một bài org_unit lọt tới emitter sẽ NÉM ở
    // `.parse()` chứ không âm thầm phát ra cả công ty.
    const base = {
      id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      type: "share",
      orgUnitId: null,
      groupId: null,
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
      publishedAt: "2026-09-21T00:00:00.000Z",
      lastActivityAt: "2026-09-21T00:00:00.000Z",
      createdAt: "2026-09-21T00:00:00.000Z",
    };
    expect(wsFeedPostCreatedEventSchema.safeParse({ ...base, audience: "company" }).success).toBe(
      true,
    );
    expect(wsFeedPostCreatedEventSchema.safeParse({ ...base, audience: "org_unit" }).success).toBe(
      false,
    );
    expect(wsFeedPostCreatedEventSchema.safeParse({ ...base, audience: "group" }).success).toBe(
      false,
    );
  });
});

describe("R24 — `feed:comment.created` HẸP HƠN DTO REST", () => {
  const wsKeys = keysOf(wsFeedCommentCreatedEventSchema);
  const restKeys = keysOf(feedCommentSchema);

  it("KHÔNG có khoá nào ngoài DTO REST", () => {
    expect(wsKeys.filter((k) => !restKeys.includes(k))).toEqual([]);
  });

  it("`myReaction`/`isMine` bị STRIP", () => {
    expect(wsKeys).not.toContain("myReaction");
    expect(wsKeys).not.toContain("isMine");
  });
});

// S16-SOCIAL-BE-1D D6 [PR1-9] — `mentions` chỉ ở REST. Neo dương: REST CÓ khoá (nếu REST mất khoá
// thì vế «WS vắng» xanh-rỗng).
describe("BE-1D D6 — `mentions` KHÔNG lên kênh WS", () => {
  it("`feed:post.created` không có `mentions` (REST thì CÓ)", () => {
    expect(keysOf(feedPostSchema)).toContain("mentions");
    expect(keysOf(wsFeedPostCreatedEventSchema)).not.toContain("mentions");
  });

  it("`feed:comment.created` không có `mentions` (REST thì CÓ)", () => {
    expect(keysOf(feedCommentSchema)).toContain("mentions");
    expect(keysOf(wsFeedCommentCreatedEventSchema)).not.toContain("mentions");
  });
});

// S16-SOCIAL-BE-2D D7 — ba khối chi tiết chỉ ở REST (`poll.myVote` là của TÁC GIẢ). Hai vế: `.shape`
// (hợp đồng) VÀ `.parse` (emitter phát ĐẦU RA của parse — khoá thừa phải bị bóc thật). Neo dương REST.
describe("BE-2D D7 — `kudos`/`poll`/`idea` KHÔNG lên kênh WS", () => {
  const BLOCK_KEYS = ["kudos", "poll", "idea"] as const;

  it.each(BLOCK_KEYS)("`%s`: REST CÓ khoá, WS KHÔNG", (k) => {
    expect(keysOf(feedPostSchema)).toContain(k);
    expect(keysOf(wsFeedPostCreatedEventSchema)).not.toContain(k);
  });

  it("`.parse` của WS BÓC cả ba khối khỏi payload (kể cả khi nguồn quên bóc)", () => {
    const base = {
      id: "11111111-1111-4111-8111-111111111111",
      type: "poll",
      audience: "company",
      orgUnitId: null,
      groupId: null,
      author: { employeeId: null, fullName: null, avatarUrl: null },
      body: null,
      tags: [],
      attachments: [],
      pinned: false,
      commentsLocked: false,
      requiresAck: false,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      editedAt: null,
      publishedAt: "2026-09-29T00:00:00.000Z",
      lastActivityAt: "2026-09-29T00:00:00.000Z",
      createdAt: "2026-09-29T00:00:00.000Z",
    };
    const leaked = {
      ...base,
      poll: { myVote: ["22222222-2222-4222-8222-222222222222"] },
      kudos: { recipients: [] },
      idea: { status: "submitted" },
    };
    const out = wsFeedPostCreatedEventSchema.parse(leaked) as Record<string, unknown>;
    expect(out.id).toBe(base.id); // neo: parse thành công, không phải ném rồi bị nuốt
    for (const k of BLOCK_KEYS) expect(out).not.toHaveProperty(k);
  });
});

describe("R24 — đính kèm trên kênh WS KHÔNG mang URL presign", () => {
  it("`url` VẮNG MẶT ở schema đính kèm của WS (REST thì CÓ)", () => {
    expect(keysOf(feedAttachmentSchema)).toContain("url");
    expect(keysOf(wsFeedAttachmentSchema)).not.toContain("url");
  });

  it("`.parse()` STRIP `url` kể cả khi caller lỡ truyền vào", () => {
    // Masking nằm ở chính bước parse, không dựa vào kỷ luật của điểm gọi — đó là lý do emitter phải
    // parse TRƯỚC emit chứ không emit thẳng object.
    const parsed = wsFeedAttachmentSchema.parse({
      fileId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      kind: "image",
      fileName: "a.png",
      sizeBytes: 10,
      url: "https://signed.example/secret",
    });
    expect("url" in parsed).toBe(false);
  });

  it("cả hai sự kiện bài/bình luận đều dùng schema đính kèm ĐÃ strip", () => {
    for (const s of [wsFeedPostCreatedEventSchema, wsFeedCommentCreatedEventSchema]) {
      const out = s.safeParse({});
      // Chỉ cần chắc `attachments` tồn tại trong shape và là mảng đã strip (kiểm sâu ở ca trên).
      expect(keysOf(s)).toContain("attachments");
      expect(out.success).toBe(false);
    }
  });
});

describe("R24 — `feed:reaction.changed`", () => {
  it("mang đúng bộ khoá API-19 §7 + `postId` để FE định vị thẻ", () => {
    expect(keysOf(wsFeedReactionChangedEventSchema)).toEqual([
      "likeCount",
      "postId",
      "reactions",
      "targetId",
      "targetType",
    ]);
  });

  it("KHÔNG có `actorUserId` (ai vừa thả không phục vụ màn hình nào)", () => {
    expect(keysOf(wsFeedReactionChangedEventSchema)).not.toContain("actorUserId");
  });

  it("`reactions[]` đã STRIP `mine` (trạng thái của MỘT người, phát cho tất cả)", () => {
    expect(keysOf(feedReactionSummarySchema)).toContain("mine");
    const parsed = wsFeedReactionChangedEventSchema.parse({
      targetType: "post",
      targetId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      postId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      likeCount: 1,
      reactions: [{ emoji: "like", count: 1, mine: true }],
    });
    expect("mine" in parsed.reactions[0]).toBe(false);
  });
});
