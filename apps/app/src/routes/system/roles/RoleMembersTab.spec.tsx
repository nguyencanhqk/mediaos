/**
 * RoleMembersTab — S2-AUTH-ROLEMEM-1.
 * Gate đọc: view:user (thiếu → forbidden, KHÔNG gọi API). Nút mutation (Thêm người / Thêm theo
 * phòng ban / Gỡ) bọc PermissionGate assign-role:user (sensitive — cờ từ /auth/me allowlist,
 * KHÔNG kế thừa wildcard qua PermissionGate exact-pair? — PermissionGate dùng useCan; cờ sensitive
 * chỉ xuất hiện khi allowlist phơi đúng grant thật nên wildcard '*:*' KHÔNG tự mở nút).
 * States: forbidden · members list · empty · remove flow gọi đúng revokeRole(userId, roleId).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, roleAdminApi, authUsersApi } from "@mediaos/web-core";
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
      listUsers: vi.fn(),
      assignRole: vi.fn(),
      revokeRole: vi.fn(),
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
