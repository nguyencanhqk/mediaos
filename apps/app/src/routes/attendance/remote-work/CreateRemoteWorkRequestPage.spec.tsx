import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, attendanceApi } from "@mediaos/web-core";
import type { RemoteWorkRequestDetail } from "@mediaos/contracts";
import { CreateRemoteWorkRequestPage } from "./CreateRemoteWorkRequestPage";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    attendanceApi: { createRemoteWorkRequest: vi.fn() },
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

const CREATED: RemoteWorkRequestDetail = {
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
};

describe("CreateRemoteWorkRequestPage (gate = create-own:remote-request)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(attendanceApi.createRemoteWorkRequest).mockResolvedValue(CREATED);
  });

  it("shows forbidden without create-own:remote-request", () => {
    setCaps({ "view-own:remote-request": true });
    renderWithQuery(<CreateRemoteWorkRequestPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
  });

  it("submits create → Draft and navigates to detail", async () => {
    setCaps({ "create-own:remote-request": true });
    renderWithQuery(<CreateRemoteWorkRequestPage />);

    fireEvent.change(screen.getByLabelText(/lý do/i), {
      target: { value: "Làm việc tại nhà tuần này" },
    });
    fireEvent.change(screen.getByLabelText(/ngày bắt đầu/i), { target: { value: "2026-07-10" } });
    fireEvent.change(screen.getByLabelText(/ngày kết thúc/i), { target: { value: "2026-07-10" } });

    fireEvent.click(screen.getByTestId("remote-work-create-submit"));

    await waitFor(() => expect(attendanceApi.createRemoteWorkRequest).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/attendance/remote-work-requests/rwr-1" }),
    );
  });
});
