/**
 * S16-SOCIAL-FE-1 — ca **C2 · C12 · C15 · C17** trên `SOC-SCREEN-001` Bảng tin.
 *
 * Ba thứ ca này giữ, và cả ba đều là quyết định của plan chứ không phải chi tiết hiện thực:
 *  1. **D6** — bộ lọc đọc TỪ URL, và tham số CHỈ-CỦA-FE (`q`, `wish`) KHÔNG được gửi lên API;
 *  2. **D7** — badge «N bài mới» chỉ ĐẾM; bấm mới tải lại, danh sách KHÔNG tự dài ra;
 *  3. **C12** — chế độ tìm kiếm có câu rỗng RIÊNG.
 */
import { screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS_EVENTS } from "@mediaos/contracts";
import i18n from "@/i18n";
import { FeedPage } from "./FeedPage";
import { makePost, page, renderWithProviders, resetCaps, setCaps } from "./social-test-doubles";

const listFeed = vi.fn();
const search = vi.fn();
const createPost = vi.fn();
let mockSearch: Record<string, unknown> = {};

type Handler = (payload: unknown) => void;
const wsHandlers = new Map<string, Set<Handler>>();
const fakeSocket = {
  on: (e: string, fn: Handler) => {
    if (!wsHandlers.has(e)) wsHandlers.set(e, new Set());
    wsHandlers.get(e)!.add(fn);
  },
  off: (e: string, fn: Handler) => wsHandlers.get(e)?.delete(fn),
};
const emitWs = (e: string, payload: unknown) => {
  for (const fn of wsHandlers.get(e) ?? []) fn(payload);
};

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => vi.fn(),
    useSearch: () => mockSearch,
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    getAppSocket: () => fakeSocket,
    socialApi: {
      ...actual.socialApi,
      listFeed: (...a: unknown[]) => listFeed(...a),
      search: (...a: unknown[]) => search(...a),
      createPost: (...a: unknown[]) => createPost(...a),
    },
  };
});

const WS_POST = {
  ...makePost({ id: "99999999-9999-4999-8999-999999999999" }),
  myReaction: undefined,
  savedByMe: undefined,
  isMine: undefined,
  status: undefined,
};

