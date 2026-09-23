/**
 * S16-SOCIAL-FE-1 — ca **C8**: `SOC-SCREEN-002` Chi tiết bài.
 *
 * 🔴 Điều ca này giữ: **bài đã xoá và bài không-được-xem phải hiện GIỐNG HỆT NHAU.** Server trả 404
 * cho cả hai một cách cố ý — phân biệt chúng ở FE là nói cho người gọi biết "bài này có tồn tại, chỉ
 * là bạn không được xem", tức dựng lại đúng oracle dò nội dung mà BE vừa đóng.
 *
 * ⟲ FULL gate 23/09/2026 — bốn lưới mới, tất cả đều là lỗi IM LẶNG hoặc lỗi NÓI SAI:
 *  · **H4** chỉ `ApiError` 404 mới là «không tìm thấy». 500 / lỗi mạng / **ZodError khi HTTP 200**
 *    phải ra khối LỖI + «Thử lại». Ca ZodError là ca đắt nhất: BE đổi một khoá trong `feedPostSchema`
 *    ⇒ HTTP 200 ⇒ `schema.parse` ném ⇒ bản cũ nói với TOÀN CÔNG TY rằng mọi bài đã bị xoá, và không
 *    ai đi tìm lỗi parse vì màn hình trông như một trạng thái bình thường.
 *  · **H5** lỗi/đang tải danh sách bình luận không được rơi vào câu «Chưa có bình luận nào.».
 *  · **H6** cảm xúc trên bình luận là mutation có `onError`, không phải promise trần.
 *  · **H1** tạo/xoá bình luận có `onError` — app KHÔNG có hệ toast, thiếu `onError` là câm tuyệt đối.
 */
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { z } from "zod";
import { ApiError } from "@mediaos/web-core";
import i18n from "@/i18n";

import { PostDetailPage } from "./PostDetailPage";
import {
  makeComment,
  makePost,
  page,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "./social-test-doubles";

/**
 * 🔴 PHẢI ném `ApiError` với `status: 404`, KHÔNG phải `new Error("404")`.
 *
 * `PostDetailPage` khai `retry: (count, err) => !(err instanceof ApiError && err.status === 404) …`
 * — 404 là một CÂU TRẢ LỜI (bài đã xoá / không được xem), không phải lỗi mạng, nên không thử lại.
 * Ném `Error` thường thì vị từ đó cho retry, ca sẽ chờ hết backoff rồi hết giờ và đỏ vì lý do HOÀN
 * TOÀN KHÁC với thứ nó định đo. Đã dính thật một lượt ở WO này.
 */
const notFound = () => new ApiError(404, "SOCIAL-ERR-404", "không tìm thấy");
const serverError = () => new ApiError(500, "SOCIAL-ERR-500", "hỏng");
const forbidden = () => new ApiError(403, "SOCIAL-ERR-403", "cấm");

/**
 * 🔴 Lỗi Zod trên một phản hồi **HTTP 200**.
 *
 * `apiFetch` gọi `schema.parse(...)` sau khi thấy `res.ok` (`packages/web-core/src/lib/api-client.ts`),
 * nên hợp đồng lệch KHÔNG ném `ApiError` — nó ném `ZodError`. Đây chính là lớp lỗi mà bản cũ quy
 * thành «bài đã bị xoá», tức biến một sự cố hợp đồng thành một lời nói dối về dữ liệu.
 */
const zodError = (): Error => {
  const parsed = z.object({ id: z.string() }).safeParse({});
  if (parsed.success) throw new Error("fixture hỏng: safeParse đáng lẽ phải thất bại");
  return parsed.error;
};

const t = i18n.getFixedT("vi", "social");
const tc = i18n.getFixedT("vi", "common");

const getPost = vi.fn();
const listComments = vi.fn();
const createComment = vi.fn();
const deleteComment = vi.fn();
const putCommentReaction = vi.fn();
const deleteCommentReaction = vi.fn();
const savePost = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => vi.fn(),
    useParams: () => ({ postId: "11111111-1111-4111-8111-111111111111" }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: {
      ...actual.socialApi,
      getPost: (...a: unknown[]) => getPost(...a),
      listComments: (...a: unknown[]) => listComments(...a),
      createComment: (...a: unknown[]) => createComment(...a),
      deleteComment: (...a: unknown[]) => deleteComment(...a),
      putCommentReaction: (...a: unknown[]) => putCommentReaction(...a),
      deleteCommentReaction: (...a: unknown[]) => deleteCommentReaction(...a),
      savePost: (...a: unknown[]) => savePost(...a),
    },
  };
});

