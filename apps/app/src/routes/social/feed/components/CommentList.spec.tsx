/**
 * S16-SOCIAL-FE-1 — `CommentList` + `CommentComposer` (SOCIAL-API-014/015/017).
 *
 * Ba thứ ca này giữ, và cả ba đều là chỗ dễ làm mất dữ liệu của người dùng một cách IM LẶNG:
 *  1. bình luận MỒ CÔI (cha đã xoá) vẫn phải hiện — bỏ qua chúng là làm biến mất bài của người ta;
 *  2. hệ thống MỘT cấp — không có nút «Trả lời» trên một trả lời (BE sẽ gắn nó vào cùng cha);
 *  3. trần độ dài là `FEED_BODY_MAX` (4000), KHÔNG phải `FEED_COMMENT_BODY_MAX` (5000 = mức DB).
 *
 * ⟲ FULL gate 23/09/2026 thêm hai lưới nữa:
 *  4. **H5** — `isLoading` / `isError` của truy vấn bình luận phải có NHÁNH RIÊNG. Trước đó cả hai
 *     rơi vào câu «Chưa có bình luận nào.»: thẻ bài ghi «12 bình luận», `GET` trả 500, người đọc kết
 *     luận 12 bình luận vừa bị xoá sạch. Trạng thái rỗng SAI SỰ THẬT tệ hơn một khối lỗi.
 *  5. **H3** — xoá bình luận phải HỎI. Nút «Xoá» nằm ngay cạnh «Trả lời», cùng cỡ chữ, không hoàn
 *     tác được: bấm nhầm là mất bình luận vĩnh viễn.
 */
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
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

const t = i18n.getFixedT("vi", "social");
const tc = i18n.getFixedT("vi", "common");

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

type ListProps = React.ComponentProps<typeof CommentList>;

function renderList(comments: FeedCommentDto[], over: Partial<ListProps> = {}) {
  return wrap(
    <CommentList
      comments={comments}
      isLoading={false}
      isError={false}
      onRetry={vi.fn()}
      onReply={vi.fn()}
      onDelete={vi.fn()}
      onReactionChange={vi.fn()}
      {...over}
    />,
  );
}

/** Mở picker rồi chọn emoji trên ĐÚNG hàng truyền vào (màn có nhiều thanh cảm xúc). */
function pickReaction(row: HTMLElement, emojiLabel: string): void {
  const bar = within(row).getByTestId("feed-reaction-bar");
  fireEvent.click(within(bar).getByRole("button", { name: new RegExp(t("reaction.trigger")) }));
  fireEvent.click(within(bar).getByRole("menuitem", { name: emojiLabel }));
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

  it("bấm «Trả lời» gọi đúng callback kèm đúng bình luận", () => {
    const onReply = vi.fn();
    const mine = base({ id: "c2", isMine: true, body: "của tôi" });
    renderList([mine], { onReply });

    fireEvent.click(screen.getByRole("button", { name: /trả lời/i }));
    expect(onReply).toHaveBeenCalledWith(mine);
  });
});

