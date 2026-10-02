/**
 * S16-SOCIAL-FE-1 — `useFeedActions`: cảm xúc · lưu · kiểm duyệt · xoá, dùng chung cho 5 màn.
 *
 * Hai luật ca này giữ:
 *  1. **Body kiểm duyệt phải QUA ĐƯỢC hợp đồng `006`** (`moderateFeedPostSchema` — `.strict()`,
 *     `{hidden?, pinned?, commentsLocked?}`, API-19 §5.1c). Kiểm bằng CHÍNH schema đó, không bằng
 *     một object kỳ vọng tự chép: bản đầu ghim `{status:"hidden"}` — khoá mà schema KHÔNG có — và ca
 *     xanh suốt trong khi server trả 400 cho MỌI lượt ẩn/bỏ ẩn (đo thật trên lane DB 30/09/2026,
 *     `S16-SOCIAL-FEMODPAYLOAD-1`: `VALIDATION-ERR-001` · `Unrecognized key(s) in object: 'status'`).
 *  2. **Chỉ gửi trường người dùng THỰC SỰ đổi.** Route 006 gác per-field ở tầng 2 (`pinned` đòi
 *     `manage:feed-news`), nên kèm thừa một khoá là biến một thao tác hợp lệ thành **403**.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { moderateFeedPostSchema, type FeedPostDto } from "@mediaos/contracts";
import { buildPostMenuActions, useFeedActions } from "./use-feed-actions";
import { POST_ERR } from "../social-test-doubles";

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

  type MenuPost = Pick<FeedPostDto, "id" | "status" | "commentsLocked" | "pinned">;
  const basePost: MenuPost = {
    id: POST_ID,
    status: "published",
    commentsLocked: false,
    pinned: false,
  };

  /**
   * Đi TRỌN đường người kiểm duyệt bấm: menu ⋯ (`buildPostMenuActions`) → hook THẬT → `moderatePost`.
   * Lỗi `FEMODPAYLOAD` sống ở khâu GIỮA (ánh xạ trong hook); ca chỉ gọi `moderate()` trực tiếp hoặc chỉ
   * thử `buildPostMenuActions` với mock sẽ bỏ lọt đúng khâu đó.
   */
  async function bodySentBy(
    post: MenuPost,
    pick: (m: ReturnType<typeof buildPostMenuActions>) => () => void,
  ): Promise<unknown> {
    const { result } = renderHook(() => useFeedActions(), { wrapper });
    act(() => pick(buildPostMenuActions(post, { actions: result.current }))());
    await waitFor(() => expect(moderatePost).toHaveBeenCalledTimes(1));
    const [postId, body] = moderatePost.mock.calls[0] as [string, unknown];
    expect(postId).toBe(POST_ID);
    return body;
  }

  it.each([
    {
      name: "ẩn bài đang hiển thị",
      post: basePost,
      pick: (m: ReturnType<typeof buildPostMenuActions>) => m.onToggleHidden,
      body: { hidden: true },
    },
    {
      name: "ẩn bài khi `status` VẮNG (người đọc thường — trường optional)",
      post: { ...basePost, status: undefined },
      pick: (m: ReturnType<typeof buildPostMenuActions>) => m.onToggleHidden,
      body: { hidden: true },
    },
    {
      name: "BỎ ẩn bài đang ẩn (nhầm chiều = ẩn tiếp, không lỗi — chỉ sai)",
      post: { ...basePost, status: "hidden" as const },
      pick: (m: ReturnType<typeof buildPostMenuActions>) => m.onToggleHidden,
      body: { hidden: false },
    },
    {
      name: "khoá bình luận",
      post: basePost,
      pick: (m: ReturnType<typeof buildPostMenuActions>) => m.onToggleComments,
      body: { commentsLocked: true },
    },
    {
      name: "mở khoá bình luận",
      post: { ...basePost, commentsLocked: true },
      pick: (m: ReturnType<typeof buildPostMenuActions>) => m.onToggleComments,
      body: { commentsLocked: false },
    },
    {
      name: "ghim",
      post: basePost,
      pick: (m: ReturnType<typeof buildPostMenuActions>) => m.onTogglePinned,
      body: { pinned: true },
    },
    {
      name: "bỏ ghim",
      post: { ...basePost, pinned: true },
      pick: (m: ReturnType<typeof buildPostMenuActions>) => m.onTogglePinned,
      body: { pinned: false },
    },
  ])("menu «$name» ⇒ body QUA `moderateFeedPostSchema` và đúng giá trị", async (c) => {
    const body = await bodySentBy(c.post, c.pick);

    // Vế hợp đồng: `.strict()` ⇒ một khoá lạ (như `status` của bản đầu) là `success:false`.
    const parsed = moderateFeedPostSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    // Vế giá trị: đúng MỘT khoá, đúng chiều — chỉ qua schema thì `{hidden:false}` khi muốn ẩn vẫn xanh.
    expect(body).toStrictEqual(c.body);
  });

  it("đối chứng — schema THẬT SỰ từ chối body của bản đầu (ca trên không xanh-rỗng)", () => {
    expect(moderateFeedPostSchema.safeParse({ status: "hidden" }).success).toBe(false);
    expect(moderateFeedPostSchema.safeParse({ status: "published" }).success).toBe(false);
  });

  it("🔴 CHỈ gửi trường được đổi — kèm thừa `pinned` là 403 cho người không có `manage:feed-news`", async () => {
    const { result } = renderHook(() => useFeedActions(), { wrapper });

    act(() => result.current.moderate(POST_ID, { commentsLocked: true }));
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

  /**
   * 🔴 `afterDelete` phải được TRAO cho `remove`, KHÔNG được gọi cạnh nó.
   *
   * Bản đầu gọi `deps.actions.remove(post.id)` rồi `deps.afterDelete?.()` ngay dòng sau. `remove` là
   * `mutate()` bất đồng bộ, nên ở màn chi tiết (`afterDelete = () => navigate({to:"/feed"}))` người
   * dùng bị đá về bảng tin **trước khi request rời máy**. Xoá thất bại 403/409 ⇒ họ tin là đã xoá
   * xong, trong khi bài vẫn còn nguyên. FULL gate 23/09/2026 bắt được.
   */
  it("`onDelete` TRAO `afterDelete` cho `remove`, KHÔNG gọi nó đồng bộ", () => {
    const afterDelete = vi.fn();
    buildPostMenuActions(post, { actions, afterDelete }).onDelete();

    expect(actions.remove).toHaveBeenCalledWith(POST_ID, afterDelete);
    // Vế ĐẮT NHẤT: chưa có xác nhận của server thì chưa được rời trang.
    expect(afterDelete).not.toHaveBeenCalled();
  });

  it("không có `afterDelete` (ở lại danh sách) ⇒ `remove` nhận undefined, không ném", () => {
    expect(() => buildPostMenuActions(post, { actions }).onDelete()).not.toThrow();
    expect(actions.remove).toHaveBeenCalledWith(POST_ID, undefined);
  });

  it("ba hành động kiểm duyệt ĐẢO đúng chiều trạng thái hiện tại", () => {
    const m = buildPostMenuActions(
      { id: POST_ID, status: "hidden", commentsLocked: true, pinned: true },
      { actions },
    );
    m.onToggleHidden();
    expect(actions.moderate).toHaveBeenLastCalledWith(POST_ID, { hidden: false });
    m.onToggleComments();
    expect(actions.moderate).toHaveBeenLastCalledWith(POST_ID, { commentsLocked: false });
    m.onTogglePinned();
    expect(actions.moderate).toHaveBeenLastCalledWith(POST_ID, { pinned: false });
  });

  it("`status` VẮNG (người đọc thường) ⇒ coi như đang hiển thị, không ném", () => {
    // `feedPostSchema.status` là OPTIONAL — chỉ có mặt với tác giả / `manage:feed-post`.
    buildPostMenuActions(post, { actions }).onToggleHidden();
    expect(actions.moderate).toHaveBeenCalledWith(POST_ID, { hidden: true });
  });
});

