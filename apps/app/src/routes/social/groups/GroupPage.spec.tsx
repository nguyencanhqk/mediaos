/**
 * S16-SOCIAL-FE-2B — trang nhóm: D1 (404 trung tính + link mời O1) · D2 (header theo vai) · P1 (tab
 * Bài viết) · H2 (đổi `$groupId` ⇒ state của nhóm cũ KHÔNG sống sang nhóm mới). Plan D8/D9 + §8.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { createFeedPostSchema } from "@mediaos/contracts";
import { socialKeys } from "@mediaos/web-core";
import i18n from "@/i18n";
import {
  GROUP_ERR,
  GROUP_ID,
  makeGroup,
  makePost,
  page,
  POST_ERR,
  resetCaps,
  setCaps,
} from "../feed/social-test-doubles";
import { GroupPage } from "./GroupPage";

const get = vi.fn();
const join = vi.fn();
const leave = vi.fn();
const listFeed = vi.fn();
const createPost = vi.fn();
const savePost = vi.fn();
const getAppSocket = vi.fn(() => null);
const navigateSpy = vi.fn();
let mockParams: Record<string, string> = { groupId: GROUP_ID };
let routeSearch: Record<string, unknown> = {};

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    getAppSocket: () => getAppSocket(),
    socialApi: {
      ...actual.socialApi,
      listFeed: (...a: unknown[]) => listFeed(...a),
      createPost: (...a: unknown[]) => createPost(...a),
      savePost: (...a: unknown[]) => savePost(...a),
    },
    socialGroupsApi: {
      ...actual.socialGroupsApi,
      get: (...a: unknown[]) => get(...a),
      join: (...a: unknown[]) => join(...a),
      leave: (...a: unknown[]) => leave(...a),
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
    useNavigate: () => navigateSpy,
    useParams: () => mockParams,
    useSearch: () => routeSearch,
  };
});

const t = i18n.getFixedT("vi", "social");
/** Nút xác nhận TRONG hộp thoại (nút mở hộp thoại ở header trùng tên). */
const confirmInDialog = (name: string): void => {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name }));
};
const OTHER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <GroupPage />
      </I18nextProvider>
    </QueryClientProvider>
  );
  const utils = render(tree());
  return { ...utils, client, rerenderPage: () => utils.rerender(tree()) };
}

