/**
 * S16-SOCIAL-FE-1 — ca **C11**: `SOC-SCREEN-005` Trang cá nhân + route tĩnh `/feed/profiles/me`.
 *
 * 🔴 Điều quan trọng nhất ca này giữ: nhánh `me` **KHÔNG** gọi `025` bằng một `employeeId` đoán ra.
 * `useAuthStore.user.id` là **userId**, không phải `employeeId` — đoán chúng bằng nhau cho ra một
 * danh sách RỖNG im lặng (hoặc tệ hơn: bài của người khác). Nhánh `me` vì vậy đi `001` với
 * `authorUserId`, tức hỏi bằng khoá mà FE thật sự có.
 */
import { screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ProfilePostsPage } from "./ProfilePostsPage";
import { makePost, page, renderWithProviders, resetCaps, setCaps } from "./social-test-doubles";

const listFeed = vi.fn();
const listProfilePosts = vi.fn();
let mockParams: Record<string, string> = {};

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => vi.fn(),
    useParams: () => mockParams,
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: {
      ...actual.socialApi,
      listFeed: (...a: unknown[]) => listFeed(...a),
      listProfilePosts: (...a: unknown[]) => listProfilePosts(...a),
    },
  };
});

beforeEach(() => {
  setCaps({ "view:feed": true });
  mockParams = {};
  listFeed.mockReset();
  listProfilePosts.mockReset();
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("C11 — trang cá nhân của ĐỒNG NGHIỆP (`/feed/profiles/$employeeId`)", () => {
  it("ALLOW: gọi `025` với đúng employeeId từ URL", async () => {
    mockParams = { employeeId: "22222222-2222-4222-8222-222222222222" };
    listProfilePosts.mockResolvedValue(page([makePost()]));
    renderWithProviders(<ProfilePostsPage />);

    await waitFor(() => expect(listProfilePosts).toHaveBeenCalled());
    expect(listProfilePosts.mock.calls[0][0]).toBe("22222222-2222-4222-8222-222222222222");
    expect(listFeed).not.toHaveBeenCalled();
  });

  it("tiêu đề mang TÊN người đó, KHÔNG in employeeId ra màn hình", async () => {
    // Phơi id ra giao diện là đúng thứ `feedAuthorSchema` cố ý tránh khi không trả `userId`.
    mockParams = { employeeId: "22222222-2222-4222-8222-222222222222" };
    listProfilePosts.mockResolvedValue(page([makePost()]));
    renderWithProviders(<ProfilePostsPage />);

    // ⚠️ Phải chờ DANH SÁCH, không phải chờ tiêu đề: tiêu đề render NGAY với nhãn dự phòng («Bài
    // viết của đồng nghiệp») trong lúc đang tải, nên `waitFor(getByTestId("profile-title"))` xanh
    // tức thì và ca sẽ đo đúng trạng thái loading thay vì trạng thái có dữ liệu.
    await waitFor(() => expect(screen.getByTestId("feed-post-list")).toBeInTheDocument());
    const title = screen.getByTestId("profile-title");
    expect(title).toHaveTextContent("An Nguyễn");
    expect(title.textContent).not.toContain("2222");
  });

  it("danh sách rỗng ⇒ tiêu đề chung chung, KHÔNG lộ id", async () => {
    mockParams = { employeeId: "22222222-2222-4222-8222-222222222222" };
    listProfilePosts.mockResolvedValue(page([]));
    renderWithProviders(<ProfilePostsPage />);

    const t = i18n.getFixedT("vi", "social");
    await waitFor(() => expect(screen.getByTestId("feed-empty")).toBeInTheDocument());
    expect(screen.getByTestId("profile-title")).toHaveTextContent(t("profile.titleUnknown"));
  });
});

describe("C11 — `/feed/profiles/me` (route TĨNH)", () => {
  it("🔴 nhánh `me` đi `001` với `authorUserId`, KHÔNG đoán employeeId = userId", async () => {
    listFeed.mockResolvedValue(page([makePost({ isMine: true })]));
    renderWithProviders(<ProfilePostsPage isMe />);

    await waitFor(() => expect(listFeed).toHaveBeenCalled());
    const arg = listFeed.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.authorUserId).toBe("u1");
    // Gọi `025` ở nhánh này nghĩa là ai đó đã đoán userId là employeeId — sai im lặng.
    expect(listProfilePosts).not.toHaveBeenCalled();
  });

  it("nhãn KHÁC nhánh đồng nghiệp («Bài viết của tôi»)", async () => {
    listFeed.mockResolvedValue(page([makePost({ isMine: true })]));
    renderWithProviders(<ProfilePostsPage isMe />);

    const t = i18n.getFixedT("vi", "social");
    await waitFor(() => expect(screen.getByTestId("profile-title")).toBeInTheDocument());
    expect(screen.getByTestId("profile-title")).toHaveTextContent(t("profile.titleMine"));
  });

  it("rỗng ⇒ câu rỗng của CHÍNH MÌNH, khác câu của đồng nghiệp", async () => {
    listFeed.mockResolvedValue(page([]));
    renderWithProviders(<ProfilePostsPage isMe />);

    const t = i18n.getFixedT("vi", "social");
    await waitFor(() => expect(screen.getByTestId("feed-empty")).toBeInTheDocument());
    expect(screen.getByTestId("feed-empty")).toHaveTextContent(t("empty.profileMine"));
    expect(t("empty.profileMine")).not.toBe(t("empty.profile"));
  });

  it("chưa biết mình là ai ⇒ KHÔNG gọi API (không hỏi câu thiếu khoá)", async () => {
    resetCaps();
    renderWithProviders(<ProfilePostsPage isMe />);
    await new Promise((r) => setTimeout(r, 0));
    // Một request thiếu `authorUserId` sẽ trả về bài của NGƯỜI KHÁC — tệ hơn là chờ.
    expect(listFeed).not.toHaveBeenCalled();
  });
});
