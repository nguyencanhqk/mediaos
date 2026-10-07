/**
 * S16-SOCIAL-FE-3C (L7 · hàng HR2 của plan §4) — ô DASH «Tổng quan nhân sự» trong VỎ THẬT của bảng tin.
 *
 * 🔴 Vì sao vỏ có ca DENY riêng, dù `components/HrOverviewRailSlot.spec.tsx` đã đo đủ bốn vế của cổng: spec đó đo
 * slot đứng RIÊNG. Vỏ bỏ slot mà mount thẳng `HrOverviewWidget` thì mọi ca ở đó vẫn xanh, còn ô chỉ còn cổng TRONG
 * của widget (`read:employee`, nhận wildcard) — nhân viên / quản lý và người chỉ cầm `*:*` thấy ô và phát một
 * request DASH mỗi lần mở bảng tin, trái chữ ký O1 = B (chỉ HR + company-admin). Lượt kiểm toán mutant của PR-C
 * (07/10/2026) đã cấy đúng mutant đó khi cấp vỏ mới chỉ có ca ALLOW: 120 file / 1970 ca vẫn xanh.
 *
 * Thứ file này giữ — chỉ vỏ THẬT đo được:
 *  · ALLOW: ô được cắm vào rail, và cắm ở CUỐI (UI-07 §34b.2).
 *  · DENY ở cấp vỏ: mỗi hàng là một bộ quyền «gần đúng» mà cổng TRONG của widget CHO QUA, nên hàng chỉ xanh khi vỏ
 *    đi qua đủ bốn vế đúng-bằng của slot. DENY = không tiêu đề ô, rail không thêm khối nào (không thẻ rỗng, không
 *    khung bọc trống), 0 lời gọi dữ liệu widget, 0 request ra khỏi tiến trình test — gom vào MỘT phép so
 *    `observe()` ⇒ ca đỏ in đủ các cạnh. Phép đếm làm sau CÙNG nhịp `settle()` mà ca ALLOW cùng khung dùng để thấy
 *    đúng 1 lời gọi.
 * Từng vế của cổng (thiếu đúng một cặp · wildcard cho từng cặp) vẫn đo ở spec của slot — đây không chép lại bảng đó.
 *
 * Tách từ `SocialPortalShell.spec.tsx` ở chính WO này (file đó đã vượt mốc 400 dòng). File gốc giữ khung ·
 * fail-LOUD · điều hướng · ô tìm kiếm · W1–W3; mọi ca ở đó chạy với `{view:feed}` hoặc caps rỗng nên ô không mount.
 *
 * THẬT: vỏ · slot · `HrOverviewWidget` · store quyền · i18n. GIẢ: router, năm lời gọi SOCIAL của rail,
 * `dashboardApi.getWidgetData`. Quyền là chuỗi cặp engine viết tay — fixture, không phải mã sản phẩm.
 *
 * 🔴 `fetch` bị thay bằng hàm luôn từ chối trong MỌI ca: gỡ mock `getWidgetData` (hoặc vỏ gọi một API chưa mock) thì
 * `apiFetch` THẬT sẽ gọi `fetch` tới địa chỉ API mặc định (`localhost:3100`) — trên máy có API đang chạy đó là một
 * request thật. Ca phải ĐỎ ở dòng đếm, không được lặng lẽ bắn request ra ngoài tiến trình test.
 */
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialPortalShell } from "./SocialPortalShell";
import { page, renderWithProviders, resetCaps, setCaps } from "./social-test-doubles";

const navigateSpy = vi.fn();
const listBirthdays = vi.fn();
const listNews = vi.fn();
const listPolls = vi.fn();
const listGroups = vi.fn();
const listKudos = vi.fn();
const getWidgetData = vi.fn();
const fetchMock = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => navigateSpy,
    useSearch: () => ({}),
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: "/feed" } }),
  };
});

