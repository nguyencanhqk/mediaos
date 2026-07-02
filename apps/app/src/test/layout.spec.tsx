// @vitest-environment jsdom
/**
 * [layout] Tests cho 3 layout chính: AuthLayout, HomePortalLayout, ModuleWorkspaceLayout.
 *
 * Phủ:
 * 1. AuthLayout — render children, brand panel toggle.
 * 2. HomePortalLayout — loading/empty/error/app-grid states, permission visibility.
 * 3. ModuleWorkspaceLayout — sidebar filter, locked/maintenance/hidden states.
 * 4. Dirty-form guard — DirtyFormConfirmDialog xuất hiện và confirm/cancel.
 * 5. AppSwitcher — open/close, search filter, dirty-form guard.
 * 6. ProtectedShell — render khi authenticated, redirect khi không.
 * 7. ModuleSidebar — filterSidebarItems theo quyền.
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createPermissionChecker,
  type SessionContext,
  type UserPermission,
  filterSidebarItems,
  type SidebarItemMeta,
  useAuthStore,
} from "@mediaos/web-core";

// Static imports — no dynamic require()
import { useLayoutStore } from "@/stores/layout.store";
import { AuthLayout } from "@/layouts/auth/AuthLayout";
import { HomePortalLayout } from "@/layouts/home/HomePortalLayout";
import { DirtyFormConfirmDialog } from "@/layouts/shared/DirtyFormConfirmDialog";
import { useDirtyFormGuard } from "@/hooks/use-dirty-form-guard";
import { ModuleWorkspaceLayout } from "@/layouts/workspace/ModuleWorkspaceLayout";
import {
  LockedModuleState,
  ModuleMaintenanceState,
  ModuleNotFoundState,
} from "@/layouts/workspace/WorkspaceStates";
import { ProtectedShell } from "@/layouts/protected/ProtectedShell";
import { AppSwitcher } from "@/layouts/home/AppSwitcher";

// ---------------------------------------------------------------------------
// Global mocks
// ---------------------------------------------------------------------------

vi.mock("react-i18next", () => ({
  useTranslation: (_ns?: string | string[]) => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  I18nextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// navigateMock + routerPathnameRef: mutable qua vi.hoisted (factory vi.mock bị hoist lên đầu file) —
// test ProtectedShell/2FA-enroll-enforcement cần điều khiển pathname hiện tại + assert navigate() gọi
// đúng target, chứ không thể cố định "/home" như trước (S2-FE-AUTH-6).
const { navigateMock, routerPathnameRef } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  routerPathnameRef: { current: "/home" },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      children,
      to,
      onClick,
    }: {
      children: React.ReactNode;
      to: string;
      onClick?: React.MouseEventHandler;
    }) => (
      <a href={to} onClick={onClick}>
        {children}
      </a>
    ),
    useNavigate: () => navigateMock,
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: routerPathnameRef.current } }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    logoutSession: vi.fn().mockResolvedValue(undefined),
    getAuthRedirectUrl: () => "http://localhost:5270/login",
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>;
}

type AuthUserStatus = "Active" | "Inactive" | "Locked" | "Pending Activation";

function setAuthStore(
  authenticated: boolean,
  capabilities: Record<string, boolean> = {},
  userStatus: AuthUserStatus = "Active",
) {
  useAuthStore.setState({
    isAuthenticated: authenticated,
    user: authenticated
      ? {
          id: "u1",
          email: "test@co.com",
          fullName: "Test User",
          companyId: "c1",
          status: userStatus,
        }
      : null,
    username: authenticated ? "Test User" : null,
    accessToken: authenticated ? "tok" : null,
    refreshToken: null,
    capabilities,
    // Reset MẶC ĐỊNH ở đây — test AUTH-003 (mustSetupTwoFactor) override RIÊNG sau lời gọi này để
    // tránh leak trạng thái ép-enroll sang các describe block khác.
    mustSetupTwoFactor: false,
  });
}

function resetLayoutStore() {
  useLayoutStore.setState({
    isSidebarCollapsed: false,
    isMobileSidebarOpen: false,
    isAppSwitcherOpen: false,
    topbarSearchOpen: false,
    dirtyFormState: null,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  resetLayoutStore();
  setAuthStore(false);
  routerPathnameRef.current = "/home";
});

// ---------------------------------------------------------------------------
// 1. AuthLayout
// ---------------------------------------------------------------------------

describe("AuthLayout", () => {
  it("renders children", () => {
    render(
      <Wrapper>
        <AuthLayout>
          <p>Login form</p>
        </AuthLayout>
      </Wrapper>,
    );
    expect(screen.getByText("Login form")).toBeInTheDocument();
  });

  it("renders title and subtitle when provided", () => {
    render(
      <Wrapper>
        <AuthLayout title="Đăng nhập" subtitle="Nhập thông tin tài khoản">
          <span />
        </AuthLayout>
      </Wrapper>,
    );
    expect(screen.getByText("Đăng nhập")).toBeInTheDocument();
    expect(screen.getByText("Nhập thông tin tài khoản")).toBeInTheDocument();
  });

  it("renders brand panel FUNTIME MEDIA text by default", () => {
    const { container } = render(
      <Wrapper>
        <AuthLayout>
          <span />
        </AuthLayout>
      </Wrapper>,
    );
    expect(container.textContent).toContain("FUNTIME MEDIA");
  });

  it("hides brand panel content when showBrandPanel=false", () => {
    render(
      <Wrapper>
        <AuthLayout showBrandPanel={false}>
          <p>form only</p>
        </AuthLayout>
      </Wrapper>,
    );
    expect(screen.getByText("form only")).toBeInTheDocument();
  });

  it("uses main landmark element", () => {
    const { container } = render(
      <Wrapper>
        <AuthLayout>
          <span />
        </AuthLayout>
      </Wrapper>,
    );
    expect(container.querySelector("main")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. HomePortalLayout — permission visibility
// ---------------------------------------------------------------------------

describe("HomePortalLayout — permission visibility", () => {
  it("shows welcome section when authenticated", () => {
    setAuthStore(true, {});
    render(
      <Wrapper>
        <HomePortalLayout />
      </Wrapper>,
    );
    expect(screen.getByText("Xin chào,")).toBeInTheDocument();
  });

  it("shows username in welcome section", () => {
    setAuthStore(true, {});
    render(
      <Wrapper>
        <HomePortalLayout />
      </Wrapper>,
    );
    expect(screen.getByText("Test User")).toBeInTheDocument();
  });

  it("shows empty state when no visible apps (no capabilities)", async () => {
    setAuthStore(true, {});
    render(
      <Wrapper>
        <HomePortalLayout />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/chưa được cấp quyền/i)).toBeInTheDocument();
    });
  });

  it("renders Ứng dụng của tôi section heading", async () => {
    setAuthStore(true, {});
    render(
      <Wrapper>
        <HomePortalLayout />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("Ứng dụng của tôi")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. DirtyFormConfirmDialog
// ---------------------------------------------------------------------------

describe("DirtyFormConfirmDialog", () => {
  it("renders when open=true with message", () => {
    render(
      <Wrapper>
        <DirtyFormConfirmDialog
          open={true}
          message="Bạn có thay đổi chưa lưu."
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </Wrapper>,
    );
    expect(screen.getByText("Thay đổi chưa lưu")).toBeInTheDocument();
    expect(screen.getByText("Bạn có thay đổi chưa lưu.")).toBeInTheDocument();
  });

  it("calls onCancel when Ở lại clicked", () => {
    const onCancel = vi.fn();
    render(
      <Wrapper>
        <DirtyFormConfirmDialog open={true} message="msg" onConfirm={vi.fn()} onCancel={onCancel} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText("Ở lại"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onConfirm when confirm button clicked", () => {
    const onConfirm = vi.fn();
    render(
      <Wrapper>
        <DirtyFormConfirmDialog
          open={true}
          message="msg"
          confirmLabel="Rời khỏi"
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText("Rời khỏi"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("does not render when open=false", () => {
    render(
      <Wrapper>
        <DirtyFormConfirmDialog open={false} message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </Wrapper>,
    );
    expect(screen.queryByText("Thay đổi chưa lưu")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. useDirtyFormGuard hook
// ---------------------------------------------------------------------------

describe("useDirtyFormGuard", () => {
  it("sets dirtyFormState when isDirty=true", () => {
    function TestComp({ dirty }: { dirty: boolean }) {
      useDirtyFormGuard({ isDirty: dirty });
      return null;
    }

    const { rerender } = render(
      <Wrapper>
        <TestComp dirty={false} />
      </Wrapper>,
    );
    expect(useLayoutStore.getState().dirtyFormState).toBeNull();

    rerender(
      <Wrapper>
        <TestComp dirty={true} />
      </Wrapper>,
    );
    expect(useLayoutStore.getState().dirtyFormState).not.toBeNull();
  });

  it("clears dirtyFormState when isDirty→false", () => {
    function TestComp({ dirty }: { dirty: boolean }) {
      useDirtyFormGuard({ isDirty: dirty });
      return null;
    }

    const { rerender } = render(
      <Wrapper>
        <TestComp dirty={true} />
      </Wrapper>,
    );
    expect(useLayoutStore.getState().dirtyFormState).not.toBeNull();

    rerender(
      <Wrapper>
        <TestComp dirty={false} />
      </Wrapper>,
    );
    expect(useLayoutStore.getState().dirtyFormState).toBeNull();
  });

  it("clears dirtyFormState on unmount", () => {
    function TestComp() {
      useDirtyFormGuard({ isDirty: true });
      return null;
    }

    const { unmount } = render(
      <Wrapper>
        <TestComp />
      </Wrapper>,
    );
    expect(useLayoutStore.getState().dirtyFormState).not.toBeNull();
    unmount();
    expect(useLayoutStore.getState().dirtyFormState).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. ModuleSidebar — filterSidebarItems
// ---------------------------------------------------------------------------

describe("ModuleSidebar — filterSidebarItems", () => {
  const activeLeaveSession: SessionContext = {
    status: "authenticated",
    user: { id: "u1", email: "a@b.com", status: "Active", companyId: "c1" },
    company: { id: "c1", name: "Acme", status: "Active" },
    modules: [{ moduleCode: "LEAVE", status: "active" }],
  };

  const leaveSidebar: SidebarItemMeta[] = [
    {
      sidebarKey: "leave.my-requests",
      moduleCode: "LEAVE",
      label: "Đơn nghỉ của tôi",
      path: "/leave/me/requests",
      order: 20,
      requiredAnyPermissions: ["LEAVE.REQUEST.VIEW_OWN"],
    },
    {
      sidebarKey: "leave.approvals",
      moduleCode: "LEAVE",
      label: "Đơn cần duyệt",
      path: "/leave/approvals",
      order: 30,
      requiredAnyPermissions: ["LEAVE.REQUEST.APPROVE"],
    },
  ];

  function makePerms(permissions: string[]): UserPermission[] {
    return permissions.map((p) => ({ permission: p, scopes: [] as never }));
  }

  it("employee thấy my-requests nhưng không thấy approvals", () => {
    const c = createPermissionChecker(makePerms(["LEAVE.REQUEST.VIEW_OWN"]));
    const filtered = filterSidebarItems(leaveSidebar, c, activeLeaveSession);
    expect(filtered.find((i) => i.sidebarKey === "leave.my-requests")).toBeDefined();
    expect(filtered.find((i) => i.sidebarKey === "leave.approvals")).toBeUndefined();
  });

  it("manager thấy cả 2 item khi có đủ quyền", () => {
    const c = createPermissionChecker(
      makePerms(["LEAVE.REQUEST.VIEW_OWN", "LEAVE.REQUEST.APPROVE"]),
    );
    const filtered = filterSidebarItems(leaveSidebar, c, activeLeaveSession);
    expect(filtered).toHaveLength(2);
  });

  it("sidebar rỗng khi không có quyền nào", () => {
    const c = createPermissionChecker(makePerms([]));
    const filtered = filterSidebarItems(leaveSidebar, c, activeLeaveSession);
    expect(filtered).toHaveLength(0);
  });

  it("sidebar rỗng khi module locked", () => {
    const lockedSession: SessionContext = {
      ...activeLeaveSession,
      modules: [{ moduleCode: "LEAVE", status: "locked" }],
    };
    const c = createPermissionChecker(
      makePerms(["LEAVE.REQUEST.VIEW_OWN", "LEAVE.REQUEST.APPROVE"]),
    );
    const filtered = filterSidebarItems(leaveSidebar, c, lockedSession);
    expect(filtered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. ModuleWorkspaceLayout — status states
// ---------------------------------------------------------------------------

describe("ModuleWorkspaceLayout — module status states", () => {
  it("renders children khi module không có status (BE chưa wire)", () => {
    setAuthStore(true, {});
    render(
      <Wrapper>
        <ModuleWorkspaceLayout moduleCode="HR">
          <p data-testid="child">HR content</p>
        </ModuleWorkspaceLayout>
      </Wrapper>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders LockedModuleState trực tiếp", () => {
    render(
      <Wrapper>
        <LockedModuleState moduleName="Nhân sự" />
      </Wrapper>,
    );
    expect(screen.getByText(/Nhân sự chưa được kích hoạt/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Về trang chủ/i })).toBeInTheDocument();
  });

  it("renders ModuleMaintenanceState", () => {
    render(
      <Wrapper>
        <ModuleMaintenanceState moduleName="Chấm công" />
      </Wrapper>,
    );
    expect(screen.getByText(/Chấm công đang bảo trì/i)).toBeInTheDocument();
  });

  it("renders ModuleNotFoundState", () => {
    render(
      <Wrapper>
        <ModuleNotFoundState />
      </Wrapper>,
    );
    expect(screen.getByText("Không tìm thấy trang")).toBeInTheDocument();
  });

  it("renders sidebar nav khi authenticated với HR.EMPLOYEE.VIEW", () => {
    setAuthStore(true, { "HR.EMPLOYEE.VIEW": true });
    render(
      <Wrapper>
        <ModuleWorkspaceLayout moduleCode="HR">
          <p>content</p>
        </ModuleWorkspaceLayout>
      </Wrapper>,
    );
    expect(screen.getByRole("navigation", { name: /module navigation/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 7. ProtectedShell — session states
// ---------------------------------------------------------------------------

describe("ProtectedShell", () => {
  it("renders children when authenticated", () => {
    setAuthStore(true, {});
    render(
      <Wrapper>
        <ProtectedShell>
          <p data-testid="protected-content">Protected</p>
        </ProtectedShell>
      </Wrapper>,
    );
    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
  });

  it("shows skeleton when not authenticated (redirect pending)", () => {
    setAuthStore(false, {});
    // jsdom allows property assignment on location.href
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: { href: "" },
    });

    render(
      <Wrapper>
        <ProtectedShell>
          <p>Should not render</p>
        </ProtectedShell>
      </Wrapper>,
    );
    expect(screen.queryByText("Should not render")).not.toBeInTheDocument();
  });

  it("renders AccountBlockedState when user status is Locked", () => {
    setAuthStore(true, {}, "Locked");
    render(
      <Wrapper>
        <ProtectedShell>
          <p>Content</p>
        </ProtectedShell>
      </Wrapper>,
    );
    expect(screen.getByText("Tài khoản bị vô hiệu hóa")).toBeInTheDocument();
    expect(screen.queryByText("Content")).not.toBeInTheDocument();
  });

  // ── AUTH-003 (S2-FE-AUTH-6) — ép enroll 2FA khi mustSetupTwoFactor=true ──────────────────────────
  describe("2FA enroll enforcement (AUTH-003)", () => {
    it("mustSetupTwoFactor=true trên route khác /account/setup-2fa → điều hướng enroll, ẩn nội dung", () => {
      setAuthStore(true, {});
      useAuthStore.setState({ mustSetupTwoFactor: true });
      routerPathnameRef.current = "/home";

      render(
        <Wrapper>
          <ProtectedShell>
            <p>Protected content</p>
          </ProtectedShell>
        </Wrapper>,
      );

      expect(navigateMock).toHaveBeenCalledWith({ to: "/account/setup-2fa" });
      expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    });

    it("mustSetupTwoFactor=false → KHÔNG điều hướng, nội dung render bình thường", () => {
      setAuthStore(true, {});
      routerPathnameRef.current = "/home";

      render(
        <Wrapper>
          <ProtectedShell>
            <p>Protected content</p>
          </ProtectedShell>
        </Wrapper>,
      );

      expect(navigateMock).not.toHaveBeenCalled();
      expect(screen.getByText("Protected content")).toBeInTheDocument();
    });

    it("mustSetupTwoFactor=true nhưng ĐANG ở /account/setup-2fa → KHÔNG điều hướng (tránh vòng lặp), render trang enroll", () => {
      setAuthStore(true, {});
      useAuthStore.setState({ mustSetupTwoFactor: true });
      routerPathnameRef.current = "/account/setup-2fa";

      render(
        <Wrapper>
          <ProtectedShell>
            <p>Enroll page content</p>
          </ProtectedShell>
        </Wrapper>,
      );

      expect(navigateMock).not.toHaveBeenCalled();
      expect(screen.getByText("Enroll page content")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Layout store
// ---------------------------------------------------------------------------

describe("useLayoutStore", () => {
  it("toggles sidebar collapsed", () => {
    expect(useLayoutStore.getState().isSidebarCollapsed).toBe(false);
    act(() => useLayoutStore.getState().toggleSidebarCollapsed());
    expect(useLayoutStore.getState().isSidebarCollapsed).toBe(true);
    act(() => useLayoutStore.getState().toggleSidebarCollapsed());
    expect(useLayoutStore.getState().isSidebarCollapsed).toBe(false);
  });

  it("opens and closes app switcher", () => {
    act(() => useLayoutStore.getState().openAppSwitcher());
    expect(useLayoutStore.getState().isAppSwitcherOpen).toBe(true);
    act(() => useLayoutStore.getState().closeAppSwitcher());
    expect(useLayoutStore.getState().isAppSwitcherOpen).toBe(false);
  });

  it("resets transient state", () => {
    act(() => {
      useLayoutStore.getState().openMobileSidebar();
      useLayoutStore.getState().openAppSwitcher();
    });
    act(() => useLayoutStore.getState().resetTransientLayoutState());
    const s = useLayoutStore.getState();
    expect(s.isMobileSidebarOpen).toBe(false);
    expect(s.isAppSwitcherOpen).toBe(false);
  });

  it("sets and clears dirty form state", () => {
    act(() =>
      useLayoutStore
        .getState()
        .setDirtyFormState({ routeKey: "hr.employees", message: "Chưa lưu" }),
    );
    expect(useLayoutStore.getState().dirtyFormState?.routeKey).toBe("hr.employees");
    act(() => useLayoutStore.getState().setDirtyFormState(null));
    expect(useLayoutStore.getState().dirtyFormState).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. AppSwitcher
// ---------------------------------------------------------------------------

describe("AppSwitcher", () => {
  it("không render khi isAppSwitcherOpen=false", () => {
    setAuthStore(true, {});
    render(
      <Wrapper>
        <AppSwitcher />
      </Wrapper>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("render dialog khi isAppSwitcherOpen=true", () => {
    setAuthStore(true, {
      "DASH.DASHBOARD.VIEW": true,
    });
    act(() => useLayoutStore.getState().openAppSwitcher());

    render(
      <Wrapper>
        <AppSwitcher />
      </Wrapper>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("đóng khi nhấn nút X", () => {
    setAuthStore(true, {
      "DASH.DASHBOARD.VIEW": true,
    });
    act(() => useLayoutStore.getState().openAppSwitcher());

    render(
      <Wrapper>
        <AppSwitcher />
      </Wrapper>,
    );
    fireEvent.click(screen.getByLabelText("Đóng danh sách ứng dụng"));
    expect(useLayoutStore.getState().isAppSwitcherOpen).toBe(false);
  });

  it("search input lọc app — không tìm thấy khi nhập từ khóa lạ", async () => {
    setAuthStore(true, {
      "DASH.DASHBOARD.VIEW": true,
      "HR.EMPLOYEE.VIEW": true,
    });
    act(() => useLayoutStore.getState().openAppSwitcher());

    render(
      <Wrapper>
        <AppSwitcher />
      </Wrapper>,
    );

    const searchInput = screen.getAllByPlaceholderText("Tìm ứng dụng…")[0];
    fireEvent.change(searchInput, { target: { value: "xxxnotfound" } });
    await waitFor(() => {
      expect(screen.getByText("Không tìm thấy ứng dụng phù hợp.")).toBeInTheDocument();
    });
  });
});
