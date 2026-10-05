/**
 * S16-SOCIAL-FE-3 (L2) — tab «Bài đang ẩn» (plan D11): G4 (vế component) · UH1 · HP1–HP3 · DC1 (vế 006) ·
 * E7 · E8 (vế 001) · E9/E11 (vế 006).
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY. Quyền đặt bằng store thật (`setCaps`) TRƯỚC khi render. Chỉ mock hai
 * lời gọi (`listFeed` · `moderatePost`) và `Link` (nội suy `params` để đo được `href`).
 *
 * Đo invalidate (plan B24): khoá ĐÃ SEED không observer + `isInvalidated`, kèm khoá ĐỐI CHỨNG phải còn
 * `false`. Riêng `hiddenPosts()` đang có observer ⇒ đo bằng spy `listFeed` được gọi lại.
 */
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";
import { feedPostPageSchema, moderateFeedPostSchema } from "@mediaos/contracts";
import {
  makeTestQueryClient,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "../../feed/social-test-doubles";
import {
  ADMIN_ERR,
  AUTHOR_EMPLOYEE_ID,
  HIDDEN_POST_ID,
  makeHiddenPost,
  makeHiddenPostPage,
} from "../../admin/admin-test-doubles";
import { HiddenPostsTab } from "./HiddenPostsTab";

const listFeed = vi.fn();
const moderatePost = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: {
      ...actual.socialApi,
      listFeed: (...a: unknown[]) => listFeed(...a),
      moderatePost: (...a: unknown[]) => moderatePost(...a),
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      children,
      to,
      params,
    }: {
      children: ReactNode;
      to: string;
      params?: Record<string, string>;
    }) => {
      const href = Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      );
      return <a href={href}>{children}</a>;
    },
  };
});

const MODERATOR = { "view:feed": true, "view:feed-report": true, "manage:feed-post": true };
const NO_POST_MANAGE = { "view:feed": true, "view:feed-report": true, "manage:feed-report": true };

const SECOND_POST_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const LIMIT_NOTE = "Danh sách này không gồm bài trong nhóm và không hiển thị tổng số bài đang ẩn.";
const EMPTY = "Không có bài nào đang ẩn.";
const LOADING = "Đang tải danh sách bài đang ẩn";
const LIST = "Danh sách bài đang ẩn";
const LOAD_MORE = "Tải thêm";
const VIEW = "Xem bài";
const UNHIDE = "Hiện lại";
const UNHIDDEN = "Đã hiện lại bài viết.";
const NO_BODY = "(Bài không có nội dung chữ)";
const RETRY = "Thử lại";
const FORBIDDEN_TEXT =
  "Bạn không có quyền thực hiện thao tác này. Nếu cần, hãy liên hệ quản trị viên để được cấp quyền.";
const POST_GONE_TEXT =
  "Bài viết này không còn tồn tại nên không thể hiện lại. Danh sách đã được làm mới.";

const HIDDEN_QUERY = { status: "hidden", sort: "latest" };

const first = () => makeHiddenPost();
const second = () =>
  makeHiddenPost({
    id: SECOND_POST_ID,
    body: "Bài thứ hai đang ẩn",
    author: { employeeId: null, fullName: "Lê Văn Cường", avatarUrl: null },
  });

const pending = <T,>(): Promise<T> => new Promise<T>(() => undefined);
const list = (): Promise<HTMLElement> => screen.findByRole("list", { name: LIST });
const rowsIn = (el: HTMLElement): HTMLElement[] => within(el).getAllByRole("listitem");
const unhideButtons = (): HTMLElement[] => screen.getAllByRole("button", { name: UNHIDE });
/** Một nhịp cho react-query kịp phát lời gọi (nếu có) — dùng ở ca «0 lời gọi». */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

