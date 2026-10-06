/**
 * S16-SOCIAL-FE-3B (L4) — màn Thiết lập huy hiệu `SOC-SCREEN-012`: NHÓM CA ĐỌC — khung · ST2 (đang tải · lỗi +
 * «Thử lại» · rỗng · bộ chuyển trang) · `page` của URL tới 056. Nhóm ca GHI («Ngừng dùng» · «Bật lại» · kết
 * cục của hộp thoại · invalidate) ở `BadgeSettingsPage.actions.spec.tsx`.
 *
 * Search của route là bản GIẢ CÓ PHẢN ỨNG (`routeSearchDouble`): `navigate({ search })` làm màn vẽ lại với
 * search mới ⇒ ca lật trang đo tới tận THAM SỐ gửi 056.
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY. Màn không có cổng riêng (route gác `manage:feed-kudos` — ca G5 ở
 * `admin/admin-route-gates.spec.tsx`).
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";
import { kudosBadgeAdminPageSchema, type KudosBadgeAdminPageDto } from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../feed/social-test-doubles";
import {
  ADMIN_ERR,
  makeBadgeAdmin,
  makeBadgeAdminPage,
  routeSearchDouble,
} from "../admin/admin-test-doubles";
import { BadgeSettingsPage } from "./BadgeSettingsPage";

const listBadgesAdmin = vi.fn();
const navigateSpy = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialKudosApi: {
      ...actual.socialKudosApi,
      listBadgesAdmin: (...a: unknown[]) => listBadgesAdmin(...a),
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const doubles = await import("../admin/admin-test-doubles");
  return {
    ...actual,
    useNavigate: () => (options: { search?: unknown }) => {
      navigateSpy({ ...options, search: doubles.routeSearchDouble.navigate(options) });
    },
    useSearch: () => doubles.useRouteSearchDouble(),
  };
});

const OFF_ID = "99999999-9999-4999-8999-999999999999";
/** Cỡ trang của màn — trùng mặc định của 056. Viết tay. */
const LIMIT = 50;

const TITLE = "Thiết lập huy hiệu";
const ADD = "Thêm huy hiệu";
const TABLE = "Danh sách huy hiệu vinh danh";
const LOADING = "Đang tải danh sách huy hiệu";
const EMPTY = "Chưa có huy hiệu nào.";
const OUT_OF_RANGE = "Trang này không còn huy hiệu nào.";
const BACK_TO_FIRST = "Về trang 1";
const RETRY = "Thử lại";
const NEXT_PAGE = "Trang sau";
const PILL_OFF = "Ngừng dùng";
const PILL_ON = "Đang dùng";
const LOAD_FAILED_TEXT = "Không tải được danh sách do lỗi hệ thống hoặc kết nối. Vui lòng thử lại.";

const active = makeBadgeAdmin();
const inactive = makeBadgeAdmin({
  id: OFF_ID,
  code: "da-tat",
  name: "Tiên phong",
  isActive: false,
  position: 2,
});
const twoBadges = (): KudosBadgeAdminPageDto => makeBadgeAdminPage([active, inactive]);

const table = (): Promise<HTMLElement> => screen.findByRole("table", { name: TABLE });
const lastListArg = (): unknown => listBadgesAdmin.mock.calls.at(-1)?.[0];
const lastNavigation = (): { to?: string; search?: Record<string, unknown> } =>
  navigateSpy.mock.calls.at(-1)?.[0] ?? {};
const pending = <T,>(): Promise<T> => new Promise<T>(() => undefined);

function renderPage(search: Record<string, unknown> = {}) {
  routeSearchDouble.set(search);
  return renderWithProviders(<BadgeSettingsPage />);
}

beforeEach(() => {
  setCaps({ "view:feed": true, "manage:feed-kudos": true });
  listBadgesAdmin.mockReset();
  navigateSpy.mockReset();
  listBadgesAdmin.mockImplementation(() => Promise.resolve(twoBadges()));
});
afterEach(() => {
  cleanup();
  resetCaps();
  routeSearchDouble.reset();
});