beforeEach(() => {
  mockParams = { groupId: GROUP_ID };
  routeSearch = {};
  setCaps({ "view:feed": true, "create:feed-post": true });
  listFeed.mockResolvedValue(page([]));
});
afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("D1 — 404 trung tính, KHÔNG màn «không có quyền»", () => {
  it("`$groupId` không phải UUID ⇒ 404 NGAY, `get` 0 lần, không nút mời dù có invite", async () => {
    mockParams = { groupId: "abc" };
    routeSearch = { invite: true };
    renderPage();
    expect(screen.getByTestId("group-not-found")).toBeTruthy();
    expect(screen.queryByTestId("group-invite-request")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("032 trả 404 ⇒ GroupNotFound; chữ KHÔNG nhắc «quyền»/«riêng tư»; không nút mời khi thiếu invite", async () => {
    get.mockRejectedValue(GROUP_ERR.notFound());
    renderPage();
    const el = await screen.findByTestId("group-not-found");
    expect(el.textContent).not.toMatch(/quyền|riêng tư/i);
    expect(screen.queryByTestId("group-invite-request")).toBeNull();
    expect(get).toHaveBeenCalledTimes(1); // 404 KHÔNG thử lại
  });

  it("ĐỐI CHỨNG: 500 ⇒ khối lỗi + «Thử lại», KHÔNG phải 404", async () => {
    // `retry` cấp query (≤2 lần với lỗi khác 404) ⇒ phải lỗi MỌI lượt mới tới khối lỗi.
    get.mockRejectedValue(GROUP_ERR.server());
    renderPage();
    expect(await screen.findByTestId("group-error")).toBeTruthy();
    expect(screen.queryByTestId("group-not-found")).toBeNull();
    expect(get).toHaveBeenCalledTimes(3);
    get.mockResolvedValue(makeGroup());
    fireEvent.click(screen.getByRole("button", { name: t("state.retry") }));
    expect(await screen.findByTestId("group-header")).toBeTruthy();
  });

  it("invite=1 ⇒ join 0 lần khi mount; bấm ⇒ 035; 201 ⇒ «đã gửi», KHÔNG hiện tên nhóm kín trong DTO", async () => {
    routeSearch = { invite: true };
    get.mockRejectedValue(GROUP_ERR.notFound());
    join.mockResolvedValue(
      makeGroup({
        name: "TÊN BÍ MẬT",
        visibility: "private",
        myRole: "member",
        myStatus: "pending",
      }),
    );
    renderPage();
    const btn = await screen.findByTestId("group-invite-request");
    expect(join).not.toHaveBeenCalled();
    fireEvent.click(btn);
    expect(await screen.findByTestId("group-invite-sent")).toHaveTextContent(
      t("groups.notFound.inviteSent"),
    );
    expect(join).toHaveBeenCalledWith(GROUP_ID);
    expect(document.body.textContent).not.toContain("TÊN BÍ MẬT");
    // «đã gửi» SỐNG qua lượt refetch 032 (vẫn 404) mà invalidate kéo theo.
    await waitFor(() => expect(screen.getByTestId("group-invite-sent")).toBeTruthy());
  });

  it("invite: 409 ⇒ «đã là thành viên/đã gửi»; 404 ⇒ «không tìm thấy nhóm»", async () => {
    routeSearch = { invite: true };
    get.mockRejectedValue(GROUP_ERR.notFound());
    join.mockRejectedValueOnce(GROUP_ERR.exists()).mockRejectedValueOnce(GROUP_ERR.notFound());
    renderPage();
    fireEvent.click(await screen.findByTestId("group-invite-request"));
    expect(await screen.findByTestId("feed-action-error")).toHaveTextContent(
      t("actionError.reason.alreadyMember"),
    );
    fireEvent.click(screen.getByTestId("group-invite-request"));
    await waitFor(() =>
      expect(screen.getByTestId("feed-action-error")).toHaveTextContent(
        t("actionError.reason.groupGone"),
      ),
    );
  });
});

describe("D2 — header theo vai (DENY cạnh ALLOW)", () => {
  it("không hàng + public ⇒ «Tham gia», KHÔNG «Rời nhóm», KHÔNG link mời", async () => {
    get.mockResolvedValue(makeGroup());
    renderPage();
    expect(await screen.findByTestId("group-join")).toHaveTextContent(t("groups.actions.join"));
    expect(screen.queryByTestId("group-leave")).toBeNull();
    expect(screen.queryByTestId("group-copy-invite")).toBeNull();
  });

  it("pending (public) ⇒ «Huỷ yêu cầu», không «Tham gia»/«Rời nhóm»", async () => {
    get.mockResolvedValue(makeGroup({ myRole: "member", myStatus: "pending" }));
    renderPage();
    expect(await screen.findByTestId("group-cancel-request")).toBeTruthy();
    expect(screen.queryByTestId("group-join")).toBeNull();
    expect(screen.queryByTestId("group-leave")).toBeNull();
  });

  it("member ⇒ «Rời nhóm», KHÔNG link mời; owner ⇒ có link mời + nhãn vai", async () => {
    get.mockResolvedValue(makeGroup({ myRole: "member", myStatus: "active" }));
    const { unmount } = renderPage();
    expect(await screen.findByTestId("group-leave")).toBeTruthy();
    expect(screen.queryByTestId("group-copy-invite")).toBeNull();
    unmount();
    get.mockResolvedValue(makeGroup({ myRole: "owner", myStatus: "active" }));
    renderPage();
    expect(await screen.findByTestId("group-copy-invite")).toBeTruthy();
    expect(screen.getByTestId("group-header")).toHaveTextContent(t("groups.role.owner"));
  });

  it("rời nhóm: chủ nhóm cuối ⇒ 409 ERR-015 ⇒ ĐÚNG câu lý do (không khoá thô, không «thử lại»)", async () => {
    get.mockResolvedValue(makeGroup({ myRole: "owner", myStatus: "active" }));
    leave.mockRejectedValue(GROUP_ERR.lastOwner());
    renderPage();
    fireEvent.click(await screen.findByTestId("group-leave"));
    confirmInDialog(t("groups.actions.leave"));
    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-reason", "lastOwner");
    expect(banner).toHaveTextContent(t("actionError.reason.lastOwner"));
  });

  it("rời nhóm KÍN thành công ⇒ điều hướng về danh sách (replace)", async () => {
    get.mockResolvedValue(
      makeGroup({ visibility: "private", myRole: "member", myStatus: "active" }),
    );
    leave.mockResolvedValue({ left: true });
    renderPage();
    fireEvent.click(await screen.findByTestId("group-leave"));
    confirmInDialog(t("groups.actions.leave"));
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/feed/groups", replace: true }),
    );
  });

  it("rời nhóm PUBLIC ⇒ ở lại trang (không điều hướng)", async () => {
    get.mockResolvedValue(makeGroup({ myRole: "member", myStatus: "active" }));
    leave.mockResolvedValue({ left: true });
    renderPage();
    fireEvent.click(await screen.findByTestId("group-leave"));
    confirmInDialog(t("groups.actions.leave"));
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
    expect(navigateSpy).not.toHaveBeenCalledWith({ to: "/feed/groups", replace: true });
  });

  it("sao chép link mời nhóm KÍN: clipboard OK ⇒ báo đã chép, url có ?invite=1; clipboard ném ⇒ ô tự chép", async () => {
    get.mockResolvedValue(
      makeGroup({ visibility: "private", myRole: "admin", myStatus: "active" }),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { unmount } = renderPage();
    fireEvent.click(await screen.findByTestId("group-copy-invite"));
    expect(await screen.findByTestId("group-invite-copied")).toBeTruthy();
    expect(writeText.mock.calls[0]?.[0]).toMatch(
      new RegExp(`/feed/groups/${GROUP_ID}\\?invite=1$`),
    );
    unmount();

    writeText.mockRejectedValue(new Error("denied"));
    renderPage();
    fireEvent.click(await screen.findByTestId("group-copy-invite"));
    const fallback = await screen.findByTestId("group-invite-fallback");
    expect(fallback.querySelector("input")?.value).toMatch(/\?invite=1$/);
  });
});

describe("P1 — tab Bài viết", () => {
  it("thành viên active ⇒ ô soạn nhóm; payload `audience:'group'` parse được; feed gọi {groupId, sort:'latest'}", async () => {
    get.mockResolvedValue(makeGroup({ myRole: "member", myStatus: "active" }));
    createPost.mockResolvedValue({ ...makePost(), droppedMentions: [] });
    renderPage();
    await screen.findByTestId("group-posts");
    await waitFor(() => expect(listFeed).toHaveBeenCalled());
    expect(listFeed.mock.calls[0]?.[0]).toMatchObject({ groupId: GROUP_ID, sort: "latest" });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Chào nhóm" } });
    fireEvent.click(screen.getByTestId("composer-submit"));
    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1));
    const dto = createPost.mock.calls[0]?.[0];
    expect(dto).toMatchObject({ audience: "group", groupId: GROUP_ID });
    expect(createFeedPostSchema.safeParse(dto).success).toBe(true);
  });

  it("public chưa tham gia ⇒ KHÔNG ô soạn (có gợi ý) nhưng feed VẪN gọi", async () => {
    get.mockResolvedValue(makeGroup());
    renderPage();
    expect(await screen.findByTestId("group-join-to-post")).toBeTruthy();
    expect(screen.queryByTestId("composer-submit")).toBeNull();
    await waitFor(() => expect(listFeed).toHaveBeenCalled());
  });

  it("manage xem nhóm KÍN mình không thuộc ⇒ khối riêng, `listFeed` 0 lần (server trả rỗng — «chưa có bài» là câu sai)", async () => {
    setCaps({ "view:feed": true, "create:feed-post": true, "manage:feed-group": true });
    get.mockResolvedValue(makeGroup({ visibility: "private" }));
    renderPage();
    expect(await screen.findByTestId("group-manage-viewer")).toHaveTextContent(
      t("groups.page.manageViewer"),
    );
    expect(listFeed).not.toHaveBeenCalled();
    expect(screen.queryByTestId("composer-submit")).toBeNull();
  });

  it("201 có droppedMentions ⇒ thông báo; KHÔNG mở socket (không badge realtime ở trang nhóm)", async () => {
    get.mockResolvedValue(makeGroup({ myRole: "member", myStatus: "active" }));
    createPost.mockResolvedValue({ ...makePost(), droppedMentions: ["x"] });
    renderPage();
    await screen.findByTestId("group-posts");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "@ai đó" } });
    fireEvent.click(screen.getByTestId("composer-submit"));
    expect(await screen.findByTestId("dropped-mentions-notice")).toBeTruthy();
    expect(getAppSocket).not.toHaveBeenCalled();
  });

  it("đăng bài 403 (mất tư cách thành viên) ⇒ banner forbidden", async () => {
    get.mockResolvedValue(makeGroup({ myRole: "member", myStatus: "active" }));
    createPost.mockRejectedValue(GROUP_ERR.forbidden());
    renderPage();
    await screen.findByTestId("group-posts");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("composer-submit"));
    expect(await screen.findByTestId("feed-action-error")).toHaveTextContent(
      t("actionError.forbidden.post"),
    );
  });

  it("S16-SOCIAL-FEMODERRMSG-1: lưu bài nhóm đã bị xoá (404 `SOCIAL-ERR-001`) ⇒ dải nói LÝ DO + thẻ cũ rời tab", async () => {
    get.mockResolvedValue(makeGroup({ myRole: "member", myStatus: "active" }));
    listFeed.mockResolvedValueOnce(page([makePost()])).mockResolvedValue(page([]));
    savePost.mockRejectedValue(POST_ERR.gone());
    renderPage();

    fireEvent.click(await screen.findByTestId("post-save-toggle"));

    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-reason", "postGone");
    expect(banner).toHaveTextContent(t("actionError.reason.postGone"));
    expect(banner).not.toHaveTextContent(t("actionError.generic.save"));
    await waitFor(() => expect(screen.queryByTestId("post-card")).toBeNull());
  });
});

