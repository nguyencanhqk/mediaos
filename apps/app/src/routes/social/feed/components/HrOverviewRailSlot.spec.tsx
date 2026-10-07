/**
 * S16-SOCIAL-FE-3C (L7) — `HrOverviewRailSlot`: cổng ngoài của widget DASH «Tổng quan nhân sự» ở cuối rail phải
 * của bảng tin (plan §4 hàng HR1 · D15 · D16 · bẫy B16 · B17 · owner ký O1 = B: chỉ HR + company-admin).
 *
 * Thứ file này giữ:
 *  · BỐN vế của cổng — mỗi vế một ca DENY riêng mang fixture «gần đúng»: đủ BA cặp còn lại, thiếu đúng cặp đang
 *    đo. Caps rỗng xanh với mọi cổng nên không dùng làm DENY (B17).
 *  · Khớp ĐÚNG-BẰNG: wildcard không thay được cặp đích danh nào trong bốn cặp.
 *  · DENY = không vẽ GÌ (không thẻ rỗng — B16) VÀ không có lời gọi DASH nào. Ba cạnh đó (tiêu đề · số node · số
 *    lời gọi) gom vào MỘT phép so `observe()` ⇒ ca đỏ in đủ cả ba; phép đếm làm sau CÙNG nhịp `settle()` mà ca
 *    ALLOW dùng để thấy đúng 1 lời gọi.
 *
 * THẬT: `HrOverviewWidget` · `useDashboardWidgetData` · store quyền · i18n. GIẢ: `dashboardApi` — MỌI hàm của nó
 * đi qua spy, nên «không gọi API DASH» đo trên cả `/dashboard/me` lẫn đường dữ liệu widget.
 * Quyền là chuỗi cặp engine viết tay — fixture, không phải mã sản phẩm. Chữ kỳ vọng VIẾT TAY.
 */
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardWidgetDataDto } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import {
  makeTestQueryClient,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "../social-test-doubles";
import { HrOverviewRailSlot } from "./HrOverviewRailSlot";

const { getWidgetData, otherDashCall, navigateSpy } = vi.hoisted(() => ({
  getWidgetData: vi.fn(),
  otherDashCall: vi.fn(),
  navigateSpy: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  // Nút quick action của `WidgetCard` điều hướng bằng `useNavigate` — không có router thật trong ca này.
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  const everyOtherMethod = Object.fromEntries(
    Object.keys(actual.dashboardApi).map((name) => [
      name,
      (...args: unknown[]) => otherDashCall(name, ...args),
    ]),
  );
  return {
    ...actual,
    dashboardApi: {
      ...everyOtherMethod,
      getWidgetData: (...args: unknown[]) => getWidgetData(...args),
    },
  };
});

const WIDGET_TITLE = "Tổng quan nhân sự";
const WIDGET_CODE = "HR_OVERVIEW";
const HEADCOUNT = 128;
/** Chữ của SERVER trong một phản hồi 403 — ca lỗi assert chuỗi này KHÔNG lên màn. */
const SERVER_MESSAGE = "AUTH-ERR-FORBIDDEN: thiếu quyền read:employee";

/** `GET /dashboard/widgets/hr-overview` như server trả cho người đọc được hồ sơ toàn công ty. */
const HR_OVERVIEW: DashboardWidgetDataDto = {
  widget_code: WIDGET_CODE,
  widget_type: "Summary",
  status: "Active",
  data: {
    summary: { headcount: HEADCOUNT },
    byStatus: { Active: 120, Probation: 8 },
    byOrgUnit: { "Phòng Kỹ thuật": 60, "Phòng Kinh doanh": 68 },
  },
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-10-07T02:00:00.000Z",
  cache: { hit: false, ttl_seconds: 900, expires_at: "2026-10-07T02:15:00.000Z" },
  quick_actions: [
    {
      action_code: "OPEN_HR_DIRECTORY",
      label: "Danh bạ nhân sự",
      target_module: "HR",
      method: "NAVIGATE",
      target_url: "/hr/employees",
      api_endpoint: null,
      enabled: true,
      disabled_reason: null,
    },
  ],
};

/** ĐỦ bốn cặp của cổng — trong bốn vai chuẩn chỉ HR và company-admin giữ cả bốn. */
const FOUR_PAIRS: Record<string, boolean> = {
  "view:feed": true,
  "read:dashboard": true,
  "read:employee": true,
  "update:employee": true,
};

/** Bộ quyền của nhân viên / quản lý: đọc được bảng tin, dashboard và hồ sơ, KHÔNG sửa được hồ sơ. */
const WITHOUT_HR_WRITE: Record<string, boolean> = {
  "view:feed": true,
  "read:dashboard": true,
  "read:employee": true,
};

const BEAT_MS = 20;

/**
 * Một nhịp đủ cho `useQuery` phát request (nếu widget CÓ mount) và cho phản hồi giả về tới màn. Ca ALLOW đếm
 * đúng 1 lời gọi NGAY sau nhịp này ⇒ nhịp đủ dài; ca DENY đếm 0 sau CÙNG nhịp đó.
 */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, BEAT_MS));
  });

