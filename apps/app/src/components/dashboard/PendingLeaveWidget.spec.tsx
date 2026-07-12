// @vitest-environment jsdom
/**
 * PendingLeaveWidget tests (S4-FE-DASH-2, DASH-WIDGET-005). Phủ: deny-path (thiếu view:leave → KHÔNG
 * render, KHÔNG fetch) · empty/error(Degraded)/success · refresh gọi getWidgetData(refresh:true).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { PendingLeaveWidget } from "./PendingLeaveWidget";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    dashboardApi: { getWidgetData: vi.fn() },
  };
});

import { dashboardApi } from "@mediaos/web-core";
const mockGetWidgetData = dashboardApi.getWidgetData as ReturnType<typeof vi.fn>;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <PendingLeaveWidget />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const ACTIVE_DTO = {
  widget_code: "PENDING_LEAVE",
  widget_type: "List",
  status: "Active" as const,
  data: {
    items: [
      {
        id: "l-1",
        leaveTypeName: "Nghỉ phép năm",
        startDate: "2026-07-15",
        endDate: "2026-07-16",
        totalDays: 2,
        status: "Pending",
        submittedAt: "2026-07-11T02:00:00.000Z",
        requester: { fullName: "Trần Thị B", department: "Phòng Kỹ thuật" },
      },
    ],
    summary: { total: 1 },
  },
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-07-12T02:00:00.000Z",
  cache: { hit: false, ttl_seconds: 60, expires_at: "2026-07-12T02:01:00.000Z" },
  quick_actions: [],
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("PendingLeaveWidget — gate (DASH_WIDGET_GATE_PAIR.PENDING_LEAVE = view:leave)", () => {
  it("thiếu view:leave → KHÔNG render widget, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(/đơn nghỉ chờ duyệt/i)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });
});

describe("PendingLeaveWidget — data states (có view:leave)", () => {
  beforeEach(() => setCaps({ "view:leave": true }));

  it("status Empty → hiện empty title", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Empty",
      data: null,
      empty_state: { message: "Không có đơn nghỉ chờ duyệt" },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Không có đơn nghỉ chờ duyệt")).toBeInTheDocument();
    });
  });

  it("status server Degraded → error state (§16.7, KHÔNG render danh sách)", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Degraded",
      error_state: {
        code: "DASH-ERR-WIDGET-DEGRADED",
        message: "Dữ liệu tạm thời không đầy đủ",
        source_module: "LEAVE",
        retryable: true,
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.queryByText("Trần Thị B")).not.toBeInTheDocument();
  });

  it("status Active → render requester + loại phép + nút Làm mới gọi getWidgetData(refresh:true)", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Trần Thị B")).toBeInTheDocument();
    });
    expect(screen.getByText(/Nghỉ phép năm/)).toBeInTheDocument();
    mockGetWidgetData.mockClear();
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    fireEvent.click(screen.getByRole("button", { name: /làm mới/i }));
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        "PENDING_LEAVE",
        expect.objectContaining({ refresh: true }),
      );
    });
  });
});