vi.mock("@/layouts/workspace/sidebar-extensions", () => ({ getSidebarExtension: () => undefined }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: {
      ...actual.socialApi,
      listBirthdays: (...a: unknown[]) => listBirthdays(...a),
      listNews: (...a: unknown[]) => listNews(...a),
      listPolls: (...a: unknown[]) => listPolls(...a),
    },
    socialGroupsApi: {
      ...actual.socialGroupsApi,
      list: (...a: unknown[]) => listGroups(...a),
    },
    socialKudosApi: {
      ...actual.socialKudosApi,
      list: (...a: unknown[]) => listKudos(...a),
    },
    // S16-SOCIAL-FE-3C (L7) — ô DASH «Tổng quan nhân sự» ở cuối rail. Không mock ⇒ `apiFetch` THẬT chạy trong test.
    dashboardApi: {
      ...actual.dashboardApi,
      getWidgetData: (...a: unknown[]) => getWidgetData(...a),
    },
  };
});

const RIGHT_RAIL = "Thông tin bên phải";
const WIDGET_TITLE = "Tổng quan nhân sự";
const WIDGET_CODE = "HR_OVERVIEW";
const HEADCOUNT = 128;
/**
 * Số khối SOCIAL của rail (Sinh nhật · Tin nổi bật · Bình chọn đang mở · Vinh danh tháng này · Nhóm của tôi).
 * Thêm / bớt một widget SOCIAL ở vỏ thì sửa số này — nó là mốc để thấy ô DASH có THÊM một khối vào rail hay không.
 */
const SOCIAL_RAIL_BLOCKS = 5;

/** ĐỦ bốn cặp của cổng — trong bốn vai chuẩn chỉ HR và company-admin giữ cả bốn. */
const FOUR_PAIRS: Record<string, boolean> = {
  "view:feed": true,
  "read:dashboard": true,
  "read:employee": true,
  "update:employee": true,
};

const renderShell = () =>
  renderWithProviders(
    <SocialPortalShell moduleCode="SOCIAL">
      <p>nội dung</p>
    </SocialPortalShell>,
  );

const rightRail = (): HTMLElement => screen.getByRole("complementary", { name: RIGHT_RAIL });

const BEAT_MS = 20;

/**
 * Một nhịp đủ cho mọi `useQuery` của lượt mount phát request (ô mà CÓ mount thì lời gọi của nó phát cùng lượt với
 * năm lời gọi SOCIAL). Ca ALLOW cùng khung đếm đúng 1 lời gọi NGAY sau nhịp này ⇒ nhịp đủ dài; ca DENY đếm 0 sau
 * CÙNG nhịp đó.
 */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, BEAT_MS));
  });

/** Thứ một lượt đo nhìn vào ở cấp vỏ, gom thành MỘT object ⇒ ca đỏ in mọi cạnh cạnh nhau. */
const observe = () => ({
  // Tìm trên CẢ trang, không riêng rail: ô không được hiện ở bất cứ đâu trong vỏ.
  widgetTitle: screen.queryByRole("heading", { name: WIDGET_TITLE }) !== null,
  railBlocks: rightRail().childElementCount,
  widgetDataCalls: getWidgetData.mock.calls.length,
  requestsLeavingTheTest: fetchMock.mock.calls.length,
});

const NOTHING = {
  widgetTitle: false,
  railBlocks: SOCIAL_RAIL_BLOCKS,
  widgetDataCalls: 0,
  requestsLeavingTheTest: 0,
};
const MOUNTED_ONCE = {
  widgetTitle: true,
  railBlocks: SOCIAL_RAIL_BLOCKS + 1,
  widgetDataCalls: 1,
  requestsLeavingTheTest: 0,
};