// Khoá ĐÃ SEED, không observer.
const KEY = {
  feedList: socialKeys.feed.list({ sort: "latest" }),
  postDetail: socialKeys.posts.detail(HIDDEN_POST_ID),
  otherPostDetail: socialKeys.posts.detail(SECOND_POST_ID),
  // Mọi bề mặt KHÁC đang vẽ bài (rail của khung portal mount tin nổi bật · bình chọn · vinh danh cạnh tab).
  newsHighlight: socialKeys.news.list({ highlight: true }),
  pollsList: socialKeys.polls.list({ page: 1 }),
  ideasList: socialKeys.ideas.list({ page: 1 }),
  kudosList: socialKeys.kudos.list({ month: "2026-10" }),
  saved: socialKeys.saved(),
  profilePosts: socialKeys.profilePosts(AUTHOR_EMPLOYEE_ID, { sort: "latest" }),
  search: socialKeys.search({ q: "tin" }),
  // Đối chứng: không phải danh sách bài.
  kudosBadges: socialKeys.kudos.badges(),
  birthdays: socialKeys.birthdays({ range: "week" }),
};
type SeededKey = keyof typeof KEY;

const OTHER_POST_SURFACES: readonly SeededKey[] = [
  "newsHighlight",
  "pollsList",
  "ideasList",
  "kudosList",
  "saved",
  "profilePosts",
  "search",
];

function renderTab(client: QueryClient = makeTestQueryClient()) {
  Object.values(KEY).forEach((key) => client.setQueryData(key, { seeded: true }));
  renderWithProviders(<HiddenPostsTab />, client);
  const invalidated = (key: SeededKey): boolean | undefined =>
    client.getQueryState(KEY[key])?.isInvalidated;
  return { client, invalidated };
}

beforeEach(() => {
  setCaps(MODERATOR);
  listFeed.mockReset();
  moderatePost.mockReset();
  listFeed.mockImplementation(() => Promise.resolve(makeHiddenPostPage([first()])));
  moderatePost.mockImplementation(() => Promise.resolve(makeHiddenPost({ status: "published" })));
});
afterEach(() => {
  cleanup();
  resetCaps();
});

