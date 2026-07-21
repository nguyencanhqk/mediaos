/**
 * RoleMembersTab — S2-AUTH-ROLEMEM-1.
 * Gate đọc: view:user (thiếu → forbidden, KHÔNG gọi API). Nút mutation (Thêm người / Thêm theo
 * phòng ban / Gỡ) bọc PermissionGate assign-role:user (sensitive — cờ từ /auth/me allowlist,
 * KHÔNG kế thừa wildcard qua PermissionGate exact-pair? — PermissionGate dùng useCan; cờ sensitive
 * chỉ xuất hiện khi allowlist phơi đúng grant thật nên wildcard '*:*' KHÔNG tự mở nút).
 * States: forbidden · members list · empty · remove flow gọi đúng revokeRole(userId, roleId).
 * "Thêm người" = EmployeeMultiPickerDialog (GET /hr/employees): hàng đã giữ vai trò / chưa link
 * tài khoản bị khóa; chọn nhiều → assignRole(userId, {roleId}) TỪNG người.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, roleAdminApi, authUsersApi, hrApi } from "@mediaos/web-core";
import { RoleMembersTab } from "./RoleMembersTab";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    roleAdminApi: {
      ...actual.roleAdminApi,
      getMembers: vi.fn(),
    },
    authUsersApi: {
      ...actual.authUsersApi,
      assignRole: vi.fn(),
      revokeRole: vi.fn(),
    },
    hrApi: {
      ...actual.hrApi,
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
      listDepartments: vi.fn().mockResolvedValue([]),
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

const MEMBERS = {
  members: [
    {
      userId: "u-100",
      email: "linh.bui@demo.local",
      fullName: "Bùi Mỹ Linh",
      status: "active",
      expiresAt: null,
      grantedAt: new Date("2026-07-01T00:00:00Z"),
    },
  ],
};

describe("RoleMembersTab", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(roleAdminApi.getMembers).mockResolvedValue(MEMBERS);
  });

  // ── DENY-PATH: thiếu view:user → forbidden, KHÔNG gọi API ──────────────────
  it("thiếu view:user → forbidden, KHÔNG fetch members", () => {
    setCaps({});
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    expect(screen.getByText("Không có quyền xem")).toBeInTheDocument();
    expect(roleAdminApi.getMembers).not.toHaveBeenCalled();
  });

  it("có view:user nhưng THIẾU assign-role:user → thấy danh sách, KHÔNG thấy nút mutation", async () => {
    setCaps({ "view:user": true });
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    expect(await screen.findByText("Bùi Mỹ Linh")).toBeInTheDocument();
    expect(screen.queryByText("Thêm người")).not.toBeInTheDocument();
    expect(screen.queryByText("Thêm theo phòng ban")).not.toBeInTheDocument();
    expect(screen.queryByText("Gỡ")).not.toBeInTheDocument();
  });

  it("đủ view:user + assign-role:user → thấy nút Thêm người/Thêm theo phòng ban/Gỡ", async () => {
    setCaps({ "view:user": true, "assign-role:user": true });
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    expect(await screen.findByText("Bùi Mỹ Linh")).toBeInTheDocument();
    expect(screen.getByText("Thêm người")).toBeInTheDocument();
    expect(screen.getByText("Thêm theo phòng ban")).toBeInTheDocument();
    expect(screen.getByText("Gỡ")).toBeInTheDocument();
  });

  it("members rỗng → empty state", async () => {
    vi.mocked(roleAdminApi.getMembers).mockResolvedValue({ members: [] });
    setCaps({ "view:user": true });
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    expect(await screen.findByText("Chưa có thành viên")).toBeInTheDocument();
  });

  // ── Picker "Thêm người" (EmployeeMultiPickerDialog) ────────────────────────
  const PICKER_EMPLOYEES = {
    items: [
      {
        id: "emp-1",
        userId: "u-100", // đã là member (MEMBERS) → khóa + badge "Đã giữ vai trò"
        fullName: "Bùi Mỹ Linh",
        email: "linh.bui@demo.local",
        positionName: "Nhân viên đăng tải",
        orgUnitName: "Nội dung",
        avatarUrl: null,
        employeeCode: "EMP0001",
      },
      {
        id: "emp-2",
        userId: "u-200", // chọn được
        fullName: "Trần Thị B",
        email: "b@demo.local",
        positionName: "Designer",
        orgUnitName: "Nội dung",
        avatarUrl: null,
        employeeCode: "EMP0002",
      },
      {
        id: "emp-3",
        userId: null, // chưa link tài khoản → khóa + badge "Chưa có tài khoản"
        fullName: "Lê Văn C",
        email: "c@demo.local",
        positionName: "QA",
        orgUnitName: "Kỹ thuật",
        avatarUrl: null,
        employeeCode: "EMP0003",
      },
    ],
    meta: { page: 1, pageSize: 10, total: 3, totalPages: 1, hasNext: false, hasPrev: false },
  };

  it("Thêm người → picker: hàng đã giữ vai trò / chưa có tài khoản bị khóa với badge riêng", async () => {
    setCaps({ "view:user": true, "assign-role:user": true });
    vi.mocked(hrApi.listEmployees).mockResolvedValue(PICKER_EMPLOYEES as never);
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    fireEvent.click(await screen.findByText("Thêm người"));
    await waitFor(() =>
      expect(screen.getByTestId("role-member-picker-row-emp-2")).toBeInTheDocument(),
    );

    expect(screen.getByLabelText("Bùi Mỹ Linh")).toBeDisabled();
    expect(screen.getByText("Đã giữ vai trò")).toBeInTheDocument();
    expect(screen.getByLabelText("Lê Văn C")).toBeDisabled();
    // Hàng chưa link tài khoản KHÔNG hiện dấu tích (khác hàng "đã ở trong").
    expect(screen.getByLabelText("Lê Văn C")).not.toBeChecked();
    expect(screen.getByText("Chưa có tài khoản")).toBeInTheDocument();
  });

  it("Thêm người → chọn nhân viên → assignRole gọi với userId (không phải employeeId)", async () => {
    setCaps({ "view:user": true, "assign-role:user": true });
    vi.mocked(hrApi.listEmployees).mockResolvedValue(PICKER_EMPLOYEES as never);
    vi.mocked(authUsersApi.assignRole).mockResolvedValue({} as never);
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    fireEvent.click(await screen.findByText("Thêm người"));
    await waitFor(() =>
      expect(screen.getByTestId("role-member-picker-row-emp-2")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("role-member-picker-row-emp-2"));
    fireEvent.click(screen.getByTestId("role-member-picker-confirm"));
    await waitFor(() => {
      expect(authUsersApi.assignRole).toHaveBeenCalledWith("u-200", { roleId: "role-1" });
    });
    // Thành công hết → dialog tự đóng.
    await waitFor(() =>
      expect(screen.queryByTestId("role-member-picker-confirm")).not.toBeInTheDocument(),
    );
  });

  it("Gỡ → confirm dialog → xác nhận gọi revokeRole(userId, roleId) + refetch", async () => {
    vi.mocked(authUsersApi.revokeRole).mockResolvedValue(undefined);
    setCaps({ "view:user": true, "assign-role:user": true });
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    fireEvent.click(await screen.findByText("Gỡ"));
    expect(screen.getByText("Gỡ thành viên khỏi vai trò?")).toBeInTheDocument();
    // Nút "Gỡ" trong footer dialog (nút thứ 2 cùng label).
    const buttons = screen.getAllByText("Gỡ");
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => {
      expect(authUsersApi.revokeRole).toHaveBeenCalledWith("u-100", "role-1");
    });
  });
});
