// @vitest-environment jsdom
/**
 * S16-SOCIAL-FE-3B — ca **G6**: cổng ROUTE của màn Thống kê tương tác `SOC-SCREEN-011` (`/feed/stats`), đo trên
 * đường dựng THẬT của router.
 *
 * Cùng họ, cùng khung mock và cùng «GIỚI HẠN ĐÃ BIẾT» với `admin-route-gates.moderation.spec.tsx` — đọc docblock ở
 * đó: i18n giả trả KHOÁ · hai vỏ là passthrough · `routeKey` là bản chép TAY của literal trong `router.tsx` (vế
 * «`router.tsx` nối đúng meta» đo ở `social-wiring.router.spec.ts`, ca W3). Tách theo màn từ
 * `admin-route-gates.spec.tsx` ở S16-SOCIAL-FE-3C (finding AUD-SPEC400) — tách THUẦN, không đổi ca nào.
 *
 * Spy `listReports` (028 của màn 010) và `listBadgesAdmin` (056 của màn 012) có mặt ở file này để ca ALLOW đo
 * được «màn 011 không đọc gì của màn 010 / 012».
 *
 * `ProtectedRoute` đọc store bằng `getState()` ⇒ quyền đặt TRƯỚC khi render (plan B5).
 */
import type { ReactElement, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { makeTestQueryClient, resetCaps, setCaps } from "../feed/social-test-doubles";
import {
  UNIT_ID,
  makeBadgeAdmin,
  makeBadgeAdminPage,
  makeEngagement,
  makeReport,
  makeReportPage,
} from "./admin-test-doubles";
import { StatsPage } from "../stats/StatsPage";

const listReports = vi.fn();
const listBadgesAdmin = vi.fn();
const engagement = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialModerationApi: {
      ...actual.socialModerationApi,
      listReports: (...a: unknown[]) => listReports(...a),
    },
    socialKudosApi: {
      ...actual.socialKudosApi,
      listBadgesAdmin: (...a: unknown[]) => listBadgesAdmin(...a),
    },
    socialStatsApi: {
      ...actual.socialStatsApi,
      engagement: (...a: unknown[]) => engagement(...a),
    },
  };
});

// Recharts trong jsdom không có layout (plan B13) — biểu đồ không thuộc phép đo cổng.
vi.mock("@/routes/social/stats/components/EngagementTrendChart", () => ({
  EngagementTrendChart: () => null,
}));

vi.mock("@/layouts/protected/ProtectedShell", () => ({
  ProtectedShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/routes/social/feed/SocialPortalShell", () => ({
  SocialPortalShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage: vi.fn() } }),
  };
});

/**
 * Ca G6 dựng nội dung route NGOÀI router ⇒ `Link` / `useNavigate` / `useSearch` phải là bản giả. Ca
 * «router THẬT» bật cờ này TRƯỚC khi render để chính màn đó dùng bản thật của thư viện. Cờ cố định suốt
 * một lượt render nên thứ tự hook không đổi giữa các lần vẽ.
 */
const routerMode = vi.hoisted(() => ({ isReal: false }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const FakeLink = ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  );
  type AnyHook = (...args: unknown[]) => unknown;
  const RealLink = actual.Link as unknown as typeof FakeLink;
  return {
    ...actual,
    Link: (props: Parameters<typeof FakeLink>[0]) =>
      routerMode.isReal ? <RealLink {...props} /> : <FakeLink {...props} />,
    useNavigate: (...args: unknown[]) =>
      routerMode.isReal ? (actual.useNavigate as AnyHook)(...args) : () => undefined,
    useSearch: (...args: unknown[]) =>
      routerMode.isReal ? (actual.useSearch as AnyHook)(...args) : {},
  };
});

/** `import("@/router")` nạp cả đồ thị route — ca ĐẦU TIÊN trả giá (tiền lệ `ProtectedRoute.spec.tsx`). */
const ROUTER_IMPORT_TIMEOUT = 20_000;

/** Khoá do `useTranslation` giả trả về. Viết tay. */
const FORBIDDEN_TITLE = "forbidden.title";
const FORBIDDEN_NO_PERMISSION = "forbidden.reason.NO_PERMISSION";
const STATS_TITLE = "admin.stats.page.title";
const STATS_EXPORT = "admin.stats.export.button";
const STATS_UNIT_LABEL = "admin.stats.filters.unitLabel";

async function renderRoute(routeKey: string, page: ReactElement): Promise<void> {
  const { buildModuleRouteContent, getMeta } = await import("@/router");
  render(
    <QueryClientProvider client={makeTestQueryClient()}>
      {buildModuleRouteContent(getMeta(routeKey), "SOCIAL", page)}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listReports.mockReset();
  listReports.mockImplementation(() => Promise.resolve(makeReportPage([makeReport()])));
  listBadgesAdmin.mockReset();
  listBadgesAdmin.mockImplementation(() => Promise.resolve(makeBadgeAdminPage([makeBadgeAdmin()])));
  engagement.mockReset();
  engagement.mockImplementation(() => Promise.resolve(makeEngagement()));
});
afterEach(() => {
  cleanup();
  resetCaps();
  routerMode.isReal = false;
});

