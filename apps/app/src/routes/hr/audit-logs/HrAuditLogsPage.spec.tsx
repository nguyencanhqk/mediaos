// @vitest-environment jsdom
/**
 * [deny-path] HrAuditLogsPage — S2-FE-HR-6.
 *
 * Gate: HR_ENGINE_PAIRS.AUDIT_LOG_VIEW (= view:audit-log, cặp seed THẬT mig 0340, is_sensitive=true)
 * → useCanExact (KHÔNG wildcard fallback, mirror BE fail-closed cho cặp sensitive).
 *  - THIẾU quyền → forbidden EmptyState, KHÔNG gọi hrAuditApi.listHrAuditLogs.
 *  - Có quyền → list render (before/after ĐÃ redact ở server — test dùng field an toàn
 *    changedFields); loading/error/empty; filter → refetch với moduleCode=HR cố định.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCanExact: vi.fn(() => false),
  hrAuditApi: {
    listHrAuditLogs: vi.fn(),
  },
  hrKeys: {
    auditLogs: {
      all: ["hr", "audit-logs"],
      list: (params?: unknown) => ["hr", "audit-logs", "list", params],
    },
  },
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title }: { title: string }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
      </div>
    ),
    EmptyState: ({
      title,
      description,
      "data-testid": testId,
    }: {
      title: string;
      description?: string;
      "data-testid"?: string;
    }) => (
      <div data-testid={testId ?? "empty-state"}>
        <p>{title}</p>
        {description && <p>{description}</p>}
      </div>
    ),
  };
});

import { useCanExact, hrAuditApi } from "@mediaos/web-core";
import type { AuditLogDto, AuditLogListResponse } from "@mediaos/contracts";
import { HrAuditLogsPage } from "./HrAuditLogsPage";

const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockList = hrAuditApi.listHrAuditLogs as ReturnType<typeof vi.fn>;

function makeLog(overrides: Partial<AuditLogDto> = {}): AuditLogDto {
  return {
    id: "audit-1",
    companyId: "company-1",
    actorUserId: "user-001",
    action: "update",
    objectType: "employee",
    objectId: "emp-1",
    before: null,
    after: { redacted: true },
    ip: null,
    userAgent: null,
    moduleCode: "HR",
    entityType: "employee",
    entityId: "emp-1",
    actorType: "user",
    oldValues: null,
    newValues: null,
    changedFields: ["position_id"],
    sensitivityLevel: null,
    resultStatus: "success",
    requestId: null,
    correlationId: null,
    ipAddress: null,
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
    ...overrides,
  };
}

function makeResponse(data: AuditLogDto[], total = data.length): AuditLogListResponse {
  return { data, meta: { total, limit: 25, offset: 0 } };
}

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <HrAuditLogsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HrAuditLogsPage", () => {
  it("[deny] no view:audit-log → forbidden EmptyState + listHrAuditLogs NOT called", () => {
    mockUseCanExact.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("hr-audit-logs-forbidden")).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("allow → renders rows (masked DTO fields only)", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockList.mockResolvedValue(makeResponse([makeLog()]));

    renderPage(buildQC());

    await waitFor(() => {
      const table = document.querySelector("table") as HTMLTableElement;
      expect(within(table).getByText("update")).toBeInTheDocument();
    });
    const table = document.querySelector("table") as HTMLTableElement;
    expect(within(table).getByText("position_id")).toBeInTheDocument();
  });

  it("shows error EmptyState when hrAuditApi.listHrAuditLogs fails", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockList.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByText(/không thể tải lịch sử/i)).toBeInTheDocument();
    });
  });

  it("shows empty state when list resolves with 0 items", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockList.mockResolvedValue(makeResponse([]));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByText(/chưa có lịch sử/i).length).toBeGreaterThan(0);
    });
  });

  it("filter by action → re-queries with action + moduleCode=HR fixed", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockList.mockResolvedValue(makeResponse([makeLog()]));

    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText("update")).toBeInTheDocument());

    const actionInput = screen.getByPlaceholderText("vd: update");
    fireEvent.change(actionInput, { target: { value: "delete" } });
    fireEvent.click(screen.getByRole("button", { name: /^lọc$/i }));

    await waitFor(() => {
      const calls = mockList.mock.calls;
      expect(calls.some((c) => (c[0] as { action?: string })?.action === "delete")).toBe(true);
    });
  });
});
