/**
 * AuditLogsPage — S2-FE-FND-2 (SYSTEM-SCREEN-AUDIT-LOGS).
 *
 * Gate: cặp ENGINE THỰC ('view','audit-log') từ contract `AUTH_AUDIT_LOG` (seed mig 0340,
 *   is_sensitive=true, grant company-admin) — PIN theo cặp seed, KHÔNG literal magic-string,
 *   KHÔNG mã FE "FOUNDATION.AUDIT_LOG.VIEW" (bài học drift: mapping cũ trỏ `view:foundation-audit-log`,
 *   cặp KHÔNG được AuditController thật enforce — đã sửa trong registry.ts PERMISSION_CODE_TO_PAIR).
 *
 * Hydrate qua ĐÚNG entrypoint /auth/me dùng (session.ts doBootstrap): setUser(me, me.capabilities) —
 * cùng kỹ thuật LoginLogsPage.spec.tsx (KHÔNG setState/setCaps tắt).
 *
 * States: loading · error · empty · forbidden · list render · filter→refetch.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, apiFetch } from "@mediaos/web-core";
import {
  AUTH_AUDIT_LOG,
  meResponseSchema,
  type AuditLogDto,
  type MeResponse,
} from "@mediaos/contracts";
import { AuditLogsPage } from "./AuditLogsPage";

// ---------------------------------------------------------------------------
// Mock router — AuditLogsPage dùng useNavigate cho cột "Xem chi tiết".
// ---------------------------------------------------------------------------
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// ---------------------------------------------------------------------------
// Mock web-core: chỉ thay apiFetch; GIỮ useCan + useAuthStore + setUser THẬT.
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

const MOCK_ROWS: AuditLogDto[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "22222222-2222-2222-2222-222222222222",
    actorUserId: "33333333-3333-3333-3333-333333333333",
    action: "create",
    objectType: "employee",
    objectId: "44444444-4444-4444-4444-444444444444",
    before: null,
    after: null,
    ip: "10.0.0.1",
    userAgent: "Mozilla/5.0",
    moduleCode: "HR",
    entityType: "Employee",
    entityId: "44444444-4444-4444-4444-444444444444",
    actorType: "user",
    oldValues: null,
    newValues: { fullName: "Nguyen Van A" },
    changedFields: ["fullName"],
    sensitivityLevel: "normal",
    resultStatus: "success",
    requestId: "req-1",
    correlationId: null,
    ipAddress: "10.0.0.1",
    actorEmployeeId: null,
    actionGroup: "data",
    entityIdText: null,
    entityCode: null,
    permissionCode: "create:employee",
    dataScope: "Company",
    deviceInfo: null,
    diffSummary: null,
    errorCode: null,
    errorMessage: null,
    metadata: null,
    createdAt: "2026-06-25T10:00:00.000Z",
  },
];

// Cặp engine canonical từ contract (KHÔNG literal magic-string) → key capabilities "view:audit-log".
const VIEW_AUDIT_LOG_CAP = `${AUTH_AUDIT_LOG.VIEW.action}:${AUTH_AUDIT_LOG.VIEW.resource}`;
const NON_AUDIT_CAP = "read:employee";

function makeMe(capabilities: Record<string, boolean>): MeResponse {
  return meResponseSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    email: "admin@demo.local",
    fullName: "Super Admin",
    status: "active",
    capabilities,
    mustSetupTwoFactor: false,
  });
}

function hydrateFromMe(me: MeResponse) {
  useAuthStore.getState().setUser(me, me.capabilities);
}

function hydrateWithAuditView() {
  hydrateFromMe(makeMe({ [VIEW_AUDIT_LOG_CAP]: true }));
}

function resetSession() {
  useAuthStore.getState().logout();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AuditLogsPage", () => {
  beforeEach(() => {
    resetSession();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  // ── DENY-PATH (RED-trước) ─────────────────────────────────────────────────
  it("renders forbidden and does NOT call API when /auth/me has no view:audit-log cap", () => {
    hydrateFromMe(makeMe({}));
    renderWithQuery(<AuditLogsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renders forbidden when /auth/me grants a non-audit cap but not view:audit-log", () => {
    hydrateFromMe(makeMe({ [NON_AUDIT_CAP]: true }));
    renderWithQuery(<AuditLogsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH ──────────────────────────────────────────────────────────────
  it("renders audit-log list when /auth/me hydrates view:audit-log capability", async () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<AuditLogsPage />);
    await waitFor(() => expect(screen.getByText("HR")).toBeInTheDocument());
    expect(screen.getByText("create")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("/foundation/audit-logs"),
      expect.anything(),
    );
  });

  // ── LOADING ─────────────────────────────────────────────────────────────────
  it("shows table skeleton while fetching", () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<AuditLogsPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  // ── ERROR ─────────────────────────────────────────────────────────────────
  it("shows error state when API fails", async () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockRejectedValue(new Error("network"));
    renderWithQuery(<AuditLogsPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải audit log/i)).toBeInTheDocument());
  });

  // ── EMPTY ─────────────────────────────────────────────────────────────────
  it("shows empty state when no rows returned", async () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockResolvedValue([]);
    renderWithQuery(<AuditLogsPage />);
    await waitFor(() => expect(screen.getByText(/không có audit log/i)).toBeInTheDocument());
  });

  // ── FILTER → refetch với param moduleCode ────────────────────────────────────
  it("re-queries with moduleCode filter when applied", async () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<AuditLogsPage />);
    await waitFor(() => expect(screen.getByText("HR")).toBeInTheDocument());

    const moduleInput = screen.getAllByRole("textbox")[0];
    fireEvent.change(moduleInput, { target: { value: "HR" } });
    fireEvent.click(screen.getByRole("button", { name: /^lọc$/i }));

    await waitFor(() => {
      const urls = vi.mocked(apiFetch).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("moduleCode=HR"))).toBe(true);
    });
  });

  // ── BẢO MẬT: không token vào storage ──────────────────────────────────────
  it("does not leak any token into client storage", async () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<AuditLogsPage />);
    await waitFor(() => expect(screen.getByText("HR")).toBeInTheDocument());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
