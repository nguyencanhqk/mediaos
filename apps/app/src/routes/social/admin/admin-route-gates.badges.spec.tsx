// @vitest-environment jsdom
/**
 * S16-SOCIAL-FE-3B — ca **G5**: cổng ROUTE của màn Thiết lập huy hiệu `SOC-SCREEN-012` (`/feed/kudos-badges`), đo
 * trên đường dựng THẬT của router.
 *
 * Cùng họ, cùng khung mock và cùng «GIỚI HẠN ĐÃ BIẾT» với `admin-route-gates.moderation.spec.tsx` — đọc docblock ở
 * đó: i18n giả trả KHOÁ · hai vỏ là passthrough · `routeKey` là bản chép TAY của literal trong `router.tsx` (vế
 * «`router.tsx` nối đúng meta» đo ở `social-wiring.router.spec.ts`, ca W3). Tách theo màn từ
 * `admin-route-gates.spec.tsx` ở S16-SOCIAL-FE-3C (finding AUD-SPEC400) — tách THUẦN, không đổi ca nào.
 *
 * Spy `listReports` (028 của màn 010) có mặt ở file này để ca ALLOW đo được «màn 012 không đọc gì của màn 010».
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
  makeBadgeAdmin,
  makeBadgeAdminPage,
  makeReport,
  makeReportPage,
} from "./admin-test-doubles";
import { BadgeSettingsPage } from "../badges/BadgeSettingsPage";

const listReports = vi.fn();
const listBadgesAdmin = vi.fn();

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
  };
});

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
 * Ca G5 dựng nội dung route NGOÀI router ⇒ `Link` / `useNavigate` / `useSearch` phải là bản giả. Ca
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
const BADGES_TITLE = "admin.badges.page.title";
const NEXT_PAGE = "pagination.next";

/** Cỡ trang của màn 012 (056 mặc định 50). Viết tay. */
const BADGES_LIMIT = 50;

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
});
afterEach(() => {
  cleanup();
  resetCaps();
  routerMode.isReal = false;
});

describe("G5 — cổng route `/feed/kudos-badges` (SOC-SCREEN-012) = `view:feed` + `manage:feed-kudos`", () => {
  const renderBadges = (): Promise<void> =>
    renderRoute("social.kudosBadges", <BadgeSettingsPage />);

  it(
    "ALLOW — `view:feed` + `manage:feed-kudos` ⇒ màn mount, 056 được gọi ĐÚNG 1 lần",
    async () => {
      setCaps({ "view:feed": true, "manage:feed-kudos": true });

      await renderBadges();

      await waitFor(() => expect(listBadgesAdmin).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("heading", { name: BADGES_TITLE })).toBeInTheDocument();
      expect(screen.queryByText(FORBIDDEN_TITLE)).not.toBeInTheDocument();
      // Màn 012 không đọc gì của màn 010.
      expect(listReports).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — chỉ `view:feed` (nhân viên thường) ⇒ trang cấm NO_PERMISSION, màn KHÔNG mount, 056 gọi 0 lần",
    async () => {
      setCaps({ "view:feed": true });

      await renderBadges();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: BADGES_TITLE })).not.toBeInTheDocument();
      expect(listBadgesAdmin).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — người kiểm duyệt (`view:feed-report` + `manage:feed-report` + `manage:feed-post`) và người được gửi vinh danh (`create:feed-kudos`) nhưng thiếu `manage:feed-kudos` ⇒ cấm, 056 gọi 0 lần",
    async () => {
      setCaps({
        "view:feed": true,
        "view:feed-report": true,
        "manage:feed-report": true,
        "manage:feed-post": true,
        "create:feed-kudos": true,
      });

      await renderBadges();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: BADGES_TITLE })).not.toBeInTheDocument();
      expect(listBadgesAdmin).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — có `manage:feed-kudos` nhưng thiếu `view:feed` (không vào được module) ⇒ cấm, 056 gọi 0 lần",
    async () => {
      setCaps({ "manage:feed-kudos": true });

      await renderBadges();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(listBadgesAdmin).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — chỉ có wildcard `*:*` ⇒ cấm: cổng route khớp ĐÚNG-BẰNG, không ăn wildcard",
    async () => {
      setCaps({ "*:*": true });

      await renderBadges();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(listBadgesAdmin).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );
});

// `BadgeSettingsPage` lật trang bằng cùng lối `navigate({ to: "." })`. Ca này đi qua CHÍNH `router` của app:
// route `/feed/kudos-badges` có trong cây, `validateSearch` của nó sống thật (`page` tới 056 là SỐ), màn nạp
// qua `React.lazy` đúng module, và lật trang không đưa người dùng khỏi màn.
describe("Router THẬT — lật trang ở `/feed/kudos-badges` ở lại đúng màn, search = ĐÚNG `?page=…`", () => {
  it(
    "ALLOW — mở `?page=2` (3 trang), bấm «Trang sau» ⇒ pathname còn `/feed/kudos-badges`, search = `?page=3`, 056 gọi lại với trang 3",
    async () => {
      routerMode.isReal = true;
      setCaps({ "view:feed": true, "manage:feed-kudos": true });
      listBadgesAdmin.mockImplementation((query: { page: number }) =>
        Promise.resolve(
          makeBadgeAdminPage([makeBadgeAdmin()], { page: query.page, total: BADGES_LIMIT * 3 }),
        ),
      );
      const { router } = await import("@/router");
      router.history.push("/feed/kudos-badges?page=2");
      await router.load();

      render(
        <QueryClientProvider client={makeTestQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );

      await waitFor(() =>
        expect(listBadgesAdmin).toHaveBeenLastCalledWith({ page: 2, limit: BADGES_LIMIT }),
      );
      expect(router.state.location.pathname).toBe("/feed/kudos-badges");

      fireEvent.click(await screen.findByRole("button", { name: NEXT_PAGE }));

      await waitFor(() => expect(router.state.location.searchStr).toBe("?page=3"));
      expect(router.state.location.pathname).toBe("/feed/kudos-badges");
      await waitFor(() =>
        expect(listBadgesAdmin).toHaveBeenLastCalledWith({ page: 3, limit: BADGES_LIMIT }),
      );
      expect(screen.getByRole("heading", { name: BADGES_TITLE })).toBeInTheDocument();
      expect(screen.queryByText(FORBIDDEN_TITLE)).not.toBeInTheDocument();
    },
    ROUTER_IMPORT_TIMEOUT,
  );
});