beforeEach(() => {
  navigateSpy.mockReset();
  listBirthdays.mockReset().mockResolvedValue({ data: [] });
  listNews.mockReset().mockResolvedValue(page([]));
  listPolls.mockReset().mockResolvedValue({ data: [], page: 1, limit: 5, total: 0 });
  listGroups.mockReset().mockResolvedValue({ data: [], page: 1, limit: 5, total: 0 });
  listKudos.mockReset().mockResolvedValue({ data: [], page: 1, limit: 5, total: 0 });
  getWidgetData.mockReset().mockResolvedValue({
    widget_code: WIDGET_CODE,
    widget_type: "Summary",
    status: "Active",
    data: {
      summary: { headcount: HEADCOUNT },
      byStatus: { Active: 120, Probation: 8 },
      byOrgUnit: {},
    },
    empty_state: null,
    error_state: null,
    last_updated_at: null,
    cache: null,
    quick_actions: [],
  });
  fetchMock.mockReset().mockRejectedValue(new TypeError("mạng bị chặn trong test"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("W4 — widget DASH «Tổng quan nhân sự» (S16-SOCIAL-FE-3C L7, plan D15 · D16 · owner O1 = B)", () => {
  it("ALLOW: đủ bốn cặp ⇒ ô «Tổng quan nhân sự» là khối CUỐI của rail phải, đường dữ liệu widget (mock) được gọi đúng 1 lần", async () => {
    setCaps(FOUR_PAIRS);
    renderShell();

    const rail = rightRail();
    const title = await within(rail).findByRole("heading", { name: WIDGET_TITLE });
    expect(rail.lastElementChild).toContainElement(title);

    await waitFor(() => expect(getWidgetData).toHaveBeenCalledTimes(1));
    expect(getWidgetData.mock.calls[0]?.[0]).toBe(WIDGET_CODE);
    expect(await within(rail).findByText(String(HEADCOUNT))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("W4 — cổng của ô ở CẤP VỎ: vỏ chỉ mount ô qua slot bốn vế, không mount thẳng widget", () => {
  it.each<[string, Record<string, boolean>]>([
    ["đủ bốn cặp đích danh", FOUR_PAIRS],
    ["đủ bốn cặp đích danh, có thêm `*:*`", { ...FOUR_PAIRS, "*:*": true }],
  ])(
    "ALLOW (cùng khung với các ca DENY) · %s ⇒ sau MỘT nhịp: có ô, rail thêm đúng 1 khối, đúng 1 lời gọi dữ liệu, 0 request ra ngoài",
    async (_label, caps) => {
      setCaps(caps);
      renderShell();
      await settle();
      expect(listGroups).toHaveBeenCalled();
      expect(observe()).toEqual(MOUNTED_ONCE);
    },
  );

  /**
   * Mỗi bộ quyền dưới đây lọt qua cổng TRONG của `HrOverviewWidget` (`read:employee`, nhận wildcard) — vỏ mount
   * thẳng widget thì cả bốn hàng đều hiện ô. Hàng DENY-4w là hàng duy nhất còn đỏ khi vỏ tự dựng lại cổng mà để
   * vế `read:employee` cho widget lo (cổng trong nhận wildcard).
   */
  it.each<[string, Record<string, boolean>]>([
    [
      "DENY-1 · bộ quyền nhân viên / quản lý (thiếu `update:employee`)",
      { "view:feed": true, "read:dashboard": true, "read:employee": true },
    ],
    ["DENY-2 · `view:feed` + chỉ `*:*`", { "view:feed": true, "*:*": true }],
    [
      "DENY-3 · thiếu `read:dashboard`",
      { "view:feed": true, "read:employee": true, "update:employee": true },
    ],
    [
      "DENY-4w · đủ ba cặp còn lại, `read:employee` chỉ có ở dạng wildcard",
      {
        "view:feed": true,
        "read:dashboard": true,
        "update:employee": true,
        "*:*": true,
        "read:*": true,
        "*:employee": true,
      },
    ],
  ])(
    "%s ⇒ không có ô, rail không thêm khối nào, 0 lời gọi dữ liệu widget, 0 request ra ngoài",
    async (_label, caps) => {
      setCaps(caps);
      renderShell();
      await settle();
      // Đối chứng: trong CHÍNH nhịp này rail đã dựng và widget SOCIAL đã hỏi dữ liệu — ca không xanh vì «chưa kịp».
      expect(listGroups).toHaveBeenCalled();
      expect(observe()).toEqual(NOTHING);
    },
  );

  it("DENY-5 · thiếu `view:feed` (đủ ba cặp còn lại) ⇒ không có ô, 0 lời gọi dữ liệu widget — như năm widget SOCIAL của rail", async () => {
    setCaps({ "read:dashboard": true, "read:employee": true, "update:employee": true });
    renderShell();
    await settle();
    // Đối chứng: vỏ đang ở chế độ «không `view:feed`» — năm widget SOCIAL cũng không hỏi dữ liệu.
    expect(listGroups).not.toHaveBeenCalled();
    expect(observe()).toEqual(NOTHING);
  });
});
