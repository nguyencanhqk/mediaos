/**
 * S16-SOCIAL-FE-3C (L6) — `FeedPage` CÓ mount «dải ô liên kết nhanh», và đặt nó NGAY TRÊN ô soạn bài
 * (UI-07 §34b.2 · plan §3 L6).
 *
 * File spec RIÊNG: `FeedPage.spec.tsx` thuộc FE-2D — không sửa (plan B15); hai spec cũ của màn chạy lại
 * nguyên trạng vì với quyền của chúng (`view:feed` · `create:feed-post` · `manage:feed-post`) dải có 0 ô ⇒
 * trả `null`. File này là nơi DUY NHẤT ghim việc màn có mount dải: gỡ dòng mount khỏi `FeedPage` thì mọi ca
 * của `QuickLinkStrip.spec.tsx` vẫn xanh.
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY.
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedPage } from "./FeedPage";
import { makePost, page, renderWithProviders, resetCaps, setCaps } from "./social-test-doubles";

const listFeed = vi.fn();
/** Thế chỗ `fetch` trong MỌI ca: luôn từ chối, và `afterEach` đòi 0 lời gọi — xem 🔴 ở `beforeEach`. */
const fetchMock = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => vi.fn(),
    useSearch: () => ({}),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    // `useFeedRealtime` chỉ cần đăng ký/gỡ listener — ca ở đây không phát sự kiện WS nào.
    getAppSocket: () => ({ on: () => undefined, off: () => undefined }),
    socialApi: {
      ...actual.socialApi,
      listFeed: (...a: unknown[]) => listFeed(...a),
    },
  };
});

const STRIP = "Liên kết nhanh";

beforeEach(() => {
  listFeed.mockReset().mockResolvedValue(page([makePost()]));
  // 🔴 Lưới chặn mạng (gate bảo mật của PR-C, SEC-02 — khuôn của `SocialPortalShell.spec.tsx`). File này dựng `FeedPage`
  // THẬT và chỉ thay `listFeed` + socket: trang hay một component con thêm một lời gọi lúc mount mà ở đây chưa mock thì
  // `apiFetch` THẬT đi tới địa chỉ API mặc định (`localhost:3100`) — trên máy có API đang chạy đó là một request thật,
  // còn ca vẫn xanh. `fetch` vì vậy luôn từ chối, và `afterEach` đòi 0 lời gọi: ca như thế ĐỎ ngay ở đây.
  fetchMock.mockReset().mockRejectedValue(new TypeError("mạng bị chặn trong test"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // Đếm TRƯỚC khi dọn; so SAU khi dọn để ca đỏ không để lại cây đang mount hay `fetch` giả cho ca kế tiếp.
  const requestsLeavingTheTest = fetchMock.mock.calls.map((call) => String(call[0]));
  cleanup();
  resetCaps();
  vi.unstubAllGlobals();
  expect(requestsLeavingTheTest).toEqual([]);
});

describe("L6 — `FeedPage` mount dải ô liên kết nhanh ngay trên ô soạn bài", () => {
  it("ALLOW: có quyền của một ô ⇒ dải hiện, đứng LIỀN TRƯỚC ô soạn bài", async () => {
    setCaps({ "view:feed": true, "create:feed-post": true, "access:goal": true });
    renderWithProviders(<FeedPage />);
    await waitFor(() => expect(screen.getByTestId("feed-post-list")).toBeInTheDocument());

    const strip = screen.getByRole("navigation", { name: STRIP });
    expect(within(strip).getByRole("link", { name: "Mục tiêu" })).toHaveAttribute("href", "/goals");
    expect(screen.getByTestId("feed-composer").previousElementSibling).toBe(strip);
  });

  it("DENY: chỉ quyền bảng tin ⇒ không có dải; ô soạn bài + danh sách vẫn vẽ như cũ", async () => {
    setCaps({ "view:feed": true, "create:feed-post": true });
    renderWithProviders(<FeedPage />);
    await waitFor(() => expect(screen.getByTestId("feed-post-list")).toBeInTheDocument());

    expect(screen.queryByRole("navigation", { name: STRIP })).toBeNull();
    expect(screen.getByTestId("feed-composer")).toBeInTheDocument();
  });
});
