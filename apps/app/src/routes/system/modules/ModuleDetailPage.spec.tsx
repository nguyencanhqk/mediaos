/**
 * ModuleDetailPage — S2-FE-FND-3.
 *
 * Cổng thật là SERVER (route-level ProtectedRoute chặn trước khi tới component) — component test chỉ
 * xác nhận loading/error/forbidden/not-found/success render đúng theo apiFetch mock, cùng kỹ thuật
 * FileDetailPage.spec.tsx.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@mediaos/web-core";
import type { AdminModuleDetail } from "@mediaos/contracts";
import { ModuleDetailPage } from "./ModuleDetailPage";

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
  const commonVi = { actions: { retry: "Thử lại" } };
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
        t: (key: string) => {
          const nsKey = key.includes(":") ? key : `${namespace}:${key}`;
          const [resolvedNs, resolvedKey] = nsKey.split(":");
          return resolve(resolvedNs, resolvedKey);
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

const MOCK_MODULE: AdminModuleDetail = {
  module_code: "HR",
  name: "Nhân sự",
  description: "Quản lý hồ sơ nhân viên",
  group: "core",
  is_active: true,
  enabled: true,
  required_permissions: ["HR.EMPLOYEE.VIEW"],
  route: "/hr",
  icon: "users",
};

describe("ModuleDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading skeleton while fetching", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<ModuleDetailPage moduleCode="HR" />);
    expect(screen.getByTestId("module-detail-loading")).toBeInTheDocument();
  });

  it("renders module metadata when fetch succeeds", async () => {
    vi.mocked(apiFetch).mockResolvedValue(MOCK_MODULE);
    renderWithQuery(<ModuleDetailPage moduleCode="HR" />);
    await waitFor(() => expect(screen.getByText("Nhân sự")).toBeInTheDocument());
    expect(screen.getByText("HR.EMPLOYEE.VIEW")).toBeInTheDocument();
  });

  it("shows forbidden state on 403", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(403, "FORBIDDEN", "no permission"));
    renderWithQuery(<ModuleDetailPage moduleCode="HR" />);
    await waitFor(() => expect(screen.getByTestId("module-detail-forbidden")).toBeInTheDocument());
  });

  it("shows not-found state on 404", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(404, "NOT_FOUND", "missing"));
    renderWithQuery(<ModuleDetailPage moduleCode="UNKNOWN" />);
    await waitFor(() => expect(screen.getByTestId("module-detail-not-found")).toBeInTheDocument());
  });

  it("shows generic error state on network failure", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("network"));
    renderWithQuery(<ModuleDetailPage moduleCode="HR" />);
    await waitFor(() => expect(screen.getByTestId("module-detail-error")).toBeInTheDocument());
  });

  // ── Read-only: no toggle/mutation control rendered (BE follow-up chưa có) ──
  it("does not render an enable/disable toggle control", async () => {
    vi.mocked(apiFetch).mockResolvedValue(MOCK_MODULE);
    renderWithQuery(<ModuleDetailPage moduleCode="HR" />);
    await waitFor(() => expect(screen.getByText("Nhân sự")).toBeInTheDocument());
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bật|tắt/i })).not.toBeInTheDocument();
  });
});
