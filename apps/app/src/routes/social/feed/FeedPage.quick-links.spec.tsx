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
});

afterEach(() => {
  cleanup();
  resetCaps();
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
