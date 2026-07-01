// @vitest-environment jsdom
/**
 * [deny-path] TeamAttendanceRecordsPage — gate useCanExact('view-team','attendance').
 *
 * Crown deny-path:
 * - employee (useCanExact view-team=false) → forbidden EmptyState + listTeamRecords NOT called.
 * - manager (view-team=true) → DataTable renders items.
 *
 * Pattern theo registry-guard.spec.tsx (deny-path matrix) + AttendanceTodayPage.spec.tsx.
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
    listTeamRecords: vi.fn(),
  },
  attendanceKeys: {
    teamRecords: (p?: unknown) => ["attendance", "team", "records", p],
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
    EmptyState: ({ title, description }: { title: string; description?: string }) => (
      <div data-testid="empty-state">
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
import { TeamAttendanceRecordsPage } from "./TeamAttendanceRecordsPage";

const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockListTeamRecords = attendanceApi.listTeamRecords as ReturnType<typeof vi.fn>;

const TEAM_RECORDS_RESPONSE = {
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
        <TeamAttendanceRecordsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TeamAttendanceRecordsPage", () => {
  // ── CROWN deny-path: employee (no view-team) ───────────────────────────────

  it("[crown deny] employee (useCanExact view-team=false) → forbidden EmptyState + listTeamRecords NOT called", () => {
    mockUseCanExact.mockReturnValue(false);
    renderPage(buildQC());

    // Should show forbidden empty state
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    // API must NOT be called when access is denied
    expect(mockListTeamRecords).not.toHaveBeenCalled();
  });

  it("[crown deny] DataTable is NOT rendered when forbidden", () => {
    mockUseCanExact.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.queryByTestId("data-table")).not.toBeInTheDocument();
  });

  // ── Manager (has view-team) → renders data ─────────────────────────────────

  it("manager (useCanExact view-team=true) → calls listTeamRecords and renders rows", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockListTeamRecords.mockResolvedValue(TEAM_RECORDS_RESPONSE);

    renderPage(buildQC());

    // Wait for data to resolve and rows to appear (data-table renders immediately
    // but with empty items until query resolves; wait for the row itself).
    await waitFor(() => {
      expect(screen.getAllByTestId("table-row")).toHaveLength(1);
    });

    expect(mockListTeamRecords).toHaveBeenCalled();
    expect(screen.getByTestId("data-table")).toBeInTheDocument();
  });

  // ── Error state ────────────────────────────────────────────────────────────

  it("shows error EmptyState when API fails (and canView=true)", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockListTeamRecords.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });

  // ── useCanExact vs useCan: wildcard *:* does NOT grant view-team ───────────

  it("caps with only *:* should still get false from useCanExact mock (mock returns false)", () => {
    // This test verifies the mock correctly simulates fail-closed behaviour.
    // The actual useCanExact unit tests (use-can-exact.spec.ts) prove the hook is fail-closed.
    mockUseCanExact.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(mockListTeamRecords).not.toHaveBeenCalled();
  });
});
