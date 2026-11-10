/**
 * S16-SOCIAL-FESTALELISTS-1 + S16-SOCIAL-FEMODINVAL-1 — «mọi bề mặt đang vẽ bài» làm mới từ MỌI đường ghi.
 *
 * Đo bằng `getQueryState(key).isInvalidated` trên cache THẬT (KHÔNG spy `invalidateQueries`): spy chỉ
 * chứng minh có gọi, không chứng minh khoá gieo vào có bị khớp.
 */
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { ApiError, socialKeys } from "@mediaos/web-core";
import type { FeedIdeaItemDto } from "@mediaos/contracts";
import { makeTestQueryClient, makePost, renderWithProviders } from "../social-test-doubles";
import { IdeaReviewDialog } from "../../ideas/IdeaReviewDialog";
import { invalidatePostSurfaces } from "../../moderation/lib/moderation-invalidation";
import { useFeedActions } from "./use-feed-actions";

const putPostReaction = vi.fn();
const savePost = vi.fn();
const deletePost = vi.fn();
const moderatePost = vi.fn();
const reviewIdea = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: {
      ...actual.socialApi,
      putPostReaction: (...a: unknown[]) => putPostReaction(...a),
      savePost: (...a: unknown[]) => savePost(...a),
      deletePost: (...a: unknown[]) => deletePost(...a),
      moderatePost: (...a: unknown[]) => moderatePost(...a),
      reviewIdea: (...a: unknown[]) => reviewIdea(...a),
    },
  };
});

const POST_ID = "11111111-1111-4111-8111-111111111111";
const IDEA_ID = "22222222-2222-4222-8222-222222222222";

const SEARCH_KEY = socialKeys.search({ q: "xin chao" });
const PROFILE_KEY = socialKeys.profilePosts("emp-1", { limit: 20 });
const FEED_KEY = socialKeys.feed.list({});
const HIDDEN_KEY = socialKeys.moderation.hiddenPosts();
const REPORTS_KEY = socialKeys.moderation.reports.list({ page: 1 });
const UNRELATED = [socialKeys.kudos.badges(), socialKeys.birthdays({ range: "week" })];

function seeded(): QueryClient {
  const client = makeTestQueryClient();
  [SEARCH_KEY, PROFILE_KEY, FEED_KEY, HIDDEN_KEY, REPORTS_KEY, ...UNRELATED].forEach((key) =>
    client.setQueryData(key, { seeded: true }),
  );
  return client;
}
const isStale = (client: QueryClient, key: QueryKey): boolean =>
  client.getQueryState(key)?.isInvalidated === true;

function expectUnrelatedUntouched(client: QueryClient): void {
  UNRELATED.forEach((key) => expect(isStale(client, key)).toBe(false));
}

function hookOn(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useFeedActions(), { wrapper });
}

beforeEach(() => {
  putPostReaction.mockResolvedValue({ targetId: POST_ID, reactions: [] });
  savePost.mockResolvedValue({ postId: POST_ID });
  deletePost.mockResolvedValue({ deleted: true });
  moderatePost.mockResolvedValue(makePost({ id: POST_ID }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("menu ⋯ của thẻ bài — thích · lưu · xoá · kiểm duyệt", () => {
  const surfaceCases: Array<[string, (a: ReturnType<typeof hookOn>["result"]) => void]> = [
    ["thích", (r) => r.current.setReaction(POST_ID, "like")],
    ["lưu", (r) => r.current.toggleSave(POST_ID, false)],
    ["xoá", (r) => r.current.remove(POST_ID)],
    ["kiểm duyệt", (r) => r.current.moderate(POST_ID, { hidden: true })],
  ];

  it.each(surfaceCases)("sau %s: search + profilePosts + feed bị đánh dấu cũ", async (_n, run) => {
    const client = seeded();
    const { result } = hookOn(client);
    act(() => run(result));
    await waitFor(() => expect(isStale(client, FEED_KEY)).toBe(true));
    expect(isStale(client, SEARCH_KEY)).toBe(true);
    expect(isStale(client, PROFILE_KEY)).toBe(true);
    expectUnrelatedUntouched(client);
  });

  it.each([surfaceCases[2], surfaceCases[3]] as typeof surfaceCases)(
    "sau %s: hàng đợi báo cáo + «Bài đang ẩn» cũng bị đánh dấu cũ",
    async (_n, run) => {
      const client = seeded();
      const { result } = hookOn(client);
      act(() => run(result));
      await waitFor(() => expect(isStale(client, FEED_KEY)).toBe(true));
      expect(isStale(client, HIDDEN_KEY)).toBe(true);
      expect(isStale(client, REPORTS_KEY)).toBe(true);
    },
  );

  it("đối chứng: thích / lưu KHÔNG đụng hàng đợi kiểm duyệt", async () => {
    const client = seeded();
    const { result } = hookOn(client);
    act(() => result.current.setReaction(POST_ID, "like"));
    await waitFor(() => expect(isStale(client, FEED_KEY)).toBe(true));
    expect(isStale(client, HIDDEN_KEY)).toBe(false);
    expect(isStale(client, REPORTS_KEY)).toBe(false);
  });
});

describe("màn Kiểm duyệt + huy hiệu — invalidatePostSurfaces", () => {
  it("phủ search · profilePosts · feed · bài đang ẩn; khoá không liên quan KHÔNG bị chạm", () => {
    const client = seeded();
    invalidatePostSurfaces(client);
    [SEARCH_KEY, PROFILE_KEY, FEED_KEY, HIDDEN_KEY].forEach((k) =>
      expect(isStale(client, k)).toBe(true),
    );
    expectUnrelatedUntouched(client);
  });
});

const idea: FeedIdeaItemDto = {
  ideaId: IDEA_ID,
  postId: POST_ID,
  status: "submitted",
  body: "Lắp thêm máy lọc nước",
  reviewNote: null,
  reviewer: null,
  reviewedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

describe("IdeaReviewDialog — xét duyệt sáng kiến", () => {
  it("thành công: search + profilePosts + feed bị đánh dấu cũ, khoá không liên quan thì không", async () => {
    reviewIdea.mockResolvedValue({ postId: POST_ID, ideaId: IDEA_ID, status: "under_review" });
    const client = seeded();
    renderWithProviders(<IdeaReviewDialog idea={idea} onClose={() => undefined} />, client);
    fireEvent.click(screen.getByTestId("idea-review-submit"));
    await waitFor(() => expect(isStale(client, FEED_KEY)).toBe(true));
    expect(isStale(client, SEARCH_KEY)).toBe(true);
    expect(isStale(client, PROFILE_KEY)).toBe(true);
    expectUnrelatedUntouched(client);
  });

  it("409 (người khác duyệt trước): vẫn làm mới search + profilePosts", async () => {
    reviewIdea.mockRejectedValue(new ApiError(409, "CONFLICT", "SOCIAL-ERR-019"));
    const client = seeded();
    renderWithProviders(<IdeaReviewDialog idea={idea} onClose={() => undefined} />, client);
    fireEvent.click(screen.getByTestId("idea-review-submit"));
    await waitFor(() => expect(isStale(client, FEED_KEY)).toBe(true));
    expect(isStale(client, SEARCH_KEY)).toBe(true);
    expect(isStale(client, PROFILE_KEY)).toBe(true);
  });
});
