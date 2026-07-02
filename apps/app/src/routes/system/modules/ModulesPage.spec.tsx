/**
 * ModulesPage — S2-FE-FND-3 (SYSTEM-SCREEN-MODULES).
 *
 * Gate: cặp ENGINE THỰC ('view','foundation-module') — seed mig 0435 dòng 338 (is_sensitive=false,
 *   bulk-grant company-admin qua LIKE 'foundation-%') — cặp mà ModuleAdminController thật sự
 *   @RequirePermission (S2-FND-BE-1).
 *
 * Hydrate qua ĐÚNG entrypoint /auth/me dùng (session.ts doBootstrap): setUser(me, me.capabilities) —
 * cùng kỹ thuật FilesPage.spec.tsx.
 *
 * States: loading · error · empty · forbidden · list render · search filter (client-side).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, apiFetch } from "@mediaos/web-core";
import { meResponseSchema, type AdminModuleItem, type MeResponse } from "@mediaos/contracts";
import { ModulesPage } from "./ModulesPage";
import { FOUNDATION_MODULE_VIEW } from "./constants";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

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

const MOCK_ROWS: AdminModuleItem[] = [
  {
    module_code: "HR",
    name: "Nhân sự",
    description: "Quản lý hồ sơ nhân viên",
    group: "core",
    is_active: true,
    enabled: true,
    required_permissions: ["HR.EMPLOYEE.VIEW"],
    route: "/hr",
    icon: "users",
  },
  {
    module_code: "PAYROLL",
    name: "Tiền lương",
    description: null,
    group: "core",
    is_active: false,
    enabled: false,
    required_permissions: [],
    route: "",
    icon: "",
  },
];

const VIEW_MODULE_CAP = `${FOUNDATION_MODULE_VIEW.action}:${FOUNDATION_MODULE_VIEW.resourceType}`;
const NON_MODULE_CAP = "read:employee";

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

function hydrateWithModuleView() {
  hydrateFromMe(makeMe({ [VIEW_MODULE_CAP]: true }));
}

function resetSession() {
  useAuthStore.getState().logout();
}

describe("ModulesPage", () => {
  beforeEach(() => {
    resetSession();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  // ── DENY-PATH (RED-trước) ─────────────────────────────────────────────────
  it("renders forbidden and does NOT call API when /auth/me has no view:foundation-module cap", () => {
    hydrateFromMe(makeMe({}));
    renderWithQuery(<ModulesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renders forbidden when /auth/me grants a non-module cap", () => {
    hydrateFromMe(makeMe({ [NON_MODULE_CAP]: true }));
    renderWithQuery(<ModulesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH ──────────────────────────────────────────────────────────────
  it("renders module list when /auth/me hydrates view:foundation-module capability", async () => {
    hydrateWithModuleView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<ModulesPage />);
    await waitFor(() => expect(screen.getByText("Nhân sự")).toBeInTheDocument());
    expect(screen.getByText("Tiền lương")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("/foundation/modules"),
      expect.anything(),
    );
  });

  // ── LOADING ─────────────────────────────────────────────────────────────────
  it("shows table skeleton while fetching", () => {
    hydrateWithModuleView();
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<ModulesPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  // ── ERROR ─────────────────────────────────────────────────────────────────
  it("shows error state when API fails", async () => {
    hydrateWithModuleView();
    vi.mocked(apiFetch).mockRejectedValue(new Error("network"));
    renderWithQuery(<ModulesPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh mục module/i)).toBeInTheDocument(),
    );
  });

  // ── EMPTY ─────────────────────────────────────────────────────────────────
  it("shows empty state when no rows returned", async () => {
    hydrateWithModuleView();
    vi.mocked(apiFetch).mockResolvedValue([]);
    renderWithQuery(<ModulesPage />);
    await waitFor(() => expect(screen.getByText(/không có module/i)).toBeInTheDocument());
  });

  // ── SEARCH filter (client-side) ─────────────────────────────────────────────
  it("filters rows by search text without extra API calls", async () => {
    hydrateWithModuleView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<ModulesPage />);
    await waitFor(() => expect(screen.getByText("Nhân sự")).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText(/tìm theo mã hoặc tên module/i);
    fireEvent.change(searchInput, { target: { value: "PAYROLL" } });

    await waitFor(() => {
      expect(screen.queryByText("Nhân sự")).not.toBeInTheDocument();
      expect(screen.getByText("Tiền lương")).toBeInTheDocument();
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  // ── Read-only: no toggle/mutation control rendered (BE follow-up chưa có) ──
  it("does not render an enable/disable toggle control", async () => {
    hydrateWithModuleView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<ModulesPage />);
    await waitFor(() => expect(screen.getByText("Nhân sự")).toBeInTheDocument());
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  // ── BẢO MẬT: không token vào storage ──────────────────────────────────────
  it("does not leak any token into client storage", async () => {
    hydrateWithModuleView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<ModulesPage />);
    await waitFor(() => expect(screen.getByText("Nhân sự")).toBeInTheDocument());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
