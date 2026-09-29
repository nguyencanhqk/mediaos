/**
 * social-api.spec.ts — ranh giới hợp đồng của các hàm `socialApi` thêm ở S16-SOCIAL-FE-2 (040..046).
 *
 * Khuôn `chat-oversight-api.spec.ts`: mock `apiFetch` ở ranh giới `./api-client` để đọc path/method/
 * body, RỒI chạy chính schema đã truyền vào trên payload giống thật (chỉ so URL thì schema sai vẫn
 * xanh).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { socialApi } from "./social-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

interface FetchInit {
  method?: string;
  body?: string;
}

function lastCall(): [
  string,
  z.ZodType<unknown>,
  FetchInit | undefined,
  { idempotencyKey?: string } | undefined,
] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

const POST_ID = "11111111-1111-4111-8111-111111111111";
const POLL_ID = "22222222-2222-4222-8222-222222222222";
const OPT_A = "33333333-3333-4333-8333-333333333333";
const OPT_B = "44444444-4444-4444-8444-444444444444";
const ISO = "2026-09-29T01:15:53.496Z";

const RESULTS = {
  pollId: POLL_ID,
  postId: POST_ID,
  question: "Q",
  status: "open",
  multipleChoice: true,
  isAnonymous: false,
  closesAt: null,
  totalVoters: 1,
  myVote: [OPT_A, OPT_B],
  options: [
    { id: OPT_A, label: "A", voteCount: 1 },
    { id: OPT_B, label: "B", voteCount: 1 },
  ],
};

beforeEach(() => {
  vi.mocked(apiClient.apiFetch).mockReset();
  vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
});

describe("bình chọn 040..044", () => {
  it("listPolls ⇒ GET /social/polls?status=open&limit=5, schema nhận envelope OFFSET", async () => {
    await socialApi.listPolls({ status: "open", limit: 5 });
    const [url, schema, init] = lastCall();
    expect(url).toBe("/social/polls?status=open&limit=5");
    expect(init?.method ?? "GET").toBe("GET");
    expect(
      schema.safeParse({
        data: [
          {
            pollId: POLL_ID,
            postId: POST_ID,
            question: "Q",
            status: "open",
            isAnonymous: false,
            closesAt: null,
            closedAt: null,
            createdAt: ISO,
          },
        ],
        page: 1,
        limit: 5,
        total: 1,
      }).success,
    ).toBe(true);
  });

  it("getPollResults ⇒ GET …/poll/results", async () => {
    await socialApi.getPollResults(POST_ID);
    const [url, schema] = lastCall();
    expect(url).toBe(`/social/posts/${POST_ID}/poll/results`);
    expect(schema.safeParse(RESULTS).success).toBe(true);
  });

  it("🔴 votePoll ⇒ PUT với CẢ TẬP optionIds (không phải ô vừa bấm)", async () => {
    await socialApi.votePoll(POST_ID, [OPT_A, OPT_B]);
    const [url, schema, init] = lastCall();
    expect(url).toBe(`/social/posts/${POST_ID}/poll/vote`);
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ optionIds: [OPT_A, OPT_B] });
    expect(schema.safeParse(RESULTS).success).toBe(true);
  });

  it("withdrawPollVote ⇒ DELETE …/poll/vote, KHÔNG body", async () => {
    await socialApi.withdrawPollVote(POST_ID);
    const [url, , init] = lastCall();
    expect(url).toBe(`/social/posts/${POST_ID}/poll/vote`);
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
  });

  it("closePoll ⇒ POST …/poll/close KÈM Idempotency-Key (044 có @Idempotent)", async () => {
    await socialApi.closePoll(POST_ID);
    const [url, schema, init, opts] = lastCall();
    expect(url).toBe(`/social/posts/${POST_ID}/poll/close`);
    expect(init?.method).toBe("POST");
    expect(opts?.idempotencyKey).toEqual(expect.any(String));
    expect(schema.safeParse({ ...RESULTS, status: "closed" }).success).toBe(true);
  });

  it("closePoll: cùng bài ⇒ cùng khoá; khác bài ⇒ khác khoá", async () => {
    await socialApi.closePoll(POST_ID);
    const k1 = lastCall()[3]?.idempotencyKey;
    await socialApi.closePoll(POST_ID);
    const k2 = lastCall()[3]?.idempotencyKey;
    await socialApi.closePoll(POLL_ID);
    const k3 = lastCall()[3]?.idempotencyKey;
    expect(k1).toBe(k2);
    expect(k3).not.toBe(k1);
  });
});

describe("sáng kiến 045..046", () => {
  it("listIdeas ⇒ GET /social/ideas?status=…", async () => {
    await socialApi.listIdeas({ status: "submitted", page: 2 });
    const [url, schema] = lastCall();
    expect(url).toBe("/social/ideas?status=submitted&page=2");
    expect(
      schema.safeParse({
        data: [
          {
            ideaId: POLL_ID,
            postId: POST_ID,
            status: "submitted",
            body: "ý tưởng",
            reviewNote: null,
            reviewer: null,
            reviewedAt: null,
            createdAt: ISO,
          },
        ],
        page: 2,
        limit: 20,
        total: 21,
      }).success,
    ).toBe(true);
  });

  it("reviewIdea ⇒ PATCH …/idea/review với đúng body", async () => {
    await socialApi.reviewIdea(POST_ID, { status: "rejected", reviewNote: "trùng" });
    const [url, schema, init] = lastCall();
    expect(url).toBe(`/social/posts/${POST_ID}/idea/review`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ status: "rejected", reviewNote: "trùng" });
    expect(
      schema.safeParse({ postId: POST_ID, ideaId: POLL_ID, status: "rejected", reviewedAt: ISO })
        .success,
    ).toBe(true);
  });
});