/**
 * ⚠️ KHÔNG dùng được `renderWithProviders` cho các ca LỖI TẢI BÀI.
 *
 * `PostDetailPage` khai `retry` **ở cấp query**, và tuỳ chọn cấp query ĐÈ `defaultOptions.queries.retry`
 * của client. Nghĩa là với lỗi khác 404, query vẫn thử lại 2 lượt dù client khai `retry:false` — với
 * `retryDelay` mặc định (1s rồi 2s) ca sẽ chạm trần 5s của vitest và đỏ vì HẾT GIỜ, không phải vì
 * assert. `retryDelay` chỉ đặt được ở cấp default (màn không khai nó) ⇒ đặt `0` ở đây là cách duy
 * nhất giữ nguyên hành vi retry thật mà không phải chờ backoff thật.
 */
function renderDetail() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <PostDetailPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Mở picker rồi chọn emoji trên ĐÚNG thanh cảm xúc của phần tử truyền vào. */
function pickReaction(scope: HTMLElement, emojiLabel: string): void {
  const bar = within(scope).getByTestId("feed-reaction-bar");
  fireEvent.click(within(bar).getByRole("button", { name: new RegExp(t("reaction.trigger")) }));
  fireEvent.click(within(bar).getByRole("menuitem", { name: emojiLabel }));
}

const reactionTrigger = (scope: HTMLElement): HTMLElement =>
  within(within(scope).getByTestId("feed-reaction-bar")).getByRole("button", {
    name: new RegExp(t("reaction.trigger")),
  });

