/**
 * S16-SOCIAL-FE-3B (L5b) — màn Thống kê tương tác `SOC-SCREEN-011`: NHÓM CA LỖI (T6) + «giữ số liệu cũ lúc
 * đang tải» (chỉ khi CÙNG bộ lọc đơn vị). Nhóm ca đọc ở `StatsPage.spec.tsx` — cùng khung mock.
 *
 * Luật đang ghim:
 *  · hai loại 403 TÁCH nhau: mã `STATS-UNIT-OUT-OF-SCOPE` ⇒ `statsUnitOutOfScope` + «Bỏ lọc đơn vị»; 403 tầng
 *    quyền ⇒ `forbidden`, không lối thoát nào;
 *  · 400 khi có gửi khoảng ⇒ `statsRangeInvalid` + «Về mặc định»;
 *  · ĐANG LỖI thì không còn bảng / thẻ / bộ lọc của lượt trước — số liệu cũ dưới một dải lỗi đọc như số liệu
 *    của bộ lọc đang chọn;
 *  · `message` của server không lên màn.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";
import { renderWithProviders, resetCaps, setCaps } from "../feed/social-test-doubles";
import { ADMIN_ERR, UNIT_ID, makeEngagement, routeSearchDouble } from "../admin/admin-test-doubles";
import { StatsPage } from "./StatsPage";

const engagement = vi.fn();
const navigateSpy = vi.fn();

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
      navigateSpy({ ...options, search: doubles.routeSearchDouble.navigate(options) });
    },
    useSearch: () => doubles.useRouteSearchDouble(),
  };
});

vi.mock("./components/EngagementTrendChart", () => ({
  EngagementTrendChart: () => <div data-testid="stats-chart-double" />,
}));

const VN_MONDAY = new Date("2026-10-04T17:30:00Z");

const LOADING = "Đang tải số liệu thống kê";
const FILTERS = "Bộ lọc thống kê";
const UNIT = "Đơn vị";
const SUMMARY = "Tổng quan trong khoảng đang xem";
const WEEK_TABLE = "Tương tác theo tuần";
const EXPORT = "Xuất Excel";
const RETRY = "Thử lại";
const CLEAR_UNIT = "Bỏ lọc đơn vị";
const RESET_RANGE = "Về mặc định";
const OUT_OF_SCOPE_TEXT =
  "Bạn không có quyền xem thống kê của đơn vị này. Hãy bỏ lọc đơn vị hoặc chọn đơn vị khác.";

const NONE = { from: undefined, to: undefined, orgUnitId: undefined };
const RANGE = { from: "2026-09-21", to: "2026-10-04" };

const lastArg = (): unknown => engagement.mock.calls.at(-1)?.[0];
const lastNavigation = (): { to?: string; search?: Record<string, unknown> } =>
  navigateSpy.mock.calls.at(-1)?.[0] ?? {};
const weekTable = (): Promise<HTMLElement> => screen.findByRole("table", { name: WEEK_TABLE });
const filters = (): Promise<HTMLElement> => screen.findByRole("group", { name: FILTERS });
const exportButton = (): HTMLButtonElement => screen.getByRole("button", { name: EXPORT });
const recoveryButtons = (): string[] =>
  [RETRY, CLEAR_UNIT, RESET_RANGE].filter(
    (name) => screen.queryByRole("button", { name }) !== null,
  );

/** Không còn gì của lượt đọc trước: bảng · dải thẻ · bộ lọc · biểu đồ. */
function expectNoStaleData(): void {
  expect(screen.queryAllByRole("table")).toHaveLength(0);
  expect(screen.queryByRole("list", { name: SUMMARY })).toBeNull();
  expect(screen.queryByRole("group", { name: FILTERS })).toBeNull();
  expect(screen.queryByTestId("stats-chart-double")).toBeNull();
}

