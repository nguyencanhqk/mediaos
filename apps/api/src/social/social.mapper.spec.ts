import { describe, expect, it } from "vitest";
import type { FeedMentionDto } from "@mediaos/contracts";
import type { CommentRow } from "./social-comments.repository";
import type { PostRow } from "./social-posts.repository";
import { toFeedCommentDto, toFeedPostDto, toReactionSummaries } from "./social.mapper";
import type { SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-BE-1 — mapper là LỚP CHE, và đây là chỗ đóng đinh nó (plan §5 R24).
 *
 * Hai khoá KHÔNG BAO GIỜ được ra ngoài, và cả hai đều rò một cách IM LẶNG nếu lọt:
 *   • `authorUserId` — khoá tài khoản, thứ duy nhất cần để dò các đường `users/*`;
 *   • `status` cho NGƯỜI ĐỌC THƯỜNG — chỉ riêng sự CÓ MẶT của khoá đã đủ để biết một bài `hidden`
 *     tồn tại.
 */

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const row: PostRow = {
  id: "33333333-3333-4333-8333-333333333333",
  authorUserId: AUTHOR,
  authorEmployeeId: "44444444-4444-4444-8444-444444444444",
  authorFullName: "Nguyễn Văn A",
  authorAvatarUrl: "https://example.test/a.png",
  type: "share",
  audience: "company",
  orgUnitId: null,
  groupId: null,
  body: "Chào cả nhà",
  status: "hidden",
  pinned: false,
  commentsLocked: false,
  requiresAck: false,
  likeCount: 3,
  commentCount: 1,
  viewCount: 31,
  publishedAt: new Date("2026-09-18T03:12:00.000Z"),
  lastActivityAt: new Date("2026-09-18T04:00:00.000Z"),
  editedAt: null,
  createdAt: new Date("2026-09-18T03:12:00.000Z"),
  sortAt: "2026-09-18T04:00:00.000Z",
};

const viewer = (over: Partial<SocialViewerContext> = {}): SocialViewerContext => ({
  actorUserId: OTHER,
  companyId: "55555555-5555-4555-8555-555555555555",
  canManagePosts: false,
  orgUnitIds: [],
  ...over,
});

const extra = { tags: ["tuyendung"], attachments: [], myReaction: null, savedByMe: false };

describe("toFeedPostDto — khoá KHÔNG BAO GIỜ lộ", () => {
  it("KHÔNG có `authorUserId` ở bất kỳ nhánh nào — kể cả với `manage:feed-post`", () => {
    for (const v of [viewer(), viewer({ canManagePosts: true }), viewer({ actorUserId: AUTHOR })]) {
      const dto = toFeedPostDto(row, v, extra);
      expect(Object.keys(dto)).not.toContain("authorUserId");
      // Và cũng không lẩn trong object `author`.
      expect(Object.keys(dto.author)).toEqual(["employeeId", "fullName", "avatarUrl"]);
      // Quét CẢ payload đã tuần tự hoá — chặn cả trường hợp khoá nằm sâu trong một object lồng.
      expect(JSON.stringify(dto)).not.toContain(AUTHOR);
    }
  });

  it("KHÔNG có `deletedAt` ở bất kỳ nhánh nào", () => {
    expect(Object.keys(toFeedPostDto(row, viewer({ canManagePosts: true }), extra))).not.toContain(
      "deletedAt",
    );
  });
});

describe("toFeedPostDto — `status` có cổng", () => {
  it("người đọc THƯỜNG: khoá `status` VẮNG MẶT hẳn (không phải null/undefined)", () => {
    const dto = toFeedPostDto(row, viewer(), extra);
    expect("status" in dto).toBe(false);
  });

  it("TÁC GIẢ: có `status`", () => {
    const dto = toFeedPostDto(row, viewer({ actorUserId: AUTHOR }), extra);
    expect(dto.status).toBe("hidden");
  });

  it("`manage:feed-post`: có `status`", () => {
    const dto = toFeedPostDto(row, viewer({ canManagePosts: true }), extra);
    expect(dto.status).toBe("hidden");
  });
});

describe("toFeedPostDto — cờ theo actor", () => {
  it("`isMine` thay cho việc phơi `authorUserId` để FE tự so", () => {
    expect(toFeedPostDto(row, viewer({ actorUserId: AUTHOR }), extra).isMine).toBe(true);
    expect(toFeedPostDto(row, viewer(), extra).isMine).toBe(false);
  });

  it("chở đúng projection theo actor được truyền vào", () => {
    const dto = toFeedPostDto(row, viewer(), { ...extra, myReaction: "👍", savedByMe: true });
    expect(dto.myReaction).toBe("👍");
    expect(dto.savedByMe).toBe(true);
  });

  it("mốc thời gian là ISO-8601 UTC, không phải Date", () => {
    const dto = toFeedPostDto(row, viewer(), extra);
    expect(dto.publishedAt).toBe("2026-09-18T03:12:00.000Z");
    expect(dto.lastActivityAt).toBe("2026-09-18T04:00:00.000Z");
    expect(dto.editedAt).toBeNull();
  });
});

describe("toReactionSummaries — `mine` là của RIÊNG actor", () => {
  const rows = [
    { emoji: "👍", count: 3 },
    { emoji: "❤️", count: 1 },
  ];

  it("đánh dấu ĐÚNG MỘT emoji actor đang thả", () => {
    expect(toReactionSummaries(rows, "❤️")).toEqual([
      { emoji: "👍", count: 3, mine: false },
      { emoji: "❤️", count: 1, mine: true },
    ]);
  });

  it("actor chưa thả ⇒ KHÔNG dòng nào `mine`", () => {
    expect(toReactionSummaries(rows, null).every((r) => !r.mine)).toBe(true);
  });
});

// ══════════════ S16-SOCIAL-BE-1D — `mentions` (D3 · D5) ══════════════

const MENTIONED_EMP = "66666666-6666-4666-8666-666666666666";
const MENTIONED_USER = "77777777-7777-4777-8777-777777777777";

const commentRow: CommentRow = {
  id: "88888888-8888-4888-8888-888888888888",
  postId: row.id,
  parentCommentId: null,
  authorUserId: AUTHOR,
  authorEmployeeId: "44444444-4444-4444-8444-444444444444",
  authorFullName: "Nguyễn Văn A",
  authorAvatarUrl: null,
  body: "@Trần Thị B chào",
  likeCount: 0,
  editedAt: null,
  createdAt: new Date("2026-09-18T03:12:00.000Z"),
  sortAt: "2026-09-18T03:12:00.000Z",
};

/**
 * Phần tử tầng dưới LỠ mang khoá lạ (`userId`, `label` ở nhánh rút) — mapper phải chép theo danh sách
 * khoá, không spread. Ép kiểu có chủ đích: đây là ca «tầng dưới sai», type không cho viết thẳng.
 */
const dirty = [
  { withheld: false, employeeId: MENTIONED_EMP, label: "Trần Thị B", userId: MENTIONED_USER },
  { withheld: true, label: "Lê Văn C", employeeId: MENTIONED_EMP, userId: MENTIONED_USER },
] as unknown as FeedMentionDto[];

const mentionBuilders = [
  ["bài", () => toFeedPostDto(row, viewer(), { ...extra, mentions: dirty }).mentions],
  [
    "bình luận",
    () =>
      toFeedCommentDto(commentRow, viewer(), { attachments: [], myReaction: null, mentions: dirty })
        .mentions,
  ],
] as const;

describe("BE-1D — `mentions` trên DTO bài & bình luận", () => {
  it("VẮNG khoá khi đường gọi không nạp mention (vắng ≠ rỗng — D5)", () => {
    expect("mentions" in toFeedPostDto(row, viewer(), extra)).toBe(false);
    const c = toFeedCommentDto(commentRow, viewer(), { attachments: [], myReaction: null });
    expect("mentions" in c).toBe(false);
  });

  it("mảng rỗng được giữ là RỖNG (có khoá)", () => {
    expect(toFeedPostDto(row, viewer(), { ...extra, mentions: [] }).mentions).toEqual([]);
  });

  for (const [name, build] of mentionBuilders) {
    it(`${name}: nhánh link chở ĐÚNG {withheld, employeeId, label} — KHÔNG userId`, () => {
      expect(build()?.[0]).toEqual({
        withheld: false,
        employeeId: MENTIONED_EMP,
        label: "Trần Thị B",
      });
    });

    it(`${name}: nhánh RÚT ra ĐÚNG {withheld:true}, GIỮ vị trí, không rò tên/id`, () => {
      const out = build();
      expect(out).toHaveLength(2);
      expect(out?.[1]).toEqual({ withheld: true });
      expect(JSON.stringify(out)).not.toContain(MENTIONED_USER);
      expect(JSON.stringify(out)).not.toContain("Lê Văn C");
    });
  }
});

// ══════════════ S16-SOCIAL-BE-2D — khối kudos/poll/idea (plan §5 U3) ══════════════

describe("toFeedPostDto — khối theo loại bài: vắng ≠ rỗng, chép theo danh sách khoá", () => {
  it("không truyền khối ⇒ ba khoá VẮNG hẳn (không null/undefined)", () => {
    const dto = toFeedPostDto(row, viewer(), extra);
    for (const k of ["kudos", "poll", "idea"]) expect(Object.keys(dto)).not.toContain(k);
  });

  it("khối có mặt ⇒ gán; khoá LẠ ở tầng dưới (userId, voters) KHÔNG đi qua", () => {
    const dirtyRecipient = {
      employeeId: "e1",
      fullName: "A",
      avatarUrl: null,
      isFormerEmployee: false,
      userId: AUTHOR,
    };
    const dto = toFeedPostDto(row, viewer(), {
      ...extra,
      kudos: {
        kudosId: "k1",
        message: null,
        isOfficial: true,
        badge: null,
        recipients: [dirtyRecipient],
      },
      poll: {
        pollId: "p1",
        postId: row.id,
        question: "?",
        status: "open",
        multipleChoice: false,
        isAnonymous: true,
        closesAt: null,
        totalVoters: 0,
        myVote: [],
        options: [],
        voters: [AUTHOR],
      } as Parameters<typeof toFeedPostDto>[2]["poll"],
      idea: { status: "accepted", reviewNote: "bí mật" } as Parameters<typeof toFeedPostDto>[2]["idea"],
    });
    expect(dto.kudos?.recipients[0]).toEqual({
      employeeId: "e1",
      fullName: "A",
      avatarUrl: null,
      isFormerEmployee: false,
    });
    expect(dto.poll).not.toHaveProperty("voters");
    expect(dto.idea).toEqual({ status: "accepted" });
    expect(JSON.stringify(dto)).not.toContain(AUTHOR);
  });
});
