import { describe, expect, it } from "vitest";
import type { PostRow } from "./social-posts.repository";
import { toFeedPostDto, toReactionSummaries } from "./social.mapper";
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