describe("G6 — cổng route `/feed/stats` (SOC-SCREEN-011) = `view:feed` + `view:feed-report`", () => {
  const renderStats = (): Promise<void> => renderRoute("social.stats", <StatsPage />);

  it(
    "ALLOW — `view:feed` + `view:feed-report` (manager) ⇒ màn mount, 052 được gọi ĐÚNG 1 lần, có nút Xuất",
    async () => {
      setCaps({ "view:feed": true, "view:feed-report": true });

      await renderStats();

      await waitFor(() => expect(engagement).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("heading", { name: STATS_TITLE })).toBeInTheDocument();
      // Nút xuất KHÔNG có cổng riêng: ai vào được màn (manager) thì thấy nút.
      expect(await screen.findByRole("button", { name: STATS_EXPORT })).toBeEnabled();
      expect(screen.queryByText(FORBIDDEN_TITLE)).not.toBeInTheDocument();
      // Màn 011 không đọc gì của màn 010 / 012.
      expect(listReports).toHaveBeenCalledTimes(0);
      expect(listBadgesAdmin).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — chỉ `view:feed` (nhân viên thường) ⇒ trang cấm NO_PERMISSION, màn KHÔNG mount, 052 gọi 0 lần, không nút Xuất",
    async () => {
      setCaps({ "view:feed": true });

      await renderStats();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: STATS_TITLE })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: STATS_EXPORT })).not.toBeInTheDocument();
      expect(engagement).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — có `manage:feed-report` + `manage:feed-kudos` nhưng thiếu `view:feed-report` ⇒ cấm (không suy manage ⇒ view), 052 gọi 0 lần",
    async () => {
      setCaps({ "view:feed": true, "manage:feed-report": true, "manage:feed-kudos": true });

      await renderStats();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: STATS_TITLE })).not.toBeInTheDocument();
      expect(engagement).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — có `view:feed-report` nhưng thiếu `view:feed` (không vào được module) ⇒ cấm, 052 gọi 0 lần",
    async () => {
      setCaps({ "view:feed-report": true });

      await renderStats();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(engagement).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — chỉ có wildcard `*:*` ⇒ cấm: cổng route khớp ĐÚNG-BẰNG, không ăn wildcard",
    async () => {
      setCaps({ "*:*": true });

      await renderStats();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(engagement).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );
});

// `StatsPage` đổi khoảng / đơn vị bằng cùng lối `navigate({ to: "." })`. Ca này đi qua CHÍNH `router` của app:
// route `/feed/stats` có trong cây, `validateSearch` của nó sống thật (`orgUnitId` của URL tới 052, cặp ngày
// lẻ bị bỏ), màn nạp qua `React.lazy` đúng module, và bỏ lọc đơn vị không đưa người dùng khỏi màn.
describe("Router THẬT — bỏ lọc đơn vị ở `/feed/stats` ở lại đúng màn, search về RỖNG", () => {
  it(
    "ALLOW — mở `?orgUnitId=…&from=2026-09-01` (cặp ngày lẻ) ⇒ 052 nhận ĐÚNG `{ orgUnitId }`; chọn «tất cả đơn vị» ⇒ pathname còn `/feed/stats`, search rỗng, 052 gọi lại với `{}`",
    async () => {
      routerMode.isReal = true;
      setCaps({ "view:feed": true, "view:feed-report": true });
      const { router } = await import("@/router");
      router.history.push(`/feed/stats?orgUnitId=${UNIT_ID}&from=2026-09-01`);
      await router.load();

      render(
        <QueryClientProvider client={makeTestQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );

      await waitFor(() => expect(engagement).toHaveBeenLastCalledWith({ orgUnitId: UNIT_ID }));
      expect(router.state.location.pathname).toBe("/feed/stats");

      const select = await screen.findByRole("combobox", { name: STATS_UNIT_LABEL });
      await waitFor(() => expect(select).toHaveValue(UNIT_ID));
      fireEvent.change(select, { target: { value: "" } });

      await waitFor(() => expect(router.state.location.searchStr).toBe(""));
      expect(router.state.location.pathname).toBe("/feed/stats");
      await waitFor(() => expect(engagement).toHaveBeenLastCalledWith({}));
      expect(screen.getByRole("heading", { name: STATS_TITLE })).toBeInTheDocument();
      expect(screen.queryByText(FORBIDDEN_TITLE)).not.toBeInTheDocument();
    },
    ROUTER_IMPORT_TIMEOUT,
  );
});
