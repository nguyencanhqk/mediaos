// @vitest-environment jsdom
/**
 * S16-SOCIAL-FE-3 — ca **G1**: cổng ROUTE của màn quản trị SOCIAL, đo trên đường dựng THẬT của router.
 *
 * Mỗi ca dựng đúng thứ `router.tsx` dựng cho route đó — `buildModuleRouteContent(getMeta(<routeKey>),
 * "SOCIAL", <màn thật />)` — rồi đo HAI thứ cùng lúc: `ProtectedRoute` vẽ gì, và lời gọi ĐẦU TIÊN của màn
 * có phát đi hay không. Cổng route lỏng hơn cặp của lời gọi đó thì người thiếu quyền vào được màn rồi ăn
 * 403 của server; ca DENY ở đây đỏ trước khi chuyện đó tới tay người dùng.
 *
 * ┌─ GIỚI HẠN ĐÃ BIẾT ───────────────────────────────────────────────────────────────────────────────┐
 * │ · Ca KHÔNG đi qua cây route: `routeKey` truyền cho `getMeta` ở đây là bản chép TAY của literal    │
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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeTestQueryClient, resetCaps, setCaps } from "../feed/social-test-doubles";
import { makeReport, makeReportPage } from "./admin-test-doubles";
import { ModerationPage } from "../moderation/ModerationPage";

const listReports = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialModerationApi: {
      ...actual.socialModerationApi,
      listReports: (...a: unknown[]) => listReports(...a),
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

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
    useNavigate: () => () => undefined,
    useSearch: () => ({}),
  };
});

/** `import("@/router")` nạp cả đồ thị route — ca ĐẦU TIÊN trả giá (tiền lệ `ProtectedRoute.spec.tsx`). */
const ROUTER_IMPORT_TIMEOUT = 20_000;

/** Khoá do `useTranslation` giả trả về. Viết tay. */
const FORBIDDEN_TITLE = "forbidden.title";
const FORBIDDEN_NO_PERMISSION = "forbidden.reason.NO_PERMISSION";
const MODERATION_TITLE = "admin.moderation.page.title";

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
});
afterEach(() => {
  cleanup();
  resetCaps();
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