describe("Khung của màn", () => {
  it("fixture trang 056 đúng hợp đồng (lưới cho mọi ca bên dưới)", () => {
    expect(kudosBadgeAdminPageSchema.parse(twoBadges())).toEqual(twoBadges());
  });

  it("có tiêu đề, nút «Thêm huy hiệu» và bảng; 056 nhận trang 1, 50 dòng; KHÔNG ghi gì lên URL", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: TITLE })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADD })).toBeInTheDocument();
    expect(within(await table()).getAllByTestId("badge-row")).toHaveLength(2);
    expect(listBadgesAdmin).toHaveBeenCalledTimes(1);
    expect(lastListArg()).toEqual({ page: 1, limit: LIMIT });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("vẽ CẢ huy hiệu đã tắt: hàng đó mang pill «Ngừng dùng» + nút «Bật lại»; hàng đang bật mang «Đang dùng» + nút «Ngừng dùng»", async () => {
    renderPage();
    const rows = within(await table()).getAllByTestId("badge-row");
    const [onRow, offRow] = rows as [HTMLElement, HTMLElement];

    expect(onRow).toHaveAttribute("data-active", "true");
    expect(within(onRow).getByTestId("badge-status")).toHaveTextContent(PILL_ON);
    expect(
      within(onRow).getByRole("button", { name: "Ngừng dùng huy hiệu Đồng đội" }),
    ).toBeInTheDocument();
    expect(within(onRow).queryByRole("button", { name: /^Bật lại/ })).toBeNull();

    expect(offRow).toHaveAttribute("data-active", "false");
    expect(within(offRow).getByTestId("badge-status")).toHaveTextContent(PILL_OFF);
    expect(
      within(offRow).getByRole("button", { name: "Bật lại huy hiệu Tiên phong" }),
    ).toBeInTheDocument();
    expect(within(offRow).queryByRole("button", { name: /^Ngừng dùng/ })).toBeNull();
  });
});

describe("Bảng huy hiệu không dùng lại bản cache còn «tươi»", () => {
  it("client mặc định `staleTime` 30 s (như `main.tsx`) + cache đã có trang ⇒ vào màn VẪN gọi 056", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    client.setQueryData(socialKeys.kudos.badgesAdmin({ page: 1, limit: LIMIT }), twoBadges());
    routeSearchDouble.set({});
    renderWithProviders(<BadgeSettingsPage />, client);

    // Trang trong cache vẽ ngay (chứng minh khoá seed ĐÚNG là khoá màn đọc)…
    expect(screen.getAllByTestId("badge-row")).toHaveLength(2);
    // …nhưng màn không tin nó: người khác có thể vừa tắt / sửa một huy hiệu.
    await waitFor(() => expect(listBadgesAdmin).toHaveBeenCalledTimes(1));
  });
});

