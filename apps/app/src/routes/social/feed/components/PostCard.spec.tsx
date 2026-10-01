/**
 * S16-SOCIAL-FE-1 — ca **C5 · C6 · C7 · C27** trên `PostCard` + `PostCardMenu`.
 *
 * ┌─ ⚠️ BẪY «NÚT ⋯ VẮNG ≠ MỤC VẮNG» (đã dính thật ở S15-PAYROLL-FE-7) ───────────────────────────┐
 * │ Ca DENY phải **mở menu ra** rồi assert MỤC không có. Nếu chỉ assert "nút ⋯ không render" thì   │
 * │ một ngày nào đó nút biến mất vì lý do hoàn toàn khác (đổi layout, lỗi render) và ca deny vẫn    │
 * │ XANH — xanh rỗng. Vì vậy `PostCardMenu` luôn render nút ⋯ (luôn có «Sao chép liên kết»), và mọi │
 * │ ca dưới đây đều bấm mở menu trước khi kiểm.                                                    │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Quyền được đặt bằng `useAuthStore.setState({capabilities})` — **store THẬT**, không mock `useCan`.
 * Lý do: `useCan` đọc store qua `../stores/auth` (không qua barrel), nên mock barrel KHÔNG chạm tới
 * nó; mock chính `useCan` thì ca này sẽ đo cái mock chứ không đo luật phân quyền thật.
 */
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import type { FeedPostDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { PostCard } from "./PostCard";

/**
 * S16-SOCIAL-FE-2 — thẻ `poll` giờ dựng `PollBlock`, khối này tự gọi `043`. Chỉ thay ĐÚNG hàm đó:
 * `useCan` đọc store thật qua `../stores/auth`, không qua barrel, nên spread `actual` giữ nguyên nó.
 */
const getPollResults = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: { ...actual.socialApi, getPollResults: (id: string) => getPollResults(id) },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const BASE_POST: FeedPostDto = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "share",
  audience: "company",
  orgUnitId: null,
  groupId: null,
  author: {
    employeeId: "22222222-2222-4222-8222-222222222222",
    fullName: "An Nguyễn",
    avatarUrl: null,
  },
  body: "xin chào công ty",
  tags: [],
  attachments: [],
  pinned: false,
  commentsLocked: false,
  requiresAck: false,
  likeCount: 3,
  commentCount: 2,
  viewCount: 10,
  myReaction: null,
  savedByMe: false,
  isMine: false,
  editedAt: null,
  publishedAt: "2026-09-23T03:00:00.000Z",
  lastActivityAt: "2026-09-23T03:00:00.000Z",
  createdAt: "2026-09-23T03:00:00.000Z",
};

const noopActions = {
  onCopyLink: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToggleHidden: vi.fn(),
  onToggleComments: vi.fn(),
  onTogglePinned: vi.fn(),
};

