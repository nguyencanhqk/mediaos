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
  wsFeedCompanyPostCreatedEventSchema,
  wsFeedGroupPostCreatedEventSchema,
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
 *
 * ⚠️ S16-SOCIAL-BE-2C (owner ký Q-SCHEMA = P1, 02/10/2026) — `wsFeedPostCreatedEventSchema` thành
 * `z.discriminatedUnion("audience", [company, group])`: union KHÔNG có `.shape` (M3), nên mọi phép đo
 * shape của sự kiện bài đi qua TỪNG option (`.options`), luôn kèm neo `toHaveLength(2)` — lặp một mảng
 * rỗng thì mọi vế bên trong xanh RỖNG. Viết lại spec này là CÓ CHỦ ĐÍCH (plan M32), không phải dọn dẹp.
 */

const keysOf = (s: { shape: Record<string, unknown> }): string[] => Object.keys(s.shape).sort();

/** Bốn khoá tính RIÊNG cho actor gọi REST — vô nghĩa (và sai) khi fan-out. */
const PER_ACTOR_KEYS = ["myReaction", "savedByMe", "isMine", "status"] as const;

/** Hai option của union sự kiện bài — neo độ dài đứng NGAY ở mọi chỗ lặp. */
const POST_OPTIONS = wsFeedPostCreatedEventSchema.options;
const AUDIENCES = ["company", "group"] as const;

/**
 * Option của union theo discriminator — tra TRONG ca chứ không lúc collect: một bảng `it.each` dựng từ
 * `.options` lúc collect sẽ làm CẢ FILE không nạp được khi schema thôi là union, che mất các ca hành vi.
 */
function optionFor(aud: (typeof AUDIENCES)[number]) {
  const option = POST_OPTIONS.find((o) => o.shape.audience.value === aud);
  if (!option) throw new Error(`union thiếu option audience=${aud}`);
  return option;
}

const G = "61000000-0000-4000-8000-000000000001";
const OU = "71000000-0000-4000-8000-000000000001";

