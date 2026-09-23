/**
 * S16-SOCIAL-FE-1 — ca **C8**: `SOC-SCREEN-002` Chi tiết bài.
 *
 * 🔴 Điều ca này giữ: **bài đã xoá và bài không-được-xem phải hiện GIỐNG HỆT NHAU.** Server trả 404
 * cho cả hai một cách cố ý — phân biệt chúng ở FE là nói cho người gọi biết "bài này có tồn tại, chỉ
 * là bạn không được xem", tức dựng lại đúng oracle dò nội dung mà BE vừa đóng.
 */
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const getPost = vi.fn();
const listComments = vi.fn();
const createComment = vi.fn();

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
    },
  };
});

beforeEach(() => {
  setCaps({ "view:feed": true, "create:feed-comment": true });
  getPost.mockReset();
  listComments.mockReset();
  createComment.mockReset();
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

    const t = i18n.getFixedT("vi", "social");
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
