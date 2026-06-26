/**
 * [RED-trước · deny-path] LoginLogsPage — S2-AUTH-BE-5 · L3-FE-VIEWER.
 *
 * Gate: cặp ENGINE THỰC 'view:audit-log' (seed mig 0340, grant company-admin) — PIN theo cặp seed,
 *   KHÔNG mã FE "AUTH.AUDIT_LOG.VIEW" (bài học drift S1-FND-MODULE).
 * Deny-path dùng read:employee (KHÔNG mở được nhật ký bảo mật) → forbidden, apiFetch KHÔNG gọi.
 * States: loading · error · empty · forbidden · list render · filter→refetch.
 * Bảo mật: DTO không chứa metadata/secret → client không thể render; KHÔNG token vào storage.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, apiFetch } from "@mediaos/web-core";
import type { LoginLogListItem } from "@mediaos/contracts";
import { LoginLogsPage } from "./LoginLogsPage";

// ---------------------------------------------------------------------------
// Mock web-core: chỉ thay apiFetch; GIỮ useCan + useAuthStore thật (đọc store).
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, apiFetch: vi.fn() };
});

// react-i18next — resolve thật namespace system + common.
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { default: systemVi } = await import("@/i18n/locales/vi/system");
  const commonVi = {
    status: "Trạng thái",
    priority: "Ưu tiên",
    pagination: { prev: "Trang trước", next: "Trang sau" },
    actions: { retry: "Thử lại" },
  };
  const bundles: Record<string, Record<string, unknown>> = {
    system: systemVi as unknown as Record<string, unknown>,
    common: commonVi,
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
          let result = resolve(resolvedNs, resolvedKey);
          if (opts && typeof result === "string") {
            result = result.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts[k] ?? ""));
          }
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
function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_ROWS: LoginLogListItem[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    user: {
      id: "22222222-2222-2222-2222-222222222222",
      email: "admin@demo.local",
      display_name: "Super Admin",
    },
    status: "success",
    ip_address: "10.0.0.1",
    user_agent: "Mozilla/5.0",
    failure_reason: null,
    created_at: "2026-06-25T10:00:00.000Z",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    user: null,
    status: "failed",
    ip_address: "10.0.0.2",
    user_agent: "curl/8.0",
    failure_reason: "WrongPassword",
    created_at: "2026-06-25T11:00:00.000Z",
  },
];

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "admin@demo.local",
      fullName: "Admin",
      status: "Active",
      companyId: "co-1",
    },
  });
}

function clearCaps() {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("LoginLogsPage", () => {
  beforeEach(() => {
    clearCaps();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  // ── DENY-PATH (RED-trước) ─────────────────────────────────────────────────
  it("renders forbidden and does NOT call API when user lacks view:audit-log", () => {
    setCaps({});
    renderWithQuery(<LoginLogsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renders forbidden when user has read:employee but not view:audit-log", () => {
    setCaps({ "read:employee": true });
    renderWithQuery(<LoginLogsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH ─────────────────────────────────────────────────────────────
  it("renders login-log list when user has view:audit-log", async () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<LoginLogsPage />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());
    expect(screen.getByText("WrongPassword")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    // endpoint AUTH-API-401
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/login-logs"),
      expect.anything(),
    );
  });

  // ── LOADING ─────────────────────────────────────────────────────────────────
  it("shows table skeleton while fetching", () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<LoginLogsPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  // ── ERROR ─────────────────────────────────────────────────────────────────
  it("shows error state when API fails", async () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockRejectedValue(new Error("network"));
    renderWithQuery(<LoginLogsPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải nhật ký đăng nhập/i)).toBeInTheDocument(),
    );
  });

  // ── EMPTY ─────────────────────────────────────────────────────────────────
  it("shows empty state when no rows returned", async () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockResolvedValue([]);
    renderWithQuery(<LoginLogsPage />);
    await waitFor(() =>
      expect(screen.getByText(/không có nhật ký đăng nhập/i)).toBeInTheDocument(),
    );
  });

  // ── FILTER → refetch với param status ───────────────────────────────────────
  it("re-queries with status filter when applied", async () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<LoginLogsPage />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());

    const statusSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(statusSelect, { target: { value: "failed" } });
    fireEvent.click(screen.getByRole("button", { name: /^lọc$/i }));

    await waitFor(() => {
      const urls = vi.mocked(apiFetch).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("status=failed"))).toBe(true);
    });
  });

  // ── BẢO MẬT: không token vào storage; DTO không phơi secret ──────────────────
  it("does not leak any token into client storage", async () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<LoginLogsPage />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
