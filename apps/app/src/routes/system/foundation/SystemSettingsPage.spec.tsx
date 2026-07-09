/**
 * [RED-trước · deny-path + masking QA-06] SystemSettingsPage — S2-FE-FND-8 (UI-SYSTEM-SCREEN-004).
 *
 * Gate DUY NHẤT: system-manage:foundation-setting (cặp seed thật mig 0435:343, is_sensitive=TRUE — BE
 * KHÔNG tách view/manage cho system-scope, xem docs/plans/S2-FND-SYSSET-1.md RECONCILE DECISION).
 *  - THIẾU system-manage:foundation-setting → ForbiddenState, KHÔNG gọi getSystemSettings.
 *  - CÓ → đọc + Nút "Sửa" hiện (đọc và sửa dùng CÙNG 1 cặp quyền, khác company-settings).
 * Masking (BẤT BIẾN #3): setting is_sensitive/masked=true → MaskedField placeholder, raw KHÔNG có trong DOM.
 * Grouping: setting nhóm theo `category` (server trả sẵn) — mỗi nhóm render 1 khối riêng.
 * Submit KHÔNG log giá trị nhạy cảm ra console.
 * States: loading · error · empty.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, foundationApi } from "@mediaos/web-core";
import type { SafeSettingView } from "@mediaos/web-core";
import { SystemSettingsPage } from "./SystemSettingsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    foundationApi: {
      ...actual.foundationApi,
      getSystemSettings: vi.fn(),
      getSystemSetting: vi.fn(),
      updateSystemSetting: vi.fn(),
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

const GENERAL_SETTING: SafeSettingView = {
  key: "system.default_locale",
  value: "vi-VN",
  valueType: "String",
  category: "General",
  moduleCode: "SYSTEM",
  scope: "system",
  isSensitive: false,
  masked: false,
};

const MAIL_SETTING: SafeSettingView = {
  key: "mail.smtp_host",
  value: "smtp.example.com",
  valueType: "String",
  category: "Mail",
  moduleCode: null,
  scope: "system",
  isSensitive: false,
  masked: false,
};

// Server đã mask: value='***' (placeholder), test dùng chuỗi raw giả để CHỨNG minh không rò.
const SENSITIVE_SETTING: SafeSettingView = {
  key: "mail.smtp_password",
  value: "SUPER_SECRET_RAW",
  valueType: "SecretRef",
  category: "Mail",
  moduleCode: null,
  scope: "system",
  isSensitive: true,
  masked: true,
};

describe("SystemSettingsPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no system-manage:foundation-setting → forbidden, API not called ────
  it("renders forbidden and does NOT call getSystemSettings when lacking system-manage:foundation-setting", () => {
    setCapabilities({});
    renderWithQuery(<SystemSettingsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(foundationApi.getSystemSettings).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: view:foundation-setting (cặp company-settings) KHÔNG mở system-manage ──
  it("stays forbidden when user only has view/update:foundation-setting (company pair ≠ system-manage)", () => {
    setCapabilities({ "view:foundation-setting": true, "update:foundation-setting": true });
    renderWithQuery(<SystemSettingsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(foundationApi.getSystemSettings).not.toHaveBeenCalled();
  });

  // ── ALLOW: system-manage:foundation-setting → đọc + nút Sửa hiện (đọc=sửa CÙNG cặp) ──
  it("fetches settings and shows the edit button when user has system-manage:foundation-setting", async () => {
    setCapabilities({ "system-manage:foundation-setting": true });
    vi.mocked(foundationApi.getSystemSettings).mockResolvedValue([GENERAL_SETTING]);
    renderWithQuery(<SystemSettingsPage />);
    await waitFor(() => expect(screen.getByText("system.default_locale")).toBeInTheDocument());
    expect(foundationApi.getSystemSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /^sửa$/i })).toBeInTheDocument();
  });

  // ── GROUPING: setting nhóm theo category, mỗi nhóm render 1 khối tiêu đề riêng ──
  it("groups settings by category into separate sections", async () => {
    setCapabilities({ "system-manage:foundation-setting": true });
    vi.mocked(foundationApi.getSystemSettings).mockResolvedValue([GENERAL_SETTING, MAIL_SETTING]);
    renderWithQuery(<SystemSettingsPage />);
    await waitFor(() => expect(screen.getByText("system.default_locale")).toBeInTheDocument());
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Mail")).toBeInTheDocument();
    expect(screen.getByText("mail.smtp_host")).toBeInTheDocument();
  });

  // ── MASKING (QA-06): sensitive value masked → raw NOT in DOM ───────────────
  it("renders MaskedField for sensitive setting and never leaks raw value into DOM", async () => {
    setCapabilities({ "system-manage:foundation-setting": true });
    vi.mocked(foundationApi.getSystemSettings).mockResolvedValue([SENSITIVE_SETTING]);
    const { container } = renderWithQuery(<SystemSettingsPage />);
    await waitFor(() => expect(screen.getByText("mail.smtp_password")).toBeInTheDocument());
    expect(screen.getByTestId("masked-value")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("SUPER_SECRET_RAW");
  });

  // ── SUBMIT does NOT log sensitive value to console ─────────────────────────
  it("does not console.log the sensitive value on submit", async () => {
    setCapabilities({ "system-manage:foundation-setting": true });
    vi.mocked(foundationApi.getSystemSettings).mockResolvedValue([SENSITIVE_SETTING]);
    vi.mocked(foundationApi.updateSystemSetting).mockResolvedValue({ ...SENSITIVE_SETTING });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithQuery(<SystemSettingsPage />);
    await waitFor(() => expect(screen.getByText("mail.smtp_password")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^sửa$/i }));

    const valueInput = await screen.findByLabelText(/giá trị mới/i);
    fireEvent.change(valueInput, { target: { value: "NEW_SECRET_VALUE" } });
    fireEvent.click(screen.getByRole("button", { name: /^lưu$/i }));

    const confirmBtn = await screen.findByRole("button", { name: /lưu cấu hình/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(foundationApi.updateSystemSetting).toHaveBeenCalledTimes(1));
    const [key, body] = vi.mocked(foundationApi.updateSystemSetting).mock.calls[0];
    expect(key).toBe("mail.smtp_password");
    expect(JSON.stringify(body)).not.toContain("company_id");

    const allLogArgs = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join(" ");
    expect(allLogArgs).not.toContain("NEW_SECRET_VALUE");
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  // ── LOADING ────────────────────────────────────────────────────────────────
  it("shows loading skeleton while fetching", () => {
    setCapabilities({ "system-manage:foundation-setting": true });
    vi.mocked(foundationApi.getSystemSettings).mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<SystemSettingsPage />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  // ── ERROR ────────────────────────────────────────────────────────────────
  it("shows error state when getSystemSettings fails", async () => {
    setCapabilities({ "system-manage:foundation-setting": true });
    vi.mocked(foundationApi.getSystemSettings).mockRejectedValue(new Error("boom"));
    renderWithQuery(<SystemSettingsPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải cấu hình/i)).toBeInTheDocument());
  });

  // ── EMPTY ────────────────────────────────────────────────────────────────
  it("shows empty state when no settings returned", async () => {
    setCapabilities({ "system-manage:foundation-setting": true });
    vi.mocked(foundationApi.getSystemSettings).mockResolvedValue([]);
    renderWithQuery(<SystemSettingsPage />);
    await waitFor(() => expect(screen.getByText(/không có cấu hình/i)).toBeInTheDocument());
  });
});
