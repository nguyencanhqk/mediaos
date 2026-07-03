import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, leaveApi } from "@mediaos/web-core";
import type { LeaveReportResponse } from "@mediaos/contracts";
import { LeaveReportsPage } from "./LeaveReportsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    leaveApi: { getLeaveReport: vi.fn() },
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

const RESPONSE: LeaveReportResponse = {
  fromDate: "2026-07-01",
  toDate: "2026-07-31",
  items: [
    {
      employeeId: "emp-1",
      userId: "u-1",
      employeeCode: "NV001",
      fullName: "Nguyễn Văn A",
      orgUnitId: null,
      orgUnitName: "Phòng IT",
      totalRequests: 3,
      totalLeaveDays: 5.5,
    },
  ],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

describe("LeaveReportsPage (gate = export:leave)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(leaveApi.getLeaveReport).mockResolvedValue(RESPONSE);
  });

  it("shows forbidden and does NOT fetch without export:leave (view:leave insufficient)", () => {
    // view:leave (đọc chéo) KHÔNG kế thừa export:leave — pair-as-gate.
    setCaps({ "view:leave": true });
    renderWithQuery(<LeaveReportsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(leaveApi.getLeaveReport).not.toHaveBeenCalled();
  });

  it("renders leave aggregate report when caller holds export:leave", async () => {
    setCaps({ "export:leave": true });
    renderWithQuery(<LeaveReportsPage />);
    await waitFor(() => expect(screen.getByText("NV001")).toBeInTheDocument());
    expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument();
    expect(leaveApi.getLeaveReport).toHaveBeenCalled();
  });
});
