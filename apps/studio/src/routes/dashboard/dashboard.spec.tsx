import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DashboardSummaryDto } from "@mediaos/contracts";
import { DashboardPage } from "./dashboard";

// ─── Mock dashboard-api ───────────────────────────────────────────────────────
vi.mock("@/lib/dashboard-api", () => ({
  getDashboardSummary: vi.fn(),
}));

import { getDashboardSummary } from "@/lib/dashboard-api";
const mockGetSummary = vi.mocked(getDashboardSummary);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

const EMPTY_SUMMARY: DashboardSummaryDto = {
  tasks: {
    total: 0,
    notStarted: 0,
    inProgress: 0,
    waitingReview: 0,
    completed: 0,
    overdue: 0,
  },
  attendance: {
    todayPresent: null,
    todayAbsent: null,
    todayLate: null,
    monthAttendanceDays: null,
    monthAbsentDays: null,
    monthLateDays: null,
  },
  leave: {
    pendingRequests: null,
    approvedThisMonth: null,
    myAnnualBalanceDays: null,
  },
  asOf: new Date().toISOString(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DashboardPage — render by role/mask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state initially", () => {
    // Never resolves — simulates loading
    mockGetSummary.mockReturnValue(new Promise(() => {}));
    renderPage(makeClient());
    expect(screen.getByText("Đang tải dữ liệu…")).toBeTruthy();
  });

  it("renders error message when API fails (DENY path — 403)", async () => {
    mockGetSummary.mockRejectedValue(new Error("403 Forbidden"));
    renderPage(makeClient());
    const msg = await screen.findByText(/Không tải được dữ liệu/);
    expect(msg).toBeTruthy();
  });

  it("renders task cards for employee with no attendance data (server masked)", async () => {
    // Employee: tasks visible, attendance/leave masked (null)
    mockGetSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      tasks: {
        ...EMPTY_SUMMARY.tasks,
        total: 5,
        inProgress: 2,
        overdue: 1,
      },
    });
    renderPage(makeClient());

    expect(await screen.findByText("Tổng task")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy(); // overdue

    // Attendance section should NOT be rendered (todayPresent === null)
    expect(screen.queryByText("Chấm công hôm nay")).toBeNull();
    // Leave section should NOT be rendered (pendingRequests === null)
    expect(screen.queryByText("Nghỉ phép")).toBeNull();
  });

  it("renders attendance + leave sections for HR/manager (server returns full data)", async () => {
    mockGetSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      attendance: {
        todayPresent: 18,
        todayAbsent: 2,
        todayLate: 3,
        monthAttendanceDays: 20,
        monthAbsentDays: 1,
        monthLateDays: 4,
      },
      leave: {
        pendingRequests: 5,
        approvedThisMonth: 3,
        myAnnualBalanceDays: null,
      },
    });
    renderPage(makeClient());

    expect(await screen.findByText("Chấm công hôm nay")).toBeTruthy();
    expect(screen.getByText("18")).toBeTruthy(); // todayPresent
    expect(screen.getByText("Nghỉ phép")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy(); // pendingRequests
  });

  it("renders task status chart when byStatus is present (manager/leadership)", async () => {
    mockGetSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      tasks: {
        ...EMPTY_SUMMARY.tasks,
        total: 10,
        inProgress: 4,
        byStatus: [
          { status: "in_progress", count: 4 },
          { status: "completed", count: 6 },
        ],
      },
    });
    renderPage(makeClient());

    expect(await screen.findByText("Phân bổ task theo trạng thái")).toBeTruthy();
  });

  it("does NOT render task status chart when byStatus is absent (employee scope)", async () => {
    mockGetSummary.mockResolvedValue(EMPTY_SUMMARY);
    renderPage(makeClient());

    await screen.findByText("Tổng task"); // wait for data to load
    expect(screen.queryByText("Phân bổ task theo trạng thái")).toBeNull();
  });
});
