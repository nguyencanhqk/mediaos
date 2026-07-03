/**
 * AccountProfilePage — S2-FE-AUTH-6 (/account/profile, đọc-only).
 *
 * Dữ liệu từ GET /auth/me (authKeys.me()) — CÙNG endpoint bootstrap dùng, KHÔNG API mới. Client CHỈ
 * render field server trả (masking là việc server — BẤT BIẾN #2): employee=null → "chưa liên kết",
 * roles=[] → "chưa gán vai trò".
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MeResponse } from "@mediaos/contracts";
import { useAuthStore } from "@mediaos/web-core";
import { AccountProfilePage } from "./AccountProfilePage";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, authApi: { ...actual.authApi, me: vi.fn() } };
});

const { authApi } = await import("@mediaos/web-core");

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const ME_WITH_EMPLOYEE: MeResponse = {
  id: "u1",
  companyId: "co1",
  email: "a@demo.local",
  fullName: "Nguyễn Văn A",
  status: "active",
  capabilities: { "create:profile-change-request": true },
  mustSetupTwoFactor: false,
  company: { id: "co1", name: "Acme Co", status: "active" },
  employee: {
    id: "emp-1",
    employeeCode: "EMP0001",
    fullName: "Nguyễn Văn A",
    departmentId: "d1",
    directManagerId: null,
    employmentStatus: "active",
  },
  roles: [{ id: "r1", name: "employee" }],
};

const ME_NO_EMPLOYEE: MeResponse = {
  id: "u2",
  companyId: "co1",
  email: "operator@demo.local",
  fullName: null,
  status: "active",
  capabilities: {},
  mustSetupTwoFactor: false,
  employee: null,
  roles: [],
};

function setAuthenticated(capabilities: Record<string, boolean> = {}) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities,
    mustSetupTwoFactor: false,
    user: {
      id: "u1",
      email: "a@demo.local",
      fullName: "Nguyễn Văn A",
      status: "Active",
      companyId: "co1",
    },
  });
}

describe("AccountProfilePage", () => {
  beforeEach(() => {
    setAuthenticated();
  });
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, user: null, capabilities: {} });
  });

  it("shows loading skeleton while fetching", () => {
    vi.mocked(authApi.me).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<AccountProfilePage />);
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows error state with retry on failure", async () => {
    vi.mocked(authApi.me).mockRejectedValue(new Error("net"));
    renderWithQuery(<AccountProfilePage />);
    await waitFor(() =>
      expect(screen.getByText("Không thể tải thông tin tài khoản")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("renders user + employee + roles from /auth/me (KHÔNG gọi API mới ngoài /auth/me)", async () => {
    vi.mocked(authApi.me).mockResolvedValue(ME_WITH_EMPLOYEE);
    setAuthenticated({ "create:profile-change-request": true });
    renderWithQuery(<AccountProfilePage />);

    await waitFor(() => expect(screen.getByText("a@demo.local")).toBeInTheDocument());
    expect(screen.getByText("EMP0001")).toBeInTheDocument();
    expect(screen.getByText("employee")).toBeInTheDocument();
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    expect(authApi.me).toHaveBeenCalledTimes(1);
  });

  it("employee=null → hiển thị 'chưa liên kết hồ sơ nhân sự' (KHÔNG crash, KHÔNG bịa dữ liệu)", async () => {
    vi.mocked(authApi.me).mockResolvedValue(ME_NO_EMPLOYEE);
    renderWithQuery(<AccountProfilePage />);

    // fullName=null → PageHeader description RƠI về email → email xuất hiện 2 lần (header + field row).
    await waitFor(() => expect(screen.getAllByText("operator@demo.local").length).toBe(2));
    expect(screen.getByText("Tài khoản chưa liên kết hồ sơ nhân sự.")).toBeInTheDocument();
    expect(screen.getByText("Chưa được gán vai trò nào.")).toBeInTheDocument();
  });

  it("ẩn link 'Đề nghị thay đổi hồ sơ' khi thiếu create:profile-change-request (PermissionGate, không hard-code)", async () => {
    vi.mocked(authApi.me).mockResolvedValue(ME_NO_EMPLOYEE);
    setAuthenticated({}); // KHÔNG có create:profile-change-request
    renderWithQuery(<AccountProfilePage />);

    await waitFor(() => expect(screen.getAllByText("operator@demo.local").length).toBe(2));
    expect(
      screen.queryByRole("button", { name: "Đề nghị thay đổi hồ sơ" }),
    ).not.toBeInTheDocument();
    // Link đổi mật khẩu + phiên đăng nhập KHÔNG bị gate (self-service, không cặp quyền riêng).
    expect(screen.getByRole("button", { name: "Đổi mật khẩu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phiên đăng nhập" })).toBeInTheDocument();
  });

  it("điều hướng đúng route khi bấm các link self-service", async () => {
    vi.mocked(authApi.me).mockResolvedValue(ME_WITH_EMPLOYEE);
    setAuthenticated({ "create:profile-change-request": true });
    renderWithQuery(<AccountProfilePage />);
    await waitFor(() => expect(screen.getByText("a@demo.local")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Đề nghị thay đổi hồ sơ" }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/hr/me/change-request" });

    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/account/change-password" });

    fireEvent.click(screen.getByRole("button", { name: "Phiên đăng nhập" }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/account/sessions" });
  });
});