describe("ST2 — trạng thái của màn", () => {
  it("đang tải lượt đầu ⇒ khung chờ CÓ TÊN, chưa có bảng, chưa có câu rỗng", () => {
    listBadgesAdmin.mockImplementation(() => pending());
    renderPage();

    expect(screen.getByRole("status", { name: LOADING })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    // Tạo huy hiệu không phụ thuộc lượt đọc.
    expect(screen.getByRole("button", { name: ADD })).toBeEnabled();
  });

  it("lỗi 500 ⇒ dải `loadFailed` với chữ của FE + «Thử lại» gọi lại 056 và bảng hiện ra", async () => {
    listBadgesAdmin.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "loadFailed");
    expect(alert).toHaveTextContent(LOAD_FAILED_TEXT);
    expect(alert).not.toHaveTextContent("boom");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();

    fireEvent.click(within(alert).getByRole("button", { name: RETRY }));

    expect(within(await table()).getAllByTestId("badge-row")).toHaveLength(2);
    expect(listBadgesAdmin).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lỗi 403 ⇒ dải `forbidden`, KHÔNG nút «Thử lại», KHÔNG hiện thông điệp của server", async () => {
    listBadgesAdmin.mockImplementation(() => Promise.reject(ADMIN_ERR.forbidden()));
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "forbidden");
    expect(within(alert).queryByRole("button", { name: RETRY })).toBeNull();
    expect(alert).not.toHaveTextContent("Forbidden resource");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("rỗng (`total = 0`) ⇒ câu «Chưa có huy hiệu nào.», không bảng, vẫn có nút «Thêm huy hiệu»", async () => {
    listBadgesAdmin.mockImplementation(() => Promise.resolve(makeBadgeAdminPage([])));
    renderPage();

    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: ADD })).toBeInTheDocument();
  });

  it("trang quá trang cuối (rỗng nhưng `total > 0`) ⇒ KHÔNG dùng câu rỗng; «Về trang 1» bỏ `page` và gọi lại trang 1", async () => {
    listBadgesAdmin.mockImplementation((query: { page: number }) =>
      Promise.resolve(
        query.page === 1
          ? makeBadgeAdminPage([active], { total: LIMIT + 10 })
          : makeBadgeAdminPage([], { page: query.page, total: LIMIT + 10 }),
      ),
    );
    renderPage({ page: 3 });

    expect(await screen.findByText(OUT_OF_RANGE)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(lastListArg()).toEqual({ page: 3, limit: LIMIT });

    fireEvent.click(screen.getByRole("button", { name: BACK_TO_FIRST }));

    expect(within(await table()).getAllByTestId("badge-row")).toHaveLength(1);
    expect(lastNavigation()).toEqual({ to: ".", search: { page: undefined } });
    expect(lastListArg()).toEqual({ page: 1, limit: LIMIT });
  });
});

describe("ST2 — bộ chuyển trang chỉ có khi `total > limit`", () => {
  it("ALLOW — `total` 120 / `limit` 50 ⇒ có bộ chuyển trang «Trang 1/3»; «Trang sau» ghi `page: 2` và 056 nhận trang 2", async () => {
    listBadgesAdmin.mockImplementation((query: { page: number }) =>
      Promise.resolve(makeBadgeAdminPage([active], { page: query.page, total: 120 })),
    );
    renderPage();
    await table();

    expect(screen.getByTestId("offset-pager")).toHaveTextContent("Trang 1/3");

    fireEvent.click(screen.getByRole("button", { name: NEXT_PAGE }));

    await waitFor(() => expect(lastListArg()).toEqual({ page: 2, limit: LIMIT }));
    expect(lastNavigation()).toEqual({ to: ".", search: { page: 2 } });
    expect(await screen.findByText("Trang 2/3")).toBeInTheDocument();
  });

  it("DENY — `total` = `limit` (đúng một trang) ⇒ KHÔNG có bộ chuyển trang", async () => {
    listBadgesAdmin.mockImplementation(() =>
      Promise.resolve(makeBadgeAdminPage([active], { total: LIMIT })),
    );
    renderPage();
    await table();

    expect(screen.queryByTestId("offset-pager")).toBeNull();
  });
});

describe("`page` của URL tới 056", () => {
  it("`?page=2` ⇒ 056 nhận `page: 2`", async () => {
    renderPage({ page: 2 });
    await table();

    expect(lastListArg()).toEqual({ page: 2, limit: LIMIT });
  });

  it.each([{ page: 1 }, { page: "x" }, { page: 2.5 }, { page: -3 }])(
    "search rác %j ⇒ 056 nhận trang 1 (không ném, không gửi tham số chắc chắn 400)",
    async (search) => {
      renderPage(search);
      await table();

      expect(lastListArg()).toEqual({ page: 1, limit: LIMIT });
    },
  );
});
