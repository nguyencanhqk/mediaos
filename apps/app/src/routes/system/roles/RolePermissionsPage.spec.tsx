/**
 * RolePermissionsPage — S2-FE-AUTH-4 (lane FE batch C).
 * Gate: assign:permission (is_sensitive=true) — useCanExact (KHÔNG wildcard kế thừa qua useCan).
 * Bảng = TOÀN BỘ danh mục quyền (GET /auth/permissions) dùng làm nguồn gán/thu hồi — KHÔNG phản ánh
 * trạng thái ĐÃ gán (BE chưa có API list-by-role — banner ghi rõ, test bắt banner tồn tại).
 * States: forbidden · loading · error/role-not-found · list + assign/revoke actions.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, roleAdminApi } from "@mediaos/web-core";
import { RolePermissionsPage } from "./RolePermissionsPage";

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

const ROLES = [{ id: "role-1", name: "Kế toán", description: null, isSystem: false }];
const PERMISSIONS = [
  { id: "p1", action: "view", resourceType: "department", isSensitive: false },
  { id: "p2", action: "assign", resourceType: "permission", isSensitive: true },
];

describe("RolePermissionsPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(roleAdminApi.listRoles).mockResolvedValue(ROLES);
    vi.mocked(roleAdminApi.listPermissions).mockResolvedValue(PERMISSIONS);
  });

  // ── DENY-PATH: wildcard KHÔNG mở khoá cặp sensitive (useCanExact) ─────────
  it("shows forbidden even with a wildcard '*:*' (assign:permission is sensitive)", () => {
    setCaps({ "*:*": true });
    renderWithQuery(<RolePermissionsPage roleId="role-1" />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(roleAdminApi.listPermissions).not.toHaveBeenCalled();
  });

  it("shows loading while fetching role + permission catalog", () => {
    setCaps({ "assign:permission": true });
    vi.mocked(roleAdminApi.listPermissions).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<RolePermissionsPage roleId="role-1" />);
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows error when role id does not exist", async () => {
    setCaps({ "assign:permission": true });
    renderWithQuery(<RolePermissionsPage roleId="unknown" />);
    await waitFor(() => expect(screen.getByText(/không thể tải dữ liệu/i)).toBeInTheDocument());
  });

  it("renders permission catalog + assigned-list-missing notice", async () => {
    setCaps({ "assign:permission": true });
    renderWithQuery(<RolePermissionsPage roleId="role-1" />);
    await waitFor(() => expect(screen.getByText("department")).toBeInTheDocument());
    expect(screen.getByText("permission")).toBeInTheDocument();
    expect(screen.getByText(/chưa cung cấp api xem danh sách quyền đã gán/i)).toBeInTheDocument();
  });

  it("assigns a permission and shows success feedback", async () => {
    setCaps({ "assign:permission": true });
    vi.mocked(roleAdminApi.assignPermission).mockResolvedValue({
      roleId: "role-1",
      permissionId: "p1",
      action: "view",
      resourceType: "department",
      effect: "ALLOW",
      dataScope: "Company",
    });
    renderWithQuery(<RolePermissionsPage roleId="role-1" />);
    await waitFor(() => expect(screen.getByText("department")).toBeInTheDocument());

    const assignButtons = screen.getAllByText("Gán");
    fireEvent.click(assignButtons[0]);

    await waitFor(() =>
      expect(roleAdminApi.assignPermission).toHaveBeenCalledWith("role-1", {
        action: "view",
        resourceType: "department",
        dataScope: "Company",
      }),
    );
    await waitFor(() => expect(screen.getByText(/đã gán quyền/i)).toBeInTheDocument());
  });

  it("revokes a permission and shows success feedback", async () => {
    setCaps({ "assign:permission": true });
    vi.mocked(roleAdminApi.revokePermission).mockResolvedValue(undefined);
    renderWithQuery(<RolePermissionsPage roleId="role-1" />);
    await waitFor(() => expect(screen.getByText("department")).toBeInTheDocument());

    const revokeButtons = screen.getAllByText("Thu hồi");
    fireEvent.click(revokeButtons[0]);

    await waitFor(() =>
      expect(roleAdminApi.revokePermission).toHaveBeenCalledWith("role-1", {
        action: "view",
        resourceType: "department",
      }),
    );
    await waitFor(() => expect(screen.getByText(/đã thu hồi quyền/i)).toBeInTheDocument());
  });
});