beforeEach(() => {
  setCaps({ "view:feed": true, "create:feed-comment": true });
  getPost.mockReset();
  listComments.mockReset();
  createComment.mockReset();
  deleteComment.mockReset();
  putCommentReaction.mockReset();
  deleteCommentReaction.mockReset();
  savePost.mockReset();
  listComments.mockResolvedValue(page([]));
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("C8 — ALLOW: bài + bình luận render", () => {
  it("render bài và danh sách bình luận", async () => {
    getPost.mockResolvedValue(makePost({ commentCount: 1 }));
    listComments.mockResolvedValue(page([makeComment({ body: "một bình luận" })]));
    renderWithProviders(<PostDetailPage />);

    await waitFor(() => expect(screen.getByTestId("post-card")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("comment-list")).toBeInTheDocument());
    expect(screen.getByTestId("comment-list")).toHaveTextContent("một bình luận");
  });

  it("KHÔNG tải bình luận khi bài chưa tải được (tránh request mồ côi)", async () => {
    getPost.mockRejectedValue(notFound());
    renderWithProviders(<PostDetailPage />);

    await waitFor(() => expect(screen.getByTestId("post-detail-not-found")).toBeInTheDocument());
    expect(listComments).not.toHaveBeenCalled();
  });

  it("thẻ bài ở màn chi tiết KHÔNG có link «mở bài viết» trỏ về chính nó", async () => {
    getPost.mockResolvedValue(makePost());
    renderWithProviders(<PostDetailPage />);

    await waitFor(() => expect(screen.getByTestId("post-card")).toBeInTheDocument());
    const card = screen.getByTestId("post-card");
    const selfLinks = Array.from(card.querySelectorAll("a")).filter((a) =>
      a.getAttribute("href")?.includes("/feed/posts/"),
    );
    expect(selfLinks).toEqual([]);
  });

  it("gửi bình luận gọi `015` với body đã trim", async () => {
    getPost.mockResolvedValue(makePost());
    createComment.mockResolvedValue({ ...makeComment(), droppedMentions: [] });
    renderWithProviders(<PostDetailPage />);

    await waitFor(() => expect(screen.getByTestId("comment-composer")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  chào  " } });
    fireEvent.click(screen.getByTestId("comment-submit"));

    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1));
    expect(createComment.mock.calls[0][1]).toEqual({ body: "chào", parentCommentId: null });
  });
});

describe("C8 — DENY: bài đã xoá / không được xem", () => {
  it("404 ⇒ trạng thái RỖNG có nghĩa + lối về bảng tin, KHÔNG phải màn lỗi", async () => {
    getPost.mockRejectedValue(notFound());
    renderWithProviders(<PostDetailPage />);

    await waitFor(() => expect(screen.getByTestId("post-detail-not-found")).toBeInTheDocument());
    expect(screen.getByTestId("post-detail-not-found")).toHaveTextContent(t("detail.notFound"));
    // Người dùng phải đi tiếp được, không mắc kẹt.
    expect(screen.getByText(t("detail.backToFeed"))).toBeInTheDocument();
  });

  it("🔴 KHÔNG rò lý do: chuỗi hiển thị không nói «đã xoá» hay «không có quyền»", async () => {
    /**
     * Server cố ý trả cùng 404 cho hai tình huống. Nếu FE phân biệt chúng thì nó tự dựng lại oracle:
     * gõ thử một id rồi đọc thông báo là biết bài đó có tồn tại hay không.
     */
    getPost.mockRejectedValue(notFound());
    renderWithProviders(<PostDetailPage />);

    await waitFor(() => expect(screen.getByTestId("post-detail-not-found")).toBeInTheDocument());
    const text = screen.getByTestId("post-detail-not-found").textContent ?? "";
    expect(text).not.toMatch(/đã xoá|đã xóa|không có quyền|403/i);
  });

  it("bài KHOÁ bình luận ⇒ ô soạn ẩn, hiện lý do", async () => {
    getPost.mockResolvedValue(makePost({ commentsLocked: true }));
    renderWithProviders(<PostDetailPage />);

    await waitFor(() => expect(screen.getByTestId("comment-locked")).toBeInTheDocument());
    expect(screen.queryByTestId("comment-composer")).toBeNull();
  });
});

/**
 * ┌─ H4 · «KHÔNG TÌM THẤY» LÀ MỘT KẾT LUẬN, KHÔNG PHẢI MỘT CÁI SỌT ─────────────────────────────┐
 * │ Bản cũ: `if (postQuery.isError || !postQuery.data)` → luôn luôn «Bài viết có thể đã bị xoá    │
 * │ hoặc bạn không còn quyền xem». Mọi lỗi mạng, mọi 500, và mọi lệch hợp đồng (ZodError trên     │
 * │ HTTP 200) đều được kể lại cho người dùng như một sự thật về dữ liệu. Không nút thử lại, nên   │
 * │ người dùng không có cách nào phát hiện mình bị nói sai.                                       │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
describe("H4 — lỗi tải bài: 404 ≠ mọi lỗi khác", () => {
  it("`ApiError` 404 ⇒ «không tìm thấy», KHÔNG phải khối lỗi", async () => {
    getPost.mockRejectedValue(notFound());
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("post-detail-not-found")).toBeInTheDocument());
    expect(screen.queryByTestId("post-detail-error")).toBeNull();
  });

  it("🔴 `ApiError` 500 ⇒ khối LỖI + «Thử lại», KHÔNG nói bài đã bị xoá", async () => {
    getPost.mockRejectedValue(serverError());
    renderDetail();

    const box = await screen.findByTestId("post-detail-error");
    expect(screen.queryByTestId("post-detail-not-found")).toBeNull();
    expect(box).toHaveTextContent(t("state.errorTitle"));
    expect(box.textContent ?? "").not.toMatch(/đã bị xoá|đã bị xóa/i);
    expect(within(box).getByRole("button", { name: t("state.retry") })).toBeInTheDocument();
  });

  it("🔴 ZodError trên HTTP 200 (hợp đồng lệch) ⇒ khối LỖI, KHÔNG phải «bài đã bị xoá»", async () => {
    /**
     * Ca đắt nhất của H4. BE đổi/bỏ một khoá trong `feedPostSchema` ⇒ mọi lượt mở bài đều 200 nhưng
     * `schema.parse` ném `ZodError`. Bản cũ quy nó thành «đã bị xoá»: toàn công ty đọc được một câu
     * SAI SỰ THẬT, và vì nó trông như trạng thái bình thường nên không ai mở devtools đi tìm.
     */
    getPost.mockRejectedValue(zodError());
    renderDetail();

    const box = await screen.findByTestId("post-detail-error");
    expect(screen.queryByTestId("post-detail-not-found")).toBeNull();
    expect(box.textContent ?? "").not.toMatch(/đã bị xoá|đã bị xóa|không còn quyền xem/i);
  });

  it("bấm «Thử lại» gọi lại `003` (nút không được là đồ trang trí)", async () => {
    getPost.mockRejectedValue(serverError());
    renderDetail();

    const box = await screen.findByTestId("post-detail-error");
    const before = getPost.mock.calls.length;
    fireEvent.click(within(box).getByRole("button", { name: t("state.retry") }));
    await waitFor(() => expect(getPost.mock.calls.length).toBeGreaterThan(before));
  });
});

