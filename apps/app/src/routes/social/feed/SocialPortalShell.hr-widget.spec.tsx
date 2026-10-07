/**
 * S16-SOCIAL-FE-3C (L7 · hàng HR2 của plan §4) — ô DASH «Tổng quan nhân sự» trong VỎ THẬT của bảng tin.
 *
 * Tách từ `SocialPortalShell.spec.tsx` ở lượt vá sau kiểm toán mutant của PR-C (finding AUD-03: file đó đã vượt
 * mốc 400 dòng) — tách THUẦN: khối W4 dời nguyên văn sang đây cùng spy `getWidgetData`, mock `dashboardApi` và hàm
 * chặn `fetch`. Khung mock (router · sidebar-extensions · năm query SOCIAL của rail) chép từ file gốc.
 *
 * Cùng họ:
 *  · `SocialPortalShell.spec.tsx` — khung · fail-LOUD · điều hướng · ô tìm kiếm · W1–W3 (các widget SOCIAL của rail);
 *  · `components/HrOverviewRailSlot.spec.tsx` — cổng bốn vế của ô, đo trên slot đứng riêng.
 */
import { screen, cleanup, waitFor, within } from "@testing-library/react";
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

beforeEach(() => {
  navigateSpy.mockReset();
  listBirthdays.mockReset().mockResolvedValue({ data: [] });
  listNews.mockReset().mockResolvedValue(page([]));
  listPolls.mockReset().mockResolvedValue({ data: [], page: 1, limit: 5, total: 0 });
  listGroups.mockReset().mockResolvedValue({ data: [], page: 1, limit: 5, total: 0 });
  listKudos.mockReset().mockResolvedValue({ data: [], page: 1, limit: 5, total: 0 });
  getWidgetData.mockReset().mockResolvedValue({
    widget_code: "HR_OVERVIEW",
    widget_type: "Summary",
    status: "Active",
    data: { summary: { headcount: 128 }, byStatus: { Active: 120, Probation: 8 }, byOrgUnit: {} },
    empty_state: null,
    error_state: null,
    last_updated_at: null,
    cache: null,
    quick_actions: [],
  });
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("W4 — widget DASH «Tổng quan nhân sự» (S16-SOCIAL-FE-3C L7, plan D15 · D16 · owner O1 = B)", () => {
  /**
   * Cổng bốn vế và các ca DENY «gần đúng» sống ở `components/HrOverviewRailSlot.spec.tsx`. Ca dưới đây giữ thứ
   * chỉ vỏ THẬT đo được: ô có được cắm vào rail không, và cắm ở CUỐI (UI-07 §34b.2). Mọi ca của
   * `SocialPortalShell.spec.tsx` chạy với `{view:feed}` hoặc caps rỗng nên ô không mount ở đó.
   *
   * 🔴 `fetch` bị thay bằng hàm luôn từ chối trong ca này: gỡ mock `getWidgetData` thì `apiFetch` THẬT sẽ gọi
   * `fetch` tới địa chỉ API mặc định (`localhost:3100`) — trên máy có API đang chạy đó là một request thật.
   * Ca phải ĐỎ ở dòng đếm lời gọi, không được lặng lẽ bắn request ra ngoài tiến trình test.
   */
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset().mockRejectedValue(new TypeError("mạng bị chặn trong test"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ALLOW: đủ bốn cặp ⇒ ô «Tổng quan nhân sự» là khối CUỐI của rail phải, đường dữ liệu widget (mock) được gọi đúng 1 lần", async () => {
    setCaps({
      "view:feed": true,
      "read:dashboard": true,
      "read:employee": true,
      "update:employee": true,
    });
    renderWithProviders(
      <SocialPortalShell moduleCode="SOCIAL">
        <p>nội dung</p>
      </SocialPortalShell>,
    );

    const rail = screen.getByRole("complementary", { name: "Thông tin bên phải" });
    const title = await within(rail).findByRole("heading", { name: "Tổng quan nhân sự" });
    expect(rail.lastElementChild).toContainElement(title);

    await waitFor(() => expect(getWidgetData).toHaveBeenCalledTimes(1));
    expect(getWidgetData.mock.calls[0]?.[0]).toBe("HR_OVERVIEW");
    expect(await within(rail).findByText("128")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
