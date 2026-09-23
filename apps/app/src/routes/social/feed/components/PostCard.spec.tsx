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
import { useAuthStore } from "@mediaos/web-core";
import type { FeedPostDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { PostCard } from "./PostCard";

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
  return render(
    <I18nextProvider i18n={i18n}>
      <PostCard
        post={{ ...BASE_POST, ...post }}
        onReactionChange={vi.fn()}
        onToggleSave={vi.fn()}
        menuActions={noopActions}
      />
    </I18nextProvider>,
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

describe("C5 — «Ghim» gác bằng `manage:feed-news`, KHÔNG phải `manage:feed-post`", () => {
  it("ALLOW: có `manage:feed-news` ⇒ MỤC «Ghim bài» CÓ trong menu", () => {
    setCaps({ "view:feed": true, "manage:feed-news": true });
    renderCard();
    expect(within(openMenu()).getByTestId("post-menu-toggle-pinned")).toBeInTheDocument();
  });

  it("DENY: có `manage:feed-post` nhưng KHÔNG có `manage:feed-news` ⇒ mục «Ghim» VẮNG", () => {
    // Đây là ca phân biệt hai cặp. `SOCIAL_MODERATION_FIELD_PAIRS` của BE ánh xạ trường `pinned` →
    // `manage:feed-news` ở TẦNG 2, trong khi decorator của route 006 chỉ là SÀN `manage:feed-post`.
    // Gate nhầm ở FE ⇒ mục hiện ra, bấm vào ăn 403.
    setCaps({ "view:feed": true, "manage:feed-post": true });
    renderCard();
    const menu = openMenu();

    expect(within(menu).queryByTestId("post-menu-toggle-pinned")).toBeNull();
    // Đối chứng: menu KHÔNG rỗng — các mục của `manage:feed-post` vẫn ở đó.
    expect(within(menu).getByTestId("post-menu-toggle-hidden")).toBeInTheDocument();
  });
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

describe("C27 — bài `type:'poll'` lọt vào dòng cuộn phải SUY BIẾN AN TOÀN (R16)", () => {
  it("`{type:'poll', body:null}` ⇒ KHÔNG ném, vẫn vẽ tác giả · thời gian · cảm xúc · bình luận", () => {
    // Từ khi BE-2B-1 (#534) merge, bài poll TẠO ĐƯỢC qua API dù composer FE-1 chỉ có 2 nút.
    expect(() => renderCard({ type: "poll", body: null })).not.toThrow();

    expect(screen.getByText("An Nguyễn")).toBeInTheDocument();
    expect(screen.getByTestId("feed-reaction-bar")).toBeInTheDocument();
    expect(screen.getByTestId("post-save-toggle")).toBeInTheDocument();
  });

  it("`body:null` ⇒ KHÔNG render khối thân, và tuyệt đối không in ra chữ «null»", () => {
    renderCard({ type: "poll", body: null });
    expect(screen.queryByTestId("post-body")).toBeNull();
    expect(screen.queryByText(/null|undefined/)).toBeNull();
  });

  it("KHÔNG mở phạm vi sang poll: không có khối bỏ phiếu / kết quả nào được vẽ", () => {
    // Vế ngược của suy biến an toàn: «chịu được bài poll» KHÔNG có nghĩa là «hiện thực poll».
    // Cụm bình chọn đầy đủ là S16-SOCIAL-FE-2 (nợ N3).
    renderCard({ type: "poll", body: null });
    const card = screen.getByTestId("post-card");
    expect(card.getAttribute("data-post-type")).toBe("poll");
    expect(within(card).queryByRole("radiogroup")).toBeNull();
    expect(within(card).queryByTestId("poll-options")).toBeNull();
  });

  it("bài `share` bình thường ⇒ thân bài CÓ render (đối chứng cho hai ca trên)", () => {
    renderCard();
    expect(screen.getByTestId("post-body")).toHaveTextContent("xin chào công ty");
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
