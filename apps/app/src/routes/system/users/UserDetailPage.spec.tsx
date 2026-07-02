/**
 * [RED-trước · deny-path] UserDetailPage — S2-FE-AUTH-3.
 * Gate: view:user (AUTH.USER.VIEW). Lock/unlock buttons gated separately (lock:user/unlock:user)
 * via useCan (no PermissionGate wrap — button presence tied to current status too).
 * States: forbidden · loading · error · lock/unlock confirm flow.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { authUsersApi } from "@mediaos/web-core";
import type { AuthUserDto } from "@mediaos/contracts";
import { UserDetailPage } from "./UserDetailPage";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    authUsersApi: {
      getUser: vi.fn(),
      lockUser: vi.fn(),
      unlockUser: vi.fn(),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
}

function clearCapabilities() {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

const ACTIVE_USER: AuthUserDto = {
  id: "33333333-3333-3333-3333-333333333333",
  email: "active@demo.local",
  fullName: "Active User",
  status: "active",
  lockedAt: null,
  lockedReason: null,
  lastLoginAt: null,
  createdAt: "2024-01-01T00:00:00.000Z",
};

const LOCKED_USER: AuthUserDto = {
  ...ACTIVE_USER,
  status: "locked",
  lockedAt: "2024-02-01T00:00:00.000Z",
  lockedReason: "Vi phạm chính sách",
};

describe("UserDetailPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no view:user → forbidden, API not called ──────────────────
  it("renders forbidden state and does NOT call API when user lacks view:user", () => {
    setCapabilities({});
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(authUsersApi.getUser).not.toHaveBeenCalled();
  });

  // ── LOADING ────────────────────────────────────────────────────────────────
  it("shows loading state while fetching", () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.getUser).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    expect(screen.getByText(/đang tải/i)).toBeInTheDocument();
  });

  // ── ERROR ──────────────────────────────────────────────────────────────────
  it("shows error state when fetch fails", async () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.getUser).mockRejectedValue(new Error("network error"));
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải thông tin người dùng/i)).toBeInTheDocument(),
    );
  });

  // ── ALLOW: renders detail; lock button hidden without lock:user ────────────
  it("renders user detail and hides the lock button without lock:user", async () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(ACTIVE_USER);
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getAllByText("active@demo.local").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /khoá tài khoản/i })).not.toBeInTheDocument();
  });

  // ── ALLOW: lock button visible + confirm flow calls the API ────────────────
  it("locks the account after confirming the dialog", async () => {
    setCapabilities({ "view:user": true, "lock:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(ACTIVE_USER);
    vi.mocked(authUsersApi.lockUser).mockResolvedValue(LOCKED_USER);
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);

    await waitFor(() => expect(screen.getAllByText("active@demo.local").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /khoá tài khoản/i }));

    // ConfirmDialog renders a second "Khoá tài khoản" as the confirm button.
    const confirmButtons = screen.getAllByRole("button", { name: /khoá tài khoản/i });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(authUsersApi.lockUser).toHaveBeenCalledWith(ACTIVE_USER.id, {}));
  });

  // ── ALLOW: unlock button visible for a locked user with unlock:user ────────
  it("shows the unlock button for a locked user with unlock:user", async () => {
    setCapabilities({ "view:user": true, "unlock:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(LOCKED_USER);
    renderWithQuery(<UserDetailPage userId={LOCKED_USER.id} />);

    await waitFor(() => expect(screen.getAllByText("active@demo.local").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /mở khoá/i })).toBeInTheDocument();
    expect(screen.getByText("Vi phạm chính sách")).toBeInTheDocument();
  });
});