describe("Khung", () => {
  it("fixture trang 001 đúng hợp đồng; bài mang `status: hidden` và avatar KHÁC rỗng", () => {
    const page = makeHiddenPostPage([first(), second()], "c1");
    expect(feedPostPageSchema.safeParse(page).success).toBe(true);
    expect(first().status).toBe("hidden");
    expect(first().author.avatarUrl).toMatch(/^https:\/\//);
    expect(first().id).not.toBe(second().id);
  });
});

describe("G4 — cổng `manage:feed-post` của lượt đọc 001", () => {
  it("ALLOW: gọi 001 đúng `{ status: hidden, sort: latest }` (không khoá nào khác) và vẽ hàng", async () => {
    renderTab();

    expect(rowsIn(await list())).toHaveLength(1);
    expect(listFeed).toHaveBeenCalledTimes(1);
    expect(listFeed.mock.calls[0]?.[0]).toStrictEqual(HIDDEN_QUERY);
  });

  it("DENY thiếu `manage:feed-post`: KHÔNG gọi 001, không vẽ hàng hay nút nào", async () => {
    setCaps(NO_POST_MANAGE);
    renderTab();
    await settle();

    expect(listFeed).not.toHaveBeenCalled();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Danh sách không dùng lại bản cache còn «tươi»", () => {
  it("client mặc định `staleTime` 30 s + cache đã có trang ⇒ vào tab VẪN gọi 001", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    client.setQueryData(socialKeys.moderation.hiddenPosts(), {
      pages: [makeHiddenPostPage([first()])],
      pageParams: [undefined],
    });
    renderTab(client);

    // Trang trong cache vẽ ngay (khoá seed ĐÚNG là khoá tab đọc)…
    expect(rowsIn(screen.getByRole("list", { name: LIST }))).toHaveLength(1);
    // …nhưng tab không tin nó.
    await waitFor(() => expect(listFeed).toHaveBeenCalledTimes(1));
  });
});

describe("Dòng bài đang ẩn", () => {
  it("vẽ tác giả · trích body CHỮ THUẦN · thời gian · «Xem bài» tới đúng bài · «Hiện lại»; không `<img>`", async () => {
    listFeed.mockImplementation(() =>
      Promise.resolve(makeHiddenPostPage([makeHiddenPost({ body: "Xin <b>chào</b> cả nhà" })])),
    );
    renderTab();
    const [row] = rowsIn(await list());
    const scope = within(row as HTMLElement);

    expect(scope.getByText("Trần Thị Bình")).toBeInTheDocument();
    expect(scope.getByText("Xin <b>chào</b> cả nhà")).toBeInTheDocument();
    expect((row as HTMLElement).querySelector("b")).toBeNull();
    const time = (row as HTMLElement).querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-10-01T02:03:04.000Z");
    expect(time?.textContent?.length).toBeGreaterThan(0);
    expect(scope.getByRole("link", { name: VIEW })).toHaveAttribute(
      "href",
      `/feed/posts/${HIDDEN_POST_ID}`,
    );
    expect(scope.getByRole("button", { name: UNHIDE })).toBeEnabled();
    // Fixture mang `avatarUrl` khác rỗng — vẫn không có ảnh (plan D8).
    expect(document.querySelector("img")).toBeNull();
  });

  it("bài không có chữ (`body: null`) ⇒ câu thay thế, vẫn có «Hiện lại»", async () => {
    listFeed.mockImplementation(() =>
      Promise.resolve(makeHiddenPostPage([makeHiddenPost({ body: null })])),
    );
    renderTab();
    const [row] = rowsIn(await list());

    expect(within(row as HTMLElement).getByText(NO_BODY)).toBeInTheDocument();
    expect(within(row as HTMLElement).getByRole("button", { name: UNHIDE })).toBeInTheDocument();
  });
});

describe("UH1 — «Hiện lại»", () => {
  it("gửi 006 cho ĐÚNG bài với ĐÚNG `{ hidden: false }` (một khoá, qua schema contracts)", async () => {
    listFeed.mockImplementation(() => Promise.resolve(makeHiddenPostPage([first(), second()])));
    renderTab();
    const rows = rowsIn(await list());

    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: UNHIDE }));

    await waitFor(() => expect(moderatePost).toHaveBeenCalledTimes(1));
    const [postId, body] = moderatePost.mock.calls[0] as [string, unknown];
    expect(postId).toBe(SECOND_POST_ID);
    expect(body).toEqual({ hidden: false });
    expect(Object.keys(body as object)).toEqual(["hidden"]);
    expect(moderateFeedPostSchema.safeParse(body).success).toBe(true);
  });

  it("thành công ⇒ hàng biến mất, có câu xác nhận, làm mới bài ẩn + dòng feed + chi tiết ĐÚNG bài đó", async () => {
    listFeed.mockImplementationOnce(() => Promise.resolve(makeHiddenPostPage([first(), second()])));
    listFeed.mockImplementation(() => Promise.resolve(makeHiddenPostPage([second()])));
    const { invalidated } = renderTab();
    const rows = rowsIn(await list());

    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: UNHIDE }));

    expect(await screen.findByText(UNHIDDEN)).toBeInTheDocument();
    await waitFor(() => expect(listFeed).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rowsIn(screen.getByRole("list", { name: LIST }))).toHaveLength(1));
    expect(screen.queryByText("Nội dung bài đang bị ẩn")).toBeNull();
    expect(screen.getByText("Bài thứ hai đang ẩn")).toBeInTheDocument();
    expect(invalidated("feedList")).toBe(true);
    expect(invalidated("postDetail")).toBe(true);
    // Bài vừa hiện lại phải xuất hiện ở MỌI bề mặt đang vẽ bài, không chỉ dòng cuộn.
    expect(OTHER_POST_SURFACES.map((key) => [key, invalidated(key)])).toEqual(
      OTHER_POST_SURFACES.map((key) => [key, true]),
    );
    // Đối chứng: không quét sạch cache.
    expect(invalidated("otherPostDetail")).toBe(false);
    expect(invalidated("kudosBadges")).toBe(false);
    expect(invalidated("birthdays")).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("DC1 — bấm đúp «Hiện lại»", () => {
  it("promise treo: bấm 2 lần ⇒ `moderatePost` 1 lần; mọi nút «Hiện lại» khoá trong lúc gửi", async () => {
    moderatePost.mockImplementation(() => pending());
    listFeed.mockImplementation(() => Promise.resolve(makeHiddenPostPage([first(), second()])));
    renderTab();
    await list();

    // Ba kích hoạt TRƯỚC khi `isPending` tới màn (react-query báo sau một nhịp): nút chưa `disabled`, chỉ cờ
    // đồng bộ trong handler chặn được — kể cả cú bấm sang hàng KHÁC.
    fireEvent.click(unhideButtons()[0] as HTMLElement);
    fireEvent.click(unhideButtons()[0] as HTMLElement);
    fireEvent.click(unhideButtons()[1] as HTMLElement);
    await waitFor(() => expect(unhideButtons()[0]).toBeDisabled());
    // …và sau khi nút đã khoá.
    fireEvent.click(unhideButtons()[0] as HTMLElement);
    fireEvent.click(unhideButtons()[1] as HTMLElement);
    await settle();

    expect(moderatePost).toHaveBeenCalledTimes(1);
    expect(moderatePost.mock.calls[0]).toEqual([HIDDEN_POST_ID, { hidden: false }]);
    expect(unhideButtons()[1]).toBeDisabled();
  });
});

