/**
 * [RED-trước · deny-path + masking QA-06] CompanySettingsPage — S2-FE-FND-1 (FND1-APP).
 *
 * Gate: view/update:foundation-setting (cặp seed thật mig 0435).
 *  - THIẾU view → ForbiddenState, KHÔNG gọi resolveSettings.
 *  - view NHƯNG thiếu update → đọc được, nút "Sửa" ẨN (đọc ≠ sửa).
 * Masking (BẤT BIẾN #3): setting is_sensitive/masked=true → MaskedField placeholder, raw KHÔNG có trong DOM.
 * Submit KHÔNG log giá trị nhạy cảm ra console.
 * States: loading · error · empty.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, foundationApi } from "@mediaos/web-core";
import type { SafeSettingView } from "@mediaos/web-core";
import { CompanySettingsPage } from "./CompanySettingsPage";

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

const PUBLIC_SETTING: SafeSettingView = {
  key: "system.default_timezone",
  value: "Asia/Ho_Chi_Minh",
  valueType: "String",
  category: "General",
  moduleCode: "SYSTEM",
  scope: "company",
  isSensitive: false,
  masked: false,
};

// Server đã mask: value='***' (placeholder), nhưng test dùng chuỗi raw giả để CHỨNG minh không rò.
const SENSITIVE_SETTING: SafeSettingView = {
  key: "mail.smtp_password",
  value: "SUPER_SECRET_RAW",
  valueType: "SecretRef",
  category: "Mail",
  moduleCode: null,
  scope: "company",
  isSensitive: true,
  masked: true,
};

describe("CompanySettingsPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no view:foundation-setting → forbidden, API not called ──────
  it("renders forbidden and does NOT call resolveSettings when lacking view:foundation-setting", () => {
    setCapabilities({});
    renderWithQuery(<CompanySettingsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(foundationApi.resolveSettings).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: view but NOT update → reads, but no "Sửa" button ────────────
  it("hides the edit button when user has view but not update:foundation-setting", async () => {
    setCapabilities({ "view:foundation-setting": true });
    vi.mocked(foundationApi.resolveSettings).mockResolvedValue({ settings: [PUBLIC_SETTING] });
    renderWithQuery(<CompanySettingsPage />);
    await waitFor(() => expect(screen.getByText("system.default_timezone")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^sửa$/i })).not.toBeInTheDocument();
  });

  // ── MASKING (QA-06): sensitive value masked → raw NOT in DOM ───────────────
  it("renders MaskedField for sensitive setting and never leaks raw value into DOM", async () => {
    setCapabilities({ "view:foundation-setting": true });
    vi.mocked(foundationApi.resolveSettings).mockResolvedValue({ settings: [SENSITIVE_SETTING] });
    const { container } = renderWithQuery(<CompanySettingsPage />);
    await waitFor(() => expect(screen.getByText("mail.smtp_password")).toBeInTheDocument());
    expect(screen.getByTestId("masked-value")).toBeInTheDocument();
    // Raw secret must never appear anywhere in the rendered tree.
    expect(container.innerHTML).not.toContain("SUPER_SECRET_RAW");
  });

  // ── SUBMIT does NOT log sensitive value to console ─────────────────────────
  it("does not console.log the sensitive value on submit", async () => {
    setCapabilities({
      "view:foundation-setting": true,
      "update:foundation-setting": true,
    });
    vi.mocked(foundationApi.resolveSettings).mockResolvedValue({ settings: [SENSITIVE_SETTING] });
    vi.mocked(foundationApi.updateCompanySetting).mockResolvedValue({
      ...SENSITIVE_SETTING,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithQuery(<CompanySettingsPage />);
    await waitFor(() => expect(screen.getByText("mail.smtp_password")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^sửa$/i }));

    const valueInput = await screen.findByLabelText(/giá trị mới/i);
    fireEvent.change(valueInput, { target: { value: "NEW_SECRET_VALUE" } });
    fireEvent.click(screen.getByRole("button", { name: /^lưu$/i }));

    // Confirm dialog (sensitive) → confirm.
    const confirmBtn = await screen.findByRole("button", { name: /lưu cấu hình/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(foundationApi.updateCompanySetting).toHaveBeenCalledTimes(1));
    const [key, body] = vi.mocked(foundationApi.updateCompanySetting).mock.calls[0];
    expect(key).toBe("mail.smtp_password");
    expect(JSON.stringify(body)).not.toContain("company_id");

    const allLogArgs = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join(" ");
    expect(allLogArgs).not.toContain("NEW_SECRET_VALUE");
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  // ── LOADING ────────────────────────────────────────────────────────────────
  it("shows loading skeleton while fetching", () => {
    setCapabilities({ "view:foundation-setting": true });
    vi.mocked(foundationApi.resolveSettings).mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<CompanySettingsPage />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  // ── ERROR ────────────────────────────────────────────────────────────────
  it("shows error state when resolveSettings fails", async () => {
    setCapabilities({ "view:foundation-setting": true });
    vi.mocked(foundationApi.resolveSettings).mockRejectedValue(new Error("boom"));
    renderWithQuery(<CompanySettingsPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải cấu hình/i)).toBeInTheDocument());
  });

  // ── EMPTY ────────────────────────────────────────────────────────────────
  it("shows empty state when no settings returned", async () => {
    setCapabilities({ "view:foundation-setting": true });
    vi.mocked(foundationApi.resolveSettings).mockResolvedValue({ settings: [] });
    renderWithQuery(<CompanySettingsPage />);
    await waitFor(() => expect(screen.getByText(/không có cấu hình/i)).toBeInTheDocument());
  });
});
