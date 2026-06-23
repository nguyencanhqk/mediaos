import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * [RED-trước · deny/redirect-path] Bảo vệ luồng auth SSO của vỏ nghiệp vụ.
 *
 * KHÔNG có phiên (bootstrapSession → false) ⇒ boot() PHẢI:
 *   1. gọi redirectToAuth() đúng 1 lần (điều hướng về app đăng nhập trung tâm), VÀ
 *   2. KHÔNG mount UI (không createRoot().render) — không rò vỏ nghiệp vụ cho khách chưa đăng nhập.
 *
 * Mock toàn bộ @mediaos/web-core qua PUBLIC index (không chạm file nội bộ auth/token).
 */

const bootstrapSession = vi.fn();
const redirectToAuth = vi.fn();
const configureApiBaseUrl = vi.fn();
const configureAuthAppUrl = vi.fn();
const configureClientVersion = vi.fn();
const shouldRetryQuery = vi.fn(() => false);
const renderSpy = vi.fn();
const createRootSpy = vi.fn(() => ({ render: renderSpy, unmount: vi.fn() }));

vi.mock("@mediaos/web-core", () => ({
  bootstrapSession,
  redirectToAuth,
  configureApiBaseUrl,
  configureAuthAppUrl,
  // S1-FE-QUERY-WIRE-1: main.tsx truyền version + lắp retry policy vào QueryClient.
  configureClientVersion,
  shouldRetryQuery,
  // i18n re-export dùng bởi @/i18n (NAMED `i18n`) — chỉ cần object react-i18next-compatible.
  i18n: { t: (k: string) => k, on: vi.fn(), off: vi.fn(), changeLanguage: vi.fn() },
  registerI18nResources: vi.fn(),
  getAuthRedirectUrl: vi.fn(() => "https://auth.localhost/login"),
  useAuthStore: Object.assign(vi.fn(), { getState: () => ({ isAuthenticated: false }) }),
}));

vi.mock("react-dom/client", () => ({
  createRoot: createRootSpy,
  default: { createRoot: createRootSpy },
}));

// Router import kéo theo @/i18n + web-core (đã mock) — giữ nhẹ, không cần router thật cho deny-path.
vi.mock("@/router", () => ({ router: {} }));

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("apps/app boot() — deny/redirect khi chưa có phiên", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("không có phiên ⇒ redirectToAuth() đúng 1 lần và KHÔNG render UI", async () => {
    bootstrapSession.mockResolvedValue(false);

    await import("@/main");
    await flushMicrotasks();

    expect(bootstrapSession).toHaveBeenCalledTimes(1);
    expect(redirectToAuth).toHaveBeenCalledTimes(1);
    expect(renderSpy).not.toHaveBeenCalled();
    expect(createRootSpy).not.toHaveBeenCalled();
  });

  it("cấu hình base URL API + auth app URL trước khi bootstrap (boot side-effect)", async () => {
    bootstrapSession.mockResolvedValue(false);

    await import("@/main");
    await flushMicrotasks();

    expect(configureApiBaseUrl).toHaveBeenCalledTimes(1);
    expect(configureAuthAppUrl).toHaveBeenCalledTimes(1);
  });
});
