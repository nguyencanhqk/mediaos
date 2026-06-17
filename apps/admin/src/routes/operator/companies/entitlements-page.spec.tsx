import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntitlementsPage } from "./entitlements-page";
import { useAuthStore } from "@/stores/auth";

// useParams trả companyId cố định (route /tenant/:companyId/entitlements).
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ companyId: "22222222-2222-2222-2222-222222222222" }),
}));

interface MockRes {
  ok: boolean;
  status: number;
  body?: unknown;
  text?: string;
}

/**
 * fetch stub theo path: getEntitlements (/entitlements) trả entitlements; mặc định trả body chung.
 * Page gọi 1 query getEntitlements (features + limits cùng 1 payload) ⇒ chỉ cần 1 matcher.
 */
function stubFetchByPath(routes: { match: string; res: MockRes }[], fallback: MockRes) {
  const fetchMock = vi.fn((url: string) => {
    const r = routes.find((x) => String(url).includes(x.match))?.res ?? fallback;
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      json: async () => r.body,
      text: async () => r.text ?? JSON.stringify(r.body ?? ""),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<EntitlementsPage />, { wrapper });
}

const entitlements = {
  planCode: "pro",
  features: [
    { featureKey: "advanced_analytics", enabled: true, source: "plan" },
    { featureKey: "custom_workflows", enabled: false, source: "override" },
  ],
  limits: [{ metricKey: "max_channels", limit: 100, used: 3, source: "plan", period: "lifetime" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe("EntitlementsPage", () => {
  it("hiển thị tiêu đề trang", () => {
    setCaps({ "manage:platform-subscription": true });
    stubFetchByPath([], { ok: true, status: 200, body: { planCode: "", features: [], limits: [] } });
    renderPage();
    expect(screen.getByRole("heading", { name: "Quyền lợi gói" })).toBeInTheDocument();
  });

  it("render feature-flag + usage-limit khi load xong", async () => {
    setCaps({ "manage:platform-subscription": true });
    stubFetchByPath([{ match: "/entitlements", res: { ok: true, status: 200, body: entitlements } }], {
      ok: true,
      status: 200,
      body: entitlements,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("advanced_analytics")).toBeInTheDocument());
    expect(screen.getByText("custom_workflows")).toBeInTheDocument();
    expect(screen.getByText("max_channels")).toBeInTheDocument();
  });

  it("hiển thị empty state khi không có quyền lợi nào", async () => {
    setCaps({ "manage:platform-subscription": true });
    stubFetchByPath([], { ok: true, status: 200, body: { planCode: "", features: [], limits: [] } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Chưa có quyền lợi nào")).toBeInTheDocument());
  });

  it("hiển thị error + nút thử lại khi load lỗi (deny/500)", async () => {
    setCaps({ "manage:platform-subscription": true });
    stubFetchByPath([], {
      ok: false,
      status: 403,
      text: JSON.stringify({ error: { code: "FORBIDDEN", message: "no" } }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("ẨN form đặt quyền lợi khi thiếu manage:platform-subscription (permission-gated)", async () => {
    setCaps({});
    stubFetchByPath([{ match: "/entitlements", res: { ok: true, status: 200, body: entitlements } }], {
      ok: true,
      status: 200,
      body: entitlements,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("advanced_analytics")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Lưu feature-flag" })).not.toBeInTheDocument();
  });

  it("HIỆN form đặt feature-flag khi có manage:platform-subscription", async () => {
    setCaps({ "manage:platform-subscription": true });
    stubFetchByPath([{ match: "/entitlements", res: { ok: true, status: 200, body: entitlements } }], {
      ok: true,
      status: 200,
      body: entitlements,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("advanced_analytics")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Lưu feature-flag" })).toBeInTheDocument();
  });
});
