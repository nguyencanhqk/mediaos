// @vitest-environment jsdom
/**
 * [deny-path] AttendanceCompanyRecordsPage — gate useCanExact('view-company','attendance').
 *
 * Crown deny-path:
 * - employee/manager (useCanExact view-company=false) → forbidden EmptyState + listRecords NOT called.
 * - HR/Admin (view-company=true) → DataTable renders items.
 *
 * Pattern theo TeamAttendanceRecordsPage.spec.tsx.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@mediaos/web-core", () => ({
  useCanExact: vi.fn(() => false),
  attendanceApi: {
    listRecords: vi.fn(),
  },
  attendanceKeys: {
    records: {
      list: (p?: unknown) => ["attendance", "records", "list", p],
    },
  },
  formatDateTime: (v: string) => v,
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title, children }: { title: string; children?: React.ReactNode }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {children}
      </div>
    ),
    DataTable: ({ data }: { data: unknown[] }) => (
      <div data-testid="data-table">
        {data.map((_, i) => (
          <div key={i} data-testid="table-row" />
        ))}
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
    Skeleton: () => <div data-testid="skeleton" />,
    Select: ({
      children,
      ...props
    }: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) => (
      <select {...props}>{children}</select>
    ),
  };
});

import { useCanExact, attendanceApi } from "@mediaos/web-core";
import { AttendanceCompanyRecordsPage } from "./AttendanceCompanyRecordsPage";

const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockListRecords = attendanceApi.listRecords as ReturnType<typeof vi.fn>;

const COMPANY_RECORDS_RESPONSE = {
  items: [
    {
      id: "rec-1",
      workDate: "2026-07-01",
      employeeId: "emp-1",
      shiftId: "shift-1",
      checkInAt: "2026-07-01T01:05:00.000Z",
      checkOutAt: "2026-07-01T10:30:00.000Z",
      checkInMethod: "web",
      checkOutMethod: "web",
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      workingMinutes: 480,
      requiredWorkingMinutes: 480,
      missingMinutes: 0,
      breakMinutes: 60,
      status: "present",
      attendanceStatus: "Present",
      isLate: false,
      isEarlyLeave: false,
      isMissingCheckOut: false,
      userId: "user-1",
      employeeCode: "EMP001",
      fullName: "Nguyen Van A",
      orgUnitId: "dept-1",
      orgUnitName: "Engineering",
    },
  ],
  meta: {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <AttendanceCompanyRecordsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AttendanceCompanyRecordsPage", () => {
  // ── CROWN deny-path: no view-company ───────────────────────────────────────

  it("[crown deny] no view-company:attendance → forbidden EmptyState + listRecords NOT called", () => {
    mockUseCanExact.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("company-forbidden")).toBeInTheDocument();
    expect(mockListRecords).not.toHaveBeenCalled();
  });

  it("[crown deny] DataTable is NOT rendered when forbidden", () => {
    mockUseCanExact.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.queryByTestId("data-table")).not.toBeInTheDocument();
  });

  // ── HR/Admin (has view-company) → renders data ─────────────────────────────

  it("HR/Admin (useCanExact view-company=true) → calls listRecords and renders rows", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockListRecords.mockResolvedValue(COMPANY_RECORDS_RESPONSE);

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByTestId("table-row")).toHaveLength(1);
    });

    expect(mockListRecords).toHaveBeenCalled();
    expect(screen.getByTestId("data-table")).toBeInTheDocument();
  });

  // ── Error state ────────────────────────────────────────────────────────────

  it("shows error EmptyState when API fails (and canView=true)", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockListRecords.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });

  // ── Empty state (canView=true, resolves empty list) ────────────────────────

  it("shows empty state when list resolves with 0 items", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockListRecords.mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    });

    renderPage(buildQC());

    await waitFor(() => {
      expect(mockListRecords).toHaveBeenCalled();
    });
    expect(screen.getByTestId("data-table")).toBeInTheDocument();
  });
});
