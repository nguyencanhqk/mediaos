/**
 * S16-SOCIAL-FE-2 — ca K1: schema RESPONSE của `040..046` (plan D1).
 *
 * Mẫu dưới đây chép ĐÚNG hình dạng service BE trả (`social-polls.service.ts#readResultsTx` ·
 * `#list` · `social-ideas.service.ts#toItem` · `#review`). Neo biên dịch nằm ở chính service (plan D2 —
 * kiểu trả về là các DTO này); spec này giữ vế RUNTIME: enum, nullable, và bất biến «không danh tính
 * cử tri».
 */
import { describe, expect, it } from "vitest";
import { feedPollPageSchema } from "./social-api-polls";
import { feedPollResultsSchema } from "./social-feed-blocks";
import {
  feedIdeaItemSchema,
  feedIdeaPageSchema,
  feedIdeaReviewResultSchema,
} from "./social-api-ideas";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const ISO = "2026-09-29T01:15:53.496Z";

const RESULTS = {
  pollId: UUID_A,
  postId: UUID_B,
  question: "Ăn trưa ở đâu?",
  status: "open",
  multipleChoice: false,
  isAnonymous: true,
  closesAt: null,
  totalVoters: 3,
  myVote: [UUID_C],
  options: [{ id: UUID_C, label: "Cơm", voteCount: 3 }],
};

describe("feedPollResultsSchema (041..044)", () => {
  it("parse đúng hình dạng `readResultsTx`", () => {
    expect(feedPollResultsSchema.parse(RESULTS)).toEqual(RESULTS);
  });

  it("`status` ngoài enum ⇒ từ chối", () => {
    expect(feedPollResultsSchema.safeParse({ ...RESULTS, status: "expired" }).success).toBe(false);
  });

  it("🔴 KHÔNG chở danh tính cử tri: khoá lạ bị bóc, không lọt vào DTO FE", () => {
    const parsed = feedPollResultsSchema.parse({ ...RESULTS, voters: [UUID_A] });
    expect(parsed).not.toHaveProperty("voters");
  });
});

describe("feedPollPageSchema (040)", () => {
  it("envelope OFFSET + dòng KHÔNG có multipleChoice / số phiếu", () => {
    const page = {
      data: [
        {
          pollId: UUID_A,
          postId: UUID_B,
          question: "Q",
          status: "closed",
          isAnonymous: false,
          closesAt: ISO,
          closedAt: ISO,
          createdAt: ISO,
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
    };
    expect(feedPollPageSchema.parse(page)).toEqual(page);
  });
});

describe("feedIdeaItemSchema / feedIdeaPageSchema (045)", () => {
  const ITEM = {
    ideaId: UUID_A,
    postId: UUID_B,
    status: "under_review",
    body: null,
    reviewNote: null,
    reviewer: null,
    reviewedAt: null,
    createdAt: ISO,
  };

  it("`body` · `reviewNote` · `reviewer` · `reviewedAt` nullable (reviewNote đã MASK ở server)", () => {
    expect(feedIdeaItemSchema.parse(ITEM)).toEqual(ITEM);
  });

  it("`status` ngoài 4 giá trị của `chk_feed_ideas_status` ⇒ từ chối", () => {
    expect(feedIdeaItemSchema.safeParse({ ...ITEM, status: "approved" }).success).toBe(false);
  });

  it("envelope OFFSET", () => {
    expect(feedIdeaPageSchema.parse({ data: [ITEM], page: 1, limit: 20, total: 1 }).total).toBe(1);
  });
});

describe("feedIdeaReviewResultSchema (046)", () => {
  it("parse `{postId, ideaId, status, reviewedAt}`", () => {
    const r = { postId: UUID_B, ideaId: UUID_A, status: "accepted", reviewedAt: ISO };
    expect(feedIdeaReviewResultSchema.parse(r)).toEqual(r);
  });

  it("`submitted` KHÔNG bao giờ là đích của một lượt xét duyệt ⇒ từ chối", () => {
    const r = { postId: UUID_B, ideaId: UUID_A, status: "submitted", reviewedAt: ISO };
    expect(feedIdeaReviewResultSchema.safeParse(r).success).toBe(false);
  });
});
