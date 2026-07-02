// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, hrApi, ApiError } from "@mediaos/web-core";
import type { ProfileChangeRequestDetail } from "@mediaos/contracts";
import { ProfileChangeRequestDetailPage } from "./ProfileChangeRequestDetailPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      getProfileChangeRequestDetail: vi.fn(),
      cancelProfileChangeRequest: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "e@demo.local", fullName: "E", status: "Active", companyId: "co-1" },
  });
}

const DETAIL: ProfileChangeRequestDetail = {
  id: "pcr-1",
  employeeId: "emp-1",
  employeeCode: "EMP0001",
  employeeFullName: "Nguyễn Văn A",
  requestedBy: "u1",
  status: "Pending",
  changedFields: ["phone"],
  oldValues: { phone: "0900000000" },
  newValues: { phone: "0911111111" },
  reason: "Đổi SĐT",
  rejectionReason: null,
  reviewedBy: null,
  reviewedByName: null,
  reviewedAt: null,
  submittedAt: "2026-07-01T00:00:00.000Z",
  cancelledAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("ProfileChangeRequestDetailPage", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    vi.clearAllMocks();
  });

  it("shows loading state", () => {
    setCapabilities({ "create:profile-change-request": true });
    vi.mocked(hrApi.getProfileChangeRequestDetail).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<ProfileChangeRequestDetailPage requestId="pcr-1" />);
    expect(screen.getByText(/đang tải/i)).toBeInTheDocument();
  });

  // ── Own-scope 404 (e.g. HR opening a colleague's request id) → graceful EmptyState ──
  it("shows a not-found state (not a raw error) on 404 — own-scope endpoint", async () => {
    setCapabilities({ "create:profile-change-request": true });
    vi.mocked(hrApi.getProfileChangeRequestDetail).mockRejectedValue(
      new ApiError(404, "NOT_FOUND", "not found"),
    );
    renderWithQuery(<ProfileChangeRequestDetailPage requestId="pcr-other" />);
    await waitFor(() => expect(screen.getByText(/không tìm thấy yêu cầu/i)).toBeInTheDocument());
  });

  it("shows generic error state on a non-404 failure", async () => {
    setCapabilities({ "create:profile-change-request": true });
    // status 403 → component retry fn returns false → no retries → isError immediately
    vi.mocked(hrApi.getProfileChangeRequestDetail).mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "forbidden"),
    );
    renderWithQuery(<ProfileChangeRequestDetailPage requestId="pcr-1" />);
    await waitFor(() => expect(screen.getByText(/không thể tải yêu cầu/i)).toBeInTheDocument());
  });

  it("renders the old/new diff and status on success", async () => {
    setCapabilities({ "create:profile-change-request": true });
    vi.mocked(hrApi.getProfileChangeRequestDetail).mockResolvedValue(DETAIL);
    renderWithQuery(<ProfileChangeRequestDetailPage requestId="pcr-1" />);
    await waitFor(() => expect(screen.getByText("0900000000")).toBeInTheDocument());
    expect(screen.getByText("0911111111")).toBeInTheDocument();
    expect(screen.getByText(/chờ duyệt/i)).toBeInTheDocument();
  });

  // ── DENY-PATH: cancel button hidden without create:profile-change-request ──
  it("hides the cancel button when the user lacks create:profile-change-request", async () => {
    setCapabilities({});
    vi.mocked(hrApi.getProfileChangeRequestDetail).mockResolvedValue(DETAIL);
    renderWithQuery(<ProfileChangeRequestDetailPage requestId="pcr-1" />);
    await waitFor(() => expect(screen.getByText("0900000000")).toBeInTheDocument());
    expect(screen.queryByText(/hủy yêu cầu/i)).not.toBeInTheDocument();
  });

  // ── Cancel button hidden when request is no longer Pending ──────────────────
  it("hides the cancel button when the request is not Pending", async () => {
    setCapabilities({ "create:profile-change-request": true });
    vi.mocked(hrApi.getProfileChangeRequestDetail).mockResolvedValue({
      ...DETAIL,
      status: "Approved",
    });
    renderWithQuery(<ProfileChangeRequestDetailPage requestId="pcr-1" />);
    await waitFor(() => expect(screen.getByText("0900000000")).toBeInTheDocument());
    expect(screen.queryByText(/hủy yêu cầu/i)).not.toBeInTheDocument();
  });

  it("cancels the request via the confirm dialog", async () => {
    setCapabilities({ "create:profile-change-request": true });
    vi.mocked(hrApi.getProfileChangeRequestDetail).mockResolvedValue(DETAIL);
    vi.mocked(hrApi.cancelProfileChangeRequest).mockResolvedValue({
      id: "pcr-1",
      status: "Cancelled",
    });

    renderWithQuery(<ProfileChangeRequestDetailPage requestId="pcr-1" />);
    await waitFor(() => expect(screen.getByText(/^hủy yêu cầu$/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/^hủy yêu cầu$/i));
    fireEvent.click(await screen.findByRole("button", { name: /^xác nhận hủy$/i }));

    await waitFor(() => expect(hrApi.cancelProfileChangeRequest).toHaveBeenCalledWith("pcr-1"));
  });
});