/** Thứ một lượt đo nhìn vào, gom thành MỘT object ⇒ ca đỏ in mọi cạnh cạnh nhau. */
const observe = (container: HTMLElement) => ({
  widgetTitle: screen.queryByRole("heading", { name: WIDGET_TITLE }) !== null,
  renderedNodes: container.childElementCount,
  widgetDataCalls: getWidgetData.mock.calls.length,
  otherDashCalls: otherDashCall.mock.calls.length,
});

const NOTHING = { widgetTitle: false, renderedNodes: 0, widgetDataCalls: 0, otherDashCalls: 0 };
const MOUNTED_ONCE = { widgetTitle: true, renderedNodes: 1, widgetDataCalls: 1, otherDashCalls: 0 };

const renderSlot = (client = makeTestQueryClient()) =>
  renderWithProviders(<HrOverviewRailSlot />, client);

beforeEach(() => {
  navigateSpy.mockReset();
  otherDashCall.mockReset();
  getWidgetData.mockReset().mockResolvedValue(HR_OVERVIEW);
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.useRealTimers();
});

describe("HR1 — cổng của ô: ĐỦ bốn cặp, khớp ĐÚNG-BẰNG", () => {
  it("ALLOW: đủ bốn cặp ⇒ ô «Tổng quan nhân sự» + đúng 1 lời gọi dữ liệu `HR_OVERVIEW`, không lời gọi DASH nào khác", async () => {
    setCaps(FOUR_PAIRS);
    const { container } = renderSlot();
    await settle();
    expect(observe(container)).toEqual(MOUNTED_ONCE);
    // Query RỖNG: không `dashboard_type` (plan D16 — FE không suy vai người xem thành loại dashboard), không `refresh`.
    expect(getWidgetData.mock.calls).toEqual([[WIDGET_CODE, {}]]);
    expect(await screen.findByText(String(HEADCOUNT))).toBeInTheDocument();
  });

  it.each<[string, Record<string, boolean>]>([
    ["DENY-1 · thiếu `update:employee` (bộ quyền của nhân viên / quản lý)", WITHOUT_HR_WRITE],
    ["DENY-2 · chỉ có `*:*`", { "*:*": true }],
    [
      "DENY-2b · mọi dạng wildcard, không cặp đích danh nào",
      {
        "*:*": true,
        "view:*": true,
        "read:*": true,
        "update:*": true,
        "*:feed": true,
        "*:dashboard": true,
        "*:employee": true,
      },
    ],
    [
      "DENY-3 · thiếu `read:dashboard`",
      { "view:feed": true, "read:employee": true, "update:employee": true },
    ],
    [
      "DENY-4 · thiếu `read:employee`",
      { "view:feed": true, "read:dashboard": true, "update:employee": true },
    ],
    [
      "DENY-5 · thiếu `view:feed`",
      { "read:dashboard": true, "read:employee": true, "update:employee": true },
    ],
  ])("%s ⇒ không vẽ gì, không lời gọi DASH nào", async (_label, caps) => {
    setCaps(caps);
    const { container } = renderSlot();
    await settle();
    expect(observe(container)).toEqual(NOTHING);
  });

  /**
   * Wildcard «gần đúng»: ba cặp còn lại ĐỦ, cặp đang đo chỉ có ở dạng wildcard. Trong file NÀY đây là hàng duy
   * nhất phân biệt được vế `read:employee` của slot với cổng trong của `HrOverviewWidget` (cổng đó nhận wildcard):
   * ở ca DENY-4 phía trên, bỏ vế ngoài thì cổng trong vẫn chặn. Vế đó còn hai ghim nữa ở ngoài file:
   * ca DENY trần của `HrOverviewRailSlot.gate.spec.tsx` (widget giả, không có cổng trong) và hàng DENY-4w của
   * `../SocialPortalShell.hr-widget.spec.tsx` (vỏ thật).
   */
  it.each<[string, Record<string, boolean>]>([
    [
      "view:feed",
      {
        "read:dashboard": true,
        "read:employee": true,
        "update:employee": true,
        "*:*": true,
        "view:*": true,
        "*:feed": true,
      },
    ],
    [
      "read:dashboard",
      {
        "view:feed": true,
        "read:employee": true,
        "update:employee": true,
        "*:*": true,
        "read:*": true,
        "*:dashboard": true,
      },
    ],
    [
      "read:employee",
      {
        "view:feed": true,
        "read:dashboard": true,
        "update:employee": true,
        "*:*": true,
        "read:*": true,
        "*:employee": true,
      },
    ],
    [
      "update:employee",
      {
        "view:feed": true,
        "read:dashboard": true,
        "read:employee": true,
        "*:*": true,
        "update:*": true,
        "*:employee": true,
      },
    ],
  ])(
    "DENY-W · đủ ba cặp còn lại, `%s` chỉ có ở dạng wildcard ⇒ không vẽ gì, không lời gọi DASH nào",
    async (_missingPair, caps) => {
      setCaps(caps);
      const { container } = renderSlot();
      await settle();
      expect(observe(container)).toEqual(NOTHING);
    },
  );

  it("ALLOW (cùng khung): đủ bốn cặp đích danh, có thêm `*:*` ⇒ ô vẫn hiện, đúng 1 lời gọi", async () => {
    setCaps({ ...FOUR_PAIRS, "*:*": true });
    const { container } = renderSlot();
    await settle();
    expect(observe(container)).toEqual(MOUNTED_ONCE);
  });

  it("quyền nạp SAU khi mount ⇒ ô tự hiện; thu `update:employee` ⇒ ô tự biến mất (không cần mount lại)", async () => {
    setCaps(WITHOUT_HR_WRITE);
    const { container } = renderSlot();
    await settle();
    expect(observe(container)).toEqual(NOTHING);

    act(() => setCaps(FOUR_PAIRS));
    await settle();
    expect(observe(container)).toEqual(MOUNTED_ONCE);

    act(() => setCaps(WITHOUT_HR_WRITE));
    await settle();
    // Ô biến mất; con số 1 là lời gọi của lượt đã được phép — không có lời gọi mới.
    expect(observe(container)).toEqual({ ...NOTHING, widgetDataCalls: 1 });
  });
});

