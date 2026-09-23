/**
 * S16-SOCIAL-FE-1 — `useFeedActions`: cảm xúc · lưu · kiểm duyệt · xoá, dùng chung cho 5 màn.
 *
 * Hai luật ca này giữ:
 *  1. **Ánh xạ payload kiểm duyệt phải ĐÚNG.** `moderate({hidden:true})` → `{status:"hidden"}`;
 *     `{hidden:false}` → `{status:"published"}`. Gửi thẳng `hidden` là 400 `.strict()`, còn nhầm
 *     chiều là ẩn bài khi người dùng bấm "bỏ ẩn" — không lỗi, chỉ sai.
 *  2. **Chỉ gửi trường người dùng THỰC SỰ đổi.** Route 006 gác per-field ở tầng 2 (`pinned` đòi
 *     `manage:feed-news`), nên kèm thừa một khoá là biến một thao tác hợp lệ thành **403**.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { buildPostMenuActions, useFeedActions } from "./use-feed-actions";

const putPostReaction = vi.fn();
const deletePostReaction = vi.fn();
const savePost = vi.fn();
const unsavePost = vi.fn();
const moderatePost = vi.fn();
const deletePost = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: {
      ...actual.socialApi,
      putPostReaction: (...a: unknown[]) => putPostReaction(...a),
      deletePostReaction: (...a: unknown[]) => deletePostReaction(...a),
      savePost: (...a: unknown[]) => savePost(...a),
      unsavePost: (...a: unknown[]) => unsavePost(...a),
      moderatePost: (...a: unknown[]) => moderatePost(...a),
      deletePost: (...a: unknown[]) => deletePost(...a),
    },
  };
});

const POST_ID = "11111111-1111-4111-8111-111111111111";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  for (const m of [
    putPostReaction,
    deletePostReaction,
    savePost,
    unsavePost,
    moderatePost,
    deletePost,
  ]) {
    m.mockReset();
  }
});

afterEach(() => vi.clearAllMocks());

describe("cảm xúc — 011 / 012", () => {
  it("emoji ⇒ `PUT` (011); `null` ⇒ `DELETE` (012)", async () => {
    putPostReaction.mockResolvedValue({
      targetType: "post",
      targetId: POST_ID,
      likeCount: 1,
      reactions: [{ emoji: "like", count: 1, mine: true }],
    });
    deletePostReaction.mockResolvedValue({
      targetType: "post",
      targetId: POST_ID,
      likeCount: 0,
      reactions: [],
    });

    const { result } = renderHook(() => useFeedActions(), { wrapper });

    act(() => result.current.setReaction(POST_ID, "like"));
    await waitFor(() => expect(putPostReaction).toHaveBeenCalledWith(POST_ID, "like"));

    act(() => result.current.setReaction(POST_ID, null));
    await waitFor(() => expect(deletePostReaction).toHaveBeenCalledWith(POST_ID));
  });

  it("dùng NGUYÊN mảng server trả về làm nguồn sự thật (không tự cộng trừ)", async () => {
    const reactions = [{ emoji: "love", count: 7, mine: true }];
    putPostReaction.mockResolvedValue({
      targetType: "post",
      targetId: POST_ID,
      likeCount: 7,
      reactions,
    });

    const { result } = renderHook(() => useFeedActions(), { wrapper });
    act(() => result.current.setReaction(POST_ID, "love"));

    await waitFor(() => expect(result.current.reactionSummaries[POST_ID]).toEqual(reactions));
  });
});

describe("lưu — 008 / 009", () => {
  it("chưa lưu ⇒ `savePost`; đang lưu ⇒ `unsavePost`", async () => {
    savePost.mockResolvedValue({ postId: POST_ID, savedByMe: true });
    unsavePost.mockResolvedValue({ postId: POST_ID, savedByMe: false });

    const { result } = renderHook(() => useFeedActions(), { wrapper });

    act(() => result.current.toggleSave(POST_ID, false));
    await waitFor(() => expect(savePost).toHaveBeenCalledWith(POST_ID));

    act(() => result.current.toggleSave(POST_ID, true));
    await waitFor(() => expect(unsavePost).toHaveBeenCalledWith(POST_ID));
  });
});

describe("kiểm duyệt — 006 (gác PER-FIELD ở tầng 2)", () => {
  beforeEach(() => moderatePost.mockResolvedValue({ id: POST_ID }));

  it("`{hidden:true}` ⇒ `{status:'hidden'}`; `{hidden:false}` ⇒ `{status:'published'}`", async () => {
    const { result } = renderHook(() => useFeedActions(), { wrapper });

    act(() => result.current.moderate(POST_ID, { hidden: true }));
    await waitFor(() => expect(moderatePost).toHaveBeenCalledWith(POST_ID, { status: "hidden" }));

    moderatePost.mockClear();
    act(() => result.current.moderate(POST_ID, { hidden: false }));
    await waitFor(() =>
      expect(moderatePost).toHaveBeenCalledWith(POST_ID, { status: "published" }),
    );
  });

  it("🔴 CHỈ gửi trường được đổi — kèm thừa `pinned` là 403 cho người không có `manage:feed-news`", async () => {
    const { result } = renderHook(() => useFeedActions(), { wrapper });

    act(() => result.current.moderate(POST_ID, { locked: true }));
    await waitFor(() => expect(moderatePost).toHaveBeenCalled());

    const body = moderatePost.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["commentsLocked"]);
    expect(body).not.toHaveProperty("pinned");
    expect(body).not.toHaveProperty("status");
  });

  it("`{pinned:true}` gửi đúng một khoá `pinned`", async () => {
    const { result } = renderHook(() => useFeedActions(), { wrapper });
    act(() => result.current.moderate(POST_ID, { pinned: true }));
    await waitFor(() => expect(moderatePost).toHaveBeenCalledWith(POST_ID, { pinned: true }));
  });
});

describe("xoá — 005", () => {
  it("gọi `deletePost` với đúng id", async () => {
    deletePost.mockResolvedValue({ deleted: true });
    const { result } = renderHook(() => useFeedActions(), { wrapper });
    act(() => result.current.remove(POST_ID));
    await waitFor(() => expect(deletePost).toHaveBeenCalledWith(POST_ID));
  });
});

describe("cờ «đang gửi» theo TỪNG BÀI", () => {
  it("chỉ bài đang gửi mới pending — không khoá cả danh sách", async () => {
    let resolveSave: ((v: unknown) => void) | undefined;
    savePost.mockImplementation(
      () =>
        new Promise((res) => {
          resolveSave = res;
        }),
    );

    const { result } = renderHook(() => useFeedActions(), { wrapper });
    act(() => result.current.toggleSave(POST_ID, false));

    await waitFor(() => expect(result.current.pendingSavePostId).toBe(POST_ID));
    // Bài khác KHÔNG bị coi là đang gửi.
    expect(result.current.pendingReactionPostId).toBeNull();

    act(() => resolveSave?.({ postId: POST_ID, savedByMe: true }));
    await waitFor(() => expect(result.current.pendingSavePostId).toBeNull());
  });
});

describe("buildPostMenuActions — sáu hành động dùng chung của menu ⋯", () => {
  const post = { id: POST_ID, status: undefined, commentsLocked: false, pinned: false } as const;
  const actions = { moderate: vi.fn(), remove: vi.fn() };

  beforeEach(() => {
    actions.moderate.mockReset();
    actions.remove.mockReset();
  });

  it("`onCopyLink` không ném khi `navigator.clipboard` VẮNG", () => {
    /**
     * `navigator.clipboard` không tồn tại trên http không phải localhost (và trong jsdom). Sao chép
     * link hỏng là chuyện nhỏ; nó ném giữa handler và làm chết cả menu mới là chuyện lớn.
     */
    const m = buildPostMenuActions(post, { actions });
    expect(() => m.onCopyLink()).not.toThrow();
  });

  it("`onEdit` gọi `openDetail`; KHÔNG có `openDetail` (đang ở màn chi tiết) ⇒ không ném", () => {
    const openDetail = vi.fn();
    buildPostMenuActions(post, { actions, openDetail }).onEdit();
    expect(openDetail).toHaveBeenCalledWith(POST_ID);

    expect(() => buildPostMenuActions(post, { actions }).onEdit()).not.toThrow();
  });

  it("`onDelete` xoá rồi gọi `afterDelete` (rời trang ở màn chi tiết)", () => {
    const afterDelete = vi.fn();
    buildPostMenuActions(post, { actions, afterDelete }).onDelete();
    expect(actions.remove).toHaveBeenCalledWith(POST_ID);
    expect(afterDelete).toHaveBeenCalledTimes(1);
  });

  it("ba hành động kiểm duyệt ĐẢO đúng chiều trạng thái hiện tại", () => {
    const m = buildPostMenuActions(
      { id: POST_ID, status: "hidden", commentsLocked: true, pinned: true },
      { actions },
    );
    m.onToggleHidden();
    expect(actions.moderate).toHaveBeenLastCalledWith(POST_ID, { hidden: false });
    m.onToggleComments();
    expect(actions.moderate).toHaveBeenLastCalledWith(POST_ID, { locked: false });
    m.onTogglePinned();
    expect(actions.moderate).toHaveBeenLastCalledWith(POST_ID, { pinned: false });
  });

  it("`status` VẮNG (người đọc thường) ⇒ coi như đang hiển thị, không ném", () => {
    // `feedPostSchema.status` là OPTIONAL — chỉ có mặt với tác giả / `manage:feed-post`.
    buildPostMenuActions(post, { actions }).onToggleHidden();
    expect(actions.moderate).toHaveBeenCalledWith(POST_ID, { hidden: true });
  });
});