/**
 * ┌─ H5 · BA TRẠNG THÁI CỦA DANH SÁCH BÌNH LUẬN ────────────────────────────────────────────────┐
 * │ Trước bản vá, `commentsQuery.isLoading` và `.isError` KHÔNG được dùng ở đâu trong             │
 * │ `PostDetailPage` — cả hai rơi xuống `comments = []` ⇒ «Chưa có bình luận nào.». Một khẳng      │
 * │ định SAI SỰ THẬT về dữ liệu của người khác, phát ra đúng lúc hệ thống đang hỏng.               │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
describe("H5 — CommentList: loading / error / empty là BA nhánh", () => {
  it("đang tải ⇒ skeleton, KHÔNG phải câu «chưa có bình luận»", () => {
    renderList([], { isLoading: true });
    expect(screen.getByTestId("comment-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-empty")).toBeNull();
  });

  it("🔴 lỗi tải ⇒ khối lỗi + «Thử lại», KHÔNG phải câu «chưa có bình luận»", () => {
    renderList([], { isError: true });
    const box = screen.getByTestId("comment-error");
    expect(box).toBeInTheDocument();
    expect(screen.queryByTestId("comment-empty")).toBeNull();
    // Nói rõ là LỖI, không phải một khẳng định về dữ liệu.
    expect(box).toHaveTextContent(t("state.errorBody"));
    expect(within(box).getByRole("button", { name: t("state.retry") })).toBeInTheDocument();
  });

  it("bấm «Thử lại» gọi `onRetry` (nút không được là đồ trang trí)", () => {
    const onRetry = vi.fn();
    renderList([], { isError: true, onRetry });
    fireEvent.click(screen.getByRole("button", { name: t("state.retry") }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("đang tải ĐÈ lên lỗi cũ: không hiện hai khối cùng lúc", () => {
    renderList([], { isLoading: true, isError: true });
    expect(screen.getByTestId("comment-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-error")).toBeNull();
  });
});

/**
 * ┌─ H3 · XOÁ BÌNH LUẬN PHẢI HỎI ───────────────────────────────────────────────────────────────┐
 * │ `comment.confirmDelete` («Xoá bình luận này?») đã nằm trong bundle i18n từ đầu WO với ĐÚNG    │
 * │ 0 call-site — khoá tồn tại vì người viết biết cần hỏi, rồi hộp hỏi không bao giờ được dựng.   │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
describe("H3 — xoá bình luận đi qua hộp xác nhận", () => {
  it("🔴 bấm «Xoá» CHƯA xoá: mở hộp hỏi trước", () => {
    const onDelete = vi.fn();
    renderList([base({ id: "c2", isMine: true })], { onDelete });

    fireEvent.click(screen.getByTestId("comment-delete"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(t("comment.confirmDelete"));
  });

  it("xác nhận ⇒ gọi `onDelete` đúng bình luận rồi đóng hộp", () => {
    const onDelete = vi.fn();
    const mine = base({ id: "c2", isMine: true, body: "của tôi" });
    renderList([mine], { onDelete });

    fireEvent.click(screen.getByTestId("comment-delete"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("comment.delete") }));

    expect(onDelete).toHaveBeenCalledWith(mine);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("huỷ ⇒ KHÔNG xoá, hộp đóng, bình luận còn nguyên", () => {
    const onDelete = vi.fn();
    renderList([base({ id: "c2", isMine: true, body: "của tôi" })], { onDelete });

    fireEvent.click(screen.getByTestId("comment-delete"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: tc("actions.cancel") }),
    );

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("comment-list")).toHaveTextContent("của tôi");
  });

  it("hộp hỏi chỉ nhắm ĐÚNG bình luận vừa bấm, không phải cái đầu danh sách", () => {
    const onDelete = vi.fn();
    const first = base({ id: "c1", isMine: true, body: "đầu" });
    const second = base({ id: "c2", isMine: true, body: "sau" });
    renderList([first, second], { onDelete });

    fireEvent.click(screen.getAllByTestId("comment-delete")[1]);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: t("comment.delete") }),
    );
    expect(onDelete).toHaveBeenCalledWith(second);
  });
});

/**
 * H6 (phần của `CommentList`) — cảm xúc trên bình luận phải KHOÁ được trong lúc chờ server, và chỉ
 * khoá ĐÚNG hàng đang gửi. Trước bản vá, `isPending` không hề được truyền xuống ⇒ bấm nhanh hai lần
 * là hai request đua nhau trên cùng một mục tiêu.
 */
describe("H6 — cảm xúc bình luận: pending theo ĐÚNG hàng", () => {
  it("truyền emoji + bình luận cho `onReactionChange`", () => {
    const onReactionChange = vi.fn();
    const c = base({ id: "c1" });
    renderList([c], { onReactionChange });

    pickReaction(screen.getByTestId("comment-row"), t("reaction.like"));
    expect(onReactionChange).toHaveBeenCalledWith(c, "like");
  });

  it("🔴 đang gửi ⇒ khoá thanh cảm xúc của ĐÚNG hàng đó, hàng khác vẫn bấm được", () => {
    renderList([base({ id: "c1", body: "đang gửi" }), base({ id: "c2", body: "bình thường" })], {
      pendingReactionCommentId: "c1",
    });

    const [rowA, rowB] = screen.getAllByTestId("comment-row");
    const trigger = (row: HTMLElement) =>
      within(within(row).getByTestId("feed-reaction-bar")).getByRole("button", {
        name: new RegExp(t("reaction.trigger")),
      });

    expect(trigger(rowA)).toBeDisabled();
    expect(trigger(rowB)).not.toBeDisabled();
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
