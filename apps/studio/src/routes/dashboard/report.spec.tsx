import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReportResponseDto } from "@mediaos/contracts";
import { ReportPage } from "./report";

// ─── Mock dashboard-api ───────────────────────────────────────────────────────
vi.mock("@/lib/dashboard-api", () => ({
  getDashboardSummary: vi.fn(),
  getDashboardReport: vi.fn(),
}));

import { getDashboardReport } from "@/lib/dashboard-api";
const mockGetReport = vi.mocked(getDashboardReport);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ReportPage />
    </QueryClientProvider>,
  );
}

const FULL_REPORT: ReportResponseDto = {
  report: {
    revenueThisMonth: 500_000_000,
    costThisMonth: 200_000_000,
    profitThisMonth: 300_000_000,
    revenueByChannel: [
      { channelId: "ch-1", channelName: "Kênh A", amount: 300_000_000 },
      { channelId: "ch-2", channelName: "Kênh B", amount: 200_000_000 },
    ],
    totalEmployees: 150,
    todayAttendanceRate: 87.5,
  },
  period: "thisMonth",
  asOf: new Date().toISOString(),
};

const NO_PERMS_REPORT: ReportResponseDto = {
  report: {
    revenueThisMonth: null,
    costThisMonth: null,
    profitThisMonth: null,
    revenueByChannel: null,
    totalEmployees: null,
    todayAttendanceRate: null,
  },
  period: "thisMonth",
  asOf: new Date().toISOString(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReportPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows loading state while fetching", () => {
    mockGetReport.mockReturnValue(new Promise(() => {}));
    renderPage(makeClient());
    expect(screen.getByText("Đang tải dữ liệu…")).toBeInTheDocument();
  });

  it("shows error message on fetch failure", async () => {
    mockGetReport.mockRejectedValue(new Error("Network error"));
    renderPage(makeClient());
    expect(await screen.findByText(/Không tải được dữ liệu/)).toBeInTheDocument();
  });

  describe("FE renders only what server returns — masking is server-side", () => {
    it("renders no-permission message when all report fields are null (low-privilege role)", async () => {
      mockGetReport.mockResolvedValue(NO_PERMS_REPORT);
      renderPage(makeClient());
      expect(
        await screen.findByText("Bạn không có quyền xem báo cáo tổng hợp."),
      ).toBeInTheDocument();
    });

    it("does NOT render finance section when revenueThisMonth is null", async () => {
      mockGetReport.mockResolvedValue(NO_PERMS_REPORT);
      renderPage(makeClient());
      await screen.findByText("Báo cáo tổng hợp");
      expect(screen.queryByText("Tài chính tháng này")).not.toBeInTheDocument();
    });

    it("does NOT render employee section when totalEmployees and attendanceRate are null", async () => {
      mockGetReport.mockResolvedValue(NO_PERMS_REPORT);
      renderPage(makeClient());
      await screen.findByText("Báo cáo tổng hợp");
      expect(screen.queryByText("Nhân sự")).not.toBeInTheDocument();
    });
  });

  describe("full-access role rendering", () => {
    it("renders finance section when server returns revenue data", async () => {
      mockGetReport.mockResolvedValue(FULL_REPORT);
      renderPage(makeClient());
      expect(await screen.findByText("Tài chính tháng này")).toBeInTheDocument();
      expect(screen.getByText("Doanh thu")).toBeInTheDocument();
      expect(screen.getByText("Chi phí")).toBeInTheDocument();
      expect(screen.getByText("Lợi nhuận")).toBeInTheDocument();
    });

    it("renders employee section when server returns employee data", async () => {
      mockGetReport.mockResolvedValue(FULL_REPORT);
      renderPage(makeClient());
      expect(await screen.findByText("Nhân sự")).toBeInTheDocument();
      expect(screen.getByText("Tổng nhân viên")).toBeInTheDocument();
      expect(screen.getByText("Tỷ lệ có mặt hôm nay")).toBeInTheDocument();
    });

    it("renders finance section but not employee section when only finance perm granted", async () => {
      const partial: ReportResponseDto = {
        ...FULL_REPORT,
        report: {
          ...FULL_REPORT.report,
          totalEmployees: null,
          todayAttendanceRate: null,
        },
      };
      mockGetReport.mockResolvedValue(partial);
      renderPage(makeClient());
      expect(await screen.findByText("Tài chính tháng này")).toBeInTheDocument();
      expect(screen.queryByText("Nhân sự")).not.toBeInTheDocument();
    });

    it("renders employee section but not finance section when only employee perm granted", async () => {
      const partial: ReportResponseDto = {
        ...FULL_REPORT,
        report: {
          ...FULL_REPORT.report,
          revenueThisMonth: null,
          costThisMonth: null,
          profitThisMonth: null,
          revenueByChannel: null,
        },
      };
      mockGetReport.mockResolvedValue(partial);
      renderPage(makeClient());
      expect(await screen.findByText("Nhân sự")).toBeInTheDocument();
      expect(screen.queryByText("Tài chính tháng này")).not.toBeInTheDocument();
    });

    it("shows asOf timestamp", async () => {
      mockGetReport.mockResolvedValue(FULL_REPORT);
      renderPage(makeClient());
      expect(await screen.findByText(/Cập nhật lúc:/)).toBeInTheDocument();
    });
  });

  describe("period filter — wired to backend (B4)", () => {
    it("fetches with the default period on first load", async () => {
      mockGetReport.mockResolvedValue(FULL_REPORT);
      renderPage(makeClient());
      await screen.findByText("Tài chính tháng này");
      expect(mockGetReport).toHaveBeenCalledWith("thisMonth");
    });

    it("refetches with the selected period when the filter changes", async () => {
      mockGetReport.mockResolvedValue(FULL_REPORT);
      renderPage(makeClient());
      await screen.findByText("Tài chính tháng này");

      fireEvent.change(screen.getByRole("combobox"), { target: { value: "lastMonth" } });

      await waitFor(() => expect(mockGetReport).toHaveBeenCalledWith("lastMonth"));
    });
  });
});
