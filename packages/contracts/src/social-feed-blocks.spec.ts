import { describe, expect, it } from "vitest";
import {
  KUDOS_RECIPIENT_MAX,
  KUDOS_RECIPIENT_MIN,
  KUDOS_RECIPIENT_QUERY_MIN,
  kudosBadgeAdminSchema,
  kudosBadgePageSchema,
  kudosRecipientCandidateSchema,
  kudosRecipientSearchQuerySchema,
} from "./social-api-kudos";
import { feedKudosRecipientSchema, feedPollResultsSchema } from "./social-feed-blocks";

/**
 * S16-SOCIAL-BE-2D — hợp đồng khối thẻ bài + query danh bạ `059` (plan §5 U5, §9 V1/V3).
 */

const parseQ = (q: unknown) => kudosRecipientSearchQuerySchema.safeParse({ q });

describe("059 — query danh bạ: đếm CHỮ/SỐ, không đếm độ dài chuỗi", () => {
  it("neo: hai chữ cái là đủ", () => {
    expect(KUDOS_RECIPIENT_QUERY_MIN).toBe(2);
    expect(parseQ("an").success).toBe(true);
  });

  it.each([
    ["một chữ", "a"],
    ["chỉ ký tự đại diện LIKE", "%%"],
    ["chỉ gạch dưới", "__"],
    ["chỉ dấu tổ hợp (f_unaccent co thành rỗng — M10)", "\u0301\u0303"],
    ["một chữ + dấu tổ hợp", "a\u0301"],
    ["ký tự điều khiển NUL", "ab\u0000"],
    ["zero-width (Cf)", "ab\u200b"],
    ["toàn khoảng trắng", "   "],
  ])("từ chối: %s", (_label, q) => {
    expect(parseQ(q).success).toBe(false);
  });

  it("`%`/`_` là ký tự THƯỜNG khi đủ chữ (server khớp bằng strpos, không LIKE)", () => {
    expect(parseQ("ab%").success).toBe(true);
    expect(parseQ("a_c").success).toBe(true);
  });

  it("chuẩn hoá NFC + gộp khoảng trắng + trim", () => {
    const r = kudosRecipientSearchQuerySchema.parse({ q: "  Nguye\u0302\u0303n \t  Va\u0306n  " });
    expect(r.q).toBe("Nguyễn Văn");
    expect(r.q).toBe(r.q.normalize("NFC"));
  });

  it("LUỸ ĐẲNG — parse hai lần (pipe toàn cục + @UsePipes) = parse một lần", () => {
    const once = kudosRecipientSearchQuerySchema.parse({ q: " Đặng\u00a0 Thu  " });
    const twice = kudosRecipientSearchQuerySchema.parse(once);
    expect(twice).toEqual(once);
    expect(once.q).toBe("Đặng Thu");
  });

  it("`.strict()` — không nhận `limit`/`page` (đường vượt trần)", () => {
    expect(kudosRecipientSearchQuerySchema.safeParse({ q: "an", limit: 5 }).success).toBe(false);
    expect(kudosRecipientSearchQuerySchema.safeParse({ q: "an", page: 2 }).success).toBe(false);
  });

  it("thiếu `q` ⇒ lỗi", () => {
    expect(kudosRecipientSearchQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe("hình dạng không chở danh tính tài khoản", () => {
  it("người trong danh bạ: ĐÚNG 3 khoá, không `userId`", () => {
    expect(Object.keys(kudosRecipientCandidateSchema.shape).sort()).toEqual([
      "avatarUrl",
      "employeeId",
      "fullName",
    ]);
  });

  it("người nhận vinh danh: không `userId`", () => {
    expect(Object.keys(feedKudosRecipientSchema.shape)).not.toContain("userId");
    expect(Object.keys(feedKudosRecipientSchema.shape)).toContain("isFormerEmployee");
  });

  it("kết quả poll: không khoá cử tri nào", () => {
    const keys = Object.keys(feedPollResultsSchema.shape);
    expect(keys).toContain("myVote"); // neo
    for (const k of ["voters", "userIds", "voterIds"]) expect(keys).not.toContain(k);
  });

  it("`closesAt` phải là ISO có `T` — chuỗi thô timestamptz của driver bị TỪ CHỐI (V1)", () => {
    const base = {
      pollId: "11111111-1111-4111-8111-111111111111",
      postId: "22222222-2222-4222-8222-222222222222",
      question: "?",
      status: "open",
      multipleChoice: false,
      isAnonymous: false,
      totalVoters: 0,
      myVote: [],
      options: [],
    };
    expect(
      feedPollResultsSchema.safeParse({ ...base, closesAt: "2026-10-05T03:00:00.000Z" }).success,
    ).toBe(true);
    expect(
      feedPollResultsSchema.safeParse({ ...base, closesAt: "2026-10-05 03:00:00+00" }).success,
    ).toBe(false);
  });
});

describe("S16-SOCIAL-FE-2C — catalog huy hiệu 048 + trần người nhận (plan K1)", () => {
  const row = {
    id: "33333333-3333-4333-8333-333333333333",
    code: "team-player",
    name: "Đồng đội",
    description: null,
    icon: null,
    position: 1,
  };

  it("parse đúng hình `KudosBadgeRow` (description/icon null)", () => {
    const r = kudosBadgePageSchema.safeParse({ data: [row], page: 1, limit: 100, total: 1 });
    expect(r.success).toBe(true);
  });

  it("từ chối `id` không phải uuid", () => {
    const r = kudosBadgePageSchema.safeParse({
      data: [{ ...row, id: "x" }],
      page: 1,
      limit: 100,
      total: 1,
    });
    expect(r.success).toBe(false);
  });

  it("đối chứng: schema QUẢN TRỊ ném với hàng 048 (thiếu isActive/createdAt) — đừng dùng nó cho 048", () => {
    expect(kudosBadgeAdminSchema.safeParse(row).success).toBe(false);
  });

  it("trần người nhận mirror service: 1..10", () => {
    expect(KUDOS_RECIPIENT_MIN).toBe(1);
    expect(KUDOS_RECIPIENT_MAX).toBe(10);
  });
});
