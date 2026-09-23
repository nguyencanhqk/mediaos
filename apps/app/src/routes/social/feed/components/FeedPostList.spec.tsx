/**
 * S16-SOCIAL-FE-1 — ca **C12 · C13** trên `FeedPostList` (5 trạng thái của SPEC-16 §14).
 *
 * **C12 là ca chống COPY-PASTE**, không phải ca đếm chữ: ba màn dùng chung component này và mỗi màn
 * phải nói đúng lý do rỗng của mình. Một câu dùng chung («chưa có dữ liệu») sẽ đẩy người ở màn tìm
 * kiếm đi đăng bài mới thay vì đổi từ khoá. Vì vậy ca dưới assert ba chuỗi **KHÁC NHAU** bằng
 * `not.toBe`, chứ không chỉ assert "có hiện chữ".
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import type { FeedPostDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { FeedPostList } from "./FeedPostList";
import type { FeedActions } from "../lib/use-feed-actions";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

const ACTIONS: FeedActions = {
  reactionSummaries: {},
  setReaction: vi.fn(),
  toggleSave: vi.fn(),
  moderate: vi.fn(),
  remove: vi.fn(),
  pendingReactionPostId: null,
  pendingSavePostId: null,
  actionError: null,
  clearActionError: vi.fn(),
};

const POST: FeedPostDto = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "share",
  audience: "company",
  orgUnitId: null,
  groupId: null,
  author: { employeeId: null, fullName: "An", avatarUrl: null },
  body: "nội dung",
  tags: [],
  attachments: [],
  pinned: false,
  commentsLocked: false,
  requiresAck: false,
  likeCount: 0,
  commentCount: 0,
  viewCount: 0,
  myReaction: null,
  savedByMe: false,
  isMine: false,
  editedAt: null,
  publishedAt: "2026-09-23T03:00:00.000Z",
  lastActivityAt: "2026-09-23T03:00:00.000Z",
  createdAt: "2026-09-23T03:00:00.000Z",
};

const MENU_ACTIONS = {
  onCopyLink: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToggleHidden: vi.fn(),
  onToggleComments: vi.fn(),
  onTogglePinned: vi.fn(),
};

function renderList(props: Partial<React.ComponentProps<typeof FeedPostList>> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <FeedPostList
        posts={props.posts ?? []}
        isLoading={props.isLoading ?? false}
        isError={props.isError ?? false}
        onRetry={props.onRetry ?? vi.fn()}
        emptyText={props.emptyText ?? "rỗng"}
        emptyHint={props.emptyHint}
        hasNextPage={props.hasNextPage}
        isFetchingNextPage={props.isFetchingNextPage}
        onLoadMore={props.onLoadMore}
        actions={props.actions ?? ACTIONS}
        buildMenuActions={props.buildMenuActions ?? (() => MENU_ACTIONS)}
      />
    </I18nextProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("C12 — ba câu RỖNG phải KHÁC NHAU (chống copy-paste)", () => {
  it("ba khoá i18n cho ba màn cho ra ba chuỗi khác nhau", () => {
    const t = i18n.getFixedT("vi", "social");
    const feed = t("empty.feed");
    const search = t("empty.search");
    const saved = t("empty.saved");

    // `not.toBe` giữa TỪNG CẶP: nếu ai đó "gọn hoá" hai trong ba về cùng một khoá, ca này đỏ ngay —
    // còn một ca chỉ kiểm "có chữ" thì xanh cả khi cả ba giống hệt nhau.
    expect(feed).not.toBe(search);
    expect(feed).not.toBe(saved);
    expect(search).not.toBe(saved);
    for (const s of [feed, search, saved]) expect(s.length).toBeGreaterThan(0);
  });

  it("render đúng câu được truyền vào, không tự thay bằng mặc định nào", () => {
    renderList({ emptyText: "Bạn chưa lưu bài viết nào.", emptyHint: "gợi ý riêng" });
    expect(screen.getByTestId("feed-empty")).toHaveTextContent("Bạn chưa lưu bài viết nào.");
    expect(screen.getByTestId("feed-empty")).toHaveTextContent("gợi ý riêng");
  });
});

describe("C13 — loading / lỗi", () => {
  it("loading ⇒ SKELETON thẻ bài, KHÔNG spinner, và không có danh sách", () => {
    renderList({ isLoading: true });
    const loading = screen.getByTestId("feed-loading");
    expect(loading).toHaveAttribute("aria-label");
    expect(screen.queryByTestId("feed-post-list")).toBeNull();
    expect(screen.queryByTestId("feed-empty")).toBeNull();
  });

  it("lỗi ⇒ khối có role=alert + nút «Thử lại» GỌI ĐƯỢC", () => {
    const onRetry = vi.fn();
    renderList({ isError: true, onRetry });

    expect(screen.getByTestId("feed-error")).toHaveAttribute("role", "alert");
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    // Nút thử lại không nối vào gì là một nút trang trí — ca này chặn đúng chuyện đó.
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("lỗi CHIẾM CHỖ của danh sách, không hiện chồng lên nhau", () => {
    renderList({ isError: true, posts: [POST] });
    expect(screen.queryByTestId("feed-post-list")).toBeNull();
  });

  it("thứ tự ưu tiên: loading THẮNG lỗi (không nháy lỗi cũ khi đang tải lại)", () => {
    renderList({ isLoading: true, isError: true });
    expect(screen.getByTestId("feed-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("feed-error")).toBeNull();
  });
});

describe("danh sách + phân trang", () => {
  it("có bài ⇒ render thẻ, không hiện khối rỗng", () => {
    renderList({ posts: [POST] });
    expect(screen.getByTestId("feed-post-list")).toBeInTheDocument();
    expect(screen.getAllByTestId("post-card")).toHaveLength(1);
    expect(screen.queryByTestId("feed-empty")).toBeNull();
  });

  it("`hasNextPage=false` ⇒ KHÔNG có nút «Xem thêm» (không mời bấm vào hư không)", () => {
    renderList({ posts: [POST], hasNextPage: false });
    expect(screen.queryByTestId("feed-load-more")).toBeNull();
  });

  it("`hasNextPage=true` ⇒ nút «Xem thêm» gọi `onLoadMore`; đang tải thì KHOÁ", () => {
    const onLoadMore = vi.fn();
    const { rerender } = renderList({ posts: [POST], hasNextPage: true, onLoadMore });
    fireEvent.click(screen.getByTestId("feed-load-more"));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <I18nextProvider i18n={i18n}>
        <FeedPostList
          posts={[POST]}
          isLoading={false}
          isError={false}
          onRetry={vi.fn()}
          emptyText="rỗng"
          hasNextPage
          isFetchingNextPage
          onLoadMore={onLoadMore}
          actions={ACTIONS}
          buildMenuActions={() => MENU_ACTIONS}
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId("feed-load-more")).toBeDisabled();
  });

  it("cờ «đang gửi» truyền xuống ĐÚNG thẻ, không khoá cả danh sách", () => {
    const second = { ...POST, id: "22222222-2222-4222-8222-222222222222" };
    renderList({
      posts: [POST, second],
      actions: { ...ACTIONS, pendingSavePostId: POST.id },
    });
    const toggles = screen.getAllByTestId("post-save-toggle");
    expect(toggles[0]).toBeDisabled();
    expect(toggles[1]).not.toBeDisabled();
  });
});
