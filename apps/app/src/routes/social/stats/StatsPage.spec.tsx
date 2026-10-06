/**
 * S16-SOCIAL-FE-3B (L5b) — màn Thống kê tương tác `SOC-SCREEN-011`: NHÓM CA ĐỌC — khung · T1 (vế màn: mặc định
 * KHÔNG gửi `from` / `to`, nhãn khoảng của server, nút ‹ › có tên) · T3 (vế thẻ) · T4 (ô đơn vị) · T5 (rỗng ≠
 * cấm) · nút xuất. Nhóm ca LỖI + «giữ số liệu cũ lúc đang tải» ở `StatsPage.errors.spec.tsx`.
 *
 * Search của route là bản GIẢ CÓ PHẢN ỨNG (`routeSearchDouble`): `navigate({ search })` làm màn vẽ lại với
 * search mới ⇒ mỗi ca đo tới tận THAM SỐ gửi 052.
 *
 * File biểu đồ bị MOCK (plan B13: Recharts trong jsdom không có layout) — ca khói của nó ở spec riêng.
 * i18n THẬT, chữ kỳ vọng VIẾT TAY. Màn không có cổng riêng (route gác `view:feed-report` — ca G6 ở
 * `admin/admin-route-gates.spec.tsx`).
 *
 * Đồng hồ: `2026-10-04T17:30:00Z` = 00:30 thứ Hai 05/10 giờ VN ⇒ tuần hiện tại kết thúc 11/10 (plan B10). Chỉ
 * giả `Date` (không giả timer) để `waitFor` của RTL vẫn chạy.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";
import { feedEngagementResponseSchema, type FeedEngagementResponseDto } from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../feed/social-test-doubles";
import {
  DELETED_UNIT_ID,
  UNIT_ID,
  makeEngagement,
  routeSearchDouble,
} from "../admin/admin-test-doubles";
import { StatsPage } from "./StatsPage";

const engagement = vi.fn();
const exportEngagement = vi.fn();
const triggerBlobDownload = vi.fn();
const navigateSpy = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialStatsApi: {
      ...actual.socialStatsApi,
      engagement: (...a: unknown[]) => engagement(...a),
      exportEngagement: (...a: unknown[]) => exportEngagement(...a),
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

vi.mock("@/lib/download-blob", () => ({
  triggerBlobDownload: (...a: unknown[]) => triggerBlobDownload(...a),
}));

vi.mock("./components/EngagementTrendChart", () => ({
  EngagementTrendChart: ({ weekTotals }: { weekTotals: readonly unknown[] }) => (
    <div data-testid="stats-chart-double" data-weeks={weekTotals.length} />
  ),
}));

const VN_MONDAY = new Date("2026-10-04T17:30:00Z");

const TITLE = "Thống kê tương tác";
const LOADING = "Đang tải số liệu thống kê";
const EMPTY_SCOPE = "Bạn chưa có đơn vị nào trong phạm vi thống kê.";
const FILTERS = "Bộ lọc thống kê";
const UNIT = "Đơn vị";
const RESET = "Về hiện tại";
const SUMMARY = "Tổng quan trong khoảng đang xem";
const WEEK_TABLE = "Tương tác theo tuần";
const UNIT_TABLE = "Tương tác theo đơn vị";
const EXPORT = "Xuất Excel";
const MEMBERS_CARD = "Thành viên hoạt động tuần gần nhất";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const NONE = { from: undefined, to: undefined, orgUnitId: undefined };
/** Khoảng mặc định của server lúc `VN_MONDAY`: 8 tuần tới hết tuần hiện tại. */
const DEFAULT_RANGE = { from: "2026-08-17", to: "2026-10-11", weeks: 8 };

const pending = <T,>(): Promise<T> => new Promise<T>(() => undefined);
const lastArg = (): unknown => engagement.mock.calls.at(-1)?.[0];
const lastNavigation = (): { to?: string; search?: Record<string, unknown> } =>
  navigateSpy.mock.calls.at(-1)?.[0] ?? {};

const filters = (): Promise<HTMLElement> => screen.findByRole("group", { name: FILTERS });
const unitSelect = async (): Promise<HTMLSelectElement> =>
  within(await filters()).getByRole("combobox", { name: UNIT });
