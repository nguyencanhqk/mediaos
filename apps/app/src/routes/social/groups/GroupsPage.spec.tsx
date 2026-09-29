/**
 * S16-SOCIAL-FE-2B — ca L1 (danh sách nhóm) + C1 (tạo nhóm), plan D6/D7 + §8.
 *
 * Mock `Link` THAY `$groupId` (mock trần bỏ `params`/`data-testid` ⇒ ca «có link» không đo được gì).
 * Mọi assert chạy SAU khi danh sách đã tải (chờ chữ của hàng), không trong trạng thái loading.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createFeedGroupSchema } from "@mediaos/contracts";
import { socialKeys } from "@mediaos/web-core";
import i18n from "@/i18n";
import {
  GROUP_ERR,
  GROUP_ID,
  makeGroup,
  offsetPage,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "../feed/social-test-doubles";
import { GroupsPage } from "./GroupsPage";

const list = vi.fn();
const join = vi.fn();
const leave = vi.fn();
const create = vi.fn();
const navigateSpy = vi.fn();
let routeSearch: Record<string, unknown> = {};

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialGroupsApi: {
      ...actual.socialGroupsApi,
      list: (...a: unknown[]) => list(...a),
      join: (...a: unknown[]) => join(...a),
      leave: (...a: unknown[]) => leave(...a),
      create: (...a: unknown[]) => create(...a),
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
      ...rest
    }: {
      children: ReactNode;
      to: string;
      params?: { groupId?: string };
      [k: string]: unknown;
    }) => (
      <a href={params?.groupId ? to.replace("$groupId", params.groupId) : to} data-testid={rest["data-testid"] as string}>
        {children}
      </a>
    ),
    useNavigate: () => navigateSpy,
    useSearch: () => routeSearch,
  };
});

const t = i18n.getFixedT("vi", "social");
const OTHER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

beforeEach(() => {
  routeSearch = {};
  setCaps({ "view:feed": true });
});
afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("L1 — tải · lỗi · rỗng · bộ lọc URL", () => {
  it("mặc định membership=all, page=1; không gửi `q`", async () => {
    list.mockResolvedValue(offsetPage([makeGroup()]));
    renderWithProviders(<GroupsPage />);
    await screen.findByText("Bóng đá công ty");
    expect(list.mock.calls[0]?.[0]).toEqual({ membership: "all", page: 1, limit: 20 });
  });

  it("URL ?membership=mine&q=bóng&page=2 ⇒ query mang đúng ba giá trị", async () => {
    routeSearch = { membership: "mine", q: "bóng", page: 2 };
    list.mockResolvedValue(offsetPage([makeGroup()]));
    renderWithProviders(<GroupsPage />);
    await screen.findByText("Bóng đá công ty");
    expect(list.mock.calls[0]?.[0]).toEqual({ membership: "mine", page: 2, limit: 20, q: "bóng" });
  });

  it("lỗi tải ⇒ khối lỗi + «Thử lại» gọi lại", async () => {
    list.mockRejectedValueOnce(GROUP_ERR.server()).mockResolvedValue(offsetPage([makeGroup()]));
    renderWithProviders(<GroupsPage />);
    const err = await screen.findByTestId("groups-error");
    fireEvent.click(within(err).getByRole("button", { name: t("state.retry") }));
    await screen.findByText("Bóng đá công ty");
  });

  it("BA câu rỗng khác nhau: tất cả · của tôi · tìm kiếm", async () => {
    list.mockResolvedValue(offsetPage([]));
    const texts: string[] = [];
    for (const s of [{}, { membership: "mine" }, { q: "xyz" }]) {
      routeSearch = s;
      const { unmount } = renderWithProviders(<GroupsPage />);
      texts.push((await screen.findByTestId("groups-empty")).textContent ?? "");
      unmount();
    }
    expect(new Set(texts).size).toBe(3);
    expect(texts[2]).toContain("xyz");
  });

  it("đổi tab ⇒ điều hướng với membership (bỏ page); tìm kiếm TRIM, khoảng trắng ⇒ bỏ q", async () => {
    list.mockResolvedValue(offsetPage([makeGroup()]));
    routeSearch = { page: 3 };
    renderWithProviders(<GroupsPage />);
    await screen.findByText("Bóng đá công ty");
    fireEvent.click(screen.getByTestId("groups-tab-mine"));
    expect(navigateSpy.mock.calls.at(-1)?.[0]).toEqual({ to: "/feed/groups", search: { membership: "mine" } });

    fireEvent.change(screen.getByTestId("groups-search"), { target: { value: "  đá  " } });
    fireEvent.click(screen.getByTestId("groups-search-submit"));
    expect(navigateSpy.mock.calls.at(-1)?.[0]).toEqual({ to: "/feed/groups", search: { q: "đá" } });

    fireEvent.change(screen.getByTestId("groups-search"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("groups-search-submit"));
    expect(navigateSpy.mock.calls.at(-1)?.[0]).toEqual({ to: "/feed/groups", search: {} });
  });
});

describe("L1 — hàng: link + nút theo myStatus (DENY cạnh ALLOW)", () => {
  it("ALLOW link: public · kín+active ⇒ href trang nhóm; DENY: kín+pending ⇒ KHÔNG link", async () => {
    list.mockResolvedValue(
      offsetPage([
        makeGroup(),
        makeGroup({ id: OTHER_ID, name: "Nhóm kín A", visibility: "private", myRole: "member", myStatus: "active" }),
        makeGroup({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          name: "Nhóm kín chờ",
          visibility: "private",
          myRole: "member",
          myStatus: "pending",
        }),
      ]),
    );
    renderWithProviders(<GroupsPage />);
    await screen.findByText("Nhóm kín chờ");
    expect(screen.getByTestId(`group-link-${GROUP_ID}`)).toHaveAttribute("href", `/feed/groups/${GROUP_ID}`);
    expect(screen.getByTestId(`group-link-${OTHER_ID}`)).toHaveAttribute("href", `/feed/groups/${OTHER_ID}`);
    expect(screen.queryByTestId("group-link-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).toBeNull();
    expect(screen.getByTestId("group-name-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).toHaveTextContent("Nhóm kín chờ");
  });

  it("không hàng + public ⇒ «Tham gia» gọi join; active ⇒ nhãn «Đã tham gia», không nút", async () => {
    list.mockResolvedValue(
      offsetPage([makeGroup(), makeGroup({ id: OTHER_ID, name: "Của tôi", myRole: "owner", myStatus: "active" })]),
    );
    join.mockResolvedValue(makeGroup({ myRole: "member", myStatus: "active" }));
    renderWithProviders(<GroupsPage />);
    await screen.findByText("Của tôi");
    expect(screen.getByTestId(`group-join-${GROUP_ID}`)).toHaveTextContent(t("groups.actions.join"));
    expect(screen.queryByTestId(`group-join-${OTHER_ID}`)).toBeNull();
    expect(within(screen.getByTestId(`group-row-${OTHER_ID}`)).getByText(t("groups.list.joined"))).toBeTruthy();
    fireEvent.click(screen.getByTestId(`group-join-${GROUP_ID}`));
    await waitFor(() => expect(join).toHaveBeenCalledWith(GROUP_ID));
  });

  it("pending ⇒ «Đang chờ duyệt» + «Huỷ yêu cầu» gọi leave; KHÔNG nút tham gia", async () => {
    list.mockResolvedValue(offsetPage([makeGroup({ myRole: "member", myStatus: "pending" })]));
    leave.mockResolvedValue({ left: true });
    renderWithProviders(<GroupsPage />);
    await screen.findByText(t("groups.list.pending"));
    expect(screen.queryByTestId(`group-join-${GROUP_ID}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`group-cancel-${GROUP_ID}`));
    await waitFor(() => expect(leave).toHaveBeenCalledWith(GROUP_ID));
  });

  it("manage + nhóm kín không hàng ⇒ «Gửi yêu cầu tham gia» (không phải «Tham gia»)", async () => {
    setCaps({ "view:feed": true, "manage:feed-group": true });
    list.mockResolvedValue(offsetPage([makeGroup({ visibility: "private" })]));
    renderWithProviders(<GroupsPage />);
    const btn = await screen.findByTestId(`group-join-${GROUP_ID}`);
    expect(btn).toHaveTextContent(t("groups.actions.requestJoin"));
    // manage thấy mọi nhóm qua 032 ⇒ vẫn link.
    expect(screen.getByTestId(`group-link-${GROUP_ID}`)).toBeTruthy();
  });

  it("join lỗi 409 ERR-013 ⇒ banner lý do «đã là thành viên / đã gửi yêu cầu» + kéo lại nhóm", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    list.mockResolvedValue(offsetPage([makeGroup()]));
    join.mockRejectedValue(GROUP_ERR.exists());
    renderWithProviders(<GroupsPage />);
    fireEvent.click(await screen.findByTestId(`group-join-${GROUP_ID}`));
    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveTextContent(t("actionError.reason.alreadyMember"));
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(
      JSON.stringify(socialKeys.groups.allOf()),
    );
  });

  it("join lỗi 500 ⇒ banner chung (mutant bỏ onError phải ĐỎ ca này)", async () => {
    list.mockResolvedValue(offsetPage([makeGroup()]));
    join.mockRejectedValue(GROUP_ERR.server());
    renderWithProviders(<GroupsPage />);
    fireEvent.click(await screen.findByTestId(`group-join-${GROUP_ID}`));
    expect(await screen.findByTestId("feed-action-error")).toHaveTextContent(t("actionError.generic.groupJoin"));
  });

  it("join thành công ⇒ invalidate groups + feed", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    list.mockResolvedValue(offsetPage([makeGroup()]));
    join.mockResolvedValue(makeGroup({ myRole: "member", myStatus: "active" }));
    renderWithProviders(<GroupsPage />);
    fireEvent.click(await screen.findByTestId(`group-join-${GROUP_ID}`));
    await waitFor(() => {
      const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(socialKeys.groups.allOf()));
      expect(keys).toContain(JSON.stringify(socialKeys.feed.allOf()));
    });
  });
});

describe("C1 — tạo nhóm", () => {
  it("DENY: không `create:feed-group` ⇒ nút vắng; ALLOW: có ⇒ hiện", async () => {
    list.mockResolvedValue(offsetPage([makeGroup()]));
    const { unmount } = renderWithProviders(<GroupsPage />);
    await screen.findByText("Bóng đá công ty");
    expect(screen.queryByTestId("groups-create")).toBeNull();
    unmount();
    setCaps({ "view:feed": true, "create:feed-group": true });
    renderWithProviders(<GroupsPage />);
    await screen.findByText("Bóng đá công ty");
    expect(screen.getByTestId("groups-create")).toBeTruthy();
  });

  async function openDialog(): Promise<void> {
    setCaps({ "view:feed": true, "create:feed-group": true });
    list.mockResolvedValue(offsetPage([]));
    renderWithProviders(<GroupsPage />);
    fireEvent.click(await screen.findByTestId("groups-create"));
  }

  it("tên rỗng ⇒ không gửi + lý do; payload hợp lệ parse bằng createFeedGroupSchema, mô tả rỗng BỎ khoá", async () => {
    await openDialog();
    fireEvent.click(screen.getByTestId("group-create-submit"));
    expect(await screen.findByTestId("group-create-name-error")).toHaveTextContent(t("groups.create.nameRequired"));
    expect(create).not.toHaveBeenCalled();

    create.mockResolvedValue(makeGroup({ id: OTHER_ID, myRole: "owner", myStatus: "active" }));
    fireEvent.change(screen.getByTestId("group-create-name"), { target: { value: "  Nhóm mới  " } });
    fireEvent.change(screen.getByTestId("group-create-description"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("group-create-visibility-private"));
    fireEvent.click(screen.getByTestId("group-create-submit"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const body = create.mock.calls[0]?.[0];
    expect(body).toEqual({ name: "Nhóm mới", visibility: "private" });
    expect(createFeedGroupSchema.safeParse(body).success).toBe(true);
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/feed/groups/$groupId", params: { groupId: OTHER_ID } }),
    );
  });

  it("409 tên trùng ⇒ lỗi DƯỚI ô tên, dữ liệu đã nhập VẪN CÒN, không điều hướng", async () => {
    await openDialog();
    create.mockRejectedValue(GROUP_ERR.nameTaken());
    fireEvent.change(screen.getByTestId("group-create-name"), { target: { value: "Trùng" } });
    fireEvent.change(screen.getByTestId("group-create-description"), { target: { value: "Mô tả" } });
    fireEvent.click(screen.getByTestId("group-create-submit"));
    expect(await screen.findByTestId("group-create-name-taken")).toHaveTextContent(t("actionError.reason.nameTaken"));
    expect(screen.getByTestId("group-create-name")).toHaveValue("Trùng");
    expect(screen.getByTestId("group-create-description")).toHaveValue("Mô tả");
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("500 ⇒ banner chung trong hộp thoại (không nuốt)", async () => {
    await openDialog();
    create.mockRejectedValue(GROUP_ERR.server());
    fireEvent.change(screen.getByTestId("group-create-name"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("group-create-submit"));
    expect(await screen.findByTestId("feed-action-error")).toHaveTextContent(t("actionError.generic.groupCreate"));
  });
});