describe("Tab theo năng lực", () => {
  it("member thấy Bài viết + Thành viên, KHÔNG Yêu cầu/Cài đặt; `?tab=settings` rơi về Bài viết", async () => {
    routeSearch = { tab: "settings" };
    get.mockResolvedValue(makeGroup({ myRole: "member", myStatus: "active" }));
    renderPage();
    expect(await screen.findByTestId("group-tab-members")).toBeTruthy();
    expect(screen.queryByTestId("group-tab-requests")).toBeNull();
    expect(screen.queryByTestId("group-tab-settings")).toBeNull();
    expect(screen.getByTestId("group-posts")).toBeTruthy();
  });

  it("admin thấy đủ 4 tab; bấm tab ⇒ điều hướng giữ groupId", async () => {
    get.mockResolvedValue(makeGroup({ myRole: "admin", myStatus: "active" }));
    renderPage();
    fireEvent.click(await screen.findByTestId("group-tab-requests"));
    expect(navigateSpy).toHaveBeenCalledWith({
      to: "/feed/groups/$groupId",
      params: { groupId: GROUP_ID },
      search: { tab: "requests" },
    });
    expect(screen.getByTestId("group-tab-settings")).toBeTruthy();
  });
});

describe("🔴 H2 — đổi `$groupId` KHÔNG mang state của nhóm cũ sang", () => {
  it("nháp ô soạn của nhóm A KHÔNG còn khi sang nhóm B", async () => {
    get.mockImplementation((id: string) =>
      Promise.resolve(
        makeGroup({
          id,
          name: id === GROUP_ID ? "Nhóm A" : "Nhóm B",
          myRole: "member",
          myStatus: "active",
        }),
      ),
    );
    const { rerenderPage, client } = renderPage();
    await screen.findByText("Nhóm A");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Nháp cho nhóm A" } });
    expect(screen.getByRole("textbox")).toHaveValue("Nháp cho nhóm A");

    // B ĐÃ có trong cache (đi A → B → A trong gcTime) ⇒ không qua skeleton; chỉ `key` mới dọn state
    // (gate LIGHT TS M1: không có dòng này thì ca xanh cả khi gỡ `key`).
    client.setQueryData(
      socialKeys.groups.detail(OTHER_ID),
      makeGroup({ id: OTHER_ID, name: "Nhóm B", myRole: "member", myStatus: "active" }),
    );
    mockParams = { groupId: OTHER_ID };
    rerenderPage();
    await screen.findByText("Nhóm B");
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("form Cài đặt mang giá trị của nhóm B sau khi đổi nhóm", async () => {
    routeSearch = { tab: "settings" };
    get.mockImplementation((id: string) =>
      Promise.resolve(
        makeGroup({
          id,
          name: id === GROUP_ID ? "Nhóm A" : "Nhóm B",
          myRole: "owner",
          myStatus: "active",
        }),
      ),
    );
    const { rerenderPage, client } = renderPage();
    expect(await screen.findByTestId("group-settings-name")).toHaveValue("Nhóm A");
    fireEvent.change(screen.getByTestId("group-settings-name"), { target: { value: "Sửa dở A" } });
    client.setQueryData(
      socialKeys.groups.detail(OTHER_ID),
      makeGroup({ id: OTHER_ID, name: "Nhóm B", myRole: "owner", myStatus: "active" }),
    );
    mockParams = { groupId: OTHER_ID };
    rerenderPage();
    await waitFor(() => expect(screen.getByTestId("group-settings-name")).toHaveValue("Nhóm B"));
  });
});

describe("🔴 gate LIGHT HIGH-1 — state lời mời SỐNG qua lượt refetch `032` đang 404", () => {
  it("409 khi xin vào ⇒ banner lý do VẪN CÒN, `032` KHÔNG bị kéo lại (không nháy skeleton)", async () => {
    routeSearch = { invite: true };
    // Lượt 2 (nếu có) treo mãi ⇒ nếu code invalidate chi tiết, trang kẹt skeleton và ca đỏ.
    get.mockRejectedValueOnce(GROUP_ERR.notFound()).mockImplementation(() => new Promise(() => {}));
    join.mockRejectedValue(GROUP_ERR.exists());
    renderPage();
    fireEvent.click(await screen.findByTestId("group-invite-request"));
    expect(await screen.findByTestId("feed-action-error")).toHaveAttribute("data-reason", "alreadyMember");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("group-not-found")).toBeTruthy();
    expect(screen.getByTestId("feed-action-error")).toHaveAttribute("data-reason", "alreadyMember");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("«đã gửi» sống qua một lượt refetch `032` thật (vd invalidate từ nơi khác) — state ở GroupPageBody", async () => {
    routeSearch = { invite: true };
    // Lượt refetch trả 404 SAU 30ms: mock từ chối ngay trong microtask thì trạng thái `pending` chưa kịp
    // render và ca xanh cả khi state nằm trong `GroupNotFound` (bẫy gate LIGHT đã chỉ).
    get
      .mockRejectedValueOnce(GROUP_ERR.notFound())
      .mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(GROUP_ERR.notFound()), 30)),
      );
    join.mockResolvedValue(makeGroup({ visibility: "private", myRole: "member", myStatus: "pending" }));
    const { client } = renderPage();
    fireEvent.click(await screen.findByTestId("group-invite-request"));
    await screen.findByTestId("group-invite-sent");
    void client.invalidateQueries({ queryKey: socialKeys.groups.detail(GROUP_ID) });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    // Trong lúc chờ: trang đang ở skeleton (query không có data ⇒ status 'pending').
    await waitFor(() => expect(screen.queryByTestId("group-not-found")).toBeNull());
    expect(await screen.findByTestId("group-invite-sent")).toBeTruthy();
    expect(screen.queryByTestId("group-invite-request")).toBeNull();
  });
});

