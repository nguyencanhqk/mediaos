/**
 * AuditLogDetailPage — S2-FE-FND-2.
 *
 * Cổng thật là SERVER (route-level ProtectedRoute đã chặn trước khi tới component này, giống
 * AttendanceRecordDetailPage) — component chỉ xử lý loading/error(403/404/generic)/render.
 * before/after/oldValues/newValues render an toàn (JSON.stringify), KHÔNG unmask.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@mediaos/web-core";
import type { AuditLogDto } from "@mediaos/contracts";
import { AuditLogDetailPage } from "./AuditLogDetailPage";

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

const MOCK_DETAIL: AuditLogDto = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
  actorUserId: "33333333-3333-3333-3333-333333333333",
  action: "update",
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
  oldValues: { fullName: "Old Name" },
  newValues: { fullName: "New Name" },
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
  permissionCode: "update:employee",
  dataScope: "Company",
  deviceInfo: null,
  diffSummary: null,
  errorCode: null,
  errorMessage: null,
  metadata: null,
  createdAt: "2026-06-25T10:00:00.000Z",
};

describe("AuditLogDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading skeleton while fetching", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<AuditLogDetailPage auditLogId={MOCK_DETAIL.id} />);
    expect(screen.getByTestId("audit-detail-loading")).toBeInTheDocument();
  });

  it("renders detail fields + old/new values when fetch succeeds", async () => {
    vi.mocked(apiFetch).mockResolvedValue(MOCK_DETAIL);
    renderWithQuery(<AuditLogDetailPage auditLogId={MOCK_DETAIL.id} />);
    await waitFor(() => expect(screen.getByText("update")).toBeInTheDocument());
    expect(screen.getByText("HR")).toBeInTheDocument();
    expect(screen.getByText(/Old Name/)).toBeInTheDocument();
    expect(screen.getByText(/New Name/)).toBeInTheDocument();
  });

  it("shows forbidden state on 403", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(403, "FORBIDDEN", "no permission"));
    renderWithQuery(<AuditLogDetailPage auditLogId={MOCK_DETAIL.id} />);
    await waitFor(() => expect(screen.getByTestId("audit-detail-forbidden")).toBeInTheDocument());
  });

  it("shows not-found state on 404", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(404, "NOT_FOUND", "missing"));
    renderWithQuery(<AuditLogDetailPage auditLogId={MOCK_DETAIL.id} />);
    await waitFor(() => expect(screen.getByTestId("audit-detail-not-found")).toBeInTheDocument());
  });

  it("shows generic error state on network failure", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("network"));
    renderWithQuery(<AuditLogDetailPage auditLogId={MOCK_DETAIL.id} />);
    await waitFor(() => expect(screen.getByTestId("audit-detail-error")).toBeInTheDocument());
  });
});
