// @vitest-environment jsdom
/**
 * [me-reuse-mount] S5-ME-FE-2 — xác nhận 3 màn TÁI DÙNG (MyProfilePage/AccountProfilePage/
 * AccountSessionsPage) mount ĐÚNG + hoạt động ĐÚNG khi render trong ME workspace, qua CHÍNH
 * `buildModuleRouteContent`/`getMeta` mà router.tsx dùng (KHÔNG bản sao logic gate/layout).
 * Component nguồn import TRỰC TIẾP (KHÔNG sửa) — cùng file router.tsx dùng cho route cũ /hr/me·
 * /account/profile·/account/sessions.
 *
 *  - /me/profile mount MyProfilePage: hành vi notLinked (404 → thông điệp §12.2) GIỮ NGUYÊN.
 *  - /me/account mount AccountProfilePage: render card tài khoản (từ /auth/me).
 *  - /me/security/sessions mount AccountSessionsPage: render danh sách phiên.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { MyProfilePage } from "@/routes/hr/me/MyProfilePage";
import { AccountProfilePage } from "@/routes/account/AccountProfilePage";
import { AccountSessionsPage } from "@/routes/account/AccountSessionsPage";

vi.mock("@/layouts/protected/ProtectedShell", () => ({
  ProtectedShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/layouts/workspace/ModuleWorkspaceLayout", () => ({
  ModuleWorkspaceLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// AccountProfilePage dùng useNavigate() (điều hướng "Đổi mật khẩu"/"Phiên đăng nhập") — cần stub vì test
// KHÔNG bọc RouterProvider thật (mirror AccountProfilePage.spec.tsx).
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: { ...actual.hrApi, getMyProfile: vi.fn() },
    authApi: { ...actual.authApi, me: vi.fn(), listSessions: vi.fn() },
    twoFactorApi: { ...actual.twoFactorApi, status: vi.fn() },
  };
});

import { hrApi, authApi, twoFactorApi } from "@mediaos/web-core";

const mockGetMyProfile = hrApi.getMyProfile as ReturnType<typeof vi.fn>;
const mockAuthMe = authApi.me as ReturnType<typeof vi.fn>;
const mockListSessions = authApi.listSessions as ReturnType<typeof vi.fn>;
const mockTwoFactorStatus = twoFactorApi.status as ReturnType<typeof vi.fn>;

function seedAuth() {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: { "access:me": true },
    user: { id: "u1", email: "u@co.com", fullName: "U", status: "Active", companyId: "co1" },
  });
}

function renderWithProviders(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
  seedAuth();
});

describe("router wires ME workspace cho 3 màn tái dùng (import-only, KHÔNG copy-paste)", () => {
  let routerMod: typeof import("@/router");

  it("/me/profile mount MyProfilePage thật — notLinked (404) GIỮ NGUYÊN hành vi (§12.2)", async () => {
    routerMod = await import("@/router");
    const { buildModuleRouteContent, getMeta } = routerMod;
    mockGetMyProfile.mockRejectedValue({ status: 404 });

    renderWithProviders(buildModuleRouteContent(getMeta("me.profile"), "ME", <MyProfilePage />));

    await waitFor(() => {
      expect(screen.getByText(/chưa liên kết hồ sơ nhân viên/i)).toBeInTheDocument();
    });
    expect(mockGetMyProfile).toHaveBeenCalledTimes(1);
  });

  it("/me/account mount AccountProfilePage thật — render card tài khoản từ /auth/me", async () => {
    routerMod = await import("@/router");
    const { buildModuleRouteContent, getMeta } = routerMod;
    mockAuthMe.mockResolvedValue({
      id: "u1",
      email: "u@co.com",
      fullName: "Trần Văn Test",
      status: "Active",
      company: null,
      employee: null,
      roles: [],
    });
    mockTwoFactorStatus.mockResolvedValue({ enabled: false, required: false });

    renderWithProviders(
      buildModuleRouteContent(getMeta("me.account"), "ME", <AccountProfilePage />),
    );

    // "profile.title" hiện CẢ ở trạng thái loading/success — chờ field CHỈ xuất hiện sau khi data đã tải.
    await waitFor(() => {
      expect(screen.getByText("u@co.com")).toBeInTheDocument();
    });
    expect(screen.getByText(/tài khoản của tôi/i)).toBeInTheDocument();
  });

  it("/me/security/sessions mount AccountSessionsPage thật — render danh sách phiên", async () => {
    routerMod = await import("@/router");
    const { buildModuleRouteContent, getMeta } = routerMod;
    mockListSessions.mockResolvedValue([
      {
        id: "s1",
        device_name: "Chrome",
        platform: "Windows",
        ip_address: "203.0.*.*",
        is_current: true,
        last_used_at: "2026-07-16T00:00:00.000Z",
        created_at: "2026-07-16T00:00:00.000Z",
      },
    ]);

    renderWithProviders(
      buildModuleRouteContent(getMeta("me.security.sessions"), "ME", <AccountSessionsPage />),
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /phiên đăng nhập/i })).toBeInTheDocument();
    });
    expect(screen.getByText("203.0.*.*")).toBeInTheDocument();
    expect(mockListSessions).toHaveBeenCalledTimes(1);
  });
});
