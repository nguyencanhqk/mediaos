/**
 * [RED-trước · deny-path] UsersPage — S2-FE-AUTH-3.
 * Gate: view:user — canonical engine pair AUTH.USER.VIEW → view:user
 *   (DB-02 §9.1 + seed §13 migration 0444/0450: hr + company-admin được view:user/Company).
 * Deny-path dùng read:employee (HR.EMPLOYEE.VIEW, KHÔNG mở được system users).
 * Nối /auth/users (authUsersApi) — thay legacy /users/admin (usersApi) của S2-FE-HR-3 P1.
 * States: loading · error · empty · forbidden · list render.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { authUsersApi } from "@mediaos/web-core";
import { UsersPage } from "./UsersPage";
import type { AuthUserListDto } from "@mediaos/contracts";
import systemVi from "@/i18n/locales/vi/system";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    authUsersApi: {
      listUsers: vi.fn(),
    },
  };
});

// Mock react-i18next — factory uses dynamic import to avoid hoisting TDZ error.
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { default: systemVi } = await import("@/i18n/locales/vi/system");
  const bundles: Record<string, Record<string, unknown>> = {
    system: systemVi as unknown as Record<string, unknown>,
  };
  function resolve(ns: string, key: string): string {
    const bundle = bundles[ns] ?? {};
    return (
      (key.split(".").reduce<unknown>((acc, k) => {
        if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[k];
        return undefined;
      }, bundle) as string) ?? key
    );
  }
  return {
    ...actual,
    useTranslation: (ns: string | string[] = "common") => {
      const namespace = Array.isArray(ns) ? ns[0] : ns;
      return {
        t: (key: string, opts?: Record<string, unknown>) => {
          const nsKey = key.includes(":") ? key : `${namespace}:${key}`;
          const [resolvedNs, resolvedKey] = nsKey.split(":");
          const result = resolve(resolvedNs, resolvedKey);
          if (opts?.defaultValue && result === resolvedKey) return opts.defaultValue as string;
          return result;
        },
        i18n: { language: "vi", changeLanguage: vi.fn() },
        ready: true,
      };
    },
    I18nextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_LIST: AuthUserListDto = {
  users: [
    {
      id: "user-001",
      email: "admin@demo.local",
      fullName: "Super Admin",
      status: "active",
      lockedAt: null,
      lockedReason: null,
      lastLoginAt: "2026-06-25T10:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "user-002",
      email: "hr@demo.local",
      fullName: "HR Manager",
      status: "active",
      lockedAt: null,
      lockedReason: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  total: 2,
};

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("UsersPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no view:user → forbidden, API not called ──────────────────
  it("renders forbidden state and does NOT call API when user lacks view:user", () => {
    setCapabilities({});
    renderWithQuery(<UsersPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(authUsersApi.listUsers).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: read:employee but not view:user → still forbidden ──────────
  //   HR.EMPLOYEE.VIEW (read:employee) KHÔNG cấp quyền mở danh sách user hệ thống.
  it("renders forbidden when user has read:employee but not view:user", () => {
    setCapabilities({ "read:employee": true });
    renderWithQuery(<UsersPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(authUsersApi.listUsers).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: view:user → list renders ─────────────────────────────────
  it("renders user list when user has view:user", async () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.listUsers).mockResolvedValue(MOCK_LIST);
    renderWithQuery(<UsersPage />);
    await waitFor(() => expect(screen.getByText("admin@demo.local")).toBeInTheDocument());
    expect(screen.getByText("Super Admin")).toBeInTheDocument();
    expect(screen.getByText("hr@demo.local")).toBeInTheDocument();
  });

  // ── LOADING state ─────────────────────────────────────────────────────────
  it("shows loading skeleton while fetching", () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.listUsers).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<UsersPage />);
    const table = document.querySelector("table");
    expect(table).toBeInTheDocument();
  });

  // ── ERROR state ───────────────────────────────────────────────────────────
  it("shows error state when API fails", async () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.listUsers).mockRejectedValue(new Error("network error"));
    renderWithQuery(<UsersPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeInTheDocument());
  });

  // ── EMPTY state ───────────────────────────────────────────────────────────
  it("shows empty state when no users returned", async () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.listUsers).mockResolvedValue({ users: [], total: 0 });
    renderWithQuery(<UsersPage />);
    await waitFor(() => expect(screen.getByText(/không có người dùng/i)).toBeInTheDocument());
  });

  // ── CREATE button gated by create:user (PermissionGate) ───────────────────
  it("hides the create button without create:user, shows it with the grant", async () => {
    setCapabilities({ "view:user": true });
    vi.mocked(authUsersApi.listUsers).mockResolvedValue(MOCK_LIST);
    const { rerender } = renderWithQuery(<UsersPage />);
    await waitFor(() => expect(screen.getByText("admin@demo.local")).toBeInTheDocument());
    expect(screen.queryByText(systemVi.users.actions.create)).not.toBeInTheDocument();

    setCapabilities({ "view:user": true, "create:user": true });
    rerender(
      <QueryClientProvider client={makeQueryClient()}>
        <UsersPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("admin@demo.local")).toBeInTheDocument());
    expect(screen.getByText(systemVi.users.actions.create)).toBeInTheDocument();
  });
});
