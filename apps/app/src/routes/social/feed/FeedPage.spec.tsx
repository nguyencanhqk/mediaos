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
import { ApiError } from "@mediaos/web-core";
import i18n from "@/i18n";
import { FeedPage } from "./FeedPage";
import { makePost, page, renderWithProviders, resetCaps, setCaps } from "./social-test-doubles";

const listFeed = vi.fn();
const search = vi.fn();
const createPost = vi.fn();
const savePost = vi.fn();
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
      savePost: (...a: unknown[]) => savePost(...a),
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
  savePost.mockReset();
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

/** Gõ nội dung rồi bấm «Đăng» — dùng ở cả bốn ca lỗi/thành công bên dưới. */
const composeAndSend = async (draft: string): Promise<void> => {
  await waitFor(() => expect(screen.getByTestId("feed-composer")).toBeInTheDocument());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: draft } });
  fireEvent.click(screen.getByTestId("composer-submit"));
};

describe("🔴 H1 — đăng bài HỎNG phải phát ra tín hiệu, không im lặng", () => {
  const t = i18n.getFixedT("vi", "social");
  const DRAFT = "z".repeat(1500);

  it("500 ⇒ dải lỗi CHUNG hiện, và nội dung 1.500 chữ VẪN CÒN trong ô soạn", async () => {
    /**
     * App KHÔNG có hệ toast và `QueryClient` ở `main.tsx` không khai `MutationCache.onError` ⇒ một
     * mutation thiếu `onError` là hỏng IM LẶNG TUYỆT ĐỐI. Ghép với "ô soạn dọn sớm" thì người dùng
     * mất trắng bài vừa gõ mà không một ký tự nào xuất hiện trên màn hình.
     */
    createPost.mockRejectedValue(new Error("mạng rớt"));
    renderWithProviders(<FeedPage />);
    await composeAndSend(DRAFT);

    await waitFor(() => expect(screen.getByTestId("feed-action-error")).toBeInTheDocument());
    const banner = screen.getByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-kind", "post");
    expect(banner).toHaveTextContent(t("actionError.generic.post"));
    // Lời hứa của chính câu đó: «Nội dung bạn gõ vẫn còn trong ô soạn».
    expect(screen.getByRole("textbox")).toHaveValue(DRAFT);
  });

  it("403 ⇒ câu «không có quyền», KHÁC hẳn câu chung", async () => {
    // Mất quyền thì thử lại bao nhiêu lần cũng vô ích — hai tình huống đòi hai hành vi khác nhau.
    createPost.mockRejectedValue(new ApiError(403, "SOCIAL-ERR-403", "forbidden"));
    renderWithProviders(<FeedPage />);
    await composeAndSend("tin nội bộ");

    await waitFor(() => expect(screen.getByTestId("feed-action-error")).toBeInTheDocument());
    const banner = screen.getByTestId("feed-action-error");
    expect(banner).toHaveTextContent(t("actionError.forbidden.post"));
    expect(banner).not.toHaveTextContent(t("actionError.generic.post"));
  });

  it("đăng THÀNH CÔNG ⇒ ô soạn rỗng và KHÔNG có dải lỗi nào", async () => {
    createPost.mockResolvedValue({ ...makePost(), droppedMentions: [] });
    renderWithProviders(<FeedPage />);
    await composeAndSend("xin chào");

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
    expect(screen.queryByTestId("feed-action-error")).toBeNull();
  });

  it("đóng dải lỗi ⇒ nó biến mất (người dùng không bị kẹt với một vệt đỏ)", async () => {
    createPost.mockRejectedValue(new Error("mạng rớt"));
    renderWithProviders(<FeedPage />);
    await composeAndSend("xin chào");

    await waitFor(() => expect(screen.getByTestId("feed-action-error")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: t("actionError.dismiss") }));
    expect(screen.queryByTestId("feed-action-error")).toBeNull();
  });
});

describe("🔴 M7 — `droppedMentions` là THÔNG TIN, không được nuốt", () => {
  const t = i18n.getFixedT("vi", "social");

  it("201 kèm 3 mention bị bỏ ⇒ nói ra bằng một dải THÔNG TIN (không phải lỗi)", async () => {
    /**
     * Server bỏ im lặng mention người ngoài audience rồi vẫn trả 201. Nuốt con số này nghĩa là
     * người đăng tin rằng cả ba đồng nghiệp vừa nhắc đều đã được báo — trong khi không ai nhận gì.
     */
    createPost.mockResolvedValue({
      ...makePost(),
      droppedMentions: [
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555",
      ],
    });
    renderWithProviders(<FeedPage />);
    await composeAndSend("chào @a @b @c");

    await waitFor(() => expect(screen.getByTestId("dropped-mentions-notice")).toBeInTheDocument());
    const notice = screen.getByTestId("dropped-mentions-notice");
    expect(notice).toHaveTextContent(t("composer.droppedMentions", { count: 3 }));
    // 🔴 THÔNG TIN, không phải lỗi: dùng dải đỏ ở đây là nói sai rằng bài đăng hỏng.
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("feed-action-error")).toBeNull();
  });

  it("không có mention nào bị bỏ ⇒ KHÔNG hiện gì (đối chứng)", async () => {
    createPost.mockResolvedValue({ ...makePost(), droppedMentions: [] });
    renderWithProviders(<FeedPage />);
    await composeAndSend("xin chào");

    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("dropped-mentions-notice")).toBeNull();
  });
});

describe("lỗi HÀNH ĐỘNG trên bài (useFeedActions) phải hiện ở màn danh sách", () => {
  it("lưu bài hỏng ⇒ dải lỗi `save` hiện trên đầu bảng tin", async () => {
    // Không render `actionError` thì cảm xúc/lưu/kiểm duyệt/xoá hỏng đều im lặng tuyệt đối.
    savePost.mockRejectedValue(new Error("boom"));
    renderWithProviders(<FeedPage />);

    await waitFor(() => expect(screen.getByTestId("post-save-toggle")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("post-save-toggle"));

    await waitFor(() => expect(screen.getByTestId("feed-action-error")).toBeInTheDocument());
    expect(screen.getByTestId("feed-action-error")).toHaveAttribute("data-kind", "save");
    expect(screen.getByTestId("feed-action-error")).toHaveTextContent(
      i18n.getFixedT("vi", "social")("actionError.generic.save"),
    );
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