/** Payload bài WS hợp lệ (company) — biến thể khác dựng bằng spread. */
const base = {
  id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  type: "share",
  audience: "company",
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

describe("WS_EVENTS — tên sự kiện bảng tin", () => {
  it("khai đúng 3 sự kiện theo API-19 §7", () => {
    expect(WS_EVENTS.FEED_POST_CREATED).toBe("feed:post.created");
    expect(WS_EVENTS.FEED_COMMENT_CREATED).toBe("feed:comment.created");
    expect(WS_EVENTS.FEED_REACTION_CHANGED).toBe("feed:reaction.changed");
  });
});

describe("BE-2C — `feed:post.created` là union theo `audience` (company · group)", () => {
  it("ĐÚNG 2 option, discriminator ĐÚNG {company, group}; hai schema export CHÍNH LÀ hai option", () => {
    expect(POST_OPTIONS).toHaveLength(2);
    expect(POST_OPTIONS.map((o) => o.shape.audience.value).sort()).toEqual(["company", "group"]);
    expect(POST_OPTIONS).toContain(wsFeedCompanyPostCreatedEventSchema);
    expect(POST_OPTIONS).toContain(wsFeedGroupPostCreatedEventSchema);
  });

  it("tập khoá option group ≡ option company — room nhóm KHÔNG nhận payload rộng hơn room công ty", () => {
    expect(keysOf(wsFeedGroupPostCreatedEventSchema)).toEqual(
      keysOf(wsFeedCompanyPostCreatedEventSchema),
    );
    expect(keysOf(wsFeedGroupPostCreatedEventSchema)).toContain("orgUnitId");
    expect(keysOf(wsFeedGroupPostCreatedEventSchema)).toContain("attachments");
  });

  /**
   * C1 — ma trận parse. Emitter định tuyến theo payload ĐÃ parse ⇒ một tổ hợp vô nghĩa parse được là một
   * bài phát sai room (hoặc phát được dù không định tuyến nổi). `orgUnitId: z.null()` ở CẢ HAI option
   * (plan-review F6/M29): không có nó thì company/orgUnit=UUID và group/orgUnit=UUID vẫn lọt.
   */
  it.each([
    ["company · groupId null", { audience: "company", groupId: null }, true],
    ["group · groupId G", { audience: "group", groupId: G }, true],
    ["group · groupId null (bài nhóm thiếu đích)", { audience: "group", groupId: null }, false],
    ["company · groupId G (bài công ty mang nhóm)", { audience: "company", groupId: G }, false],
    ["org_unit (D21 — không room nào)", { audience: "org_unit", groupId: null }, false],
    ["company · orgUnitId UUID", { audience: "company", groupId: null, orgUnitId: OU }, false],
    ["group · orgUnitId UUID", { audience: "group", groupId: G, orgUnitId: OU }, false],
  ] as const)("C1 %s ⇒ parse %s", (_label, patch, ok) => {
    expect(wsFeedPostCreatedEventSchema.safeParse({ ...base, ...patch }).success).toBe(ok);
  });
});

describe("R24 — `feed:post.created` HẸP HƠN DTO REST (TỪNG option)", () => {
  const restKeys = keysOf(feedPostSchema);

  it("neo: union có đủ 2 option để đo", () => {
    expect(POST_OPTIONS).toHaveLength(2);
  });

  it.each(AUDIENCES)("option `%s`: KHÔNG có khoá nào ngoài DTO REST", (aud) => {
    expect(keysOf(optionFor(aud)).filter((k) => !restKeys.includes(k))).toEqual([]);
  });

  it.each(AUDIENCES)("option `%s`: bốn khoá projection-theo-actor bị STRIP", (aud) => {
    for (const k of PER_ACTOR_KEYS) expect(keysOf(optionFor(aud))).not.toContain(k);
  });

  it.each(AUDIENCES)(
    "option `%s`: KHÔNG có `authorUserId`/`deletedAt` (vốn đã không có ở REST — giữ đai)",
    (aud) => {
      expect(keysOf(optionFor(aud))).not.toContain("authorUserId");
      expect(keysOf(optionFor(aud))).not.toContain("deletedAt");
    },
  );

  it("bài `org_unit` và bài group THIẾU `groupId` KHÔNG parse được (vế thứ hai của D21 cho org_unit)", () => {
    // Vế thứ nhất ở service (`buildWsPostCreatedEvent` trả null). Một bài org_unit lọt tới emitter sẽ
    // NÉM ở `.parse()` chứ không âm thầm phát ra — và emitter không chạm `.to()` khi parse ném.
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
  it("`feed:post.created` (CẢ HAI option) không có `mentions` (REST thì CÓ)", () => {
    expect(keysOf(feedPostSchema)).toContain("mentions");
    expect(POST_OPTIONS).toHaveLength(2);
    for (const option of POST_OPTIONS) expect(keysOf(option)).not.toContain("mentions");
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

  it.each(BLOCK_KEYS)("`%s`: REST CÓ khoá, WS (CẢ HAI option) KHÔNG", (k) => {
    expect(keysOf(feedPostSchema)).toContain(k);
    expect(POST_OPTIONS).toHaveLength(2);
    for (const option of POST_OPTIONS) expect(keysOf(option)).not.toContain(k);
  });

  it.each([
    ["company", { audience: "company", groupId: null }],
    ["group", { audience: "group", groupId: G }],
  ] as const)(
    "`.parse` của WS BÓC cả ba khối khỏi payload %s (kể cả khi nguồn quên bóc)",
    (_aud, patch) => {
      const leaked = {
        ...base,
        ...patch,
        type: "poll",
        poll: { myVote: ["22222222-2222-4222-8222-222222222222"] },
        kudos: { recipients: [] },
        idea: { status: "submitted" },
      };
      const out = wsFeedPostCreatedEventSchema.parse(leaked) as Record<string, unknown>;
      expect(out.id).toBe(base.id); // neo: parse thành công, không phải ném rồi bị nuốt
      expect(out.audience).toBe(patch.audience);
      for (const k of BLOCK_KEYS) expect(out).not.toHaveProperty(k);
    },
  );
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

  it("cả ba schema bài (2 option) / bình luận đều dùng schema đính kèm ĐÃ strip", () => {
    const schemas = [...POST_OPTIONS, wsFeedCommentCreatedEventSchema];
    // Neo: 2 option bài + 1 bình luận — lặp mảng rỗng thì mọi vế dưới xanh RỖNG.
    expect(schemas).toHaveLength(3);
    for (const s of schemas) {
      const out = s.safeParse({});
      // Chỉ cần chắc `attachments` tồn tại trong shape và là mảng đã strip (kiểm sâu ở ca trên).
      expect(keysOf(s)).toContain("attachments");
      expect(s.shape.attachments.element).toBe(wsFeedAttachmentSchema);
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
