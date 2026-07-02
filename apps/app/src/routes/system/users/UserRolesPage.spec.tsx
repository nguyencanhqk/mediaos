/**
 * [RED-trước · deny-path] UserRolesPage — S2-FE-AUTH-3.
 * Gate: assign-role:user (AUTH.USER.ASSIGN_ROLE, isSensitive — mutation-path G3-4).
 * States: forbidden · loading · error · empty · assign/revoke session log.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, ApiError } from "@mediaos/web-core";
import { authUsersApi } from "@mediaos/web-core";
import type { RoleListDto } from "@mediaos/contracts";
import { UserRolesPage } from "./UserRolesPage";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    authUsersApi: {
      listRoles: vi.fn(),
      assignRole: vi.fn(),
      revokeRole: vi.fn(),
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

const TARGET_USER_ID = "44444444-4444-4444-4444-444444444444";

const ROLES: RoleListDto = {
  roles: [
    { id: "role-001", name: "HR Manager", description: "Quản lý nhân sự", isSystem: false },
    { id: "role-002", name: "Employee", description: null, isSystem: true },
  ],
};

describe("UserRolesPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no assign-role:user → forbidden, API not called ────────────
  it("renders forbidden state and does NOT call API when user lacks assign-role:user", () => {
    setCapabilities({});
    renderWithQuery(<UserRolesPage userId={TARGET_USER_ID} />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(authUsersApi.listRoles).not.toHaveBeenCalled();
  });

  // ── LOADING ────────────────────────────────────────────────────────────────
  it("shows loading state while fetching the role catalog", () => {
    setCapabilities({ "assign-role:user": true });
    vi.mocked(authUsersApi.listRoles).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<UserRolesPage userId={TARGET_USER_ID} />);
    expect(screen.getByText(/đang tải/i)).toBeInTheDocument();
  });

  // ── ERROR ──────────────────────────────────────────────────────────────────
  it("shows error state when the catalog fetch fails", async () => {
    setCapabilities({ "assign-role:user": true });
    vi.mocked(authUsersApi.listRoles).mockRejectedValue(new Error("network error"));
    renderWithQuery(<UserRolesPage userId={TARGET_USER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh mục vai trò/i)).toBeInTheDocument(),
    );
  });

  // ── EMPTY ──────────────────────────────────────────────────────────────────
  it("shows empty state when the catalog has no roles", async () => {
    setCapabilities({ "assign-role:user": true });
    vi.mocked(authUsersApi.listRoles).mockResolvedValue({ roles: [] });
    renderWithQuery(<UserRolesPage userId={TARGET_USER_ID} />);
    await waitFor(() => expect(screen.getByText(/không có vai trò/i)).toBeInTheDocument());
  });

  // ── ALLOW: renders catalog + assign action logs success ────────────────────
  it("renders the role catalog and logs a successful assign", async () => {
    setCapabilities({ "assign-role:user": true });
    vi.mocked(authUsersApi.listRoles).mockResolvedValue(ROLES);
    vi.mocked(authUsersApi.assignRole).mockResolvedValue({
      id: "ur-1",
      userId: TARGET_USER_ID,
      roleId: "role-001",
      companyId: "co-001",
      grantedBy: "u1",
      expiresAt: null,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    renderWithQuery(<UserRolesPage userId={TARGET_USER_ID} />);

    await waitFor(() => expect(screen.getByText("HR Manager")).toBeInTheDocument());
    const assignButtons = screen.getAllByRole("button", { name: /^gán$/i });
    fireEvent.click(assignButtons[0]);

    await waitFor(() =>
      expect(authUsersApi.assignRole).toHaveBeenCalledWith(TARGET_USER_ID, {
        roleId: "role-001",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Đã gán vai trò "HR Manager"/)).toBeInTheDocument(),
    );
  });

  // ── ALLOW: revoke on a role not held surfaces the server 404 clearly ───────
  it("logs a clear error when revoking a role the user does not hold (404)", async () => {
    setCapabilities({ "assign-role:user": true });
    vi.mocked(authUsersApi.listRoles).mockResolvedValue(ROLES);
    vi.mocked(authUsersApi.revokeRole).mockRejectedValue(
      new ApiError(404, "AUTH-ERR-NOT-FOUND", "not assigned"),
    );
    renderWithQuery(<UserRolesPage userId={TARGET_USER_ID} />);

    await waitFor(() => expect(screen.getByText("Employee")).toBeInTheDocument());
    const revokeButtons = screen.getAllByRole("button", { name: /^gỡ$/i });
    fireEvent.click(revokeButtons[1]);

    await waitFor(() =>
      expect(
        screen.getByText(/Lỗi với vai trò "Employee": Người dùng chưa có vai trò này/),
      ).toBeInTheDocument(),
    );
  });

  // ── Limitation notice always visible (documents the missing BE read) ───────
  it("shows the known-limitation notice about missing current-roles read", async () => {
    setCapabilities({ "assign-role:user": true });
    vi.mocked(authUsersApi.listRoles).mockResolvedValue(ROLES);
    renderWithQuery(<UserRolesPage userId={TARGET_USER_ID} />);
    await waitFor(() => expect(screen.getByText("HR Manager")).toBeInTheDocument());
    expect(screen.getByText(/chưa hiển thị được vai trò ĐANG giữ/)).toBeInTheDocument();
  });
});