describe("S16-SOCIAL-FE-2 — plan §8 H5: xoá/ẩn bài làm mới danh sách bình chọn + sáng kiến", () => {
  it("xoá thành công ⇒ invalidate `polls.allOf()` VÀ `ideas.allOf()` (không để dòng trỏ vào bài 404)", async () => {
    deletePost.mockResolvedValue({ deleted: true });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useFeedActions(), { wrapper: localWrapper });
    act(() => result.current.remove(POST_ID));

    await waitFor(() => expect(deletePost).toHaveBeenCalledWith(POST_ID));
    const { socialKeys } = await import("@mediaos/web-core");
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(socialKeys.polls.allOf()));
      expect(keys).toContain(JSON.stringify(socialKeys.ideas.allOf()));
    });
  });

  it("S16-SOCIAL-FE-2C: xoá bài ⇒ khoá THẬT của widget/màn vinh danh bị invalidate", async () => {
    deletePost.mockResolvedValue({ deleted: true });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { socialKeys } = await import("@mediaos/web-core");
    const widgetKey = socialKeys.kudos.list({ month: "2026-09", limit: 5 });
    client.setQueryData(widgetKey, { data: [], page: 1, limit: 5, total: 0 });
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useFeedActions(), { wrapper: localWrapper });
    act(() => result.current.remove(POST_ID));

    await waitFor(() => expect(client.getQueryState(widgetKey)?.isInvalidated).toBe(true));
  });
});