describe("HP1–HP3 — trạng thái riêng của tab", () => {
  it("HP1: rỗng ⇒ câu riêng + dòng giới hạn «không gồm bài trong nhóm»; không danh sách, không «Tải thêm»", async () => {
    listFeed.mockImplementation(() => Promise.resolve(makeHiddenPostPage([])));
    renderTab();

    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
    expect(screen.getByText(LIMIT_NOTE)).toBeInTheDocument();
    expect(LIMIT_NOTE).toContain("không gồm bài trong nhóm");
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button", { name: LOAD_MORE })).toBeNull();
  });

  it("dòng giới hạn hiện cả khi ĐANG TẢI (skeleton có tên trợ năng) và khi CÓ dữ liệu", async () => {
    let release: (page: ReturnType<typeof makeHiddenPostPage>) => void = () => undefined;
    listFeed.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderTab();

    expect(await screen.findByRole("status", { name: LOADING })).toBeInTheDocument();
    expect(screen.getByText(LIMIT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).toBeNull();

    release(makeHiddenPostPage([first()]));
    expect(rowsIn(await list())).toHaveLength(1);
    expect(screen.getByText(LIMIT_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: LOADING })).toBeNull();
  });

  it("HP2: có `nextCursor` ⇒ «Tải thêm» gọi lượt 2 ĐÚNG cursor; trang cuối ⇒ hết nút", async () => {
    listFeed.mockImplementationOnce(() =>
      Promise.resolve(makeHiddenPostPage([first()], "cursor-1")),
    );
    listFeed.mockImplementationOnce(() => Promise.resolve(makeHiddenPostPage([second()], null)));
    renderTab();
    expect(rowsIn(await list())).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: LOAD_MORE }));

    await waitFor(() => expect(rowsIn(screen.getByRole("list", { name: LIST }))).toHaveLength(2));
    expect(listFeed).toHaveBeenCalledTimes(2);
    expect(listFeed.mock.calls[1]?.[0]).toStrictEqual({ ...HIDDEN_QUERY, cursor: "cursor-1" });
    expect(screen.queryByRole("button", { name: LOAD_MORE })).toBeNull();
  });

  it("HP2: trang đầu `nextCursor: null` ⇒ KHÔNG có «Tải thêm»", async () => {
    renderTab();

    expect(rowsIn(await list())).toHaveLength(1);
    expect(screen.queryByRole("button", { name: LOAD_MORE })).toBeNull();
  });

  it("HP3: lỗi khác 403 ⇒ `generic` + «Thử lại» GỌI LẠI và danh sách hiện ra", async () => {
    listFeed.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));
    renderTab();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "generic");
    expect(screen.getByText(LIMIT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).toBeNull();

    fireEvent.click(within(alert).getByRole("button", { name: RETRY }));

    expect(rowsIn(await list())).toHaveLength(1);
    expect(listFeed).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("400 của lượt đọc ⇒ `invalidRequest`, KHÔNG «Thử lại» (gửi lại nguyên yêu cầu vẫn 400)", async () => {
    listFeed.mockImplementation(() => Promise.reject(ADMIN_ERR.badRequest()));
    renderTab();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "invalidRequest");
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });
});

