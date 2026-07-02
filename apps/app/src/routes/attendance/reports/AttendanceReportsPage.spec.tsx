import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, attendanceApi } from "@mediaos/web-core";
import type { AttendanceReportResponse } from "@mediaos/contracts";
import { AttendanceReportsPage } from "./AttendanceReportsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    attendanceApi: {
      getTeamAttendanceReport: vi.fn(),
      getCompanyAttendanceReport: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const RESPONSE: AttendanceReportResponse = {
  fromDate: "2026-07-01",
  toDate: "2026-08-01",
  items: [
    {
      employeeId: "emp-1",
      userId: "u-1",
      employeeCode: "NV001",
      fullName: "Nguyễn Văn A",
      orgUnitId: null,
      orgUnitName: "Phòng IT",
      totalDays: 22,
      presentDays: 20,
      lateDays: 1,
      missingDays: 0,
      leaveDays: 1,
    },
  ],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

describe("AttendanceReportsPage (gate = view-team/view-company:attendance)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(attendanceApi.getTeamAttendanceReport).mockResolvedValue(RESPONSE);
    vi.mocked(attendanceApi.getCompanyAttendanceReport).mockResolvedValue(RESPONSE);
  });

  it("shows forbidden without view-team/view-company:attendance", () => {
    setCaps({ "view-own:attendance": true });
    renderWithQuery(<AttendanceReportsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(attendanceApi.getCompanyAttendanceReport).not.toHaveBeenCalled();
  });

  it("renders company report by default when caller holds view-company:attendance", async () => {
    setCaps({ "view-company:attendance": true });
    renderWithQuery(<AttendanceReportsPage />);
    await waitFor(() => expect(screen.getByText("NV001")).toBeInTheDocument());
    expect(attendanceApi.getCompanyAttendanceReport).toHaveBeenCalled();
    expect(attendanceApi.getTeamAttendanceReport).not.toHaveBeenCalled();
  });

  it("falls back to team report when only view-team:attendance is granted", async () => {
    setCaps({ "view-team:attendance": true });
    renderWithQuery(<AttendanceReportsPage />);
    await waitFor(() => expect(attendanceApi.getTeamAttendanceReport).toHaveBeenCalled());
    expect(attendanceApi.getCompanyAttendanceReport).not.toHaveBeenCalled();
  });
});
