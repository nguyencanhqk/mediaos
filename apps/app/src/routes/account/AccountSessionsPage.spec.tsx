/**
 * AccountSessionsPage — S2-FE-AUTH-5 (lane FE batch C).
 * Authenticated-only (KHÔNG permission pair — S2-AUTH-BE-7: Own scope, owner-check ở service, mirror
 * /auth/me). "Phiên này" (is_current) KHÔNG có nút thu hồi. Revoke/revoke-others qua ConfirmDialog.
 * States: loading · error · empty · list + revoke + revoke-others.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, authApi } from "@mediaos/web-core";
import { AccountSessionsPage } from "./AccountSessionsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      listSessions: vi.fn(),
      revokeSession: vi.fn(),
      revokeOtherSessions: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setAuthenticated() {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: {},
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const CURRENT_SESSION = {
  id: "sess-current",
  device_name: "Chrome",
  platform: "Windows",
  ip_address: "127.0.0.1",
  user_agent: "UA",
  last_used_at: "2026-07-02T00:00:00.000Z",
  created_at: "2026-07-01T00:00:00.000Z",
  expired_at: "2026-07-08T00:00:00.000Z",
  is_current: true,
};

const OTHER_SESSION = {
  id: "sess-other",
  device_name: "Safari",
  platform: "macOS",
  ip_address: "10.0.0.1",
  user_agent: "UA2",
  last_used_at: null,
  created_at: "2026-06-30T00:00:00.000Z",
  expired_at: "2026-07-07T00:00:00.000Z",
  is_current: false,
};

describe("AccountSessionsPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    setAuthenticated();
  });

  it("shows loading skeleton while fetching", () => {
    vi.mocked(authApi.listSessions).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<AccountSessionsPage />);
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows error state on failure", async () => {
    vi.mocked(authApi.listSessions).mockRejectedValue(new Error("net"));
    renderWithQuery(<AccountSessionsPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh sách phiên/i)).toBeInTheDocument(),
    );
  });

  it("shows empty state when there are no sessions", async () => {
    vi.mocked(authApi.listSessions).mockResolvedValue([]);
    renderWithQuery(<AccountSessionsPage />);
    await waitFor(() => expect(screen.getByText(/không có phiên đăng nhập/i)).toBeInTheDocument());
  });

  it("renders sessions, marks the current one, and hides revoke for it", async () => {
    vi.mocked(authApi.listSessions).mockResolvedValue([CURRENT_SESSION, OTHER_SESSION]);
    renderWithQuery(<AccountSessionsPage />);
    await waitFor(() => expect(screen.getByText(/chrome/i)).toBeInTheDocument());
    expect(screen.getByText("Phiên này")).toBeInTheDocument();
    // Chỉ 1 nút "Thu hồi" (phiên khác) — phiên hiện tại KHÔNG có nút.
    expect(screen.getAllByRole("button", { name: "Thu hồi" })).toHaveLength(1);
  });

  it("revokes a single session via confirm dialog", async () => {
    vi.mocked(authApi.listSessions).mockResolvedValue([CURRENT_SESSION, OTHER_SESSION]);
    vi.mocked(authApi.revokeSession).mockResolvedValue({ ok: true, revoked_count: 1 });
    renderWithQuery(<AccountSessionsPage />);
    await waitFor(() => expect(screen.getByText(/safari/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Thu hồi" }));
    const dialog = await screen.findByRole("dialog", { name: /xác nhận thu hồi phiên/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /xác nhận/i }));

    await waitFor(() => expect(authApi.revokeSession).toHaveBeenCalledWith("sess-other"));
    await waitFor(() =>
      expect(screen.getByText(/đã thu hồi phiên đăng nhập/i)).toBeInTheDocument(),
    );
  });

  it("revokes all other sessions via confirm dialog", async () => {
    vi.mocked(authApi.listSessions).mockResolvedValue([CURRENT_SESSION, OTHER_SESSION]);
    vi.mocked(authApi.revokeOtherSessions).mockResolvedValue({ ok: true, revoked_count: 1 });
    renderWithQuery(<AccountSessionsPage />);
    await waitFor(() => expect(screen.getByText(/safari/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /thu hồi mọi phiên khác/i }));
    const dialog = await screen.findByRole("dialog", {
      name: /xác nhận thu hồi mọi phiên khác/i,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /xác nhận/i }));

    await waitFor(() => expect(authApi.revokeOtherSessions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/đã thu hồi 1 phiên khác/i)).toBeInTheDocument());
  });

  it("hides 'Thu hồi mọi phiên khác' when there is only the current session", async () => {
    vi.mocked(authApi.listSessions).mockResolvedValue([CURRENT_SESSION]);
    renderWithQuery(<AccountSessionsPage />);
    await waitFor(() => expect(screen.getByText(/chrome/i)).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: /thu hồi mọi phiên khác/i }),
    ).not.toBeInTheDocument();
  });

  // ── QA-06 no-leak: token KHÔNG trong localStorage/sessionStorage ─────────────
  it("does not persist any auth token in web storage", async () => {
    vi.mocked(authApi.listSessions).mockResolvedValue([CURRENT_SESSION]);
    renderWithQuery(<AccountSessionsPage />);
    await waitFor(() => expect(screen.getByText(/chrome/i)).toBeInTheDocument());
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) ?? "";
        const value = storage.getItem(key) ?? "";
        expect(`${key}${value}`).not.toMatch(/token|jwt|eyJ/i);
      }
    }
  });
});
