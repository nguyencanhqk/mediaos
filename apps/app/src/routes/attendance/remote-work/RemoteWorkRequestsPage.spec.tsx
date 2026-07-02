import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, attendanceApi } from "@mediaos/web-core";
import type { RemoteWorkRequestListResponse } from "@mediaos/contracts";
import { RemoteWorkRequestsPage } from "./RemoteWorkRequestsPage";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    attendanceApi: {
      listMyRemoteWorkRequests: vi.fn(),
      listTeamRemoteWorkRequests: vi.fn(),
      listCompanyRemoteWorkRequests: vi.fn(),
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

const LIST_RESPONSE: RemoteWorkRequestListResponse = {
  items: [
    {
      id: "rwr-1",
      requestCode: "RWR-001",
      employeeId: "emp-1",
      employeeCode: "NV001",
      fullName: "Nguyễn Văn A",
      requestType: "Remote",
      startDate: "2026-07-10",
      endDate: "2026-07-10",
      startTime: null,
      endTime: null,
      attendanceMode: "SELF_CHECK_IN",
      locationText: null,
      reason: "Làm việc tại nhà",
      taskId: null,
      projectId: null,
      status: "Draft",
      submittedAt: null,
      requestedBy: "u1",
      currentApproverUserId: null,
      watcherUserIds: [],
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      cancelledAt: null,
      cancelledBy: null,
      attachmentFileId: null,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    },
  ],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

describe("RemoteWorkRequestsPage (gate = create-own/view-own/team/company:remote-request)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(attendanceApi.listMyRemoteWorkRequests).mockResolvedValue(LIST_RESPONSE);
    vi.mocked(attendanceApi.listTeamRemoteWorkRequests).mockResolvedValue(LIST_RESPONSE);
    vi.mocked(attendanceApi.listCompanyRemoteWorkRequests).mockResolvedValue(LIST_RESPONSE);
  });

  it("shows forbidden without any remote-request permission", () => {
    setCaps({ "read:employee": true });
    renderWithQuery(<RemoteWorkRequestsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(attendanceApi.listMyRemoteWorkRequests).not.toHaveBeenCalled();
  });

  it("renders 'my' scope list with view-own:remote-request", async () => {
    setCaps({ "view-own:remote-request": true });
    renderWithQuery(<RemoteWorkRequestsPage />);
    await waitFor(() => expect(screen.getByText("RWR-001")).toBeInTheDocument());
    expect(attendanceApi.listMyRemoteWorkRequests).toHaveBeenCalled();
  });

  it("shows create button only with create-own:remote-request", async () => {
    setCaps({ "view-own:remote-request": true, "create-own:remote-request": true });
    renderWithQuery(<RemoteWorkRequestsPage />);
    await waitFor(() => expect(screen.getByText("RWR-001")).toBeInTheDocument());
    expect(screen.getByTestId("remote-work-create-btn")).toBeInTheDocument();
  });

  it("defaults to company scope when caller holds view-company:remote-request", async () => {
    setCaps({ "view-company:remote-request": true });
    renderWithQuery(<RemoteWorkRequestsPage />);
    await waitFor(() => expect(attendanceApi.listCompanyRemoteWorkRequests).toHaveBeenCalled());
    expect(attendanceApi.listMyRemoteWorkRequests).not.toHaveBeenCalled();
  });
});
