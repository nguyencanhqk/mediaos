import { describe, expect, it } from "vitest";
import {
  FEED_COMMENT_BODY_MAX,
  FEED_POLL_QUESTION_MAX,
  FEED_POST_BODY_MAX,
  feedAudienceSchema,
  feedGroupMemberCoreSchema,
  feedGroupMemberStatusSchema,
  feedGroupRoleSchema,
  feedGroupVisibilitySchema,
  feedIdeaCoreSchema,
  feedIdeaStatusSchema,
  feedPollCoreSchema,
  feedPollStatusSchema,
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

/**
 * S16-SOCIAL-DB-2 — PIN HAI CHIỀU 5 enum SOCIAL Track B ↔ CHECK của migration `0580`. Mảng LITERAL chép
 * TAY từ plan §4 / migration `0580`, cố ý KHÔNG import từ `schema/social.ts` (tautology —
 * `contract-must-mirror-db-check-both-directions`). `toEqual` trên hai mảng đã sort ⇒ đỏ theo CẢ HAI
 * chiều: DB thừa một giá trị mà Zod thiếu, và Zod thừa một giá trị mà DB thiếu.
 */
const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const TS = "2026-09-21T03:00:00.000Z";

describe("contracts/social — 5 enum Track B mirror CHECK migration 0580 (hai chiều, đúng bằng)", () => {
  it("feedGroupVisibilitySchema == chk_feed_groups_visibility (2 giá trị)", () => {
    expect([...feedGroupVisibilitySchema.options].sort()).toEqual(["public", "private"].sort());
  });

  it("feedGroupRoleSchema == chk_feed_group_members_role (3 giá trị)", () => {
    expect([...feedGroupRoleSchema.options].sort()).toEqual(["owner", "admin", "member"].sort());
  });

  it("feedGroupMemberStatusSchema == chk_feed_group_members_status (2 giá trị — KHÔNG có 'removed')", () => {
    // SOC-DEC-006: rời/mời-ra-nhóm là DELETE cứng, vết nằm ở audit_logs — KHÔNG có trạng thái thứ ba.
    expect([...feedGroupMemberStatusSchema.options].sort()).toEqual(["active", "pending"].sort());
  });

  it("feedPollStatusSchema == chk_feed_polls_status (2 giá trị)", () => {
    expect([...feedPollStatusSchema.options].sort()).toEqual(["open", "closed"].sort());
  });

  it("feedIdeaStatusSchema == chk_feed_ideas_status (4 giá trị)", () => {
    expect([...feedIdeaStatusSchema.options].sort()).toEqual(
      ["submitted", "under_review", "accepted", "rejected"].sort(),
    );
  });

  it("FEED_POLL_QUESTION_MAX == varchar(500) của feed_polls.question", () => {
    expect(FEED_POLL_QUESTION_MAX).toBe(500);
  });
});

describe("contracts/social — superRefine Track B mirror CHECK KÉO THEO (mỗi DENY kèm 1 ALLOW)", () => {
  const member = (over: Record<string, unknown>) =>
    feedGroupMemberCoreSchema.safeParse({ groupId: UUID, userId: UUID2, ...over });

  it("chk_feed_group_members_pending_role: pending + admin ⇒ CHẶN", () => {
    expect(member({ role: "admin", status: "pending" }).success).toBe(false);
  });

  it("ALLOW đối chứng: pending + member ⇒ QUA; active + admin ⇒ QUA (chặn đúng NHÁNH pending)", () => {
    expect(member({ role: "member", status: "pending" }).success).toBe(true);
    expect(member({ role: "admin", status: "active" }).success).toBe(true);
  });

  const poll = (over: Record<string, unknown>) =>
    feedPollCoreSchema.safeParse({ postId: UUID, question: "Ăn trưa ở đâu?", ...over });

  it("chk_feed_polls_closed_pair: status='closed' mà thiếu closedAt ⇒ CHẶN", () => {
    expect(poll({ status: "closed" }).success).toBe(false);
  });

  it("ALLOW đối chứng: closed + closedAt ⇒ QUA; open không closedAt ⇒ QUA", () => {
    expect(poll({ status: "closed", closedAt: TS }).success).toBe(true);
    expect(poll({ status: "open" }).success).toBe(true);
  });

  it("NGOẠI LỆ CÓ CHỦ Ý: closesAt trong QUÁ KHỨ ⇒ Zod cho QUA (lưới là CHECK ở DB + service)", () => {
    // `chk_feed_polls_closes_future` so với `created_at` — giá trị DB sinh trong CÙNG câu INSERT, chưa
    // tồn tại lúc validate request ⇒ mirror đúng-bằng là BẤT KHẢ. Ca này GHIM ngoại lệ để review sau
    // không đọc nhầm thành "thiếu superRefine" (plan §6.5 / §9 rủi ro 13). Ca song sinh chứng minh
    // chiều DB thật sự chặn: `s16-social-db2-invariants.int-spec.ts` Nhóm 2.
    expect(poll({ closesAt: "2020-01-01T00:00:00.000Z" }).success).toBe(true);
  });

  const idea = (over: Record<string, unknown>) =>
    feedIdeaCoreSchema.safeParse({ postId: UUID, ...over });

  it("chk_feed_ideas_reviewed_pair: accepted mà thiếu reviewedBy/reviewedAt ⇒ CHẶN", () => {
    expect(idea({ status: "accepted" }).success).toBe(false);
    expect(idea({ status: "accepted", reviewedBy: UUID2 }).success).toBe(false);
  });

  it("chk_feed_ideas_reject_note: rejected ĐỦ cặp duyệt mà thiếu/rỗng review_note ⇒ CHẶN", () => {
    // ĐỦ cặp duyệt ⇒ chỉ vi phạm ĐÚNG MỘT ràng buộc (phân biệt với ca reviewed_pair ở trên).
    expect(idea({ status: "rejected", reviewedBy: UUID2, reviewedAt: TS }).success).toBe(false);
    expect(
      idea({ status: "rejected", reviewedBy: UUID2, reviewedAt: TS, reviewNote: "   " }).success,
    ).toBe(false);
  });

  it("ALLOW đối chứng: submitted trần ⇒ QUA; accepted đủ cặp ⇒ QUA; rejected có lý do ⇒ QUA", () => {
    expect(idea({ status: "submitted" }).success).toBe(true);
    expect(idea({ status: "under_review" }).success).toBe(true);
    expect(idea({ status: "accepted", reviewedBy: UUID2, reviewedAt: TS }).success).toBe(true);
    expect(
      idea({
        status: "rejected",
        reviewedBy: UUID2,
        reviewedAt: TS,
        reviewNote: "trùng ý tưởng cũ",
      }).success,
    ).toBe(true);
  });
});
