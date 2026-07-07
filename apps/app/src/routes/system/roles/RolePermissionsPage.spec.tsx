/**
 * RolePermissionsPage — S2-FE-AUTH-4 (lane FE batch C).
 * Gate: assign:permission (is_sensitive=true) — useCanExact (KHÔNG wildcard kế thừa qua useCan).
 * v2 (S2-AUTH-PERMUX-1): trang hiện TRẠNG THÁI ĐÃ GÁN thật (GET :id/permissions) — nhóm theo
 * resourceType, badge Đã gán + scope, bulk. Test bắt state-render thay banner mù-trạng-thái cũ.
 * States: forbidden · loading · error/role-not-found · grouped list + assign/revoke actions.
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
      getRolePermissions: vi.fn(),
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
    // v2: grants đã gán — mặc định 1 grant view:department Company (trạng thái thật).
    vi.mocked(roleAdminApi.getRolePermissions).mockResolvedValue({
      grants: [
        {
          action: "view",
          resourceType: "department",
          effect: "ALLOW",
          dataScope: "Company",
          isSensitive: false,
        },
      ],
    });
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

  it("v2: renders grouped catalog VỚI trạng thái đã gán (badge + đếm nhóm), KHÔNG còn banner mù-trạng-thái", async () => {
    setCaps({ "assign:permission": true });
    renderWithQuery(<RolePermissionsPage roleId="role-1" />);
    await waitFor(() => expect(screen.getByText("department")).toBeInTheDocument());
    // Badge trạng thái thật từ GET :id/permissions.
    expect(screen.getByText(/Đã gán · Công ty/)).toBeInTheDocument();
    // Đếm nhóm đã gán/tổng.
    expect(screen.getByText(/đã gán 1\/1/)).toBeInTheDocument();
    // Banner cũ phải biến mất.
    expect(screen.queryByText(/chưa cung cấp api xem danh sách quyền đã gán/i)).not.toBeInTheDocument();
  });

  it("assigns a permission and shows success feedback", async () => {
    setCaps({ "assign:permission": true });
    // Trường hợp chưa gán gì: mọi hàng đều có nút Gán (nhóm mặc định đóng → mở qua header).
    vi.mocked(roleAdminApi.getRolePermissions).mockResolvedValue({ grants: [] });
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
    fireEvent.click(screen.getByText("department")); // mở nhóm

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
    // Nhóm có grant mở sẵn (assigned>0) → nút Thu hồi hiện ngay.
    await waitFor(() => expect(screen.getByText(/Đã gán · Công ty/)).toBeInTheDocument());

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