describe("🔴 gate LIGHT MEDIUM-1 — refetch nền hỏng KHÔNG thay cả trang bằng khối lỗi", () => {
  it("đã có dữ liệu + lượt kéo lại 500 ⇒ GIỮ header + nháp ô soạn, hiện cảnh báo nhỏ", async () => {
    get.mockResolvedValueOnce(makeGroup({ myRole: "member", myStatus: "active" }));
    const { client } = renderPage();
    await screen.findByTestId("group-posts");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Nháp đang gõ" } });
    get.mockRejectedValue(GROUP_ERR.server());
    await client.invalidateQueries({ queryKey: socialKeys.groups.detail(GROUP_ID) });
    expect(await screen.findByTestId("group-refresh-error")).toBeTruthy();
    expect(screen.queryByTestId("group-error")).toBeNull();
    expect(screen.getByTestId("group-header")).toBeTruthy();
    expect(screen.getByRole("textbox")).toHaveValue("Nháp đang gõ");
  });
});

describe("gate LIGHT LOW — gợi ý «Tham gia để đăng bài» CHỈ khi bấm «Tham gia» được", () => {
  it("hàng `pending` trên nhóm public (nhóm kín vừa đổi sang công khai) ⇒ KHÔNG gợi ý", async () => {
    get.mockResolvedValue(makeGroup({ myRole: "member", myStatus: "pending" }));
    renderPage();
    await screen.findByTestId("group-cancel-request");
    expect(screen.queryByTestId("group-join-to-post")).toBeNull();
  });

  it("manage rời nhóm KÍN ⇒ KHÔNG bị đẩy ra danh sách (vẫn xem được nhóm)", async () => {
    setCaps({ "view:feed": true, "create:feed-post": true, "manage:feed-group": true });
    get.mockResolvedValue(makeGroup({ visibility: "private", myRole: "member", myStatus: "active" }));
    leave.mockResolvedValue({ left: true });
    renderPage();
    fireEvent.click(await screen.findByTestId("group-leave"));
    confirmInDialog(t("groups.actions.leave"));
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
    expect(navigateSpy).not.toHaveBeenCalledWith({ to: "/feed/groups", replace: true });
  });
});