// Năm khối SOCIAL của rail là `<section aria-label>` (`PortalWidgetBlock`); thẻ của widget DASH tự nó không khai vùng
// nào ⇒ ô từng là khối DUY NHẤT của rail vắng mặt trong danh sách vùng của trình đọc màn hình (gate TS, TSC-04). Vế
// DENY của vùng là các hàng DENY phía trên (`renderedNodes: 0` — không có khung nào, kể cả khung vùng rỗng).
describe("vùng có nhãn — ô đứng trong rail như năm khối SOCIAL", () => {
  it("ALLOW: slot vẽ đúng MỘT vùng (`region`) mang tên tiêu đề của widget; vùng là node duy nhất và chứa tiêu đề + số liệu", async () => {
    setCaps(FOUR_PAIRS);
    const { container } = renderSlot();
    await settle();

    const regionNames = screen.queryAllByRole("region").map((el) => el.getAttribute("aria-label"));
    expect(regionNames).toEqual([WIDGET_TITLE]);
    const region = screen.getByRole("region", { name: WIDGET_TITLE });
    expect(container.firstElementChild).toBe(region);
    expect(within(region).getByRole("heading", { name: WIDGET_TITLE })).toBeInTheDocument();
    expect(within(region).getByText(String(HEADCOUNT))).toBeInTheDocument();
  });
});

