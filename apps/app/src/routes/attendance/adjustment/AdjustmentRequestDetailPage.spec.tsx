// @vitest-environment jsdom
/**
 * AdjustmentRequestDetailPage tests (S3-FE-ATT-3).
 * Phủ: loading · 403 forbidden · 404 notFound · error chung · happy-path Pending hiện nút Duyệt/Từ chối ·
 * Approved KHÔNG hiện nút · duyệt thành công (approveAdjustmentRequest được gọi) · từ chối rỗng bị chặn
 * (KHÔNG gọi API) · từ chối có lý do gọi rejectAdjustmentRequest · lỗi 403 khi duyệt → thông điệp inline.
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

vi.mock("@mediaos/web-core", () => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number, message = "") {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError: MockApiError,
    formatDateTime: (v: string) => v,
    attendanceApi: {
      getAdjustmentRequest: vi.fn(),
      approveAdjustmentRequest: vi.fn(),
      rejectAdjustmentRequest: vi.fn(),
    },
    attendanceKeys: {
      adjustments: {
        all: ["attendance", "adjustments"],
        detail: (id: string) => ["attendance", "adjustments", "detail", id],
      },
      records: { all: ["attendance", "records"] },
    },
    attendanceInvalidation: {
      approveAdjustment: (id: string) => [
        ["attendance", "adjustments"],
        ["attendance", "adjustments", "detail", id],
        ["attendance", "records"],
      ],
      rejectAdjustment: (id: string) => [
        ["attendance", "adjustments"],
        ["attendance", "adjustments", "detail", id],
      ],
    },
  };
});

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {actions}
      </div>
    ),
  };
});

import { attendanceApi, ApiError } from "@mediaos/web-core";
import { AdjustmentRequestDetailPage } from "./AdjustmentRequestDetailPage";

const mockGetDetail = attendanceApi.getAdjustmentRequest as ReturnType<typeof vi.fn>;
const mockApprove = attendanceApi.approveAdjustmentRequest as ReturnType<typeof vi.fn>;
const mockReject = attendanceApi.rejectAdjustmentRequest as ReturnType<typeof vi.fn>;

const DETAIL_PENDING = {
  id: "adj-1",
  requestCode: "ADJ-0001",
  employeeId: "emp-1",
  employeeCode: "EMP001",
  fullName: "Nguyen Van A",
  attendanceRecordId: null,
  workDate: "2026-07-01",
  requestType: "OTHER",
  requestedCheckInAt: null,
  requestedCheckOutAt: null,
  reason: "Quên chấm công",
  status: "Pending",
  submittedAt: "2026-07-01T02:00:00.000Z",
  requestedBy: "u-1",
  currentApproverUserId: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  attachmentFileId: null,
  items: [],
  createdAt: "2026-07-01T02:00:00.000Z",
  updatedAt: "2026-07-01T02:00:00.000Z",
};

const DETAIL_APPROVED = { ...DETAIL_PENDING, status: "Approved" };

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={buildQC()}>
      <I18nextProvider i18n={i18n}>
        <AdjustmentRequestDetailPage requestId="adj-1" />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdjustmentRequestDetailPage — states", () => {
  it("loading → detail-loading", () => {
    mockGetDetail.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId("detail-loading")).toBeInTheDocument();
  });

  it("403 → forbidden", async () => {
    mockGetDetail.mockRejectedValue(new ApiError(403, "ERR", "forbidden"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("detail-forbidden")).toBeInTheDocument();
    });
  });

  it("404 → notFound", async () => {
    mockGetDetail.mockRejectedValue(new ApiError(404, "ERR", "not found"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không tìm thấy/i)).toBeInTheDocument();
    });
  });

  it("500 → error chung", async () => {
    mockGetDetail.mockRejectedValue(new ApiError(500, "ERR", "boom"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("detail-error")).toBeInTheDocument();
    });
  });
});

describe("AdjustmentRequestDetailPage — Pending hiện Duyệt/Từ chối", () => {
  it("Pending → hiện nút Duyệt + Từ chối; Approved → ẨN", async () => {
    mockGetDetail.mockResolvedValue(DETAIL_PENDING);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("btn-open-approve")).toBeInTheDocument();
    });
    expect(screen.getByTestId("btn-open-reject")).toBeInTheDocument();
  });

  it("Approved → KHÔNG hiện nút Duyệt/Từ chối", async () => {
    mockGetDetail.mockResolvedValue(DETAIL_APPROVED);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/chi tiết đơn điều chỉnh/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("btn-open-approve")).not.toBeInTheDocument();
  });
});

describe("AdjustmentRequestDetailPage — duyệt/từ chối", () => {
  it("duyệt (approve) → gọi approveAdjustmentRequest", async () => {
    mockGetDetail.mockResolvedValue(DETAIL_PENDING);
    mockApprove.mockResolvedValue({ ...DETAIL_APPROVED });
    renderPage();

    await waitFor(() => screen.getByTestId("btn-open-approve"));
    fireEvent.click(screen.getByTestId("btn-open-approve"));
    await waitFor(() => screen.getByTestId("btn-confirm-approve"));
    fireEvent.click(screen.getByTestId("btn-confirm-approve"));

    await waitFor(() => {
      expect(mockApprove).toHaveBeenCalledWith("adj-1", expect.any(Object));
    });
  });

  it("từ chối rỗng → KHÔNG gọi rejectAdjustmentRequest, hiện lỗi bắt buộc", async () => {
    mockGetDetail.mockResolvedValue(DETAIL_PENDING);
    renderPage();

    await waitFor(() => screen.getByTestId("btn-open-reject"));
    fireEvent.click(screen.getByTestId("btn-open-reject"));
    await waitFor(() => screen.getByTestId("btn-confirm-reject"));
    fireEvent.click(screen.getByTestId("btn-confirm-reject"));

    expect(screen.getByText(/lý do từ chối là bắt buộc/i)).toBeInTheDocument();
    expect(mockReject).not.toHaveBeenCalled();
  });

  it("từ chối có lý do → gọi rejectAdjustmentRequest với reason", async () => {
    mockGetDetail.mockResolvedValue(DETAIL_PENDING);
    mockReject.mockResolvedValue({ ...DETAIL_PENDING, status: "Rejected" });
    renderPage();

    await waitFor(() => screen.getByTestId("btn-open-reject"));
    fireEvent.click(screen.getByTestId("btn-open-reject"));
    await waitFor(() => screen.getByTestId("btn-confirm-reject"));

    const textarea = screen.getByPlaceholderText(/nhập lý do từ chối/i);
    fireEvent.change(textarea, { target: { value: "Thiếu chứng từ" } });
    fireEvent.click(screen.getByTestId("btn-confirm-reject"));

    await waitFor(() => {
      expect(mockReject).toHaveBeenCalledWith("adj-1", { reason: "Thiếu chứng từ" });
    });
  });

  it("duyệt 403 → thông điệp lỗi inline", async () => {
    mockGetDetail.mockResolvedValue(DETAIL_PENDING);
    mockApprove.mockRejectedValue(new ApiError(403, "ERR", "forbidden"));
    renderPage();

    await waitFor(() => screen.getByTestId("btn-open-approve"));
    fireEvent.click(screen.getByTestId("btn-open-approve"));
    await waitFor(() => screen.getByTestId("btn-confirm-approve"));
    fireEvent.click(screen.getByTestId("btn-confirm-approve"));

    await waitFor(() => {
      expect(screen.getByText(/bạn không có quyền duyệt đơn này/i)).toBeInTheDocument();
    });
  });
});