// App không có toast: lượt «Tải thêm» hỏng mà không vẽ gì là hỏng IM LẶNG — nút nhả ra như chưa bấm.
describe("Lượt «Tải thêm» bị từ chối", () => {
  it("500 ⇒ dải `generic` + «Thử lại» GỌI LẠI 001; danh sách và «Tải thêm» hiện lại", async () => {
    listFeed.mockImplementationOnce(() =>
      Promise.resolve(makeHiddenPostPage([first()], "cursor-1")),
    );
    listFeed.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));
    listFeed.mockImplementation(() => Promise.resolve(makeHiddenPostPage([first()], "cursor-1")));
    renderTab();
    await list();

    fireEvent.click(screen.getByRole("button", { name: LOAD_MORE }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "generic");
    expect(listFeed).toHaveBeenCalledTimes(2);
    expect(listFeed.mock.calls[1]?.[0]).toStrictEqual({ ...HIDDEN_QUERY, cursor: "cursor-1" });

    fireEvent.click(within(alert).getByRole("button", { name: RETRY }));

    expect(rowsIn(await list())).toHaveLength(1);
    expect(listFeed).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: LOAD_MORE })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("403 ⇒ dải `forbidden` bằng chữ của FE, KHÔNG «Thử lại»", async () => {
    const error = ADMIN_ERR.forbidden();
    listFeed.mockImplementationOnce(() =>
      Promise.resolve(makeHiddenPostPage([first()], "cursor-1")),
    );
    listFeed.mockImplementation(() => Promise.reject(error));
    renderTab();
    await list();

    fireEvent.click(screen.getByRole("button", { name: LOAD_MORE }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "forbidden");
    expect(alert).toHaveTextContent(FORBIDDEN_TEXT);
    expect(document.body).not.toHaveTextContent(error.message);
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(listFeed).toHaveBeenCalledTimes(2);
  });
});

describe("E8 — 001 trả 403", () => {
  it.each([
    ["mã SOCIAL (`SOCIAL-ERR-010`)", ADMIN_ERR.moderationDenied],
    ["tầng 1/2 (`AUTH-ERR-FORBIDDEN`)", ADMIN_ERR.forbidden],
  ])(
    "403 %s ⇒ `forbidden` bằng chữ của FE, KHÔNG hiện `message` server, KHÔNG «Thử lại»",
    async (_label, makeError) => {
      const error = makeError();
      listFeed.mockImplementation(() => Promise.reject(error));
      renderTab();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveAttribute("data-reason", "forbidden");
      expect(alert).toHaveTextContent(FORBIDDEN_TEXT);
      expect(error.message.length).toBeGreaterThan(0);
      expect(document.body).not.toHaveTextContent(error.message);
      expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
      expect(screen.queryByText(EMPTY)).toBeNull();
    },
  );
});

