// @vitest-environment jsdom
/**
 * AttendanceTodayWidget tests (S4-FE-DASH-2, DASH-WIDGET-001). Phủ: deny-path (thiếu view-own:attendance →
 * KHÔNG render, KHÔNG fetch) · loading/empty/error(Degraded)/success · refresh gọi getWidgetData(refresh:true).
 *
 * Giữ web-core THẬT (useCan/PermissionGate/useAuthStore) — chỉ stub `dashboardApi` (mirror
 * MyTasksWidget.spec.tsx pattern: setCaps() điều khiển gate, KHÔNG mock useCan/PermissionGate tay).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { AttendanceTodayWidget } from "./AttendanceTodayWidget";

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
        <AttendanceTodayWidget />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const ACTIVE_DTO = {
  widget_code: "ATTENDANCE_TODAY",
  widget_type: "Summary",
  status: "Active" as const,
  data: {
    date: "2026-07-12",
    items: [
      {
        id: "a-1",
        workDate: "2026-07-12",
        attendanceStatus: "Present",
        status: "checked_out",
        checkInAt: "2026-07-12T01:30:00.000Z",
        checkOutAt: "2026-07-12T09:30:00.000Z",
      },
    ],
    summary: { total: 1 },
  },
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-07-12T09:31:00.000Z",
  cache: { hit: false, ttl_seconds: 60, expires_at: "2026-07-12T09:32:00.000Z" },
  quick_actions: [],
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("AttendanceTodayWidget — gate (DASH_WIDGET_GATE_PAIR.ATTENDANCE_TODAY = view-own:attendance)", () => {
  it("thiếu view-own:attendance → KHÔNG render widget, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(/chấm công hôm nay/i)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });
});

describe("AttendanceTodayWidget — data states (có view-own:attendance)", () => {
  beforeEach(() => setCaps({ "view-own:attendance": true }));

  it("status Empty → hiện empty title", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Empty",
      data: null,
      empty_state: { message: "Chưa có chấm công hôm nay" },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Chưa có chấm công hôm nay")).toBeInTheDocument();
    });
  });

  it("status server Degraded → error state (§16.7, KHÔNG render danh sách)", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Degraded",
      error_state: {
        code: "DASH-ERR-WIDGET-DEGRADED",
        message: "Dữ liệu tạm thời không đầy đủ",
        source_module: "ATT",
        retryable: true,
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
  });

  it("status Active → render badge trạng thái + nút Làm mới gọi getWidgetData(refresh:true)", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      // attendanceStatus="Present" → AttendanceStatusBadge dịch qua ns "attendance" (status.Present="Có mặt").
      expect(screen.getByText("Có mặt")).toBeInTheDocument();
    });
    mockGetWidgetData.mockClear();
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    fireEvent.click(screen.getByRole("button", { name: /làm mới/i }));
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        "ATTENDANCE_TODAY",
        expect.objectContaining({ refresh: true }),
      );
    });
  });
});