function renderCard(post: Partial<FeedPostDto> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <PostCard
          post={{ ...BASE_POST, ...post }}
          onReactionChange={vi.fn()}
          onToggleSave={vi.fn()}
          menuActions={noopActions}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Mở menu ⋯ rồi trả về chính node menu — mọi ca gate đều đi qua đây. */
function openMenu(): HTMLElement {
  fireEvent.click(screen.getByTestId("post-menu-trigger"));
  return screen.getByTestId("post-menu");
}

beforeEach(() => {
  setCaps({ "view:feed": true });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

/**
 * «Ghim» có BA lý do bị server từ chối, mỗi ca DENY dưới đây gỡ ĐÚNG MỘT vế và giữ hai vế kia:
 *  - thiếu `manage:feed-news` ⇒ 403 tầng 2 (`SOCIAL_MODERATION_FIELD_PAIRS.pinned`);
 *  - thiếu `manage:feed-post` ⇒ 403 tầng 1 (SÀN decorator route 006, `tier1IsFloor`);
 *  - bài không phải `news` ⇒ 422 `SOCIAL-ERR-PIN-NEWS-ONLY` (CHECK `chk_feed_posts_pinned_news`).
 * Bản đầu chỉ xét vế 1 và ca ALLOW của nó dựng đúng trạng thái hỏng (bài `share`, không `feed-post`)
 * — xanh trong khi mục hiện ra mà bấm là lỗi (`S16-SOCIAL-FEMODPAYLOAD-1`).
 */
describe("C5 — «Ghim» = `manage:feed-news` + sàn `manage:feed-post` + bài `news`", () => {
  const MODERATOR = { "view:feed": true, "manage:feed-post": true, "manage:feed-news": true };

  it("ALLOW: đủ hai cặp (vai canonical hr/company-admin) + bài `news` ⇒ mục «Ghim» CÓ", () => {
    setCaps(MODERATOR);
    renderCard({ type: "news" });
    expect(within(openMenu()).getByTestId("post-menu-toggle-pinned")).toBeInTheDocument();
  });

  it("ALLOW: bài `news` ĐANG ghim ⇒ vẫn có mục (để bỏ ghim)", () => {
    setCaps(MODERATOR);
    renderCard({ type: "news", pinned: true });
    expect(within(openMenu()).getByTestId("post-menu-toggle-pinned")).toBeInTheDocument();
  });

  it("DENY: có `manage:feed-post` nhưng KHÔNG có `manage:feed-news` ⇒ mục «Ghim» VẮNG", () => {
    setCaps({ "view:feed": true, "manage:feed-post": true });
    renderCard({ type: "news" });
    const menu = openMenu();

    expect(within(menu).queryByTestId("post-menu-toggle-pinned")).toBeNull();
    // Đối chứng: menu KHÔNG rỗng — các mục của `manage:feed-post` vẫn ở đó.
    expect(within(menu).getByTestId("post-menu-toggle-hidden")).toBeInTheDocument();
  });

  it("DENY: CHỈ `manage:feed-news` (vai tuỳ biến, thiếu SÀN tầng 1) ⇒ mục «Ghim» VẮNG", () => {
    setCaps({ "view:feed": true, "manage:feed-news": true });
    renderCard({ type: "news" });
    const menu = openMenu();

    expect(within(menu).queryByTestId("post-menu-toggle-pinned")).toBeNull();
    expect(within(menu).getByTestId("post-menu-copy-link")).toBeInTheDocument();
  });

  it.each(["share", "poll", "idea", "kudos"] as const)(
    "DENY: đủ hai cặp nhưng bài `%s` (không phải tin) ⇒ mục «Ghim» VẮNG",
    (type) => {
      setCaps(MODERATOR);
      renderCard({ type, body: "nội dung" });
      const menu = openMenu();

      expect(within(menu).queryByTestId("post-menu-toggle-pinned")).toBeNull();
      // Đối chứng: cùng actor vẫn thấy mục kiểm duyệt khác — vắng «Ghim» là do LOẠI BÀI.
      expect(within(menu).getByTestId("post-menu-toggle-hidden")).toBeInTheDocument();
    },
  );
});

describe("C6 — xoá bài NGƯỜI KHÁC cần `manage:feed-post`", () => {
  it("ALLOW: `manage:feed-post` ⇒ mục «Xoá bài» có, dù bài không phải của mình", () => {
    setCaps({ "view:feed": true, "manage:feed-post": true });
    renderCard({ isMine: false });
    expect(within(openMenu()).getByTestId("post-menu-delete")).toBeInTheDocument();
  });

  it("DENY: chỉ `view:feed` + `isMine=false` ⇒ «Xoá» VẮNG, nhưng «Sao chép liên kết» VẪN CÓ", () => {
    renderCard({ isMine: false });
    const menu = openMenu();

    expect(within(menu).queryByTestId("post-menu-delete")).toBeNull();
    expect(within(menu).queryByTestId("post-menu-edit")).toBeNull();
    /**
     * 🔴 Vế ĐỐI CHỨNG — không có nó thì ca này xanh cả khi menu vỡ hoàn toàn. «Sao chép liên kết»
     * là mục KHÔNG cần quyền, nên nó phải còn. (Plan finding #3: bản đầu dùng «Báo cáo» làm đối
     * chứng, nhưng owner đã gỡ «Báo cáo» khỏi FE-1 nên phải đổi sang mục này.)
     */
    expect(within(menu).getByTestId("post-menu-copy-link")).toBeInTheDocument();
  });

  it("ALLOW: bài CỦA MÌNH ⇒ sửa/xoá có, KHÔNG cần cặp quản trị nào", () => {
    // Sở hữu HÀNG, không phải quyền: `isMine` đến từ DTO chứ không từ so sánh id ở FE.
    renderCard({ isMine: true });
    const menu = openMenu();
    expect(within(menu).getByTestId("post-menu-edit")).toBeInTheDocument();
    expect(within(menu).getByTestId("post-menu-delete")).toBeInTheDocument();
    expect(within(menu).queryByTestId("post-menu-toggle-hidden")).toBeNull();
  });
});

describe("C7 — thích/lưu KHÔNG có cặp riêng (SPEC-16 §11.2)", () => {
  it("ALLOW: chỉ `view:feed` ⇒ nút cảm xúc và nút lưu VẪN HIỆN", () => {
    /**
     * Lưới chống BỊA CẶP. Nếu ai đó thêm `useCan("create","feed-reaction")` hay
     * `useCan("create","feed-save")`, khoá đó không tồn tại trong seed `0578` ⇒ `capabilities`
     * không bao giờ có nó ⇒ hai nút này **ẩn vĩnh viễn với mọi người** — và không cổng nào khác
     * bắt được, vì "nút không hiện" trông y hệt "chưa làm xong". Ca ALLOW này là chỗ nó ĐỎ.
     */
    renderCard();
    expect(screen.getByTestId("feed-reaction-bar")).toBeInTheDocument();
    expect(screen.getByTestId("post-save-toggle")).toBeInTheDocument();
  });

  it("bộ chọn cảm xúc mở ra đúng 6 emoji của contracts — không nhiều không ít", () => {
    renderCard();
    fireEvent.click(within(screen.getByTestId("feed-reaction-bar")).getByRole("button"));
    const picker = screen.getByTestId("feed-reaction-picker");
    expect(within(picker).getAllByRole("menuitem")).toHaveLength(6);
  });
});

describe("C27 — kudos VẮNG khối (006 · WS · API cũ · mồ côi) / loại lạ phải SUY BIẾN AN TOÀN (R16)", () => {
  it("`{type:'kudos', body:null}` không `kudos` ⇒ KHÔNG ném, vẫn vẽ tác giả · cảm xúc · lưu", () => {
    // S16-SOCIAL-FE-2C: khối kudos chỉ vẽ khi DTO chở `post.kudos` — ca này là nhánh VẮNG khối.
    expect(() => renderCard({ type: "kudos", body: null })).not.toThrow();
    expect(screen.getByText("An Nguyễn")).toBeInTheDocument();
    expect(screen.getByTestId("feed-reaction-bar")).toBeInTheDocument();
    expect(screen.getByTestId("post-save-toggle")).toBeInTheDocument();
  });

  it("`kudos` vắng khối / loại lạ ⇒ KHÔNG khối thân, KHÔNG chữ «null», KHÔNG gọi `043`", () => {
    renderCard({ type: "kudos", body: null });
    expect(screen.queryByTestId("post-body")).toBeNull();
    expect(screen.queryByTestId("kudos-block")).toBeNull();
    expect(screen.queryByText(/null|undefined/)).toBeNull();
    expect(screen.queryByTestId("poll-block")).toBeNull();
    expect(getPollResults).not.toHaveBeenCalled();
  });

  it("S16-SOCIAL-FE-2C: `kudos` CÓ `post.kudos` ⇒ vẽ `kudos-block` (người nhận + lời nhắn)", () => {
    renderCard({
      type: "kudos",
      body: null,
      kudos: {
        kudosId: "44444444-4444-4444-8444-444444444444",
        message: "Cảm ơn đã hỗ trợ!",
        isOfficial: false,
        badge: null,
        recipients: [
          {
            employeeId: "33333333-3333-4333-8333-333333333333",
            fullName: "Bình Trần",
            avatarUrl: "https://x.invalid/p.png",
            isFormerEmployee: false,
          },
        ],
      },
    });
    expect(screen.getByTestId("kudos-block")).toBeInTheDocument();
    expect(screen.getByText("Bình Trần")).toBeInTheDocument();
    expect(screen.getByText("Cảm ơn đã hỗ trợ!")).toBeInTheDocument();
    expect(screen.queryByTestId("post-body")).toBeNull();
  });

  it("loại LẠ có `body` ⇒ vẫn KHÔNG vẽ thân (không đoán nghĩa của loại chưa biết)", () => {
    renderCard({ type: "announcement", body: "không nên hiện" });
    expect(screen.queryByTestId("post-body")).toBeNull();
  });

  it("bài `share` bình thường ⇒ thân bài CÓ render (đối chứng)", () => {
    renderCard();
    expect(screen.getByTestId("post-body")).toHaveTextContent("xin chào công ty");
  });
});

describe("S16-SOCIAL-FE-2 — thẻ `poll` / `idea`", () => {
  it("`poll` ⇒ dựng khối bỏ phiếu, gọi `043` đúng `postId`", async () => {
    getPollResults.mockResolvedValue({
      pollId: "22222222-2222-4222-8222-222222222222",
      postId: BASE_POST.id,
      question: "Ăn trưa ở đâu?",
      status: "open",
      multipleChoice: false,
      isAnonymous: false,
      closesAt: null,
      totalVoters: 0,
      myVote: [],
      options: [],
    });
    renderCard({ type: "poll", body: null });
    expect(await screen.findByTestId("poll-block")).toHaveTextContent("Ăn trưa ở đâu?");
    expect(getPollResults).toHaveBeenCalledWith(BASE_POST.id);
  });

  it("`poll` có mô tả ⇒ thân HIỆN (plan §8 M8); không mô tả ⇒ không khối thân", () => {
    getPollResults.mockReturnValue(new Promise(() => {}));
    renderCard({ type: "poll", body: "Chọn giúp chỗ liên hoan" });
    expect(screen.getByTestId("post-body")).toHaveTextContent("Chọn giúp chỗ liên hoan");
    cleanup();
    renderCard({ type: "poll", body: null });
    expect(screen.queryByTestId("post-body")).toBeNull();
  });

  it("`idea` ⇒ thân + nhãn «Sáng kiến» trỏ `/feed/ideas`", () => {
    renderCard({ type: "idea", body: "Lắp thêm máy lọc nước" });
    expect(screen.getByTestId("post-body")).toHaveTextContent("Lắp thêm máy lọc nước");
    // `Link` bị mock thành `<a href={to}>` trần (bỏ `data-testid`) ⇒ tìm theo nhãn i18n thật.
    const t = i18n.getFixedT("vi", "social");
    const badge = screen.getByText(new RegExp(`^${t("idea.label")} ·`)).closest("a");
    expect(badge).toHaveAttribute("href", "/feed/ideas");
    expect(screen.queryByTestId("poll-block")).toBeNull();
  });

  it("thẻ `share` KHÔNG có nhãn sáng kiến, KHÔNG khối poll (đối chứng)", () => {
    renderCard();
    expect(screen.queryByText(/^Sáng kiến ·/)).toBeNull();
    expect(screen.queryByTestId("poll-block")).toBeNull();
  });
});

describe("lưới ảnh — đính kèm bị từ chối presign (`url: null`) KHÔNG được vẽ", () => {
  it("ảnh `url:null` bị lọc khỏi lưới, và KHÔNG tính vào «+N»", () => {
    /**
     * `feedAttachmentSchema.url` nullable vì `FilePolicyService` quyết định presign theo TỪNG người
     * nhận và từ chối thì trả `null` (fail-soft). Vẽ `<img src={null}>` cho ra ô ảnh vỡ — và tệ hơn
     * là nó RÒ: người xem biết "có một ảnh ở đây mà tôi không được xem".
     */
    renderCard({
      attachments: [
        { fileId: "f1", kind: "image", fileName: "a.png", sizeBytes: 1, url: "https://x/a.png" },
        { fileId: "f2", kind: "image", fileName: "b.png", sizeBytes: 1, url: null },
      ],
    });
    const grid = screen.getByTestId("post-image-grid");
    expect(within(grid).getAllByRole("img")).toHaveLength(1);
    expect(within(grid).queryByText(/^\+/)).toBeNull();
  });

  it("không có ảnh nào xem được ⇒ KHÔNG render lưới rỗng", () => {
    renderCard({
      attachments: [{ fileId: "f2", kind: "image", fileName: "b.png", sizeBytes: 1, url: null }],
    });
    expect(screen.queryByTestId("post-image-grid")).toBeNull();
  });
});

describe("tương tác thật trên thẻ bài", () => {
  it("chọn một emoji ⇒ gọi `onReactionChange` với đúng mã", () => {
    const onReactionChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <PostCard
          post={BASE_POST}
          onReactionChange={onReactionChange}
          onToggleSave={vi.fn()}
          menuActions={noopActions}
        />
      </I18nextProvider>,
    );

    fireEvent.click(within(screen.getByTestId("feed-reaction-bar")).getByRole("button"));
    fireEvent.click(within(screen.getByTestId("feed-reaction-picker")).getAllByRole("menuitem")[1]);
    expect(onReactionChange).toHaveBeenCalledWith("love");
  });

  it("bấm lại ĐÚNG emoji đang thả ⇒ GỠ (gửi `null`), không cần nút «bỏ thích» riêng", () => {
    const onReactionChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <PostCard
          post={{ ...BASE_POST, myReaction: "like" }}
          onReactionChange={onReactionChange}
          onToggleSave={vi.fn()}
          menuActions={noopActions}
        />
      </I18nextProvider>,
    );

    fireEvent.click(within(screen.getByTestId("feed-reaction-bar")).getByRole("button"));
    fireEvent.click(within(screen.getByTestId("feed-reaction-picker")).getAllByRole("menuitem")[0]);
    expect(onReactionChange).toHaveBeenCalledWith(null);
  });

  it("nút lưu gọi `onToggleSave`", () => {
    const onToggleSave = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <PostCard
          post={BASE_POST}
          onReactionChange={vi.fn()}
          onToggleSave={onToggleSave}
          menuActions={noopActions}
        />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByTestId("post-save-toggle"));
    expect(onToggleSave).toHaveBeenCalledTimes(1);
  });

  it("bấm một mục menu ⇒ gọi hành động VÀ đóng menu (không để menu treo)", () => {
    setCaps({ "view:feed": true, "manage:feed-post": true });
    renderCard();

    fireEvent.click(screen.getByTestId("post-menu-trigger"));
    fireEvent.click(screen.getByTestId("post-menu-toggle-hidden"));

    expect(noopActions.onToggleHidden).toHaveBeenCalledTimes(1);
    // Menu phải tự đóng: một menu còn mở sau khi bấm che mất chính thẻ bài vừa đổi trạng thái.
    expect(screen.queryByTestId("post-menu")).toBeNull();
  });
});
