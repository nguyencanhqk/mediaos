import { describe, expect, it } from "vitest";
import {
  FEED_COMMENT_BODY_MAX,
  FEED_POST_BODY_MAX,
  feedAudienceSchema,
  feedPostStatusSchema,
  feedPostTypeSchema,
  feedReactionCoreSchema,
  feedReportReasonSchema,
  feedReportStatusSchema,
  feedTargetTypeSchema,
} from "./social";

/**
 * PIN HAI CHIỀU 6 enum SOCIAL Track A ↔ CHECK của migration `0577` (S16-SOCIAL-DB-1). Mảng LITERAL chép
 * TỪ MIGRATION, cố ý KHÔNG import từ `schema/social.ts` (assert hằng bằng chính nó = tautology —
 * `contract-must-mirror-db-check-both-directions`). Đổi CHECK ⇒ đổi cả đây lẫn enum, cùng commit.
 *
 * `toEqual` trên hai mảng đã sort là phép so ĐÚNG BẰNG ⇒ đỏ theo CẢ HAI chiều: DB có giá trị mà Zod
 * thiếu, và Zod có giá trị mà DB thiếu.
 */
describe("contracts/social — 6 enum mirror CHECK migration 0577 (hai chiều, đúng bằng)", () => {
  it("feedPostTypeSchema == chk_feed_posts_type (5 giá trị)", () => {
    expect([...feedPostTypeSchema.options].sort()).toEqual(
      ["share", "news", "idea", "poll", "kudos"].sort(),
    );
  });

  it("feedAudienceSchema == chk_feed_posts_audience (3 giá trị)", () => {
    expect([...feedAudienceSchema.options].sort()).toEqual(["company", "group", "org_unit"].sort());
  });

  it("feedPostStatusSchema == chk_feed_posts_status (3 giá trị — SPEC-01 §17.18)", () => {
    expect([...feedPostStatusSchema.options].sort()).toEqual(
      ["published", "hidden", "deleted"].sort(),
    );
  });

  it("feedTargetTypeSchema == chk_feed_reactions_target == _mentions_target == _reports_target", () => {
    // Ba CHECK RIÊNG BIỆT ở DB, cùng một tập giá trị ⇒ một enum dùng chung (DB-17 §8).
    expect([...feedTargetTypeSchema.options].sort()).toEqual(["post", "comment"].sort());
  });

  it("feedReportReasonSchema == chk_feed_reports_reason (5 giá trị)", () => {
    expect([...feedReportReasonSchema.options].sort()).toEqual(
      ["spam", "harassment", "inappropriate", "misinformation", "other"].sort(),
    );
  });

  it("feedReportStatusSchema == chk_feed_reports_status (3 giá trị)", () => {
    expect([...feedReportStatusSchema.options].sort()).toEqual(
      ["open", "resolved", "dismissed"].sort(),
    );
  });

  it("hằng độ dài == chk_feed_posts_body_len / chk_feed_comments_body_len", () => {
    expect(FEED_POST_BODY_MAX).toBe(20000);
    expect(FEED_COMMENT_BODY_MAX).toBe(5000);
  });
});

/**
 * ⚠️ NGOẠI LỆ DUY NHẤT của luật mirror — `feed_reactions.emoji` KHÔNG có CHECK ở DB (DB-17 §6.3).
 * Spec này CỐ Ý không đi tìm CHECK cho cột đó; nó chứng minh vế còn lại: Zod là lớp phòng thủ DUY NHẤT,
 * và nó thật sự chặn. Ca song sinh ở tầng PG (`s16-social-db1-invariants.int-spec.ts` §7.1 ca b) chứng
 * minh chiều ngược: PG **PASS** cùng giá trị đó — đúng thiết kế, KHÔNG phải thiếu CHECK.
 */
describe("contracts/social — emoji: NGOẠI LỆ mirror, lưới nằm ở Zod chứ không ở DB", () => {
  it("emoji lạ bị Zod CHẶN (PG cố ý cho qua — xem int-spec ca b)", () => {
    const r = feedReactionCoreSchema.safeParse({
      targetType: "post",
      targetId: "11111111-1111-4111-8111-111111111111",
      emoji: "clown",
    });
    expect(r.success).toBe(false);
  });

  it("emoji thuộc bộ CHAT được chấp nhận — ca ALLOW đối chứng (ca DENY rỗng là ca xanh giả)", () => {
    const r = feedReactionCoreSchema.safeParse({
      targetType: "post",
      targetId: "11111111-1111-4111-8111-111111111111",
      emoji: "like",
    });
    expect(r.success).toBe(true);
  });
});
