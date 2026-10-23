/**
 * S16-SOCIAL-FE-3C (L7) · S4-DASH-HROVERVIEW-FE-1 — `HrOverviewRailSlot`: cổng ngoài của widget DASH «Tổng quan nhân
 * sự» ở cuối rail phải của bảng tin (plan §4 hàng HR1 · D15 · D16 · bẫy B16 · B17 · SPEC-07 §14.8: người giữ
 * `read:employee` @Department trở lên thấy ô; quản lý @Team và nhân viên @Own KHÔNG).
 *
 * Thứ file này giữ:
 *  · BỐN vế của cổng (ba cặp đúng-bằng + phạm vi `read:employee` ≥ sàn) — mỗi vế một ca DENY riêng mang fixture
 *    «gần đúng»: đủ các vế còn lại, thiếu đúng vế đang đo. Caps rỗng xanh với mọi cổng nên không dùng làm DENY (B17).
 *  · Khớp ĐÚNG-BẰNG: wildcard không thay được cặp đích danh nào, kể cả phạm vi ghi trên khoá wildcard.
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
import { ApiError, type DataScope } from "@mediaos/web-core";
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

/** Ba cặp đúng-bằng của cổng — MỌI vai chuẩn đều giữ; vế phân biệt là phạm vi của `read:employee`. */
const THREE_PAIRS: Record<string, boolean> = {
  "view:feed": true,
  "read:dashboard": true,
  "read:employee": true,
};

/** Phạm vi `read:employee` theo vai chuẩn (như `/auth/me.scopes`) — sàn của widget là Department. */
const HR_COMPANY = { "read:employee": ["Company"] } as const;
const DEPT_HEAD = { "read:employee": ["Department"] } as const;
const MANAGER_TEAM = { "read:employee": ["Team"] } as const;
const STAFF_OWN = { "read:employee": ["Own"] } as const;

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

