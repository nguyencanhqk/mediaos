/**
 * S16-SOCIAL-FESEARCHBOUNDS-1 (vá review LIGHT) — tham số mà `FeedPage` THỰC SỰ gửi lên `001`/`023`,
 * đo qua ROUTER THẬT (`createRouter` + `createMemoryHistory`), không qua `useSearch` giả.
 *
 * 🔴 Vì sao cần file này dù `feed-route-search.spec.ts` đã đo bộ lọc: TanStack Router dựng `search`
 * của một match bằng `{ ...searchCủaCha, ...đầuRaValidateSearch }` (router-core `router.ts`, nhánh
 * «Validate the search params»), và `useSearch` trả CHÍNH object đã gộp đó. Bộ lọc mà "bỏ" một khoá
 * bằng cách KHÔNG trả nó thì giá trị THÔ của URL vẫn sống trong object gộp và `FeedPage` gửi nó lên
 * nguyên xi ⇒ 400 ⇒ bảng tin ra màn LỖI — trong khi ca đo riêng đầu ra bộ lọc vẫn XANH. Chỉ một ca đi
 * qua router mới thấy được khoảng hở đó.
 *
 * Cây route ở đây là bản TỐI GIẢN của `router.tsx` nhưng dùng ĐÚNG hàm `validateFeedRouteSearch` mà
 * route `/feed` khai — nạp cả `router.tsx` (3.500+ dòng, mọi route lazy) chỉ để lấy một route là không
 * đáng. `errorComponent` in thông điệp lỗi để ca sập màn đỏ bằng CHÍNH lỗi đó, không phải hết giờ.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  FEED_SEARCH_QUERY_MAX,
  listFeedQuerySchema,
  searchFeedQuerySchema,
} from "@mediaos/contracts";
import { FeedPage } from "./FeedPage";
import { validateFeedRouteSearch } from "./lib/feed-route-search";
import { page, renderWithProviders, resetCaps, setCaps } from "./social-test-doubles";

const listFeed = vi.fn();
const search = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    // `useFeedRealtime` chỉ cần đăng ký/gỡ listener — ca ở đây không phát sự kiện WS nào.
    getAppSocket: () => ({ on: () => undefined, off: () => undefined }),
    socialApi: {
      ...actual.socialApi,
      listFeed: (...a: unknown[]) => listFeed(...a),
      search: (...a: unknown[]) => search(...a),
    },
  };
});

beforeEach(() => {
  setCaps({ "view:feed": true });
  listFeed.mockReset().mockResolvedValue(page([]));
  search.mockReset().mockResolvedValue(page([]));
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

/**
 * Dựng `/feed` với ĐÚNG `validateSearch` của app rồi mở `href` (chuỗi URL như người dùng dán). Trả
 * `history` để ca điều hướng đọc được URL THẬT mà router ghi ra.
 */
function mountFeedAt(href: string) {
  const rootRoute = createRootRoute();
  const feedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed",
    validateSearch: validateFeedRouteSearch,
    component: FeedPage,
    errorComponent: ({ error }) => <p data-testid="route-error">{error.message}</p>,
  });
  const history = createMemoryHistory({ initialEntries: [href] });
  const router = createRouter({ routeTree: rootRoute.addChildren([feedRoute]), history });
  renderWithProviders(<RouterProvider router={router} />);
  return history;
}

/**
 * Chờ tới khi màn HOẶC đã gọi API, HOẶC đã sập vào `errorComponent` — rồi khẳng định là KHÔNG sập.
 * Thông điệp đỏ khi sập là chính lỗi ném ra (vd. `search.q.trim is not a function`).
 */
async function settle(): Promise<void> {
  await waitFor(() => {
    const crashed = screen.queryByTestId("route-error") !== null;
    const called = listFeed.mock.calls.length + search.mock.calls.length > 0;
    expect(crashed || called).toBe(true);
  });
  expect(screen.queryByTestId("route-error")?.textContent).toBeUndefined();
}

/** Đối số `FeedPage` gửi lên `001` ở lượt tải đầu. */
function forwardedToList(): Record<string, unknown> {
  expect(search).not.toHaveBeenCalled();
  expect(listFeed).toHaveBeenCalledTimes(1);
  return listFeed.mock.calls[0][0] as Record<string, unknown>;
}

/** Issue của schema `.strict()` THẬT của `001` — rỗng ⇔ server không trả 400 vì tham số. */
const listIssues = (arg: Record<string, unknown>) =>
  listFeedQuerySchema.safeParse(arg).error?.issues ?? [];

