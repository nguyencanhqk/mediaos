/**
 * RolesPage — S2-FE-AUTH-4 (lane FE batch C).
 * Gate: view:role — canonical engine pair AUTH.ROLE.VIEW → view:role
 *   (DB-02 §9.1 + seed §13 migration 0444: chỉ company-admin được view:role/Company).
 * Deny-path dùng view:user (role hr có view:user nhưng KHÔNG có view:role) — bắt đúng drift
 *   theo cặp seed-truth, KHÔNG khớp cặp FE sai để xanh giả.
 * States: loading · error · empty · forbidden · list render · create button gate (create:role).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, roleAdminApi } from "@mediaos/web-core";
import { RolesPage } from "./RolesPage";

// ---------------------------------------------------------------------------
// Mocks — giữ web-core thật (useCan/store/PermissionGate/i18n), chỉ stub API surface.
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    roleAdminApi: {
      listRoles: vi.fn(),
      listPermissions: vi.fn(),
      createRole: vi.fn(),
      updateRole: vi.fn(),
      assignPermission: vi.fn(),
      revokePermission: vi.fn(),
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_ROLES = [
  { id: "role-001", name: "Super Admin", description: null, isSystem: true },
  { id: "role-002", name: "HR Manager", description: "Quản lý nhân sự", isSystem: false },
  { id: "role-003", name: "Employee", description: null, isSystem: false },
];

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

describe("RolesPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
    vi.mocked(roleAdminApi.listRoles).mockResolvedValue(MOCK_ROLES);
  });

  // ── DENY-PATH: no view:role → forbidden, API not called ──────────────────
  it("renders forbidden state and does NOT call API when user lacks view:role", () => {
    setCapabilities({});
    renderWithQuery(<RolesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(roleAdminApi.listRoles).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: view:user (hr) but not view:role → still forbidden ─────────
  it("renders forbidden when user has view:user but not view:role", () => {
    setCapabilities({ "view:user": true });
    renderWithQuery(<RolesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(roleAdminApi.listRoles).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: view:role → list renders (name/description/isSystem badge) ─
  it("renders roles list when user has view:role", async () => {
    setCapabilities({ "view:role": true });
    renderWithQuery(<RolesPage />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());
    expect(screen.getByText("HR Manager")).toBeInTheDocument();
    expect(screen.getByText("Employee")).toBeInTheDocument();
    expect(screen.getByText("Quản lý nhân sự")).toBeInTheDocument();
    expect(screen.getByText("Hệ thống")).toBeInTheDocument();
  });

  // ── LOADING state ─────────────────────────────────────────────────────────
  it("shows loading skeleton while fetching", () => {
    setCapabilities({ "view:role": true });
    vi.mocked(roleAdminApi.listRoles).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<RolesPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  // ── ERROR state ───────────────────────────────────────────────────────────
  it("shows error state when API fails", async () => {
    setCapabilities({ "view:role": true });
    vi.mocked(roleAdminApi.listRoles).mockRejectedValue(new Error("network error"));
    renderWithQuery(<RolesPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeInTheDocument());
  });

  // ── EMPTY state ───────────────────────────────────────────────────────────
  it("shows empty state when no roles returned", async () => {
    setCapabilities({ "view:role": true });
    vi.mocked(roleAdminApi.listRoles).mockResolvedValue([]);
    renderWithQuery(<RolesPage />);
    await waitFor(() => expect(screen.getByText(/không có vai trò/i)).toBeInTheDocument());
  });

  // ── PermissionGate: create button ──────────────────────────────────────────
  it("hides 'Tạo vai trò' button when user lacks create:role", async () => {
    setCapabilities({ "view:role": true });
    renderWithQuery(<RolesPage />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());
    expect(screen.queryByText("Tạo vai trò")).not.toBeInTheDocument();
  });

  it("shows 'Tạo vai trò' button when user has create:role", async () => {
    setCapabilities({ "view:role": true, "create:role": true });
    renderWithQuery(<RolesPage />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());
    expect(screen.getByText("Tạo vai trò")).toBeInTheDocument();
  });

  // ── PermissionGate: manage-permissions row action ───────────────────────────
  it("hides per-row 'Quản lý quyền' action when user lacks assign:permission", async () => {
    setCapabilities({ "view:role": true });
    renderWithQuery(<RolesPage />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());
    expect(screen.queryByLabelText("Quản lý quyền")).not.toBeInTheDocument();
  });

  it("shows per-row 'Quản lý quyền' action when user has assign:permission", async () => {
    setCapabilities({ "view:role": true, "assign:permission": true });
    renderWithQuery(<RolesPage />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());
    expect(screen.getAllByLabelText("Quản lý quyền").length).toBeGreaterThan(0);
  });
});