/** Lời gọi treo: trả hàm nhả để ca tự quyết lúc nào phản hồi về. */
function hangEngagement(): {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
} {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  engagement.mockImplementationOnce(
    () =>
      new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return { resolve: (value) => resolve(value), reject: (reason) => reject(reason) };
}

function renderPage(search: Record<string, unknown> = {}) {
  routeSearchDouble.set(search);
  return renderWithProviders(<StatsPage />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(VN_MONDAY);
  setCaps({ "view:feed": true, "view:feed-report": true });
  engagement.mockReset();
  navigateSpy.mockReset();
  engagement.mockImplementation(() => Promise.resolve(makeEngagement()));
});
afterEach(() => {
  cleanup();
  resetCaps();
  routeSearchDouble.reset();
  vi.useRealTimers();
});

describe("T6 — hai loại 403 tách nhau", () => {
  it("403 `STATS-UNIT-OUT-OF-SCOPE` ⇒ `statsUnitOutOfScope` + ĐÚNG một lối thoát «Bỏ lọc đơn vị»; bấm ⇒ bỏ `orgUnitId` (giữ khoảng), số liệu hiện ra", async () => {
    engagement.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.statsUnitOutOfScope()));
    renderPage({ ...RANGE, orgUnitId: UNIT_ID });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "statsUnitOutOfScope");
    expect(alert).toHaveTextContent(OUT_OF_SCOPE_TEXT);
    expect(alert).not.toHaveTextContent("ngoài phạm vi thống kê của bạn");
    expect(recoveryButtons()).toEqual([CLEAR_UNIT]);
    expectNoStaleData();

    fireEvent.click(screen.getByRole("button", { name: CLEAR_UNIT }));

    expect(lastNavigation()).toEqual({ to: ".", search: { ...NONE, ...RANGE } });
    expect(await weekTable()).toBeInTheDocument();
    expect(lastArg()).toStrictEqual(RANGE);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("403 tầng quyền ⇒ `forbidden`: KHÔNG lối thoát nào, KHÔNG hiện thông điệp của server", async () => {
    engagement.mockImplementation(() => Promise.reject(ADMIN_ERR.forbidden()));
    renderPage({ orgUnitId: UNIT_ID });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "forbidden");
    expect(alert).not.toHaveTextContent("Forbidden resource");
    expect(recoveryButtons()).toEqual([]);
    expectNoStaleData();
    expect(exportButton()).toBeDisabled();
  });
});

