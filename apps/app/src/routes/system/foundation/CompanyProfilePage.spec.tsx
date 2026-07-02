/**
 * [RED-trước · deny-path + tenant/scope] CompanyProfilePage — S2-FE-FND-1 (FND1-APP).
 *
 * Gate: view/update:foundation-company (cặp seed thật mig 0435).
 *  - THIẾU view → ForbiddenState, KHÔNG gọi getCompany.
 *  - THIẾU update → view render nhưng nút edit ẨN.
 * BẤT BIẾN #1: PATCH body KHÔNG chứa company_id/companyId (server resolve từ AuthContext).
 * States: loading · error · empty · view · edit + confirm.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, foundationApi } from "@mediaos/web-core";
import type { CompanyView } from "@mediaos/contracts";
import { CompanyProfilePage } from "./CompanyProfilePage";

// ---------------------------------------------------------------------------
// Mocks — keep real web-core (useCan/store) but stub foundationApi.
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    foundationApi: {
      getCompany: vi.fn(),
      updateCompany: vi.fn(),
      resolveSettings: vi.fn(),
      updateCompanySetting: vi.fn(),
    },
  };
});

// Dirty-form guard reaches into TanStack router state (no RouterProvider here) → no-op.
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

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
        t: (key: string) => resolve(namespace, key),
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

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "admin@demo.local",
      fullName: "Admin",
      status: "Active",
      companyId: "co-001",
    },
  });
}

const COMPANY: CompanyView = {
  id: "co-001",
  name: "Công ty Demo",
  slug: "demo",
  status: "Active",
  shortName: "Demo",
  companyCode: "DEMO",
  logoUrl: null,
  timezone: "Asia/Ho_Chi_Minh",
  currency: "VND",
  language: "vi",
  taxCode: "0101234567",
  businessType: "LLC",
  regNumber: null,
  regDate: null,
  regPlace: null,
  legalRepName: null,
  legalRepTitle: null,
  establishedDate: null,
  address: "Hà Nội",
  phone: "024-1234",
  fax: null,
  email: "info@demo.local",
  website: "https://demo.local",
};

describe("CompanyProfilePage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no view:foundation-company → forbidden, API not called ──────
  it("renders forbidden and does NOT call getCompany when lacking view:foundation-company", () => {
    setCapabilities({});
    renderWithQuery(<CompanyProfilePage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(foundationApi.getCompany).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: view but NOT update → view renders, edit button hidden ──────
  it("hides the edit button when user has view but not update:foundation-company", async () => {
    setCapabilities({ "view:foundation-company": true });
    vi.mocked(foundationApi.getCompany).mockResolvedValue(COMPANY);
    renderWithQuery(<CompanyProfilePage />);
    await waitFor(() => expect(screen.getByText("Công ty Demo")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /chỉnh sửa/i })).not.toBeInTheDocument();
  });

  // ── ALLOW: view + update → edit button shown; edit → confirm → PATCH clean ──
  it("submits update WITHOUT company_id after confirm (server resolves tenant)", async () => {
    setCapabilities({
      "view:foundation-company": true,
      "update:foundation-company": true,
    });
    vi.mocked(foundationApi.getCompany).mockResolvedValue(COMPANY);
    vi.mocked(foundationApi.updateCompany).mockResolvedValue({ ...COMPANY, name: "Đổi Tên" });
    renderWithQuery(<CompanyProfilePage />);

    await waitFor(() => expect(screen.getByText("Công ty Demo")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /chỉnh sửa/i }));

    // Change the name then submit → opens confirm dialog.
    const nameInput = await screen.findByLabelText(/tên công ty/i);
    fireEvent.change(nameInput, { target: { value: "Đổi Tên" } });
    fireEvent.click(screen.getByRole("button", { name: /^lưu thay đổi$/i }));

    // Confirm dialog appears; confirm it (distinct label to avoid collision with the form save button).
    const confirmBtn = await screen.findByRole("button", { name: /xác nhận lưu/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(foundationApi.updateCompany).toHaveBeenCalledTimes(1));
    const body = vi.mocked(foundationApi.updateCompany).mock.calls[0][0];
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("company_id");
    expect(serialized).not.toContain("companyId");
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("slug");
    expect(body).not.toHaveProperty("status");
  });

  // ── LOADING ────────────────────────────────────────────────────────────────
  it("shows loading skeleton while fetching", () => {
    setCapabilities({ "view:foundation-company": true });
    vi.mocked(foundationApi.getCompany).mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<CompanyProfilePage />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  // ── ERROR ────────────────────────────────────────────────────────────────
  it("shows error state when getCompany fails", async () => {
    setCapabilities({ "view:foundation-company": true });
    vi.mocked(foundationApi.getCompany).mockRejectedValue(new Error("boom"));
    renderWithQuery(<CompanyProfilePage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải hồ sơ công ty/i)).toBeInTheDocument(),
    );
  });
});