const weekTable = (): Promise<HTMLElement> => screen.findByRole("table", { name: WEEK_TABLE });
const exportButton = (): HTMLButtonElement => screen.getByRole("button", { name: EXPORT });
const card = (metric: string): HTMLElement => {
  const found = within(screen.getByRole("list", { name: SUMMARY }))
    .getAllByRole("listitem")
    .find((item) => item.getAttribute("data-metric") === metric);
  if (found === undefined) throw new Error(`không có thẻ tổng quan '${metric}'`);
  return found;
};

function renderPage(search: Record<string, unknown> = {}) {
  routeSearchDouble.set(search);
  return renderWithProviders(<StatsPage />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(VN_MONDAY);
  setCaps({ "view:feed": true, "view:feed-report": true });
  engagement.mockReset();
  exportEngagement.mockReset();
  triggerBlobDownload.mockReset();
  navigateSpy.mockReset();
  engagement.mockImplementation(() => Promise.resolve(makeEngagement()));
});
afterEach(() => {
  cleanup();
  resetCaps();
  routeSearchDouble.reset();
  vi.useRealTimers();
});

describe("Khung của màn", () => {
  it("fixture 052 đúng hợp đồng (lưới cho mọi ca bên dưới)", () => {
    expect(feedEngagementResponseSchema.parse(makeEngagement())).toEqual(makeEngagement());
  });

  it("có tiêu đề, bộ lọc, dải thẻ, biểu đồ và HAI bảng có tên + `columnheader`", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: TITLE, level: 1 })).toBeInTheDocument();
    const weeks = await weekTable();
    expect(within(weeks).getAllByRole("columnheader")).toHaveLength(5);
    expect(within(weeks).getAllByRole("row")).toHaveLength(3);
    const units = screen.getByRole("table", { name: UNIT_TABLE });
    // 2 đơn vị + hàng «Chưa gán đơn vị» + hàng tiêu đề.
    expect(within(units).getAllByRole("row")).toHaveLength(4);
    expect(await filters()).toBeInTheDocument();
    expect(screen.getByTestId("stats-chart-double")).toHaveAttribute("data-weeks", "2");
  });

  it("đang tải lượt đầu ⇒ khung chờ CÓ TÊN; chưa có bảng, bộ lọc, câu rỗng; nút xuất KHOÁ", () => {
    engagement.mockImplementation(() => pending());
    renderPage();

    expect(screen.getByRole("status", { name: LOADING })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("group", { name: FILTERS })).toBeNull();
    expect(screen.queryByText(EMPTY_SCOPE)).toBeNull();
    expect(exportButton()).toBeDisabled();
  });

  it("client mặc định `staleTime` 30 s (như `main.tsx`) + cache đã có số liệu ⇒ vào màn VẪN gọi 052", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    client.setQueryData(socialKeys.stats.engagement({}), makeEngagement());
    routeSearchDouble.set({});
    renderWithProviders(<StatsPage />, client);

    // Số liệu trong cache vẽ ngay (chứng minh khoá seed ĐÚNG là khoá màn đọc)…
    expect(screen.getByRole("table", { name: WEEK_TABLE })).toBeInTheDocument();
    // …nhưng màn không tin nó.
    await waitFor(() => expect(engagement).toHaveBeenCalledTimes(1));
  });
});