beforeEach(() => {
  setCaps({ "view:feed": true, "create:feed-post": true });
  mockSearch = {};
  wsHandlers.clear();
  listFeed.mockReset();
  search.mockReset();
  createPost.mockReset();
  listFeed.mockResolvedValue(page([makePost()]));
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("C2 — bảng tin với `view:feed`", () => {
  it("ALLOW: danh sách + composer cùng render", async () => {
    renderWithProviders(<FeedPage />);
    await waitFor(() => expect(screen.getByTestId("feed-post-list")).toBeInTheDocument());
    expect(screen.getByTestId("feed-composer")).toBeInTheDocument();
  });

  it("DENY: không có `create:feed-post` ⇒ composer ẨN, danh sách vẫn còn", async () => {
    setCaps({ "view:feed": true });
    renderWithProviders(<FeedPage />);
    await waitFor(() => expect(screen.getByTestId("feed-post-list")).toBeInTheDocument());
    expect(screen.queryByTestId("feed-composer")).toBeNull();
  });
});

describe("C17 — bộ lọc sống trong URL (D6)", () => {
  it("`?sort=latest&tag=x` ⇒ gọi `001` với ĐÚNG hai tham số đó", async () => {
    mockSearch = { sort: "latest", tag: "x" };
    renderWithProviders(<FeedPage />);

    await waitFor(() => expect(listFeed).toHaveBeenCalled());
    const arg = listFeed.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.sort).toBe("latest");
    expect(arg.tag).toBe("x");
  });

  it("🔴 `wish` là tham số CHỈ-CỦA-FE ⇒ KHÔNG được gửi lên API", async () => {
    /**
     * `listFeedQuerySchema` là `.strict()`. Lọt `wish` lên sẽ là **400 vô danh** cho một tính năng
     * (lời chúc sinh nhật) mà người dùng không hề nghĩ là liên quan tới bộ lọc.
     */
    mockSearch = { wish: "An Nguyễn" };
    renderWithProviders(<FeedPage />);

    await waitFor(() => expect(listFeed).toHaveBeenCalled());
    expect(listFeed.mock.calls[0][0]).not.toHaveProperty("wish");
  });

  it("`wish` điền sẵn vào composer (mở, KHÔNG tự đăng — SOC-DEC-003)", async () => {
    mockSearch = { wish: "An Nguyễn" };
    renderWithProviders(<FeedPage />);

    await waitFor(() => expect(screen.getByTestId("feed-composer")).toBeInTheDocument());
    expect(screen.getByRole("textbox")).toHaveValue(
      i18n.getFixedT("vi", "social")("birthday.wishPrefill", { name: "An Nguyễn" }),
    );
    // Không có lời gọi tạo bài nào xảy ra chỉ vì mở màn.
    expect(createPost).not.toHaveBeenCalled();
  });

  it("tham số RÁC không làm vỡ trang (rơi về mặc định)", async () => {
    mockSearch = { sort: "không-tồn-tại", limit: "abc" };
    expect(() => renderWithProviders(<FeedPage />)).not.toThrow();
    await waitFor(() => expect(listFeed).toHaveBeenCalled());
  });
});

describe("C12 — chế độ TÌM KIẾM có câu rỗng riêng", () => {
  it("`?q=` ⇒ gọi `023` thay vì `001`", async () => {
    mockSearch = { q: "nghỉ lễ" };
    search.mockResolvedValue(page([makePost()]));
    renderWithProviders(<FeedPage />);

    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(search.mock.calls[0][0]).toMatchObject({ q: "nghỉ lễ" });
    expect(listFeed).not.toHaveBeenCalled();
  });

  it("tìm không ra ⇒ câu «không tìm thấy», KHÔNG phải «chưa có bài nào»", async () => {
    mockSearch = { q: "xyz" };
    search.mockResolvedValue(page([]));
    renderWithProviders(<FeedPage />);

    const t = i18n.getFixedT("vi", "social");
    await waitFor(() => expect(screen.getByTestId("feed-empty")).toBeInTheDocument());
    expect(screen.getByTestId("feed-empty")).toHaveTextContent(t("empty.search"));
    expect(screen.getByTestId("feed-empty")).not.toHaveTextContent(t("empty.feed"));
  });

  it("đang tìm kiếm ⇒ ẩn dải bộ lọc (chúng không áp cho `023`)", async () => {
    mockSearch = { q: "xyz" };
    search.mockResolvedValue(page([]));
    renderWithProviders(<FeedPage />);
    await waitFor(() => expect(screen.getByTestId("feed-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("feed-filters")).toBeNull();
  });
});

describe("C15 — badge «N bài mới»: ĐẾM, KHÔNG chèn (D7 · SOC-DEC-010)", () => {
  it("3 sự kiện WS ⇒ badge hiện 3 VÀ độ dài danh sách KHÔNG đổi", async () => {
    renderWithProviders(<FeedPage />);
    await waitFor(() => expect(screen.getByTestId("feed-post-list")).toBeInTheDocument());
    const before = screen.getAllByTestId("post-card").length;

    act(() => {
      for (let i = 0; i < 3; i += 1) emitWs(WS_EVENTS.FEED_POST_CREATED, WS_POST);
    });

    await waitFor(() => expect(screen.getByTestId("new-posts-badge")).toBeInTheDocument());
    expect(screen.getByTestId("new-posts-badge")).toHaveTextContent("3");
    /**
     * 🔴 Vế DƯƠNG TÍNH — thứ SOC-DEC-010 thật sự cấm. Payload WS đã omit `myReaction`/`savedByMe`/
     * `isMine`/`status` và strip `url` khỏi attachment, nên một thẻ chèn từ nó sẽ thiếu ảnh và không
     * biết "tôi đã thích chưa". Assert độ dài KHÔNG đổi là cách duy nhất bắt được việc chèn lén.
     */
    expect(screen.getAllByTestId("post-card")).toHaveLength(before);
  });

  it("bấm badge ⇒ badge biến mất (đếm reset về 0)", async () => {
    renderWithProviders(<FeedPage />);
    await waitFor(() => expect(screen.getByTestId("feed-post-list")).toBeInTheDocument());

    act(() => emitWs(WS_EVENTS.FEED_POST_CREATED, WS_POST));
    await waitFor(() => expect(screen.getByTestId("new-posts-badge")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("new-posts-badge"));
    await waitFor(() => expect(screen.queryByTestId("new-posts-badge")).toBeNull());
  });
});

describe("đăng bài", () => {
  it("gửi ⇒ gọi `002` với type share + audience company", async () => {
    createPost.mockResolvedValue({ ...makePost(), droppedMentions: [] });
    renderWithProviders(<FeedPage />);

    await waitFor(() => expect(screen.getByTestId("feed-composer")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "xin chào" } });
    fireEvent.click(screen.getByTestId("composer-submit"));

    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1));
    expect(createPost.mock.calls[0][0]).toMatchObject({
      type: "share",
      audience: "company",
      body: "xin chào",
      requiresAck: false,
    });
  });
});
