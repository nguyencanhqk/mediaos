// @vitest-environment jsdom
/**
 * MyAttendanceRecordsPage tests — S3-FE-ATT-2.
 *
 * Phủ: loading · error · empty · forbidden (deny-path, useCanExact view-own=false → không gọi API)
 *      · columns render (ngày/ca/check-in/out/tổng giờ/status/nguồn)
 *      · StatusBadge · đổi filter (status) → queryFn nhận params mới.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@mediaos/web-core", () => ({
  useCanExact: vi.fn(() => true),
  attendanceApi: {
    listMyRecords: vi.fn(),
  },
  attendanceKeys: {
    myRecords: (p?: unknown) => ["attendance", "my", "records", p],
  },
  formatDateTime: (v: string) => v,
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({
      title,
      description,
      children,
    }: {
      title: string;
      description?: string;
      children?: React.ReactNode;
    }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
    ),
    DataTable: ({
      columns,
      data,
      isLoading,
      emptyState,
    }: {
      columns: Array<{
        id?: string;
        accessorKey?: string;
        header: string | (() => string);
        cell?: (ctx: { row: { original: unknown } }) => React.ReactNode;
      }>;
      data: unknown[];
      isLoading: boolean;
      emptyState?: React.ReactNode;
    }) => {
      if (isLoading) return <div data-testid="table-loading" />;
      if (data.length === 0) return <>{emptyState}</>;
      return (
        <div data-testid="data-table">
          {/* Render header labels */}
          <div data-testid="table-headers">
            {columns.map((col, i) => (
              <span key={i} data-testid={`col-header-${String(col.accessorKey ?? col.id ?? i)}`}>
                {typeof col.header === "function" ? col.header() : col.header}
              </span>
            ))}
          </div>
          {/* Render rows */}
          {data.map((row, ri) => (
            <div key={ri} data-testid="table-row">
              {columns.map((col, ci) =>
                col.cell ? (
                  <span
                    key={ci}
                    data-testid={`cell-${String(col.accessorKey ?? col.id ?? ci)}-${ri}`}
                  >
                    {col.cell({ row: { original: row } })}
                  </span>
                ) : null,
              )}
            </div>
          ))}
        </div>
      );
    },
    EmptyState: ({ title, description }: { title: string; description?: string }) => (
      <div data-testid="empty-state">
        <p>{title}</p>
        {description && <p>{description}</p>}
      </div>
    ),
    Skeleton: () => <div data-testid="skeleton" />,
    Select: ({
      children,
      onChange,
      value,
      ...props
    }: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) => (
      <select data-testid="select" value={value} onChange={onChange} {...props}>
        {children}
      </select>
    ),
    Button: ({
      children,
      onClick,
      disabled,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
    Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
      <span data-testid="badge" data-variant={variant}>
        {children}
      </span>
    ),
  };
});

import { useCanExact, attendanceApi } from "@mediaos/web-core";
import { MyAttendanceRecordsPage } from "./MyAttendanceRecordsPage";

const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockListMyRecords = attendanceApi.listMyRecords as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RECORD_ROW = {
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
  orgUnitId: null,
  orgUnitName: null,
};

const makeResponse = (items = [RECORD_ROW]) => ({
  items,
  meta: {
    page: 1,
    pageSize: 20,
    total: items.length,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
});

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MyAttendanceRecordsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCanExact.mockReturnValue(true);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MyAttendanceRecordsPage", () => {
  // ── Deny-path: forbidden ───────────────────────────────────────────────────

  it("[deny] useCanExact view-own=false → forbidden EmptyState + listMyRecords NOT called", () => {
    mockUseCanExact.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(mockListMyRecords).not.toHaveBeenCalled();
    // DataTable must NOT render
    expect(screen.queryByTestId("data-table")).not.toBeInTheDocument();
  });

  // ── Loading ────────────────────────────────────────────────────────────────

  it("shows loading state while query is pending", () => {
    mockListMyRecords.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage(buildQC());

    expect(screen.getByTestId("table-loading")).toBeInTheDocument();
  });

  // ── Error ──────────────────────────────────────────────────────────────────

  it("shows error EmptyState when API fails", async () => {
    mockListMyRecords.mockRejectedValue(new Error("Network error"));
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });

  // ── Empty ──────────────────────────────────────────────────────────────────

  it("shows empty EmptyState when items is empty array", async () => {
    mockListMyRecords.mockResolvedValue(makeResponse([]));
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("table-row")).not.toBeInTheDocument();
  });

  // ── Columns render ─────────────────────────────────────────────────────────

  it("renders row with all 7 columns (date/shift/checkIn/checkOut/totalHours/status/source)", async () => {
    mockListMyRecords.mockResolvedValue(makeResponse());
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    // Date column
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
    // Shift column (shiftId value)
    expect(screen.getByText("shift-1")).toBeInTheDocument();
    // Check-in
    expect(screen.getByText("2026-07-01T01:05:00.000Z")).toBeInTheDocument();
    // Check-out
    expect(screen.getByText("2026-07-01T10:30:00.000Z")).toBeInTheDocument();
    // Total hours (480 min = 8h)
    expect(screen.getByText("8h")).toBeInTheDocument();
    // Source (checkInMethod)
    expect(screen.getByText("web")).toBeInTheDocument();
  });

  // ── StatusBadge renders ────────────────────────────────────────────────────

  it("renders AttendanceStatusBadge for attendanceStatus column", async () => {
    mockListMyRecords.mockResolvedValue(makeResponse());
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("badge")).toBeInTheDocument();
    });
  });

  // ── Filter: status change → listMyRecords called with new params ──────────

  it("changing status filter resets page and refetches with new attendanceStatus param", async () => {
    mockListMyRecords.mockResolvedValue(makeResponse());
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    const select = screen.getByTestId("filter-status");
    fireEvent.change(select, { target: { value: "Late" } });

    await waitFor(() => {
      const calls = mockListMyRecords.mock.calls;
      const lastCall = calls[calls.length - 1][0] as Record<string, unknown>;
      expect(lastCall.attendanceStatus).toBe("Late");
    });
  });
});
