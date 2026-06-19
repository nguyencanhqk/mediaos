import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import type { ApiKeyDto } from "@mediaos/contracts";
import { useAuthStore } from "@mediaos/web-core";
import { ApiKeysPage } from "./api-keys-page";

/**
 * ApiKeysPage (console DevOps — tenant aud=user) unit tests.
 * 1. Deny without manage:api-key → noPermission EmptyState + KHÔNG fetch.
 * 2. Allow + empty → empty state bảng.
 * 3. Allow + data → render row + nút Tạo.
 * 4. Allow + lỗi fetch → role=alert.
 * 5. Allow → fetch gọi đúng endpoint /api-keys.
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
  return render(<ApiKeysPage />, { wrapper });
}

function makeKey(overrides: Partial<ApiKeyDto> = {}): ApiKeyDto {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "CI deploy bot",
    tokenPrefix: "mok_ab12",
    scopePermissionIds: [],
    status: "active",
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: "2026-06-18T08:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAuthStore.setState({ capabilities: {} });
});

describe("ApiKeysPage (gate manage:api-key)", () => {
  it("KHÔNG có manage:api-key → EmptyState 'Không có quyền quản lý API key'", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText("Không có quyền quản lý API key")).toBeInTheDocument();
  });

  it("KHÔNG có manage:api-key → KHÔNG fetch", () => {
    setCaps({});
    const fetchMock = stubFetch({ ok: true, status: 200, body: [] });
    renderPage();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("có manage:api-key + rỗng → empty state bảng", async () => {
    setCaps({ "manage:api-key": true });
    stubFetch({ ok: true, status: 200, body: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText("Chưa có API key nào.")).toBeInTheDocument());
  });

  it("có manage:api-key + data → render row + nút Tạo API key", async () => {
    setCaps({ "manage:api-key": true });
    stubFetch({ ok: true, status: 200, body: [makeKey()] });
    renderPage();
    await waitFor(() => expect(screen.getByText("CI deploy bot")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Tạo API key" })).toBeInTheDocument();
  });

  it("có manage:api-key + lỗi fetch → role=alert", async () => {
    setCaps({ "manage:api-key": true });
    stubFetch({ ok: false, status: 500, body: {} });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("có manage:api-key → fetch gọi đúng endpoint /api-keys", async () => {
    setCaps({ "manage:api-key": true });
    const fetchMock = stubFetch({ ok: true, status: 200, body: [] });
    renderPage();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api-keys"),
        expect.anything(),
      ),
    );
  });
});
