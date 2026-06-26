/**
 * [RED-trước · deny-path] SecurityEventsPage — S2-AUTH-BE-5 · L3-FE-VIEWER.
 *
 * Gate: cặp ENGINE THỰC 'view:audit-log' (seed mig 0340, grant company-admin) — PIN theo cặp seed,
 *   KHÔNG mã FE "AUTH.AUDIT_LOG.VIEW" (bài học drift S1-FND-MODULE).
 * Deny-path dùng read:employee → forbidden, apiFetch KHÔNG gọi.
 * States: loading · error · empty · forbidden · list render · filter→refetch.
 * Bảo mật: DTO không chứa payload/secret → client không thể render; KHÔNG token vào storage.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, apiFetch } from "@mediaos/web-core";
import type { SecurityEventListItem } from "@mediaos/contracts";
import { SecurityEventsPage } from "./SecurityEventsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, apiFetch: vi.fn() };
});

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

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_ROWS: SecurityEventListItem[] = [
  {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    user: {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      email: "user@demo.local",
      display_name: "Nhân Viên",
    },
    event_type: "PASSWORD_CHANGED",
    severity: "high",
    actor: {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      email: "admin@demo.local",
      display_name: "Super Admin",
    },
    ip_address: "10.0.0.9",
    user_agent: "Mozilla/5.0",
    created_at: "2026-06-25T12:00:00.000Z",
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

describe("SecurityEventsPage", () => {
  beforeEach(() => {
    clearCaps();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  // ── DENY-PATH (RED-trước) ─────────────────────────────────────────────────
  it("renders forbidden and does NOT call API when user lacks view:audit-log", () => {
    setCaps({});
    renderWithQuery(<SecurityEventsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renders forbidden when user has read:employee but not view:audit-log", () => {
    setCaps({ "read:employee": true });
    renderWithQuery(<SecurityEventsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH ─────────────────────────────────────────────────────────────
  it("renders security-event list when user has view:audit-log", async () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<SecurityEventsPage />);
    await waitFor(() => expect(screen.getByText("PASSWORD_CHANGED")).toBeInTheDocument());
    expect(screen.getByText("Nhân Viên")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/security-events"),
      expect.anything(),
    );
  });

  // ── LOADING ─────────────────────────────────────────────────────────────────
  it("shows table skeleton while fetching", () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<SecurityEventsPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  // ── ERROR ─────────────────────────────────────────────────────────────────
  it("shows error state when API fails", async () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockRejectedValue(new Error("network"));
    renderWithQuery(<SecurityEventsPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải sự kiện bảo mật/i)).toBeInTheDocument(),
    );
  });

  // ── EMPTY ─────────────────────────────────────────────────────────────────
  it("shows empty state when no rows returned", async () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockResolvedValue([]);
    renderWithQuery(<SecurityEventsPage />);
    await waitFor(() => expect(screen.getByText(/không có sự kiện bảo mật/i)).toBeInTheDocument());
  });

  // ── FILTER → refetch với param severity ─────────────────────────────────────
  it("re-queries with severity filter when applied", async () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<SecurityEventsPage />);
    await waitFor(() => expect(screen.getByText("PASSWORD_CHANGED")).toBeInTheDocument());

    const severitySelect = screen.getByRole("combobox");
    fireEvent.change(severitySelect, { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: /^lọc$/i }));

    await waitFor(() => {
      const urls = vi.mocked(apiFetch).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("severity=high"))).toBe(true);
    });
  });

  // ── BẢO MẬT: không token vào storage ────────────────────────────────────────
  it("does not leak any token into client storage", async () => {
    setCaps({ "view:audit-log": true });
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<SecurityEventsPage />);
    await waitFor(() => expect(screen.getByText("PASSWORD_CHANGED")).toBeInTheDocument());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