describe("số request khi đi lại giữa các trang của cụm bảng tin (vỏ mount lại ô ở mỗi route)", () => {
  it("mount lại trên CÙNG QueryClient: vài giây sau ⇒ dùng số liệu đã có, không gọi thêm; rất lâu sau ⇒ thêm đúng 1 lời gọi", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T02:00:00.000Z"));
    setCaps(FOUR_PAIRS);
    const client = makeTestQueryClient();

    const first = renderSlot(client);
    await settle();
    expect(getWidgetData).toHaveBeenCalledTimes(1);
    first.unmount();

    vi.setSystemTime(new Date("2026-10-07T02:00:05.000Z"));
    const second = renderSlot(client);
    await settle();
    expect(screen.getByText(String(HEADCOUNT))).toBeInTheDocument();
    expect(getWidgetData).toHaveBeenCalledTimes(1);
    second.unmount();

    vi.setSystemTime(new Date("2026-10-07T02:10:00.000Z"));
    renderSlot(client);
    await settle();
    expect(getWidgetData).toHaveBeenCalledTimes(2);
  });
});

describe("trạng thái của ô ở rail — do widget DASH tự vẽ, slot không thêm trạng thái nào", () => {
  beforeEach(() => setCaps(FOUR_PAIRS));

  it("đang tải ⇒ tiêu đề đã có, nút «Làm mới» khoá, chưa có số liệu", async () => {
    getWidgetData.mockReturnValue(new Promise<never>(() => {}));
    renderSlot();
    await settle();
    expect(screen.getByRole("heading", { name: WIDGET_TITLE })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Làm mới" })).toBeDisabled();
    expect(screen.queryByText(String(HEADCOUNT))).toBeNull();
  });

  it("server từ chối (403) ⇒ câu lỗi chung + «Thử lại», KHÔNG in thông điệp của server; thử lại được thì số liệu hiện", async () => {
    getWidgetData.mockRejectedValueOnce(new ApiError(403, "AUTH-ERR-FORBIDDEN", SERVER_MESSAGE));
    renderSlot();
    expect(await screen.findByText("Không thể tải dữ liệu")).toBeInTheDocument();
    expect(screen.queryByText(SERVER_MESSAGE, { exact: false })).toBeNull();
    expect(screen.queryByText(String(HEADCOUNT))).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(String(HEADCOUNT))).toBeInTheDocument();
    expect(getWidgetData).toHaveBeenLastCalledWith(
      WIDGET_CODE,
      expect.objectContaining({ refresh: true }),
    );
  });

  it("phạm vi không có nhân sự ⇒ câu rỗng do server gửi, không có số liệu", async () => {
    getWidgetData.mockResolvedValue({
      ...HR_OVERVIEW,
      status: "Empty",
      data: null,
      empty_state: { message: "Chưa có nhân sự" },
    });
    renderSlot();
    expect(await screen.findByText("Chưa có nhân sự")).toBeInTheDocument();
    expect(screen.queryByText(String(HEADCOUNT))).toBeNull();
  });

  it("lối sang module HR: quick action «Danh bạ nhân sự» do SERVER cấp ⇒ nút điều hướng tới `/hr/employees`", async () => {
    renderSlot();
    fireEvent.click(await screen.findByRole("button", { name: "Danh bạ nhân sự" }));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith({ to: "/hr/employees" });
  });
});
