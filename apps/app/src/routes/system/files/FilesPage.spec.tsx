/**
 * FilesPage — S2-FE-FND-2 (SYSTEM-SCREEN-FILES).
 *
 * Gate: cặp ENGINE THỰC ('view','foundation-file') — seed mig 0435 (is_sensitive=false, bulk-grant
 *   company-admin qua LIKE 'foundation-%') — cặp mà FilesController thật sự @RequirePermission.
 *
 * Hydrate qua ĐÚNG entrypoint /auth/me dùng (session.ts doBootstrap): setUser(me, me.capabilities) —
 * cùng kỹ thuật LoginLogsPage.spec.tsx.
 *
 * States: loading · error · empty · forbidden · list render · filter→refetch.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, apiFetch } from "@mediaos/web-core";
import { meResponseSchema, type FileMetadataDto, type MeResponse } from "@mediaos/contracts";
import { FilesPage } from "./FilesPage";
import { FOUNDATION_FILE_VIEW } from "./constants";

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

const MOCK_ROWS: FileMetadataDto[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    originalName: "contract.pdf",
    mimeType: "application/pdf",
    fileExtension: "pdf",
    sizeBytes: 204800,
    visibility: "Private",
    uploadStatus: "Uploaded",
    scanStatus: "Clean",
    uploadedAt: "2026-06-25T10:00:00.000Z",
    downloadCount: 3,
    ownerUserId: "22222222-2222-2222-2222-222222222222",
    isTemporary: false,
  },
];

const VIEW_FILE_CAP = `${FOUNDATION_FILE_VIEW.action}:${FOUNDATION_FILE_VIEW.resourceType}`;
const NON_FILE_CAP = "read:employee";

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

function hydrateWithFileView() {
  hydrateFromMe(makeMe({ [VIEW_FILE_CAP]: true }));
}

function resetSession() {
  useAuthStore.getState().logout();
}

describe("FilesPage", () => {
  beforeEach(() => {
    resetSession();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  // ── DENY-PATH (RED-trước) ─────────────────────────────────────────────────
  it("renders forbidden and does NOT call API when /auth/me has no view:foundation-file cap", () => {
    hydrateFromMe(makeMe({}));
    renderWithQuery(<FilesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renders forbidden when /auth/me grants a non-file cap", () => {
    hydrateFromMe(makeMe({ [NON_FILE_CAP]: true }));
    renderWithQuery(<FilesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH ──────────────────────────────────────────────────────────────
  it("renders file list when /auth/me hydrates view:foundation-file capability", async () => {
    hydrateWithFileView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<FilesPage />);
    await waitFor(() => expect(screen.getByText("contract.pdf")).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("/foundation/files"),
      expect.anything(),
    );
  });

  // ── LOADING ─────────────────────────────────────────────────────────────────
  it("shows table skeleton while fetching", () => {
    hydrateWithFileView();
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<FilesPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  // ── ERROR ─────────────────────────────────────────────────────────────────
  it("shows error state when API fails", async () => {
    hydrateWithFileView();
    vi.mocked(apiFetch).mockRejectedValue(new Error("network"));
    renderWithQuery(<FilesPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh sách tệp tin/i)).toBeInTheDocument(),
    );
  });

  // ── EMPTY ─────────────────────────────────────────────────────────────────
  it("shows empty state when no rows returned", async () => {
    hydrateWithFileView();
    vi.mocked(apiFetch).mockResolvedValue([]);
    renderWithQuery(<FilesPage />);
    await waitFor(() => expect(screen.getByText(/không có tệp tin/i)).toBeInTheDocument());
  });

  // ── FILTER → refetch với param moduleCode ────────────────────────────────────
  it("re-queries with moduleCode filter when applied", async () => {
    hydrateWithFileView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<FilesPage />);
    await waitFor(() => expect(screen.getByText("contract.pdf")).toBeInTheDocument());

    const moduleInput = screen.getAllByRole("textbox")[0];
    fireEvent.change(moduleInput, { target: { value: "HR" } });
    fireEvent.click(screen.getByRole("button", { name: /^lọc$/i }));

    await waitFor(() => {
      const urls = vi.mocked(apiFetch).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("moduleCode=HR"))).toBe(true);
    });
  });

  // ── BẢO MẬT: DTO không lộ storagePath/storageBucket/checksum/signedUrl ─────────
  it("does not leak any token into client storage and DTO stays within allowlist", async () => {
    hydrateWithFileView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<FilesPage />);
    await waitFor(() => expect(screen.getByText("contract.pdf")).toBeInTheDocument());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.body.innerHTML).not.toMatch(/storagePath|storageBucket|checksumSha256/i);
  });
});