/**
 * H5 — ba trạng thái của danh sách bình luận, đo TỪ MÀN (dây nối `commentsQuery` → `CommentList`).
 * `CommentList.spec.tsx` đo riêng phần render; ca ở đây đo phần dây, vì bản cũ có đủ cờ trong
 * `commentsQuery` mà KHÔNG truyền xuống — component có thể đúng mà màn vẫn nói dối.
 */
describe("H5 — trạng thái danh sách bình luận nối đúng vào màn", () => {
  it("🔴 lỗi tải bình luận ⇒ khối lỗi, KHÔNG phải «Chưa có bình luận nào»", async () => {
    // Thẻ bài nói «12 bình luận» trong khi danh sách hỏng — đúng tình huống làm người đọc kết luận
    // 12 bình luận vừa bị xoá sạch.
    getPost.mockResolvedValue(makePost({ commentCount: 12 }));
    listComments.mockRejectedValue(serverError());
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-error")).toBeInTheDocument());
    expect(screen.queryByTestId("comment-empty")).toBeNull();
  });

  it("bấm «Thử lại» của bình luận gọi lại `014`", async () => {
    getPost.mockResolvedValue(makePost({ commentCount: 12 }));
    listComments.mockRejectedValue(serverError());
    renderDetail();

    const box = await screen.findByTestId("comment-error");
    const before = listComments.mock.calls.length;
    fireEvent.click(within(box).getByRole("button", { name: t("state.retry") }));
    await waitFor(() => expect(listComments.mock.calls.length).toBeGreaterThan(before));
  });

  it("đang tải bình luận ⇒ skeleton, KHÔNG phải câu rỗng", async () => {
    getPost.mockResolvedValue(makePost({ commentCount: 3 }));
    listComments.mockReturnValue(new Promise(() => {}));
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-loading")).toBeInTheDocument());
    expect(screen.queryByTestId("comment-empty")).toBeNull();
  });

  it("tải xong mà rỗng thật ⇒ MỚI được nói «chưa có bình luận»", async () => {
    getPost.mockResolvedValue(makePost({ commentCount: 0 }));
    listComments.mockResolvedValue(page([]));
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("comment-error")).toBeNull();
  });
});