describe("T6 — 400 và lỗi hệ thống", () => {
  it("400 khi CÓ gửi khoảng ⇒ `statsRangeInvalid` + «Về mặc định»; bấm ⇒ bỏ `from` + `to` (giữ đơn vị)", async () => {
    engagement.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.badRequest()));
    renderPage({ ...RANGE, orgUnitId: UNIT_ID });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "statsRangeInvalid");
    expect(alert).not.toHaveTextContent("Validation failed");
    expect(recoveryButtons()).toEqual([RESET_RANGE]);

    fireEvent.click(screen.getByRole("button", { name: RESET_RANGE }));

    expect(lastNavigation()).toEqual({ to: ".", search: { ...NONE, orgUnitId: UNIT_ID } });
    expect(await weekTable()).toBeInTheDocument();
    expect(lastArg()).toStrictEqual({ orgUnitId: UNIT_ID });
  });

  it("400 khi KHÔNG gửi khoảng ⇒ `invalidRequest`, không mời «Về mặc định» (bấm cũng không đổi được gì)", async () => {
    engagement.mockImplementation(() => Promise.reject(ADMIN_ERR.badRequest()));
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "invalidRequest");
    expect(recoveryButtons()).toEqual([]);
  });

  it("500 ⇒ `generic` + «Thử lại» gọi lại 052 với NGUYÊN tham số; thành công thì bảng hiện, dải lỗi mất", async () => {
    engagement.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));
    renderPage({ orgUnitId: UNIT_ID });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "generic");
    expect(alert).not.toHaveTextContent("boom");
    expect(recoveryButtons()).toEqual([RETRY]);
    expectNoStaleData();

    fireEvent.click(within(alert).getByRole("button", { name: RETRY }));

    expect(await weekTable()).toBeInTheDocument();
    expect(engagement).toHaveBeenCalledTimes(2);
    expect(lastArg()).toStrictEqual({ orgUnitId: UNIT_ID });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("T6 — đang lỗi thì KHÔNG còn số liệu cũ", () => {
  it("đang xem số liệu, bấm ‹, lượt đọc mới hỏng ⇒ bảng / thẻ / bộ lọc của lượt trước biến mất, chỉ còn dải lỗi", async () => {
    renderPage();
    const bar = await filters();
    engagement.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));

    fireEvent.click(within(bar).getByRole("button", { name: "Lùi 2 tuần" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "generic");
    expectNoStaleData();
    expect(exportButton()).toBeDisabled();
  });

  it("cache CÒN số liệu của đúng khoá đó nhưng lượt đọc lại hỏng ⇒ vẫn ẩn số liệu; «Thử lại» đang chạy thì nút khoá", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(socialKeys.stats.engagement({}), makeEngagement());
    engagement.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));
    routeSearchDouble.set({});
    renderWithProviders(<StatsPage />, client);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "generic");
    expectNoStaleData();

    const retry = hangEngagement();
    fireEvent.click(within(alert).getByRole("button", { name: RETRY }));

    await waitFor(() =>
      expect(within(screen.getByRole("alert")).getByRole("button", { name: RETRY })).toBeDisabled(),
    );
    expectNoStaleData();

    retry.resolve(makeEngagement());
    expect(await weekTable()).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Giữ số liệu cũ lúc đang tải — CHỈ khi cùng bộ lọc đơn vị", () => {
  it("ALLOW — đổi khoảng tuần (cùng đơn vị) ⇒ bảng + bộ lọc của lượt trước CÒN trong lúc chờ, vùng số liệu `aria-busy`, nút xuất KHOÁ; về tới thì hết bận", async () => {
    renderPage();
    const bar = await filters();
    const next = hangEngagement();

    fireEvent.click(within(bar).getByRole("button", { name: "Lùi 2 tuần" }));

    await waitFor(() => expect(lastArg()).toStrictEqual({ from: "2026-09-07", to: "2026-09-20" }));
    expect(screen.getByRole("table", { name: WEEK_TABLE })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: FILTERS })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: LOADING })).toBeNull();
    expect(screen.getByTestId("stats-data")).toHaveAttribute("aria-busy", "true");
    // Tham số đã đổi nhưng số liệu trên màn còn của khoảng cũ ⇒ không cho xuất «thứ đang xem».
    expect(exportButton()).toBeDisabled();

    next.resolve(
      makeEngagement({ range: { from: "2026-09-07", to: "2026-09-20", weeks: 2 }, rows: [] }),
    );

    expect(await within(await filters()).findByText("07/09/2026 – 20/09/2026")).toBeInTheDocument();
    expect(screen.getByTestId("stats-data")).not.toHaveAttribute("aria-busy");
    expect(exportButton()).toBeEnabled();
  });

  it("DENY — đổi ĐƠN VỊ ⇒ KHÔNG giữ số liệu của bộ lọc cũ: khung chờ thay cho bảng", async () => {
    renderPage();
    const select = within(await filters()).getByRole("combobox", { name: UNIT });
    await within(select).findByRole("option", { name: "Phòng Kỹ thuật" });
    hangEngagement();

    fireEvent.change(select, { target: { value: UNIT_ID } });

    await waitFor(() => expect(lastArg()).toStrictEqual({ orgUnitId: UNIT_ID }));
    expect(screen.getByRole("status", { name: LOADING })).toBeInTheDocument();
    expectNoStaleData();
  });
});