/**
 * S16-SOCIAL-FEMODERRMSG-1 — lỗi mang LÝ DO đọc từ `error.code`.
 *
 * Đo trên `005`/`006` (+ `009`/`010`/`011`/`012` cùng cổng đọc `assertPostVisible`): lỗi KHÔNG-403 duy nhất
 * người dùng chạm được từ menu là **404 `SOCIAL-ERR-001`** — bài đã bị người khác xoá/ẩn giữa chừng. Câu
 * chung «vui lòng thử lại» ở đây là lời khuyên SAI: thử lại bao nhiêu lần cũng 404.
 */
describe("S16-SOCIAL-FEMODERRMSG-1 — lỗi trên bài mang LÝ DO từ `error.code`", () => {
  type Hook = ReturnType<typeof useFeedActions>;

  function setup() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useFeedActions(), { wrapper: localWrapper });
    return { result, spy };
  }

  const cases = [
    {
      name: "ẩn bài (006)",
      mock: moderatePost,
      run: (h: Hook) => h.moderate(POST_ID, { hidden: true }),
      kind: "moderate",
    },
    {
      name: "khoá bình luận (006)",
      mock: moderatePost,
      run: (h: Hook) => h.moderate(POST_ID, { commentsLocked: true }),
      kind: "moderate",
    },
    {
      name: "xoá bài (005)",
      mock: deletePost,
      run: (h: Hook) => h.remove(POST_ID),
      kind: "delete",
    },
    {
      name: "lưu bài (009)",
      mock: savePost,
      run: (h: Hook) => h.toggleSave(POST_ID, false),
      kind: "save",
    },
    {
      name: "thả cảm xúc (011)",
      mock: putPostReaction,
      run: (h: Hook) => h.setReaction(POST_ID, "like"),
      kind: "reaction",
    },
  ] as const;

  it.each(cases)("$name: 404 `SOCIAL-ERR-001` ⇒ reason «postGone»", async (c) => {
    c.mock.mockRejectedValue(POST_ERR.gone());
    const { result } = setup();

    act(() => c.run(result.current));

    await waitFor(() => expect(result.current.actionError).not.toBeNull());
    expect(result.current.actionError).toEqual({
      kind: c.kind,
      forbidden: false,
      reason: "postGone",
    });
  });

  it("API CŨ (mã chung `RESOURCE-ERR-NOT-FOUND`, mã SOCIAL ở tiền tố `message`) ⇒ VẪN «postGone»", async () => {
    moderatePost.mockRejectedValue(POST_ERR.goneLegacy());
    const { result } = setup();

    act(() => result.current.moderate(POST_ID, { hidden: true }));

    await waitFor(() => expect(result.current.actionError).not.toBeNull());
    expect(result.current.actionError?.reason).toBe("postGone");
  });

  it.each([
    { name: "500 (thử lại là ĐÚNG)", err: POST_ERR.server, forbidden: false },
    {
      name: "403 `SOCIAL-ERR-010` (thiếu cặp theo trường)",
      err: POST_ERR.fieldDenied,
      forbidden: true,
    },
  ])("đối chứng — $name ⇒ KHÔNG có reason (câu forbidden/generic như cũ)", async (c) => {
    moderatePost.mockRejectedValue(c.err());
    const { result } = setup();

    act(() => result.current.moderate(POST_ID, { hidden: true }));

    await waitFor(() => expect(result.current.actionError).not.toBeNull());
    expect(result.current.actionError).toEqual({
      kind: "moderate",
      forbidden: c.forbidden,
      reason: null,
    });
  });

  it("«postGone» ⇒ kéo lại danh sách + chi tiết bài ⇒ thẻ cũ tự biến mất", async () => {
    moderatePost.mockRejectedValue(POST_ERR.gone());
    const { result, spy } = setup();

    act(() => result.current.moderate(POST_ID, { hidden: true }));

    await waitFor(() => expect(result.current.actionError?.reason).toBe("postGone"));
    const { socialKeys } = await import("@mediaos/web-core");
    const keys = spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(socialKeys.feed.allOf()));
    expect(keys).toContain(JSON.stringify(socialKeys.posts.detail(POST_ID)));
  });

  it("đối chứng — 500 ⇒ KHÔNG kéo lại gì (dữ liệu chưa chắc đã cũ; người dùng tự thử lại)", async () => {
    moderatePost.mockRejectedValue(POST_ERR.server());
    const { result, spy } = setup();

    act(() => result.current.moderate(POST_ID, { hidden: true }));

    await waitFor(() => expect(result.current.actionError).not.toBeNull());
    expect(spy).not.toHaveBeenCalled();
  });
});