/**
 * ┌─ H6 · CẢM XÚC TRÊN BÌNH LUẬN TỪNG LÀ PROMISE TRẦN ─────────────────────────────────────────┐
 * │ `void (…).then(…)` — không `.catch`, không pending. Ba hậu quả: thất bại 100% im lặng · một   │
 * │ **unhandled promise rejection** (lớp lỗi làm CI đỏ dù mọi test PASS) · bấm nhanh hai lần là   │
 * │ hai request đua nhau trên cùng một mục tiêu.                                                  │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
describe("H6 — cảm xúc bình luận là mutation, không phải promise trần", () => {
  const withOneComment = () => {
    getPost.mockResolvedValue(makePost());
    listComments.mockResolvedValue(page([makeComment({ id: "c1", body: "một bình luận" })]));
  };

  it("thả cảm xúc gọi `018` đúng bình luận", async () => {
    withOneComment();
    putCommentReaction.mockResolvedValue({ targetId: "c1", reactions: [] });
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-list")).toBeInTheDocument());
    pickReaction(screen.getByTestId("comment-row"), t("reaction.like"));
    await waitFor(() => expect(putCommentReaction).toHaveBeenCalledWith("c1", "like"));
  });

  it("🔴 thất bại ⇒ HIỆN dải lỗi `reaction`, không im lặng", async () => {
    withOneComment();
    putCommentReaction.mockRejectedValue(serverError());
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-list")).toBeInTheDocument());
    pickReaction(screen.getByTestId("comment-row"), t("reaction.like"));

    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-kind", "reaction");
    expect(banner).toHaveTextContent(t("actionError.generic.reaction"));
  });

  it("403 ⇒ câu «mất quyền», không phải câu «thử lại»", async () => {
    withOneComment();
    putCommentReaction.mockRejectedValue(forbidden());
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-list")).toBeInTheDocument());
    pickReaction(screen.getByTestId("comment-row"), t("reaction.like"));

    expect(await screen.findByTestId("feed-action-error")).toHaveTextContent(
      t("actionError.forbidden.reaction"),
    );
  });

  it("🔴 đang gửi ⇒ khoá thanh cảm xúc của bình luận đó (chặn hai request đua nhau)", async () => {
    withOneComment();
    putCommentReaction.mockReturnValue(new Promise(() => {}));
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-list")).toBeInTheDocument());
    pickReaction(screen.getByTestId("comment-row"), t("reaction.like"));

    await waitFor(() => expect(reactionTrigger(screen.getByTestId("comment-row"))).toBeDisabled());
    // Cảm xúc của BÀI đi đường khác (011/012) ⇒ không được khoá lây.
    expect(reactionTrigger(screen.getByTestId("post-card"))).not.toBeDisabled();
  });

  it("gỡ cảm xúc (bấm lại đúng emoji đang thả) đi đường `019`", async () => {
    getPost.mockResolvedValue(makePost());
    listComments.mockResolvedValue(page([makeComment({ id: "c1", myReaction: "like" })]));
    deleteCommentReaction.mockResolvedValue({ targetId: "c1", reactions: [] });
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-list")).toBeInTheDocument());
    pickReaction(screen.getByTestId("comment-row"), t("reaction.like"));
    await waitFor(() => expect(deleteCommentReaction).toHaveBeenCalledWith("c1"));
    expect(putCommentReaction).not.toHaveBeenCalled();
  });
});

/**
 * H1 — mọi đường GHI của màn phải nói khi hỏng. App không có toast và `QueryClient` không khai
 * `MutationCache.onError`, nên một mutation thiếu `onError` là câm TUYỆT ĐỐI: nút nhả ra như cũ.
 */
