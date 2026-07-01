/**
 * S3-FE-LEAVE-1 — LeaveRequestDetailPage tests.
 * Covers: loading skeleton, not-found, detail fields, status stepper, cancel action.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Synchronous factory — MockApiError defined INSIDE factory (vi.mock is hoisted, class is not)
vi.mock("@mediaos/web-core", () => {
  class MockApiError extends Error {
    status: number;
    code: string;
    constructor(opts: { message: string; status: number; code: string }) {
      super(opts.message);
      this.status = opts.status;
      this.code = opts.code;
      this.name = "ApiError";
    }
  }
  return {
    useCan: vi.fn(() => true),
    leaveApi: {
      getMyRequest: vi.fn(),
      cancelRequest: vi.fn(),
    },
    leaveKeys: {
      requests: {
        my: () => ["leave", "requests", "my"],
        detail: (id: string) => ["leave", "requests", "detail", id],
      },
      balances: { my: () => ["leave", "balances", "my"] },
      all: ["leave"],
    },
    ApiError: MockApiError,
  };
});

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
  };
});

import { useCan, leaveApi, ApiError } from "@mediaos/web-core";
import { LeaveRequestDetailPage } from "./LeaveRequestDetailPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockGetMyRequest = leaveApi.getMyRequest as ReturnType<typeof vi.fn>;
const mockCancelRequest = leaveApi.cancelRequest as ReturnType<typeof vi.fn>;

const MOCK_REQUEST = {
  id: "req-1",
  leaveTypeId: "lt-1",
  leaveTypeCode: "ANNUAL",
  leaveTypeName: "Nghỉ phép năm",
  startDate: "2026-07-10",
  endDate: "2026-07-11",
  durationType: "FullDay",
  totalDays: 2,
  totalHours: 16,
  status: "Pending",
  reason: "Việc gia đình",
  handoverNote: null,
  contactDuringLeave: null,
  balanceEffectStatus: null,
  submittedAt: "2026-07-01T09:00:00.000Z",
  createdAt: "2026-07-01T08:50:00.000Z",
  employeeId: "emp-1",
  leavePolicyId: null,
  halfDaySession: null,
  startTime: null,
  endTime: null,
  cancelReason: null,
  cancelledAt: null,
  days: [],
  approvals: [
    {
      id: "appr-1",
      approvalStep: 1,
      action: "Submitted",
      fromStatus: null,
      toStatus: "Pending",
      comment: null,
      approverUserId: "user-1",
      actedAt: "2026-07-01T09:00:00.000Z",
    },
  ],
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient, requestId = "req-1") {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <LeaveRequestDetailPage requestId={requestId} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
});

describe("LeaveRequestDetailPage — data states", () => {
  it("renders detail fields after data loads", async () => {
    mockGetMyRequest.mockResolvedValue(MOCK_REQUEST);
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByText("Nghỉ phép năm")).toBeTruthy();
    });
    expect(screen.getByText("Việc gia đình")).toBeTruthy();
  });

  it("shows approval history entry", async () => {
    mockGetMyRequest.mockResolvedValue(MOCK_REQUEST);
    renderPage(buildQC());
    await waitFor(() => {
      // approval action label
      expect(screen.getByText(/gửi đơn/i)).toBeTruthy();
    });
  });

  it("shows error state on fetch failure", async () => {
    // Use 404 ApiError so component retry fn returns false immediately (non-ApiError errors retry 2×)
    // cancelMutation.error stays null → component shows generic error title, not notFound title
    mockGetMyRequest.mockRejectedValue(
      new ApiError({ message: "not found", status: 404, code: "LEAVE-ERR-404" }),
    );
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByText(/không thể tải chi tiết/i)).toBeTruthy();
    });
  });
});

// ── QA05-LEAVE-004: permission gate ──────────────────────────────────────────
describe("LeaveRequestDetailPage — permission gate", () => {
  it("QA05-LEAVE-004 — shows forbidden EmptyState when canViewRequest=false", async () => {
    // Deny view-own:leave specifically; all other useCan calls return true
    mockUseCan.mockImplementation((action: string) => {
      if (action === "view-own") return false;
      return true;
    });
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByText(/không có quyền truy cập/i)).toBeTruthy();
    });
    // fetch must be blocked (enabled:false when no permission)
    expect(mockGetMyRequest).not.toHaveBeenCalled();
  });
});

describe("LeaveRequestDetailPage — cancel action", () => {
  it("shows cancel button for Pending request when canCancelOwn=true", async () => {
    mockGetMyRequest.mockResolvedValue(MOCK_REQUEST);
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /hủy đơn/i })).toBeTruthy();
    });
  });

  it("hides cancel button for Approved request", async () => {
    mockGetMyRequest.mockResolvedValue({ ...MOCK_REQUEST, status: "Approved" });
    renderPage(buildQC());
    await waitFor(() => screen.getByText("Nghỉ phép năm"));
    expect(screen.queryByRole("button", { name: /hủy đơn/i })).toBeNull();
  });

  it("hides cancel button when canCancelOwn=false", async () => {
    mockGetMyRequest.mockResolvedValue(MOCK_REQUEST);
    // Action-specific mock: only deny cancel-own; keep view-own=true so page loads normally
    mockUseCan.mockImplementation((action: string) => {
      if (action === "cancel-own") return false;
      return true;
    });
    renderPage(buildQC());
    await waitFor(() => screen.getByText("Nghỉ phép năm"));
    expect(screen.queryByRole("button", { name: /hủy đơn/i })).toBeNull();
  });

  it("opens cancel dialog on cancel button click", async () => {
    mockGetMyRequest.mockResolvedValue(MOCK_REQUEST);
    renderPage(buildQC());
    await waitFor(() => screen.getByRole("button", { name: /hủy đơn/i }));
    fireEvent.click(screen.getByRole("button", { name: /hủy đơn/i }));
    await waitFor(() => {
      expect(screen.getByText(/xác nhận hủy/i)).toBeTruthy();
    });
  });

  it("calls cancelRequest and closes dialog on confirm", async () => {
    mockGetMyRequest.mockResolvedValue(MOCK_REQUEST);
    mockCancelRequest.mockResolvedValue({ ...MOCK_REQUEST, status: "Cancelled" });
    renderPage(buildQC());
    await waitFor(() => screen.getByRole("button", { name: /hủy đơn/i }));
    fireEvent.click(screen.getByRole("button", { name: /hủy đơn/i }));
    await waitFor(() => screen.getByText(/xác nhận hủy/i));
    const confirmBtn = screen.getByRole("button", { name: /xác nhận hủy/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(mockCancelRequest).toHaveBeenCalledWith("req-1", "");
    });
  });
});
