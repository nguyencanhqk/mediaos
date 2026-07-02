/**
 * [deny-path + landing] SystemOverviewPage — S2-FE-FND-1 (FND1-APP).
 *
 * /system landing THAY ModulePlaceholder. Gate hiển thị theo cặp seed thật; mỗi thẻ chỉ hiện khi có quyền.
 *  - Không có bất kỳ cặp FOUNDATION/AUTH nào → ForbiddenState (fail-closed), KHÔNG gọi getCompany.
 *  - Có view:foundation-company → thẻ hồ sơ công ty + tên; getCompany được gọi.
 *  - view:foundation-setting → thẻ cấu hình; view:user → thẻ người dùng.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, foundationApi, getHealth } from "@mediaos/web-core";
import type { CompanyView } from "@mediaos/contracts";
import { SystemOverviewPage } from "./SystemOverviewPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    getHealth: vi.fn(),
    foundationApi: {
      getCompany: vi.fn(),
      updateCompany: vi.fn(),
      resolveSettings: vi.fn(),
      updateCompanySetting: vi.fn(),
    },
  };
});

// Link needs router context — stub to a plain anchor.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
      <a href={to}>{children}</a>
    ),
  };
});

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

const COMPANY = {
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
  taxCode: null,
  businessType: null,
  regNumber: null,
  regDate: null,
  regPlace: null,
  legalRepName: null,
  legalRepTitle: null,
  establishedDate: null,
  address: null,
  phone: null,
  fax: null,
  email: null,
  website: null,
} satisfies CompanyView;

describe("SystemOverviewPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(getHealth).mockResolvedValue({ status: "ok" });
  });

  // ── DENY-PATH: no foundation/auth pair → forbidden, getCompany not called ──
  it("renders forbidden and does NOT fetch company when user has no system access", () => {
    setCapabilities({});
    renderWithQuery(<SystemOverviewPage />);
    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
    expect(foundationApi.getCompany).not.toHaveBeenCalled();
  });

  // ── company card + name when canViewCompany ────────────────────────────────
  it("shows the company card and name when user has view:foundation-company", async () => {
    setCapabilities({ "view:foundation-company": true });
    vi.mocked(foundationApi.getCompany).mockResolvedValue(COMPANY);
    renderWithQuery(<SystemOverviewPage />);
    expect(screen.getByText(/tổng quan hệ thống/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Công ty Demo")).toBeInTheDocument());
    expect(foundationApi.getCompany).toHaveBeenCalledTimes(1);
  });

  // ── settings card gated by view:foundation-setting, company card hidden ────
  it("shows settings card but NOT company card for a settings-only user", () => {
    setCapabilities({ "view:foundation-setting": true });
    renderWithQuery(<SystemOverviewPage />);
    expect(screen.getByText(/cấu hình công ty/i)).toBeInTheDocument();
    // company card manage link not present
    expect(screen.queryByText(/xem & chỉnh sửa/i)).not.toBeInTheDocument();
    // company is not fetched (no view:foundation-company)
    expect(foundationApi.getCompany).not.toHaveBeenCalled();
  });

  // ── S2-FE-FND-4: holidays card gated by view:foundation-holiday ────────────
  it("shows the public-holidays card ONLY when user has view:foundation-holiday", () => {
    setCapabilities({ "view:foundation-setting": true });
    renderWithQuery(<SystemOverviewPage />);
    expect(screen.queryByText(/ngày nghỉ lễ/i)).not.toBeInTheDocument();
  });

  it("shows the public-holidays card when user has view:foundation-holiday", () => {
    setCapabilities({ "view:foundation-holiday": true });
    renderWithQuery(<SystemOverviewPage />);
    expect(screen.getAllByText(/ngày nghỉ lễ/i).length).toBeGreaterThan(0);
  });

  // ── S2-FE-FND-4: health card links to /system/health for every user with access ─
  it("health card links to /system/health", () => {
    setCapabilities({ "view:foundation-setting": true });
    renderWithQuery(<SystemOverviewPage />);
    expect(screen.getByRole("link", { name: /xem chi tiết/i })).toHaveAttribute(
      "href",
      "/system/health",
    );
  });

  // ── S2-FE-FND-7 (RC2): audit-log-only persona — NO soft-403, audit card shown ──
  // Route-guard cho /system (SYSTEM_APP_PERMISSIONS) ALLOW persona chỉ view:audit-log
  // ⇒ thân trang PHẢI landing overview (KHÔNG forbidden EmptyState) + có thẻ Nhật ký kiểm toán.
  it("does NOT show forbidden and shows the audit-logs card for an audit-log-only user", () => {
    setCapabilities({ "view:audit-log": true });
    renderWithQuery(<SystemOverviewPage />);
    // KHÔNG rơi vào soft-403
    expect(screen.queryByText("Không có quyền truy cập")).not.toBeInTheDocument();
    // Đã landing overview thật
    expect(screen.getByText(/tổng quan hệ thống/i)).toBeInTheDocument();
    // Thẻ audit-logs hiện + link tới /system/audit-logs
    expect(screen.getByRole("link", { name: /xem nhật ký kiểm toán/i })).toHaveAttribute(
      "href",
      "/system/audit-logs",
    );
    // Không có quyền company → KHÔNG fetch company
    expect(foundationApi.getCompany).not.toHaveBeenCalled();
  });

  // ── audit-logs card is HIDDEN for a user without view:audit-log (deny-path) ──
  it("does NOT show the audit-logs card for a settings-only user", () => {
    setCapabilities({ "view:foundation-setting": true });
    renderWithQuery(<SystemOverviewPage />);
    expect(screen.queryByRole("link", { name: /xem nhật ký kiểm toán/i })).not.toBeInTheDocument();
  });
});
