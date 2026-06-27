import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import type { WebhookEndpointDto } from "@mediaos/contracts";
import { useAuthStore } from "@mediaos/web-core";
import { WebhooksPage } from "./webhooks-page";

/**
 * WebhooksPage (console DevOps — tenant aud=user) unit tests.
 * 1. Deny without view:webhook → noPermission EmptyState + KHÔNG fetch.
 * 2. view-only (không manage) → KHÔNG hiện nút Tạo endpoint.
 * 3. manage → hiện nút Tạo endpoint.
 * 4. có view + data → render endpoint row.
 * 5. lỗi fetch → role=alert.
 */

function stubFetch(res: { ok: boolean; status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: async () => res.body,
    text: async () => JSON.stringify(res.body ?? ""),
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
  return render(<WebhooksPage />, { wrapper });
}

function makeEndpoint(overrides: Partial<WebhookEndpointDto> = {}): WebhookEndpointDto {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    url: "https://hooks.example.com/mediaos",
    description: "Prod hook",
    active: true,
    createdAt: "2026-06-18T08:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAuthStore.setState({ capabilities: {} });
});

describe("WebhooksPage (gate view/manage:webhook)", () => {
  it("KHÔNG có view:webhook → EmptyState 'Không có quyền xem webhook' + KHÔNG fetch", () => {
    setCaps({});
    const fetchMock = stubFetch({ ok: true, status: 200, body: [] });
    renderPage();
    expect(screen.getByText("Không có quyền xem webhook")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("chỉ view (không manage) → KHÔNG hiện nút Tạo endpoint", async () => {
    setCaps({ "view:webhook": true });
    stubFetch({ ok: true, status: 200, body: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText("Chưa có endpoint nào.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Tạo endpoint" })).not.toBeInTheDocument();
  });

  it("có manage → hiện nút Tạo endpoint", async () => {
    setCaps({ "view:webhook": true, "manage:webhook": true });
    stubFetch({ ok: true, status: 200, body: [] });
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Tạo endpoint" })).toBeInTheDocument(),
    );
  });

  it("có view + data → render endpoint row", async () => {
    setCaps({ "view:webhook": true });
    stubFetch({ ok: true, status: 200, body: [makeEndpoint()] });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("https://hooks.example.com/mediaos")).toBeInTheDocument(),
    );
  });

  it("có view + lỗi fetch → role=alert", async () => {
    setCaps({ "view:webhook": true });
    stubFetch({ ok: false, status: 500, body: {} });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
