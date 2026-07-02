import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, attendanceApi } from "@mediaos/web-core";
import type { RemoteWorkRequestDetail } from "@mediaos/contracts";
import { RemoteWorkRequestDetailPage } from "./RemoteWorkRequestDetailPage";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    attendanceApi: {
      getRemoteWorkRequest: vi.fn(),
      approveRemoteWorkRequest: vi.fn(),
      rejectRemoteWorkRequest: vi.fn(),
      cancelOwnRemoteWorkRequest: vi.fn(),
      submitRemoteWorkRequest: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(userId: string, caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: userId, email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

function makeDetail(overrides: Partial<RemoteWorkRequestDetail>): RemoteWorkRequestDetail {
  return {
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
    ...overrides,
  };
}

describe("RemoteWorkRequestDetailPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
  });

  it("shows forbidden without any view permission", () => {
    setCaps("u1", { "read:employee": true });
    renderWithQuery(<RemoteWorkRequestDetailPage requestId="rwr-1" />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(attendanceApi.getRemoteWorkRequest).not.toHaveBeenCalled();
  });

  it("renders detail + submit button for the owner's Draft request", async () => {
    setCaps("u1", { "view-own:remote-request": true, "create-own:remote-request": true });
    vi.mocked(attendanceApi.getRemoteWorkRequest).mockResolvedValue(
      makeDetail({ status: "Draft", requestedBy: "u1" }),
    );
    renderWithQuery(<RemoteWorkRequestDetailPage requestId="rwr-1" />);
    await waitFor(() => expect(screen.getByText("RWR-001")).toBeInTheDocument());
    expect(screen.getByTestId("remote-work-submit-btn")).toBeInTheDocument();
  });

  it("shows approve/reject for a Pending request when caller is NOT the owner", async () => {
    setCaps("manager-1", {
      "view-team:remote-request": true,
      "approve:remote-request": true,
      "reject:remote-request": true,
    });
    vi.mocked(attendanceApi.getRemoteWorkRequest).mockResolvedValue(
      makeDetail({ status: "Pending", requestedBy: "u1" }),
    );
    renderWithQuery(<RemoteWorkRequestDetailPage requestId="rwr-1" />);
    await waitFor(() => expect(screen.getByText("RWR-001")).toBeInTheDocument());
    expect(screen.getByText(/^duyệt$/i)).toBeInTheDocument();
    expect(screen.getByText(/từ chối/i)).toBeInTheDocument();
  });

  it("hides decide actions when the caller IS the owner (no self-approval)", async () => {
    setCaps("u1", {
      "view-own:remote-request": true,
      "approve:remote-request": true,
      "reject:remote-request": true,
    });
    vi.mocked(attendanceApi.getRemoteWorkRequest).mockResolvedValue(
      makeDetail({ status: "Pending", requestedBy: "u1" }),
    );
    renderWithQuery(<RemoteWorkRequestDetailPage requestId="rwr-1" />);
    await waitFor(() => expect(screen.getByText("RWR-001")).toBeInTheDocument());
    expect(screen.queryByText(/^duyệt$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/từ chối/i)).not.toBeInTheDocument();
  });
});
