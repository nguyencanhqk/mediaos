/**
 * S16-SOCIAL-FESTATSBUSY-1 — màn Thống kê tương tác `SOC-SCREEN-011`: thanh bộ lọc dựng từ trạng thái YÊU CẦU
 * (URL), không từ response cũ, và focus sau mỗi lối thoát của dải lỗi.
 *
 * Search của route là bản GIẢ CÓ PHẢN ỨNG (`routeSearchDouble`). Biểu đồ bị MOCK (Recharts không có layout
 * trong jsdom). i18n THẬT, chữ kỳ vọng VIẾT TAY. Đồng hồ: `2026-10-04T17:30:00Z` = 00:30 thứ Hai 05/10 giờ VN.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, resetCaps, setCaps } from "../feed/social-test-doubles";
import { ADMIN_ERR, UNIT_ID, makeEngagement, routeSearchDouble } from "../admin/admin-test-doubles";
import { StatsPage } from "./StatsPage";

const engagement = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialStatsApi: {
      ...actual.socialStatsApi,
      engagement: (...a: unknown[]) => engagement(...a),
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const doubles = await import("../admin/admin-test-doubles");
  return {
    ...actual,
    useNavigate: () => (options: { search?: unknown }) => {
      doubles.routeSearchDouble.navigate(options);
    },
    useSearch: () => doubles.useRouteSearchDouble(),
  };
});

vi.mock("./components/EngagementTrendChart", () => ({
  EngagementTrendChart: () => <div data-testid="stats-chart-double" />,
}));

const VN_MONDAY = new Date("2026-10-04T17:30:00Z");

const TITLE = "Thống kê tương tác";
const FILTERS = "Bộ lọc thống kê";
const WEEKS = "Số tuần";
const RETRY = "Thử lại";
const CLEAR_UNIT = "Bỏ lọc đơn vị";
const RESET_RANGE = "Về mặc định";
const RANGE_LABEL_ID = "stats-range-label";
const RANGE = { from: "2026-09-21", to: "2026-10-04" };

const pending = <T,>(): Promise<T> => new Promise<T>(() => undefined);
const lastArg = (): unknown => engagement.mock.calls.at(-1)?.[0];
const filters = (): Promise<HTMLElement> => screen.findByRole("group", { name: FILTERS });
const heading = (): HTMLElement => screen.getByRole("heading", { name: TITLE, level: 1 });

function renderPage(search: Record<string, unknown> = {}) {
  routeSearchDouble.set(search);
  return renderWithProviders(<StatsPage />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(VN_MONDAY);
  setCaps({ "view:feed": true, "view:feed-report": true });
  engagement.mockReset();
  engagement.mockImplementation(() => Promise.resolve(makeEngagement()));
});
afterEach(() => {
  cleanup();
  resetCaps();
  routeSearchDouble.reset();
  vi.useRealTimers();
});

describe("Thanh bộ lọc dựng từ khoảng ĐÃ YÊU CẦU, không từ response cũ", () => {
  it("‹ hai lần liên tiếp trước khi phản hồi về ⇒ dịch ĐÚNG hai bước (2 tuần mỗi bước); nút không `disabled`", async () => {
    renderPage();
    const bar = await filters();
    engagement.mockImplementation(() => pending());
    const back = within(bar).getByRole("button", { name: "Lùi 2 tuần" });
    back.focus();

    fireEvent.click(back);
    await waitFor(() => expect(lastArg()).toStrictEqual({ from: "2026-09-07", to: "2026-09-20" }));
    expect(back).not.toBeDisabled();
    expect(back).toHaveFocus();
    fireEvent.click(within(await filters()).getByRole("button", { name: "Lùi 2 tuần" }));

    await waitFor(() => expect(lastArg()).toStrictEqual({ from: "2026-08-24", to: "2026-09-06" }));
    expect(screen.getByTestId(RANGE_LABEL_ID)).toHaveTextContent("24/08/2026 – 06/09/2026");
  });

  it("› sau ‹ trong lúc chờ ⇒ quay lại ĐÚNG khoảng gốc (không kẹt ở khoảng của response cũ)", async () => {
    renderPage({ from: "2026-08-24", to: "2026-09-06" });
    const bar = await filters();
    engagement.mockImplementation(() => pending());

    fireEvent.click(within(bar).getByRole("button", { name: "Tiến 2 tuần" }));

    await waitFor(() => expect(lastArg()).toStrictEqual({ from: "2026-09-07", to: "2026-09-20" }));
    fireEvent.click(within(await filters()).getByRole("button", { name: "Tiến 2 tuần" }));
    await waitFor(() => expect(lastArg()).toStrictEqual(RANGE));
  });

  it("ô «Số tuần» giữ giá trị vừa chọn suốt lượt tải; đối chứng — chưa chọn thì theo response", async () => {
    renderPage();
    const select = within(await filters()).getByRole<HTMLSelectElement>("combobox", {
      name: WEEKS,
    });
    expect(select).toHaveValue("2");
    engagement.mockImplementation(() => pending());

    fireEvent.change(select, { target: { value: "4" } });

    await waitFor(() => expect(lastArg()).toStrictEqual({ from: "2026-09-07", to: "2026-10-04" }));
    expect(
      within(screen.getByRole("group", { name: FILTERS })).getByRole("combobox", { name: WEEKS }),
    ).toHaveValue("4");
  });
});

describe("Focus sau lối thoát của dải lỗi nằm ở phần tử có nghĩa (tiêu đề màn), không phải body", () => {
  it("«Bỏ lọc đơn vị»", async () => {
    engagement.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.statsUnitOutOfScope()));
    renderPage({ ...RANGE, orgUnitId: UNIT_ID });
    const button = await screen.findByRole("button", { name: CLEAR_UNIT });
    button.focus();

    fireEvent.click(button);

    await screen.findByRole("group", { name: FILTERS });
    expect(document.activeElement).toBe(heading());
  });

  it("«Về mặc định»", async () => {
    engagement.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.badRequest()));
    renderPage(RANGE);
    const button = await screen.findByRole("button", { name: RESET_RANGE });
    button.focus();

    fireEvent.click(button);

    await screen.findByRole("group", { name: FILTERS });
    expect(document.activeElement).toBe(heading());
  });

  it("«Thử lại» thành công", async () => {
    engagement.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));
    renderPage();
    const button = await screen.findByRole("button", { name: RETRY });
    button.focus();

    fireEvent.click(button);

    await screen.findByRole("group", { name: FILTERS });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.activeElement).toBe(heading());
  });
});
