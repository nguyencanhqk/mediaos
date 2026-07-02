/**
 * FileDetailPage — S2-FE-FND-2.
 *
 * Cổng thật là SERVER (route-level ProtectedRoute chặn trước khi tới component). Download button
 * gate qua PermissionGate('download','foundation-file') — SEPARATE cap từ view (giữ useAuthStore thật
 * để kiểm tra render/không-render nút Download theo capability).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiFetch, ApiError, useAuthStore } from "@mediaos/web-core";
import { meResponseSchema, type FileMetadataDto, type MeResponse } from "@mediaos/contracts";
import { FileDetailPage } from "./FileDetailPage";

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

const MOCK_FILE: FileMetadataDto = {
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
  links: [],
};

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

function resetSession() {
  useAuthStore.getState().logout();
}

describe("FileDetailPage", () => {
  beforeEach(() => {
    resetSession();
    vi.clearAllMocks();
  });

  it("shows loading skeleton while fetching", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<FileDetailPage fileId={MOCK_FILE.id} />);
    expect(screen.getByTestId("file-detail-loading")).toBeInTheDocument();
  });

  it("renders file metadata when fetch succeeds", async () => {
    vi.mocked(apiFetch).mockResolvedValue(MOCK_FILE);
    renderWithQuery(<FileDetailPage fileId={MOCK_FILE.id} />);
    await waitFor(() => expect(screen.getByText("contract.pdf")).toBeInTheDocument());
    expect(screen.getByText("application/pdf")).toBeInTheDocument();
  });

  it("shows forbidden state on 403", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(403, "FORBIDDEN", "no permission"));
    renderWithQuery(<FileDetailPage fileId={MOCK_FILE.id} />);
    await waitFor(() => expect(screen.getByTestId("file-detail-forbidden")).toBeInTheDocument());
  });

  it("shows not-found state on 404", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(404, "NOT_FOUND", "missing"));
    renderWithQuery(<FileDetailPage fileId={MOCK_FILE.id} />);
    await waitFor(() => expect(screen.getByTestId("file-detail-not-found")).toBeInTheDocument());
  });

  it("shows generic error state on network failure", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("network"));
    renderWithQuery(<FileDetailPage fileId={MOCK_FILE.id} />);
    await waitFor(() => expect(screen.getByTestId("file-detail-error")).toBeInTheDocument());
  });

  // ── PermissionGate: nút Download chỉ hiện khi có cặp 'download:foundation-file' ────────────
  it("hides Download button when user lacks download:foundation-file capability", async () => {
    hydrateFromMe(makeMe({}));
    vi.mocked(apiFetch).mockResolvedValue(MOCK_FILE);
    renderWithQuery(<FileDetailPage fileId={MOCK_FILE.id} />);
    await waitFor(() => expect(screen.getByText("contract.pdf")).toBeInTheDocument());
    expect(screen.queryByText(/tải xuống/i)).not.toBeInTheDocument();
  });

  it("shows Download button when user has download:foundation-file capability", async () => {
    hydrateFromMe(makeMe({ "download:foundation-file": true }));
    vi.mocked(apiFetch).mockResolvedValue(MOCK_FILE);
    renderWithQuery(<FileDetailPage fileId={MOCK_FILE.id} />);
    await waitFor(() => expect(screen.getByText("contract.pdf")).toBeInTheDocument());
    expect(screen.getByText(/tải xuống/i)).toBeInTheDocument();
  });

  // ── BẢO MẬT: DTO không lộ storagePath/checksum ─────────────────────────────
  it("does not render storagePath/checksum in the DOM", async () => {
    vi.mocked(apiFetch).mockResolvedValue(MOCK_FILE);
    renderWithQuery(<FileDetailPage fileId={MOCK_FILE.id} />);
    await waitFor(() => expect(screen.getByText("contract.pdf")).toBeInTheDocument());
    expect(document.body.innerHTML).not.toMatch(/storagePath|storageBucket|checksumSha256/i);
  });
});