/** Trần THẬT của một trường chuỗi, dò bằng chính schema hợp đồng — không chép con số vào spec. */
function probeMax(accepts: (s: string) => boolean): number {
  let n = 1;
  while (n < 10_000 && accepts("t".repeat(n + 1))) n += 1;
  return n;
}

const TAG_MAX = probeMax((s) => listFeedQuerySchema.safeParse({ tag: s }).success);
const TYPE_MAX = probeMax((s) => listFeedQuerySchema.safeParse({ type: s }).success);

describe("router THẬT — tham số `FeedPage` gửi lên `001` theo biên hợp đồng", () => {
  it("ĐỐI CHỨNG DƯƠNG: bộ lọc hợp lệ đi tới `001` nguyên vẹn (setup chuyển tiếp được giá trị)", async () => {
    mountFeedAt("/feed?sort=latest&tag=quy-che&type=news");
    await settle();
    const arg = forwardedToList();
    expect(arg).toMatchObject({ sort: "latest", tag: "quy-che", type: "news" });
    expect(listIssues(arg)).toEqual([]);
  });

  it("ĐỐI CHỨNG DƯƠNG: `tag` đệm khoảng trắng ⇒ gửi bản ĐÃ trim", async () => {
    mountFeedAt("/feed?tag=%20quy-che%20");
    await settle();
    expect(forwardedToList().tag).toBe("quy-che");
  });

  it.each([
    ["`tag` toàn khoảng trắng", "/feed?tag=%20%20%20"],
    ["`tag` vượt trần 1 ký tự", `/feed?tag=${"t".repeat(TAG_MAX + 1)}`],
    ["`type` vượt trần 1 ký tự", `/feed?type=${"x".repeat(TYPE_MAX + 1)}`],
    ["`sort` ngoài tập hợp lệ (C17)", "/feed?sort=popular"],
  ])("%s ⇒ KHÔNG lọt lên `001` (không 400, không màn LỖI)", async (_label, href) => {
    mountFeedAt(href);
    await settle();
    expect(listIssues(forwardedToList())).toEqual([]);
  });

  it("URL rác tổng hợp ⇒ khoá hỏng bị bỏ, bộ lọc HỢP LỆ đi kèm vẫn tới `001`", async () => {
    mountFeedAt("/feed?sort=latest&tag=%20");
    await settle();
    const arg = forwardedToList();
    expect(listIssues(arg)).toEqual([]);
    expect(arg.sort).toBe("latest");
    expect(arg.tag).toBeUndefined();
  });

  it("`type` ngắn nhưng ngoài enum loại bài ⇒ KHÔNG gửi (server nhận nhưng trả tập rỗng vĩnh viễn)", async () => {
    mountFeedAt("/feed?type=announcement");
    await settle();
    expect(forwardedToList().type).toBeUndefined();
  });
});

describe("router THẬT — `q` không làm sập màn và theo biên của `023`", () => {
  it("`?q=2026` (parser JSON của router ra SỐ) ⇒ màn KHÔNG sập, về chế độ bảng tin", async () => {
    mountFeedAt("/feed?q=2026");
    await settle();
    expect(listIssues(forwardedToList())).toEqual([]);
  });

  it("ĐỐI CHỨNG DƯƠNG: `q` vượt trần ⇒ `023` nhận bản cắt về trần, qua schema thật", async () => {
    mountFeedAt(`/feed?q=${"a".repeat(FEED_SEARCH_QUERY_MAX * 5)}`);
    await settle();
    expect(listFeed).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(1);
    const arg = search.mock.calls[0][0] as { q: string };
    expect(arg.q).toBe("a".repeat(FEED_SEARCH_QUERY_MAX));
    expect(searchFeedQuerySchema.safeParse({ q: arg.q }).success).toBe(true);
  });
});

describe("router THẬT — điều hướng tiếp theo KHÔNG chở rác theo", () => {
  it("đứng ở `/feed?tag=%20` bấm «Mới nhất» ⇒ URL mới chỉ còn `sort` (không thẻ rác, không chuỗi `undefined`)", async () => {
    /**
     * `setSort` dựng URL mới từ `prev` = search ĐÃ GỘP của router. Khoá bị bỏ mang giá trị `undefined`
     * và `stringifySearch` phải lược nó đi — ca này đo đúng lời khai đó ở docblock bộ lọc.
     */
    const history = mountFeedAt("/feed?tag=%20");
    await settle();
    fireEvent.click(screen.getByTestId("feed-sort-latest"));
    await waitFor(() => expect(history.location.search).toBe("?sort=latest"));
  });
});