describe("HR1 — cổng của ô: ba cặp + phạm vi `read:employee` ≥ sàn, khớp ĐÚNG-BẰNG", () => {
  it("ALLOW: ba cặp + `read:employee` @Company (HR / company-admin) ⇒ ô «Tổng quan nhân sự» + đúng 1 lời gọi dữ liệu `HR_OVERVIEW`, không lời gọi DASH nào khác", async () => {
    setCaps(THREE_PAIRS, HR_COMPANY);
    const { container } = renderSlot();
    await settle();
    expect(observe(container)).toEqual(MOUNTED_ONCE);
    // Query RỖNG: không `dashboard_type` (plan D16 — FE không suy vai người xem thành loại dashboard), không `refresh`.
    expect(getWidgetData.mock.calls).toEqual([[WIDGET_CODE, {}]]);
    expect(await screen.findByText(String(HEADCOUNT))).toBeInTheDocument();
  });

  it("ALLOW: ba cặp + `read:employee` @Department (người giữ phạm vi phòng), KHÔNG có `update:employee` ⇒ ô hiện, đúng 1 lời gọi", async () => {
    setCaps(THREE_PAIRS, DEPT_HEAD);
    const { container } = renderSlot();
    await settle();
    expect(observe(container)).toEqual(MOUNTED_ONCE);
  });

  it.each<[string, Record<string, boolean>, Record<string, readonly DataScope[]>]>([
    ["DENY-1 · quản lý: `read:employee` @Team (dưới sàn)", THREE_PAIRS, MANAGER_TEAM],
    ["DENY-1b · nhân viên: `read:employee` @Own (dưới sàn)", THREE_PAIRS, STAFF_OWN],
    [
      "DENY-1c · @Team dù CÓ `update:employee` — vế cũ không còn mở cổng",
      { ...THREE_PAIRS, "update:employee": true },
      MANAGER_TEAM,
    ],
    [
      "DENY-1d · `read:employee` chỉ @Project (phạm vi ngang, không xếp hạng)",
      THREE_PAIRS,
      { "read:employee": ["Project"] },
    ],
    ["DENY-1e · `/auth/me` không gửi phạm vi nào", THREE_PAIRS, {}],
    [
      "DENY-2 · chỉ có `*:*` (phạm vi @Company trên chính khoá đó)",
      { "*:*": true },
      { "*:*": ["Company"] },
    ],
    [
      "DENY-2b · mọi dạng wildcard, không cặp đích danh nào",
      {
        "*:*": true,
        "view:*": true,
        "read:*": true,
        "*:feed": true,
        "*:dashboard": true,
        "*:employee": true,
      },
      { "*:*": ["Company"], "read:*": ["Company"], "*:employee": ["Company"] },
    ],
    ["DENY-3 · thiếu `read:dashboard`", { "view:feed": true, "read:employee": true }, HR_COMPANY],
    [
      "DENY-4 · thiếu cặp `read:employee`",
      { "view:feed": true, "read:dashboard": true },
      HR_COMPANY,
    ],
    ["DENY-5 · thiếu `view:feed`", { "read:dashboard": true, "read:employee": true }, HR_COMPANY],
  ])("%s ⇒ không vẽ gì, không lời gọi DASH nào", async (_label, caps, scopes) => {
    setCaps(caps, scopes);
    const { container } = renderSlot();
    await settle();
    expect(observe(container)).toEqual(NOTHING);
  });

  /**
   * Wildcard «gần đúng»: các vế còn lại ĐỦ, vế đang đo chỉ có ở dạng wildcard. Trong file NÀY đây là hàng duy
   * nhất phân biệt được vế `read:employee` của slot với cổng trong của `HrOverviewWidget` (cổng đó nhận wildcard):
   * ở ca DENY-4 phía trên, bỏ vế ngoài thì cổng trong vẫn chặn. Vế đó còn hai ghim nữa ở ngoài file:
   * ca DENY trần của `HrOverviewRailSlot.gate.spec.tsx` (widget giả, không có cổng trong) và hàng DENY-4w của
   * `../SocialPortalShell.hr-widget.spec.tsx` (vỏ thật).
   */
  it.each<[string, Record<string, boolean>, Record<string, readonly DataScope[]>]>([
    [
      "view:feed",
      {
        "read:dashboard": true,
        "read:employee": true,
        "*:*": true,
        "view:*": true,
        "*:feed": true,
      },
      HR_COMPANY,
    ],
    [
      "read:dashboard",
      {
        "view:feed": true,
        "read:employee": true,
        "*:*": true,
        "read:*": true,
        "*:dashboard": true,
      },
      HR_COMPANY,
    ],
    [
      "read:employee",
      {
        "view:feed": true,
        "read:dashboard": true,
        "*:*": true,
        "read:*": true,
        "*:employee": true,
      },
      HR_COMPANY,
    ],
    [
      "phạm vi ≥ sàn (cặp đích danh chỉ @Own, @Company nằm trên khoá wildcard)",
      { ...THREE_PAIRS, "*:*": true, "read:*": true, "*:employee": true },
      {
        "read:employee": ["Own"],
        "*:*": ["Company"],
        "read:*": ["Company"],
        "*:employee": ["Company"],
      },
    ],
  ])(
    "DENY-W · đủ các vế còn lại, `%s` chỉ có ở dạng wildcard ⇒ không vẽ gì, không lời gọi DASH nào",
    async (_missingPair, caps, scopes) => {
      setCaps(caps, scopes);
      const { container } = renderSlot();
      await settle();
      expect(observe(container)).toEqual(NOTHING);
    },
  );

  it("ALLOW (cùng khung): ba cặp đích danh @Company, có thêm `*:*` ⇒ ô vẫn hiện, đúng 1 lời gọi", async () => {
    setCaps({ ...THREE_PAIRS, "*:*": true }, { ...HR_COMPANY, "*:*": ["Company"] });
    const { container } = renderSlot();
    await settle();
    expect(observe(container)).toEqual(MOUNTED_ONCE);
  });

  it("phạm vi nâng lên sàn SAU khi mount ⇒ ô tự hiện; hạ xuống dưới sàn ⇒ ô tự biến mất (không cần mount lại)", async () => {
    setCaps(THREE_PAIRS, MANAGER_TEAM);
    const { container } = renderSlot();
    await settle();
    expect(observe(container)).toEqual(NOTHING);

    act(() => setCaps(THREE_PAIRS, DEPT_HEAD));
    await settle();
    expect(observe(container)).toEqual(MOUNTED_ONCE);

    act(() => setCaps(THREE_PAIRS, MANAGER_TEAM));
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
    setCaps(THREE_PAIRS, HR_COMPANY);
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
    setCaps(THREE_PAIRS, HR_COMPANY);
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
  beforeEach(() => setCaps(THREE_PAIRS, HR_COMPANY));

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
