/**
 * RoleDetailPage — S2-FE-AUTH-4 (lane FE batch C).
 * Gate: view:role. Edit button ẨN cho role isSystem=true (kể cả có update:role) + hiện badge "Hệ thống".
 * States: forbidden · loading · error/not-found · detail.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, roleAdminApi } from "@mediaos/web-core";
import { RoleDetailPage } from "./RoleDetailPage";

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

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const ROLES = [
  { id: "role-1", name: "Kế toán", description: "Vai trò kế toán", isSystem: false },
  { id: "role-sys", name: "Super Admin", description: null, isSystem: true },
];

describe("RoleDetailPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(roleAdminApi.listRoles).mockResolvedValue(ROLES);
  });

  it("shows forbidden when user lacks view:role", () => {
    setCaps({});
    renderWithQuery(<RoleDetailPage roleId="role-1" />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
  });

  it("shows loading skeleton while fetching", () => {
    setCaps({ "view:role": true });
    vi.mocked(roleAdminApi.listRoles).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<RoleDetailPage roleId="role-1" />);
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows not-found error when role id does not exist", async () => {
    setCaps({ "view:role": true });
    renderWithQuery(<RoleDetailPage roleId="unknown" />);
    await waitFor(() => expect(screen.getByText(/không tìm thấy vai trò/i)).toBeInTheDocument());
  });

  it("renders role detail + edit button for company role with update:role", async () => {
    setCaps({ "view:role": true, "update:role": true });
    renderWithQuery(<RoleDetailPage roleId="role-1" onEdit={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText("Kế toán").length).toBeGreaterThan(0));
    expect(screen.getByText("Sửa vai trò")).toBeInTheDocument();
  });

  it("hides edit button for system role even with update:role", async () => {
    setCaps({ "view:role": true, "update:role": true });
    renderWithQuery(<RoleDetailPage roleId="role-sys" onEdit={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText("Super Admin").length).toBeGreaterThan(0));
    expect(screen.queryByText("Sửa vai trò")).not.toBeInTheDocument();
    expect(screen.getByText("Hệ thống")).toBeInTheDocument();
  });

  it("hides 'Quản lý quyền' button when user lacks assign:permission", async () => {
    setCaps({ "view:role": true });
    renderWithQuery(<RoleDetailPage roleId="role-1" onManagePermissions={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText("Kế toán").length).toBeGreaterThan(0));
    expect(screen.queryByText("Quản lý quyền")).not.toBeInTheDocument();
  });

  it("shows 'Quản lý quyền' button when user has assign:permission", async () => {
    setCaps({ "view:role": true, "assign:permission": true });
    renderWithQuery(<RoleDetailPage roleId="role-1" onManagePermissions={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText("Kế toán").length).toBeGreaterThan(0));
    expect(screen.getByText("Quản lý quyền")).toBeInTheDocument();
  });
});