describe("Lỗi của 006 «Hiện lại»", () => {
  it("E7: 404 `SOCIAL-ERR-001` ⇒ `postGone`, làm mới danh sách bài ẩn; dải CÒN sau khi hàng biến mất", async () => {
    const error = ADMIN_ERR.postGone();
    moderatePost.mockImplementation(() => Promise.reject(error));
    listFeed.mockImplementationOnce(() => Promise.resolve(makeHiddenPostPage([first()])));
    listFeed.mockImplementation(() => Promise.resolve(makeHiddenPostPage([])));
    const { invalidated } = renderTab();
    await list();

    fireEvent.click(screen.getByRole("button", { name: UNHIDE }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "postGone");
    expect(alert).toHaveTextContent(POST_GONE_TEXT);
    expect(within(alert).queryByRole("button", { name: RETRY })).toBeNull();
    await waitFor(() => expect(listFeed).toHaveBeenCalledTimes(2));
    // Hàng đã biến mất sau refetch; dải vẫn còn vì nó sống ở tab, không ở hàng (plan B6).
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute("data-reason", "postGone");
    expect(document.body).not.toHaveTextContent(error.message);
    // Bài không được hiện lại ⇒ dòng feed, chi tiết bài và các bề mặt bài khác KHÔNG bị làm mới.
    expect(invalidated("feedList")).toBe(false);
    expect(invalidated("postDetail")).toBe(false);
    expect(OTHER_POST_SURFACES.map((key) => [key, invalidated(key)])).toEqual(
      OTHER_POST_SURFACES.map((key) => [key, false]),
    );
  });

  it("E9: 403 ⇒ `forbidden` bằng chữ của FE, KHÔNG «Thử lại», KHÔNG làm mới gì; hàng còn", async () => {
    const error = ADMIN_ERR.forbidden();
    moderatePost.mockImplementation(() => Promise.reject(error));
    const { invalidated } = renderTab();
    await list();

    fireEvent.click(screen.getByRole("button", { name: UNHIDE }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "forbidden");
    expect(alert).toHaveTextContent(FORBIDDEN_TEXT);
    expect(document.body).not.toHaveTextContent(error.message);
    expect(within(alert).queryByRole("button", { name: RETRY })).toBeNull();
    await settle();
    expect(listFeed).toHaveBeenCalledTimes(1);
    expect(invalidated("feedList")).toBe(false);
    expect(rowsIn(screen.getByRole("list", { name: LIST }))).toHaveLength(1);
    expect(screen.getByRole("button", { name: UNHIDE })).toBeEnabled();
  });

  it("E7 mà lượt tải lại HỎNG: chỉ còn MỘT dải (lỗi tải + «Thử lại»), không giữ câu «danh sách đã được làm mới»; thử lại xong thì dải `postGone` hiện lại", async () => {
    moderatePost.mockImplementation(() => Promise.reject(ADMIN_ERR.postGone()));
    listFeed.mockImplementationOnce(() => Promise.resolve(makeHiddenPostPage([first()])));
    listFeed.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));
    listFeed.mockImplementation(() => Promise.resolve(makeHiddenPostPage([])));
    renderTab();
    await list();

    fireEvent.click(screen.getByRole("button", { name: UNHIDE }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveAttribute("data-reason", "generic"),
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText(POST_GONE_TEXT)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: RETRY }));

    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
    expect(listFeed).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("alert")).toHaveTextContent(POST_GONE_TEXT);
  });

  it("400 ⇒ `invalidRequest`, KHÔNG «Thử lại», KHÔNG làm mới gì; hàng còn", async () => {
    moderatePost.mockImplementation(() => Promise.reject(ADMIN_ERR.badRequest()));
    const { invalidated } = renderTab();
    await list();

    fireEvent.click(screen.getByRole("button", { name: UNHIDE }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "invalidRequest");
    expect(within(alert).queryByRole("button", { name: RETRY })).toBeNull();
    await settle();
    expect(listFeed).toHaveBeenCalledTimes(1);
    expect(invalidated("feedList")).toBe(false);
    expect(rowsIn(screen.getByRole("list", { name: LIST }))).toHaveLength(1);
  });

  it("E11: 500 ⇒ `generic` + «Thử lại» GỬI LẠI đúng bài đó (hàng THỨ HAI, không phải bài đầu danh sách); lượt hai thành công ⇒ dải lỗi mất", async () => {
    moderatePost.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));
    listFeed.mockImplementation(() => Promise.resolve(makeHiddenPostPage([first(), second()])));
    renderTab();
    const rows = rowsIn(await list());

    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: UNHIDE }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "generic");
    expect(moderatePost.mock.calls[0]).toEqual([SECOND_POST_ID, { hidden: false }]);

    fireEvent.click(within(alert).getByRole("button", { name: RETRY }));

    await waitFor(() => expect(moderatePost).toHaveBeenCalledTimes(2));
    expect(moderatePost.mock.calls[1]).toEqual([SECOND_POST_ID, { hidden: false }]);
    expect(await screen.findByText(UNHIDDEN)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
