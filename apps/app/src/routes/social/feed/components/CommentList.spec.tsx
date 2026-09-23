/**
 * S16-SOCIAL-FE-1 — `CommentList` + `CommentComposer` (SOCIAL-API-014/015/017).
 *
 * Ba thứ ca này giữ, và cả ba đều là chỗ dễ làm mất dữ liệu của người dùng một cách IM LẶNG:
 *  1. bình luận MỒ CÔI (cha đã xoá) vẫn phải hiện — bỏ qua chúng là làm biến mất bài của người ta;
 *  2. hệ thống MỘT cấp — không có nút «Trả lời» trên một trả lời (BE sẽ gắn nó vào cùng cha);
 *  3. trần độ dài là `FEED_BODY_MAX` (4000), KHÔNG phải `FEED_COMMENT_BODY_MAX` (5000 = mức DB).
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import { FEED_BODY_MAX, FEED_COMMENT_BODY_MAX, type FeedCommentDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { CommentList } from "./CommentList";
import { CommentComposer } from "./CommentComposer";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const base = (over: Partial<FeedCommentDto>): FeedCommentDto => ({
  id: "c1",
  postId: "p1",
  parentCommentId: null,
  author: { employeeId: null, fullName: "An", avatarUrl: null },
  body: "bình luận",
  attachments: [],
  likeCount: 0,
  myReaction: null,
  isMine: false,
  editedAt: null,
  createdAt: "2026-09-23T03:00:00.000Z",
  ...over,
});

const wrap = (node: React.ReactNode) =>
  render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

function renderList(comments: FeedCommentDto[], over: Record<string, unknown> = {}) {
  return wrap(
    <CommentList
      comments={comments}
      onReply={(over.onReply as never) ?? vi.fn()}
      onDelete={(over.onDelete as never) ?? vi.fn()}
      onReactionChange={(over.onReactionChange as never) ?? vi.fn()}
    />,
  );
}

beforeEach(() => setCaps({ "view:feed": true, "create:feed-comment": true }));
afterEach(() => {
  cleanup();
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("CommentList — gom MỘT cấp", () => {
  it("rỗng ⇒ câu rỗng riêng của bình luận", () => {
    renderList([]);
    expect(screen.getByTestId("comment-empty")).toBeInTheDocument();
  });

  it("trả lời xếp NGAY DƯỚI cha và được đánh dấu là trả lời", () => {
    renderList([
      base({ id: "c1", body: "gốc" }),
      base({ id: "c2", parentCommentId: "c1", body: "trả lời" }),
    ]);
    expect(screen.getAllByTestId("comment-row")).toHaveLength(1);
    expect(screen.getAllByTestId("comment-reply")).toHaveLength(1);
  });

  it("🔴 con MỒ CÔI (cha không có trong trang) VẪN hiện, ở mức gốc", () => {
    /**
     * Cha bị xoá mềm nên không nằm trong `comments`. Nếu gom theo `parentCommentId` mà không kiểm
     * cha có tồn tại không, bình luận này **biến mất im lặng** — không lỗi, không dấu vết, người
     * viết tưởng mình bị xoá bài.
     */
    renderList([base({ id: "c9", parentCommentId: "đã-xoá", body: "mồ côi" })]);
    expect(screen.getByTestId("comment-list")).toHaveTextContent("mồ côi");
    expect(screen.getAllByTestId("comment-row")).toHaveLength(1);
  });

  it("MỘT CẤP: nút «Trả lời» chỉ có ở gốc, KHÔNG có trên một trả lời", () => {
    // BE gắn trả-lời-của-trả-lời vào cùng cha, nên một nút ở đây là lời hứa không giữ được.
    renderList([
      base({ id: "c1", body: "gốc" }),
      base({ id: "c2", parentCommentId: "c1", body: "trả lời" }),
    ]);
    expect(screen.getAllByRole("button", { name: /trả lời/i })).toHaveLength(1);
  });

  it("nút «Xoá» chỉ hiện trên bình luận CỦA MÌNH (`isMine` — sở hữu hàng, không phải quyền)", () => {
    renderList([base({ id: "c1", isMine: false }), base({ id: "c2", isMine: true })]);
    expect(screen.getAllByTestId("comment-delete")).toHaveLength(1);
  });

  it("bấm «Trả lời» / «Xoá» gọi đúng callback kèm đúng bình luận", () => {
    const onReply = vi.fn();
    const onDelete = vi.fn();
    const mine = base({ id: "c2", isMine: true, body: "của tôi" });
    renderList([mine], { onReply, onDelete });

    fireEvent.click(screen.getByRole("button", { name: /trả lời/i }));
    expect(onReply).toHaveBeenCalledWith(mine);

    fireEvent.click(screen.getByTestId("comment-delete"));
    expect(onDelete).toHaveBeenCalledWith(mine);
  });
});

describe("CommentComposer — cổng quyền + trần độ dài", () => {
  it("DENY: KHÔNG có `create:feed-comment` ⇒ ô soạn KHÔNG render", () => {
    setCaps({ "view:feed": true });
    wrap(<CommentComposer onSubmit={vi.fn()} isSubmitting={false} />);
    expect(screen.queryByTestId("comment-composer")).toBeNull();
  });

  it("ALLOW: có cặp ⇒ ô soạn hiện; gửi truyền `parentCommentId` đúng", () => {
    const onSubmit = vi.fn();
    wrap(
      <CommentComposer
        onSubmit={onSubmit}
        isSubmitting={false}
        replyTo={{ commentId: "c1", authorName: "An" }}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "trả lời đây" } });
    fireEvent.click(screen.getByTestId("comment-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ body: "trả lời đây", parentCommentId: "c1" });
  });

  it("bài KHOÁ bình luận ⇒ ẩn ô soạn và NÓI RÕ lý do (không để gõ xong mới 409)", () => {
    wrap(<CommentComposer onSubmit={vi.fn()} isSubmitting={false} locked />);
    expect(screen.getByTestId("comment-locked")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-composer")).toBeNull();
  });

  it("🔴 trần là FEED_BODY_MAX (4000), KHÔNG phải FEED_COMMENT_BODY_MAX (5000 = mức DB)", () => {
    /**
     * Hai hằng gần giống tên nhau nói hai chuyện khác nhau. Dùng nhầm 5000 ⇒ ô soạn cho gõ tới 5000
     * rồi ăn **400 từ Zod của server** ở ký tự 4001 — lỗi mà người dùng không hiểu và dev không tìm
     * ra vì "FE có kiểm rồi mà". Ca này ghim đúng con số đang được dùng.
     */
    expect(FEED_COMMENT_BODY_MAX).toBeGreaterThan(FEED_BODY_MAX);

    const onSubmit = vi.fn();
    wrap(<CommentComposer onSubmit={onSubmit} isSubmitting={false} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "x".repeat(FEED_BODY_MAX + 1) },
    });
    expect(screen.getByTestId("comment-submit")).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "x".repeat(FEED_BODY_MAX) },
    });
    expect(screen.getByTestId("comment-submit")).not.toBeDisabled();
  });

  it("đang gửi ⇒ nút KHOÁ", () => {
    wrap(<CommentComposer onSubmit={vi.fn()} isSubmitting />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "abc" } });
    expect(screen.getByTestId("comment-submit")).toBeDisabled();
  });

  it("KHÔNG có nút đính kèm (D8 · nợ N1)", () => {
    const { container } = wrap(<CommentComposer onSubmit={vi.fn()} isSubmitting={false} />);
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
