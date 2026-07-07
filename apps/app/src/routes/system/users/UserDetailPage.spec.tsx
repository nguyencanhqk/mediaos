/**
 * [RED-trước · deny-path] UserDetailPage — S2-FE-AUTH-3 + S2-FE-SYS-SEC-1.
 * Gate: view:user (page). Lock/unlock via useCan(lock:user/unlock:user). 2FA:
 *  - Toggle 'Ép 2FA' → useCan(update:user) (ẩn khi thiếu).
 *  - Reset 2FA → useCanExact('reset-2fa','user') FAIL-CLOSED (wildcard '*:*' KHÔNG mở cổng).
 * States: forbidden · loading · error · lock/unlock/reset confirm flow.
 * BẤT BIẾN #3: KHÔNG render secret/recovery-code; reset chỉ phơi revokedSessionCount.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, authUsersApi, ApiError } from "@mediaos/web-core";
import type { AuthUserDetailDto } from "@mediaos/contracts";
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
      updateUser: vi.fn(),
      resetTwoFactor: vi.fn(),
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

const ACTIVE_USER: AuthUserDetailDto = {
  id: "33333333-3333-3333-3333-333333333333",
  email: "active@demo.local",
  fullName: "Active User",
  status: "active",
  lockedAt: null,
  lockedReason: null,
  lastLoginAt: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  deletedAt: null, // S2-AUTH-USEROPS-1: mốc xóa mềm (null = LIVE)
  twoFactor: { enabled: false, requiredByRole: false, requiredByUser: false },
};

const LOCKED_USER: AuthUserDetailDto = {
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

// ---------------------------------------------------------------------------
// S2-FE-SYS-SEC-1 — 2FA card (source label · toggle · reset fail-closed)
// ---------------------------------------------------------------------------
describe("UserDetailPage — 2FA card", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── Source label: requiredByRole vs requiredByUser ─────────────────────────
  it("labels enforcement source as 'theo vai trò' when requiredByRole", async () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue({
      ...ACTIVE_USER,
      twoFactor: { enabled: true, requiredByRole: true, requiredByUser: false },
    });
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getByText(/xác thực 2 lớp/i)).toBeInTheDocument());
    expect(screen.getByText(/theo vai trò/i)).toBeInTheDocument();
    expect(screen.queryByText(/theo tài khoản/i)).not.toBeInTheDocument();
  });

  it("labels enforcement source as 'theo tài khoản' when requiredByUser", async () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue({
      ...ACTIVE_USER,
      twoFactor: { enabled: true, requiredByRole: false, requiredByUser: true },
    });
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getByText(/xác thực 2 lớp/i)).toBeInTheDocument());
    expect(screen.getByText(/theo tài khoản/i)).toBeInTheDocument();
    expect(screen.queryByText(/theo vai trò/i)).not.toBeInTheDocument();
  });

  it("shows 'Không bắt buộc' when neither source enforces 2FA", async () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(ACTIVE_USER);
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getByText(/không bắt buộc/i)).toBeInTheDocument());
  });

  // ── DENY: toggle 'Ép 2FA' hidden + not called without update:user ──────────
  it("hides the 'Ép 2FA' toggle and does NOT call updateUser without update:user", async () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(ACTIVE_USER);
    const { container } = renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getByText(/xác thực 2 lớp/i)).toBeInTheDocument());
    expect(container.querySelector("#requireTwoFactor")).not.toBeInTheDocument();
    expect(authUsersApi.updateUser).not.toHaveBeenCalled();
  });

  // ── ALLOW: toggle visible + PATCH {requireTwoFactor} with update:user ──────
  it("shows the toggle and calls updateUser with {requireTwoFactor} when toggled", async () => {
    setCapabilities({ "view:user": true, "update:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(ACTIVE_USER);
    vi.mocked(authUsersApi.updateUser).mockResolvedValue(ACTIVE_USER);
    const { container } = renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getByText(/xác thực 2 lớp/i)).toBeInTheDocument());

    const toggle = container.querySelector("#requireTwoFactor") as HTMLInputElement;
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(authUsersApi.updateUser).toHaveBeenCalledWith(ACTIVE_USER.id, {
        requireTwoFactor: true,
      }),
    );
  });

  // ── DENY (fail-closed): Reset 2FA hidden with caps={} ──────────────────────
  it("hides Reset 2FA button when capabilities are empty", async () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(ACTIVE_USER);
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getByText(/xác thực 2 lớp/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /đặt lại 2fa/i })).not.toBeInTheDocument();
  });

  // ── DENY (fail-closed): wildcard '*:*' must NOT open the sensitive reset gate
  it("hides Reset 2FA button when only wildcard '*:*' is granted (fail-closed)", async () => {
    setCapabilities({ "*:*": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(ACTIVE_USER);
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getByText(/xác thực 2 lớp/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /đặt lại 2fa/i })).not.toBeInTheDocument();
  });

  // ── ALLOW: exact reset-2fa:user → button visible ───────────────────────────
  it("shows Reset 2FA button with the exact reset-2fa:user grant", async () => {
    setCapabilities({ "view:user": true, "reset-2fa:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(ACTIVE_USER);
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getByText(/xác thực 2 lớp/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /đặt lại 2fa/i })).toBeInTheDocument();
  });

  // ── ALLOW: reset flow → confirm → resetTwoFactor + success toast ───────────
  it("resets 2FA after confirm and shows a success toast with revoked session count", async () => {
    setCapabilities({ "view:user": true, "reset-2fa:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(ACTIVE_USER);
    vi.mocked(authUsersApi.resetTwoFactor).mockResolvedValue({ revokedSessionCount: 3 });
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getByText(/xác thực 2 lớp/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /đặt lại 2fa/i }));

    // ConfirmDialog renders a confirm button also labelled "Đặt lại 2FA".
    const resetButtons = screen.getAllByRole("button", { name: /đặt lại 2fa/i });
    fireEvent.click(resetButtons[resetButtons.length - 1]);

    await waitFor(() => expect(authUsersApi.resetTwoFactor).toHaveBeenCalledWith(ACTIVE_USER.id));
    // Toast surfaces ONLY revokedSessionCount (no secret / recovery code).
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/thu hồi 3 phiên/i));
  });

  // ── ERROR: reset 403 → forbidden message surfaced ──────────────────────────
  it("surfaces a forbidden message when reset returns 403", async () => {
    setCapabilities({ "view:user": true, "reset-2fa:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(ACTIVE_USER);
    vi.mocked(authUsersApi.resetTwoFactor).mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "forbidden"),
    );
    renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getByText(/xác thực 2 lớp/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /đặt lại 2fa/i }));
    const resetButtons = screen.getAllByRole("button", { name: /đặt lại 2fa/i });
    fireEvent.click(resetButtons[resetButtons.length - 1]);

    await waitFor(() =>
      expect(screen.getByText(/bạn không có quyền thực hiện thao tác này/i)).toBeInTheDocument(),
    );
  });

  // ── SECURITY (BẤT BIẾN #3): no secret / recovery-code / TOTP in the DOM ─────
  it("never renders any TOTP secret or recovery code", async () => {
    setCapabilities({ "view:user": true, "reset-2fa:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue({
      ...ACTIVE_USER,
      twoFactor: { enabled: true, requiredByRole: false, requiredByUser: true },
    });
    const { container } = renderWithQuery(<UserDetailPage userId={ACTIVE_USER.id} />);
    await waitFor(() => expect(screen.getByText(/xác thực 2 lớp/i)).toBeInTheDocument());

    const html = container.innerHTML.toLowerCase();
    expect(html).not.toMatch(/secret/);
    expect(html).not.toMatch(/recovery/);
    expect(html).not.toMatch(/otpauth/);
    expect(html).not.toMatch(/cipher/);
  });
});