describe("T1 — khoảng tuần (vế màn)", () => {
  it("mặc định ⇒ 052 được gọi KHÔNG `from` / `to` / `orgUnitId`, và không ghi gì lên URL", async () => {
    renderPage();
    await weekTable();

    expect(engagement).toHaveBeenCalledTimes(1);
    expect(lastArg()).toStrictEqual({});
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("nhãn khoảng lấy từ `range` SERVER trả (URL không mang ngày nào)", async () => {
    renderPage();

    expect(within(await filters()).getByText("21/09/2026 – 04/10/2026")).toBeInTheDocument();
  });

  it("(role) nút ‹ › có TÊN trợ năng mang số tuần sẽ dịch", async () => {
    renderPage();
    const bar = await filters();

    expect(within(bar).getByRole("button", { name: "Lùi 2 tuần" })).toBeEnabled();
    expect(within(bar).getByRole("button", { name: "Tiến 2 tuần" })).toBeEnabled();
  });

  it("‹ ⇒ URL nhận khoảng lùi đúng 2×7 ngày (thứ Hai 07/09 → Chủ nhật 20/09) và 052 nhận đúng cặp đó", async () => {
    renderPage();
    fireEvent.click(within(await filters()).getByRole("button", { name: "Lùi 2 tuần" }));

    expect(lastNavigation()).toEqual({
      to: ".",
      search: { ...NONE, from: "2026-09-07", to: "2026-09-20" },
    });
    await waitFor(() => expect(lastArg()).toStrictEqual({ from: "2026-09-07", to: "2026-09-20" }));
  });

  it("› KHOÁ khi khoảng server trả kết thúc ở tuần hiện tại (11/10 theo giờ VN)", async () => {
    engagement.mockImplementation(() => Promise.resolve(makeEngagement({ range: DEFAULT_RANGE })));
    renderPage();
    const bar = await filters();

    expect(within(bar).getByRole("button", { name: "Tiến 8 tuần" })).toBeDisabled();
    expect(within(bar).getByRole("button", { name: "Lùi 8 tuần" })).toBeEnabled();
    // Đang ở mặc định ⇒ «Về hiện tại» cũng khoá.
    expect(within(bar).getByRole("button", { name: RESET })).toBeDisabled();
  });

  it("URL mang cặp ngày ⇒ 052 nhận đúng cặp; «Về hiện tại» bỏ CẢ HAI khỏi URL và 052 được gọi lại không ngày", async () => {
    renderPage({ from: "2026-09-21", to: "2026-10-04" });
    const bar = await filters();
    expect(lastArg()).toStrictEqual({ from: "2026-09-21", to: "2026-10-04" });

    fireEvent.click(within(bar).getByRole("button", { name: RESET }));

    expect(lastNavigation()).toEqual({ to: ".", search: NONE });
    await waitFor(() => expect(lastArg()).toStrictEqual({}));
  });

  it.each([
    { from: "2026-09-01" },
    { from: "2026-10-04", to: "2026-09-21" },
    { from: "2026-01-01", to: "2026-10-04" },
    { orgUnitId: "abc" },
  ])("search rác %j ⇒ 052 nhận `{}` (không gửi tham số chắc chắn 400)", async (search) => {
    renderPage(search);
    await weekTable();

    expect(lastArg()).toStrictEqual({});
  });
});

describe("T3 — dải thẻ tổng quan (vế màn)", () => {
  it("ba thẻ tổng = cộng `weekTotals`; thẻ thành viên = tuần CUỐI (5), KHÔNG phải tổng (8)", async () => {
    renderPage();
    await weekTable();

    expect(within(card("posts")).getByText("7")).toBeInTheDocument();
    expect(within(card("comments")).getByText("10")).toBeInTheDocument();
    expect(within(card("reactions")).getByText("19")).toBeInTheDocument();
    const members = card("activeMembers");
    expect(members).toHaveTextContent(MEMBERS_CARD);
    expect(within(members).getByText("5")).toBeInTheDocument();
    expect(within(members).queryByText("8")).toBeNull();
    // Thẻ nói rõ nó là số của tuần nào.
    expect(members).toHaveTextContent("28/09/2026 – 04/10/2026");
  });
});

describe("T4 — ô đơn vị", () => {
  it("option = `units` của response; chọn một đơn vị ⇒ URL có `orgUnitId` và 052 nhận đúng id đó", async () => {
    renderPage();
    const select = await unitSelect();
    // Chờ CHÍNH option xuất hiện rồi mới `change` (plan B9).
    const option = await within(select).findByRole("option", { name: "Phòng Kỹ thuật" });
    expect(option).toHaveValue(UNIT_ID);
    expect(
      within(select)
        .getAllByRole("option")
        .map((node) => node.textContent),
    ).toEqual(["Tất cả đơn vị", "Phòng Kỹ thuật", "Phòng Dự án cũ (đã xoá)"]);

    fireEvent.change(select, { target: { value: UNIT_ID } });

    expect(lastNavigation()).toEqual({ to: ".", search: { ...NONE, orgUnitId: UNIT_ID } });
    await waitFor(() => expect(lastArg()).toStrictEqual({ orgUnitId: UNIT_ID }));
    await waitFor(async () => expect((await unitSelect()).value).toBe(UNIT_ID));
  });

  it("đang lọc một đơn vị ⇒ bảng «Theo đơn vị» chỉ còn hàng của đơn vị đó; chọn «Tất cả đơn vị» ⇒ bỏ `orgUnitId`", async () => {
    renderPage({ orgUnitId: DELETED_UNIT_ID });
    await weekTable();

    expect(lastArg()).toStrictEqual({ orgUnitId: DELETED_UNIT_ID });
    const rows = within(screen.getByRole("table", { name: UNIT_TABLE })).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("Phòng Dự án cũ (đã xoá)");

    fireEvent.change(await unitSelect(), { target: { value: "" } });

    expect(lastNavigation()).toEqual({ to: ".", search: NONE });
    await waitFor(() => expect(lastArg()).toStrictEqual({}));
  });
});

describe("T5 — 200 rỗng KHÁC «không có quyền»", () => {
  const emptyScope = (): FeedEngagementResponseDto =>
    makeEngagement({ range: DEFAULT_RANGE, units: [], rows: [], weekTotals: [] });

  it("`units: []` + `rows: []` ⇒ câu «chưa có đơn vị…»; KHÔNG dải lỗi nào, KHÔNG `data-reason=forbidden`, KHÔNG bảng", async () => {
    engagement.mockImplementation(() => Promise.resolve(emptyScope()));
    const { container } = renderPage();

    expect(await screen.findByText(EMPTY_SCOPE)).toBeInTheDocument();
    expect(container.querySelector('[data-reason="forbidden"]')).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(exportButton()).toBeDisabled();
  });

  it("đối chứng: có đơn vị nhưng TOÀN SỐ 0 ⇒ vẫn vẽ hai bảng với số 0, KHÔNG dùng câu rỗng; nút xuất MỞ", async () => {
    engagement.mockImplementation(() =>
      Promise.resolve(
        makeEngagement({
          rows: [],
          weekTotals: [
            { weekStart: "2026-09-21", posts: 0, comments: 0, reactions: 0, activeMembers: 0 },
            { weekStart: "2026-09-28", posts: 0, comments: 0, reactions: 0, activeMembers: 0 },
          ],
        }),
      ),
    );
    renderPage();

    expect(within(await weekTable()).getAllByRole("row")).toHaveLength(3);
    expect(
      within(screen.getByRole("table", { name: UNIT_TABLE })).getAllByRole("row"),
    ).toHaveLength(3);
    expect(screen.queryByText(EMPTY_SCOPE)).toBeNull();
    expect(within(card("posts")).getByText("0")).toBeInTheDocument();
    expect(exportButton()).toBeEnabled();
  });
});

describe("Nút «Xuất Excel» — xuất ĐÚNG thứ đang xem", () => {
  it("có số liệu ⇒ nút mở; bấm ⇒ 053 nhận CÙNG tham số của lượt đọc đang hiển thị, tệp tải về với tên theo `range` server", async () => {
    exportEngagement.mockImplementation(() =>
      Promise.resolve({ blob: new Blob(["PK-xlsx-bytes"], { type: XLSX_MIME }), filename: null }),
    );
    renderPage({ from: "2026-09-21", to: "2026-10-04", orgUnitId: UNIT_ID });
    await weekTable();

    fireEvent.click(exportButton());

    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledTimes(1));
    expect(exportEngagement).toHaveBeenCalledTimes(1);
    expect(exportEngagement.mock.calls[0]?.[0]).toStrictEqual({
      from: "2026-09-21",
      to: "2026-10-04",
      orgUnitId: UNIT_ID,
    });
    expect(triggerBlobDownload.mock.calls[0]?.[1]).toBe(
      "social-tuong-tac-2026-09-21_2026-10-04.xlsx",
    );
  });
});
