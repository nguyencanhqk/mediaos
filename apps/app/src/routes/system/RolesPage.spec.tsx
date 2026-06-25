/**
 * [RED-trước · deny-path] RolesPage — S2-FE-HR-3.
 * Gate: read:role — khớp engine pair AUTH.ROLE.VIEW → read:role (seed migration).
 * States: loading · error · empty · forbidden · list render.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, apiFetch } from "@mediaos/web-core";
import { RolesPage } from "./RolesPage";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

// Mock react-i18next — factory uses dynamic import to avoid hoisting TDZ error.
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  // Dynamic import inside factory avoids top-level variable hoisting issue.
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

const MOCK_ROLES = [
  { id: "role-001", name: "Super Admin" },
  { id: "role-002", name: "HR Manager" },
  { id: "role-003", name: "Employee" },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("RolesPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no read:role → forbidden, API not called ─────────────────
  it("renders forbidden state and does NOT call API when user lacks read:role", () => {
    setCapabilities({});
    renderWithQuery(<RolesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: manage:user but not read:role → still forbidden ───────────
  it("renders forbidden when user has manage:user but not read:role", () => {
    setCapabilities({ "manage:user": true });
    renderWithQuery(<RolesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: read:role → list renders ─────────────────────────────────
  it("renders roles list when user has read:role", async () => {
    setCapabilities({ "read:role": true });
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROLES);
    renderWithQuery(<RolesPage />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());
    expect(screen.getByText("HR Manager")).toBeInTheDocument();
    expect(screen.getByText("Employee")).toBeInTheDocument();
  });

  // ── LOADING state ─────────────────────────────────────────────────────────
  it("shows loading skeleton while fetching", () => {
    setCapabilities({ "read:role": true });
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<RolesPage />);
    const table = document.querySelector("table");
    expect(table).toBeInTheDocument();
  });

  // ── ERROR state ───────────────────────────────────────────────────────────
  it("shows error state when API fails", async () => {
    setCapabilities({ "read:role": true });
    vi.mocked(apiFetch).mockRejectedValue(new Error("network error"));
    renderWithQuery(<RolesPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeInTheDocument());
  });

  // ── EMPTY state ───────────────────────────────────────────────────────────
  it("shows empty state when no roles returned", async () => {
    setCapabilities({ "read:role": true });
    vi.mocked(apiFetch).mockResolvedValue([]);
    renderWithQuery(<RolesPage />);
    await waitFor(() => expect(screen.getByText(/không có vai trò/i)).toBeInTheDocument());
  });

  // ── Sprint-3 notice visible ───────────────────────────────────────────────
  it("shows Sprint 3 placeholder notice when user has permission", async () => {
    setCapabilities({ "read:role": true });
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROLES);
    renderWithQuery(<RolesPage />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());
    expect(screen.getByText(/sprint 3/i)).toBeInTheDocument();
  });
});
