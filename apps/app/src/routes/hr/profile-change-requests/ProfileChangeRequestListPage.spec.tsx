// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, hrApi } from "@mediaos/web-core";
import type { ProfileChangeRequestListResponse } from "@mediaos/contracts";
import { ProfileChangeRequestListPage } from "./ProfileChangeRequestListPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      listProfileChangeRequests: vi.fn(),
      approveProfileChangeRequest: vi.fn(),
      rejectProfileChangeRequest: vi.fn(),
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
    user: {
      id: "hr1",
      email: "hr@demo.local",
      fullName: "HR",
      status: "Active",
      companyId: "co-1",
    },
  });
}

const LIST: ProfileChangeRequestListResponse = {
  items: [
    {
      id: "pcr-1",
      employeeId: "emp-1",
      employeeCode: "EMP0001",
      employeeFullName: "Nguyễn Văn A",
      status: "Pending",
      changedFields: ["phone"],
      reason: "Đổi SĐT",
      submittedAt: "2026-07-01T00:00:00.000Z",
      reviewedAt: null,
      reviewedByName: null,
      createdAt: "2026-07-01T00:00:00.000Z",
    },
  ],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

describe("ProfileChangeRequestListPage", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no approve:profile-change-request → forbidden, no API call ──
  it("renders forbidden state when user lacks approve:profile-change-request", () => {
    setCapabilities({});
    renderWithQuery(<ProfileChangeRequestListPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(hrApi.listProfileChangeRequests).not.toHaveBeenCalled();
  });

  it("shows loading state (table renders while fetching)", () => {
    setCapabilities({ "approve:profile-change-request": true });
    vi.mocked(hrApi.listProfileChangeRequests).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<ProfileChangeRequestListPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  it("shows error state when the list call fails", async () => {
    setCapabilities({ "approve:profile-change-request": true });
    vi.mocked(hrApi.listProfileChangeRequests).mockRejectedValue(new Error("boom"));
    renderWithQuery(<ProfileChangeRequestListPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeInTheDocument());
  });

  it("shows empty state when no requests match the filter", async () => {
    setCapabilities({ "approve:profile-change-request": true });
    vi.mocked(hrApi.listProfileChangeRequests).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    });
    renderWithQuery(<ProfileChangeRequestListPage />);
    await waitFor(() => expect(screen.getByText(/không có yêu cầu nào/i)).toBeInTheDocument());
  });

  it("renders list rows on success", async () => {
    setCapabilities({ "approve:profile-change-request": true });
    vi.mocked(hrApi.listProfileChangeRequests).mockResolvedValue(LIST);
    renderWithQuery(<ProfileChangeRequestListPage />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.getByText("EMP0001")).toBeInTheDocument();
  });

  // ── Approve happy path (dialog, no GET /:id — uses row data already fetched) ──
  it("approves a pending request from the row dialog", async () => {
    setCapabilities({ "approve:profile-change-request": true });
    vi.mocked(hrApi.listProfileChangeRequests).mockResolvedValue(LIST);
    vi.mocked(hrApi.approveProfileChangeRequest).mockResolvedValue({
      id: "pcr-1",
      status: "Approved",
    });

    renderWithQuery(<ProfileChangeRequestListPage />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());

    fireEvent.click(screen.getByText(/^xem$/i));
    fireEvent.click(await screen.findByRole("button", { name: /^duyệt$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /xác nhận duyệt/i }));

    await waitFor(() => expect(hrApi.approveProfileChangeRequest).toHaveBeenCalledWith("pcr-1"));
  });

  // ── Reject requires a reason (blocked client-side without one) ──────────────
  it("blocks reject submit without a reason, then submits once filled", async () => {
    setCapabilities({ "approve:profile-change-request": true });
    vi.mocked(hrApi.listProfileChangeRequests).mockResolvedValue(LIST);
    vi.mocked(hrApi.rejectProfileChangeRequest).mockResolvedValue({
      id: "pcr-1",
      status: "Rejected",
    });

    renderWithQuery(<ProfileChangeRequestListPage />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());

    fireEvent.click(screen.getByText(/^xem$/i));
    fireEvent.click(await screen.findByRole("button", { name: /^từ chối$/i }));

    fireEvent.click(screen.getByRole("button", { name: /xác nhận từ chối/i }));
    expect(hrApi.rejectProfileChangeRequest).not.toHaveBeenCalled();
    expect(screen.getByText(/vui lòng nhập lý do từ chối/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/nhập lý do từ chối/i), {
      target: { value: "Không đủ minh chứng" },
    });
    fireEvent.click(screen.getByRole("button", { name: /xác nhận từ chối/i }));

    await waitFor(() =>
      expect(hrApi.rejectProfileChangeRequest).toHaveBeenCalledWith("pcr-1", "Không đủ minh chứng"),
    );
  });
});
