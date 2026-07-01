// @vitest-environment jsdom
/**
 * AttendanceRecordDetailPage tests — S3-FE-ATT-2.
 *
 * Phủ: loading · success (fields: ngày/ca/check-in/out/tổng giờ/status/nguồn)
 *      · ApiError(403) → forbidden state · ApiError(404) → notFound state
 *      · locationJson=null null-safe (mask server)
 *
 * BẤT BIẾN: KHÔNG mock useCan/useCanExact('view-detail') làm cổng.
 * Server là cổng duy nhất: 403 → forbidden, 404 → notFound.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

// ── vi.hoisted: define MockApiError BEFORE vi.mock hoisting ───────────────────
// vi.mock factory is hoisted to top-of-file by Vitest; class declarations are
// NOT hoisted the same way, so referencing a class inside a factory causes
// ReferenceError. vi.hoisted() runs before vi.mock and makes the value available.
const { MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number, message = "api error") {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return { MockApiError };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@mediaos/web-core", () => ({
  attendanceApi: {
    getRecord: vi.fn(),
  },
  attendanceKeys: {
    records: {
      detail: (id: string) => ["attendance", "records", "detail", id],
    },
  },
  // Expose MockApiError as ApiError so the page's `instanceof ApiError` check works.
  ApiError: MockApiError,
  formatDateTime: (v: string) => v,
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    EmptyState: ({
      title,
      description,
      action,
    }: {
      title: string;
      description?: string;
      action?: React.ReactNode;
    }) => (
      <div data-testid="empty-state">
        <p data-testid="empty-title">{title}</p>
        {description && <p>{description}</p>}
        {action}
      </div>
    ),
    Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
    CardContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="card-content">{children}</div>
    ),
    Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
      <span data-testid="badge" data-variant={variant}>
        {children}
      </span>
    ),
    Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
  };
});

import { attendanceApi } from "@mediaos/web-core";
import { AttendanceRecordDetailPage } from "./AttendanceRecordDetailPage";

const mockGetRecord = attendanceApi.getRecord as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DETAIL_RECORD = {
  id: "rec-1",
  workDate: "2026-07-01",
  employeeId: "emp-1",
  shiftId: "shift-abc",
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
  // Detail-only fields
  locationJson: null, // SENSITIVE — null from server when view-sensitive not granted
  workScheduleId: null,
  checkInStatus: null,
  checkOutStatus: null,
  attendanceSource: "Hệ thống",
  workMode: null,
  createdAt: "2026-07-01T10:30:00.000Z",
  updatedAt: "2026-07-01T10:30:00.000Z",
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient, recordId = "rec-1") {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <AttendanceRecordDetailPage recordId={recordId} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AttendanceRecordDetailPage", () => {
  // ── Loading ────────────────────────────────────────────────────────────────

  it("shows loading skeleton while query is pending", () => {
    mockGetRecord.mockReturnValue(new Promise(() => {}));
    renderPage(buildQC());

    expect(screen.getByTestId("detail-loading")).toBeInTheDocument();
  });

  // ── Success: fields render ─────────────────────────────────────────────────

  it("renders all required fields on success", async () => {
    mockGetRecord.mockResolvedValue(DETAIL_RECORD);
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("card")).toBeInTheDocument();
    });

    // Date
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
    // Shift
    expect(screen.getByText("shift-abc")).toBeInTheDocument();
    // Check-in
    expect(screen.getByText("2026-07-01T01:05:00.000Z")).toBeInTheDocument();
    // Check-out
    expect(screen.getByText("2026-07-01T10:30:00.000Z")).toBeInTheDocument();
    // Total hours (480 min = 8h)
    expect(screen.getByText("8h")).toBeInTheDocument();
    // Source (attendanceSource)
    expect(screen.getByText("Hệ thống")).toBeInTheDocument();
  });

  it("renders AttendanceStatusBadge for attendanceStatus", async () => {
    mockGetRecord.mockResolvedValue(DETAIL_RECORD);
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("badge")).toBeInTheDocument();
    });
  });

  // ── locationJson=null: null-safe (mask by server) ─────────────────────────

  it("locationJson=null → no location field rendered (null-safe mask by server)", async () => {
    mockGetRecord.mockResolvedValue({ ...DETAIL_RECORD, locationJson: null });
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("card")).toBeInTheDocument();
    });

    // Location field should not appear when null
    expect(screen.queryByText(/vị trí/i)).not.toBeInTheDocument();
  });

  // ── ApiError 403 → forbidden state ────────────────────────────────────────

  it("ApiError(status 403) → shows forbidden EmptyState", async () => {
    mockGetRecord.mockRejectedValue(new MockApiError(403));
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("detail-forbidden")).toBeInTheDocument();
    });

    // Must NOT show generic error or not-found
    expect(screen.queryByTestId("detail-not-found")).not.toBeInTheDocument();
    expect(screen.queryByTestId("detail-error")).not.toBeInTheDocument();
  });

  // ── ApiError 404 → notFound state ─────────────────────────────────────────

  it("ApiError(status 404) → shows notFound EmptyState", async () => {
    mockGetRecord.mockRejectedValue(new MockApiError(404));
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("detail-not-found")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("detail-forbidden")).not.toBeInTheDocument();
    expect(screen.queryByTestId("detail-error")).not.toBeInTheDocument();
  });

  // ── Generic error (non-403/404) ────────────────────────────────────────────

  it("generic Error (non-ApiError) → shows generic error EmptyState", async () => {
    mockGetRecord.mockRejectedValue(new Error("Network timeout"));
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("detail-error")).toBeInTheDocument();
    });
  });

  // ── Invariant: KHÔNG dùng useCan/useCanExact('view-detail') làm cổng ──────

  it("does NOT gate fetch on useCan/useCanExact — server is the real gate", async () => {
    // Verify getRecord IS called (no local permission gate blocking the fetch).
    mockGetRecord.mockResolvedValue(DETAIL_RECORD);
    renderPage(buildQC());

    await waitFor(() => {
      expect(mockGetRecord).toHaveBeenCalledWith("rec-1");
    });
  });
});