describe("H1 — tạo/xoá bình luận + hành động trên bài đều báo lỗi", () => {
  it("🔴 gửi bình luận hỏng ⇒ dải lỗi `comment` (nội dung vẫn còn trong ô soạn)", async () => {
    getPost.mockResolvedValue(makePost());
    createComment.mockRejectedValue(forbidden());
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-composer")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "chào" } });
    fireEvent.click(screen.getByTestId("comment-submit"));

    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-kind", "comment");
    expect(banner).toHaveTextContent(t("actionError.forbidden.comment"));
  });

  it("🔴 xoá bình luận hỏng ⇒ dải lỗi `commentDelete`", async () => {
    getPost.mockResolvedValue(makePost());
    listComments.mockResolvedValue(page([makeComment({ id: "c1", isMine: true })]));
    deleteComment.mockRejectedValue(serverError());
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-delete")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("comment-delete"));
    // H3 — xoá phải đi qua hộp xác nhận.
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: t("comment.delete") }),
    );

    await waitFor(() => expect(deleteComment).toHaveBeenCalledWith("c1"));
    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-kind", "commentDelete");
    expect(banner).toHaveTextContent(t("actionError.generic.commentDelete"));
  });

  it("🔴 lỗi của `useFeedActions` (lưu bài) cũng được MÀN render ra", async () => {
    // Hook đã bắt lỗi từ trước; ca này giữ phần màn PHẢI hiện nó — bắt mà không hiện thì vẫn câm.
    getPost.mockResolvedValue(makePost());
    savePost.mockRejectedValue(serverError());
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("post-save-toggle")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("post-save-toggle"));

    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-kind", "save");
  });

  it("đóng dải lỗi ⇒ biến mất (không dính lại vĩnh viễn)", async () => {
    getPost.mockResolvedValue(makePost());
    createComment.mockRejectedValue(serverError());
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-composer")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "chào" } });
    fireEvent.click(screen.getByTestId("comment-submit"));

    const banner = await screen.findByTestId("feed-action-error");
    fireEvent.click(within(banner).getByRole("button", { name: t("actionError.dismiss") }));
    await waitFor(() => expect(screen.queryByTestId("feed-action-error")).toBeNull());
  });

  it("ĐÚNG MỘT dải lỗi tại một thời điểm (lỗi mới thay lỗi cũ, không chồng đống)", async () => {
    getPost.mockResolvedValue(makePost());
    createComment.mockRejectedValue(serverError());
    savePost.mockRejectedValue(serverError());
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-composer")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "chào" } });
    fireEvent.click(screen.getByTestId("comment-submit"));
    await screen.findByTestId("feed-action-error");

    fireEvent.click(screen.getByTestId("post-save-toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("feed-action-error")).toHaveAttribute("data-kind", "save"),
    );
    expect(screen.getAllByTestId("feed-action-error")).toHaveLength(1);
  });
});

/** H3 — hộp xác nhận nối đúng vào đường xoá của màn (phần render đo ở `CommentList.spec.tsx`). */
describe("H3 — xoá bình luận hỏi trước khi gọi `017`", () => {
  it("🔴 bấm «Xoá» KHÔNG gọi API ngay", async () => {
    getPost.mockResolvedValue(makePost());
    listComments.mockResolvedValue(page([makeComment({ id: "c1", isMine: true })]));
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-delete")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("comment-delete"));

    expect(deleteComment).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(t("comment.confirmDelete"));
  });

  it("huỷ ⇒ không gọi `017`; xác nhận ⇒ mới gọi", async () => {
    getPost.mockResolvedValue(makePost());
    listComments.mockResolvedValue(page([makeComment({ id: "c1", isMine: true })]));
    deleteComment.mockResolvedValue({ id: "c1", deleted: true });
    renderDetail();

    await waitFor(() => expect(screen.getByTestId("comment-delete")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("comment-delete"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: tc("actions.cancel") }),
    );
    expect(deleteComment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("comment-delete"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: t("comment.delete") }),
    );
    await waitFor(() => expect(deleteComment).toHaveBeenCalledWith("c1"));
  });
});
