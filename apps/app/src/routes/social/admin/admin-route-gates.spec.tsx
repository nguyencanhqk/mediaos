// @vitest-environment jsdom
/**
 * S16-SOCIAL-FE-3 / FE-3B — ca **G1** (màn 010) · **G5** (màn 012): cổng ROUTE của màn quản trị SOCIAL, đo
 * trên đường dựng THẬT của router.
 *
 * Mỗi ca dựng đúng thứ `router.tsx` dựng cho route đó — `buildModuleRouteContent(getMeta(<routeKey>),
 * "SOCIAL", <màn thật />)` — rồi đo HAI thứ cùng lúc: `ProtectedRoute` vẽ gì, và lời gọi ĐẦU TIÊN của màn
 * có phát đi hay không. Cổng route lỏng hơn cặp của lời gọi đó thì người thiếu quyền vào được màn rồi ăn
 * 403 của server; ca DENY ở đây đỏ trước khi chuyện đó tới tay người dùng.
 *
 * ┌─ GIỚI HẠN ĐÃ BIẾT ───────────────────────────────────────────────────────────────────────────────┐
 * │ · Ca G1 KHÔNG đi qua cây route (riêng describe «Router THẬT» ở cuối file thì có): `routeKey` truyền cho `getMeta` ở đây là bản chép TAY của literal    │
 * │   trong `router.tsx`. Vế «route `/feed/moderation` dùng đúng `getMeta("social.moderation")` và đã │
 * │   lắp vào cây» đo ở `social-wiring.spec.ts` (ca W3, đọc nguồn).                                   │
 * │ · `useTranslation` bị thay bằng bản trả KHOÁ (tiền lệ `ProtectedRoute.spec.tsx`) để đọc được lý   │
 * │   do của trang cấm (`forbidden.reason.*`). Chữ của màn KHÔNG đo ở đây — đo ở spec của từng màn.   │
 * │ · `ProtectedShell` + `SocialPortalShell` là passthrough: cổng chặn thì con không mount nên vô hại,│
 * │   cổng hở thì màn mount và lời gọi của nó lộ ra. Bỏ vỏ portal còn tránh 5 query của hai rail.     │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
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
import { ModerationPage } from "../moderation/ModerationPage";

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
 * Ca G1 dựng nội dung route NGOÀI router ⇒ `Link` / `useNavigate` / `useSearch` phải là bản giả. Ca
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
const MODERATION_TITLE = "admin.moderation.page.title";
const FILTER_LABEL = "admin.moderation.page.filterLabel";
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

describe("G1 — cổng route `/feed/moderation` (SOC-SCREEN-010) = `view:feed` + `view:feed-report`", () => {
  const renderModeration = (): Promise<void> =>
    renderRoute("social.moderation", <ModerationPage />);

  it(
    "ALLOW — `view:feed` + `view:feed-report` (manager) ⇒ màn mount, 028 được gọi ĐÚNG 1 lần",
    async () => {
      setCaps({ "view:feed": true, "view:feed-report": true });

      await renderModeration();

      await waitFor(() => expect(listReports).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("heading", { name: MODERATION_TITLE })).toBeInTheDocument();
      expect(screen.queryByText(FORBIDDEN_TITLE)).not.toBeInTheDocument();
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — chỉ `view:feed` (nhân viên thường) ⇒ trang cấm NO_PERMISSION, màn KHÔNG mount, 028 gọi 0 lần",
    async () => {
      setCaps({ "view:feed": true });

      await renderModeration();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: MODERATION_TITLE })).not.toBeInTheDocument();
      expect(listReports).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — có `manage:feed-report` + `manage:feed-post` nhưng thiếu `view:feed-report` ⇒ cấm (không suy manage ⇒ view), 028 gọi 0 lần",
    async () => {
      setCaps({ "view:feed": true, "manage:feed-report": true, "manage:feed-post": true });

      await renderModeration();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: MODERATION_TITLE })).not.toBeInTheDocument();
      expect(listReports).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — có `view:feed-report` nhưng thiếu `view:feed` (không vào được module) ⇒ cấm, 028 gọi 0 lần",
    async () => {
      setCaps({ "view:feed-report": true });

      await renderModeration();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(listReports).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );

  it(
    "DENY — chỉ có wildcard `*:*` ⇒ cấm: cổng route khớp ĐÚNG-BẰNG, không ăn wildcard",
    async () => {
      setCaps({ "*:*": true });

      await renderModeration();

      expect(await screen.findByText(FORBIDDEN_NO_PERMISSION)).toBeInTheDocument();
      expect(listReports).toHaveBeenCalledTimes(0);
    },
    ROUTER_IMPORT_TIMEOUT,
  );
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

// `ModerationPage` đổi bộ lọc / trang / tab bằng `navigate({ to: "." })` — chỗ DUY NHẤT trong app dùng
// đường dẫn tương đối đó. Sai một nét là đổi bộ lọc xong người kiểm duyệt bị đưa khỏi màn; các spec của
// màn dùng `navigate` giả nên chỉ so được literal. Ca này đi qua CHÍNH `router` của app (cây route thật,
// `validateSearch` thật, màn nạp qua `React.lazy` thật) và đọc URL router ghi ra.
describe("Router THẬT — đổi bộ lọc ở `/feed/moderation` ở lại đúng màn, thay TOÀN BỘ search", () => {
  it(
    "ALLOW — mở `?status=dismissed&page=3`, chọn «Đã giải quyết» ⇒ pathname còn `/feed/moderation`, search = ĐÚNG `?status=resolved`, 028 gọi lại với bộ lọc mới",
    async () => {
      routerMode.isReal = true;
      setCaps({ "view:feed": true, "view:feed-report": true });
      const { router } = await import("@/router");
      router.history.push("/feed/moderation?status=dismissed&page=3");
      await router.load();

      render(
        <QueryClientProvider client={makeTestQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );

      // Đối chứng: URL dán vào tới được 028 nguyên vẹn (`page` là SỐ) ⇒ search của route đang sống thật.
      await waitFor(() =>
        expect(listReports).toHaveBeenLastCalledWith({ status: "dismissed", page: 3, limit: 20 }),
      );
      expect(router.state.location.pathname).toBe("/feed/moderation");

      fireEvent.change(await screen.findByRole("combobox", { name: FILTER_LABEL }), {
        target: { value: "resolved" },
      });

      await waitFor(() => expect(router.state.location.searchStr).toBe("?status=resolved"));
      expect(router.state.location.pathname).toBe("/feed/moderation");
      await waitFor(() =>
        expect(listReports).toHaveBeenLastCalledWith({ status: "resolved", page: 1, limit: 20 }),
      );
      expect(screen.getByRole("heading", { name: MODERATION_TITLE })).toBeInTheDocument();
      expect(screen.queryByText(FORBIDDEN_TITLE)).not.toBeInTheDocument();
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
