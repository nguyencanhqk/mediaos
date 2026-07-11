// @vitest-environment jsdom
/**
 * DashboardMePage tests (S4-FE-DASH-1, DASH-SCREEN-001). Phủ: forbidden (thiếu read:dashboard → KHÔNG
 * fetch) · loading skeleton · error + thử lại · empty (0 widget) · success render DashboardWidgetGrid
 * ("load shell trước, widget lazy" — grid nhận widgets/dashboardType, TỰ lazy-load data, không phải việc
 * của page này).
 *
 * Giữ web-core THẬT (useCan/useAuthStore) — chỉ stub `dashboardApi.getMyDashboard` (mirror
 * LeaveTypesPage.spec.tsx: setCaps() điều khiển gate). Mock DashboardWidgetGrid (component con test riêng
 * ở DashboardWidgetGrid.spec.tsx) để page-test tập trung vào 5 trạng thái shell.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { DashboardMePage } from "./DashboardMePage";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    dashboardApi: { getMyDashboard: vi.fn() },
  };
});

vi.mock("@/components/dashboard/DashboardWidgetGrid", () => ({
  DashboardWidgetGrid: ({
    widgets,
    dashboardType,
  }: {
    widgets: unknown[];
    dashboardType: string;
  }) => (
    <div data-testid="widget-grid">
      grid:{dashboardType}:{widgets.length}
    </div>
  ),
}));

import { dashboardApi } from "@mediaos/web-core";
const mockGetMyDashboard = dashboardApi.getMyDashboard as ReturnType<typeof vi.fn>;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <DashboardMePage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("DashboardMePage — gate (DASH_READ_PAIR = read:dashboard)", () => {
  it("thiếu read:dashboard → hiện forbidden, KHÔNG gọi getMyDashboard", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(mockGetMyDashboard).not.toHaveBeenCalled();
  });
});

describe("DashboardMePage — data states (có read:dashboard)", () => {
  beforeEach(() => setCaps({ "read:dashboard": true }));

  it("loading → hiện skeleton (KHÔNG hiện tiêu đề trang/lỗi/rỗng)", () => {
    mockGetMyDashboard.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText("Bảng điều khiển")).not.toBeInTheDocument();
    expect(screen.queryByTestId("widget-grid")).not.toBeInTheDocument();
  });

  it("lỗi fetch shell → error state + nút thử lại gọi lại getMyDashboard", async () => {
    mockGetMyDashboard.mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không thể tải bảng điều khiển/i)).toBeInTheDocument();
    });
    mockGetMyDashboard.mockClear();
    mockGetMyDashboard.mockResolvedValue({
      dashboard_type: "Employee",
      widgets: [],
      generated_at: "2026-07-11T08:00:00.000Z",
    });
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => {
      expect(mockGetMyDashboard).toHaveBeenCalled();
    });
  });

  it("0 widget được phép xem → empty state", async () => {
    mockGetMyDashboard.mockResolvedValue({
      dashboard_type: "Employee",
      widgets: [],
      generated_at: "2026-07-11T08:00:00.000Z",
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/chưa có widget nào để hiển thị/i)).toBeInTheDocument();
    });
  });

  it("có widget → render PageHeader + DashboardWidgetGrid(widgets, dashboardType)", async () => {
    mockGetMyDashboard.mockResolvedValue({
      dashboard_type: "Manager",
      widgets: [
        {
          widget_code: "TASK_ALERTS",
          widget_name: "Task cần chú ý",
          widget_type: "Alert",
          source_modules: ["TASK"],
          data_scope: "Own",
          layout: { order: 30 },
          data: null,
          last_updated_at: null,
        },
      ],
      generated_at: "2026-07-11T08:00:00.000Z",
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Bảng điều khiển")).toBeInTheDocument();
    });
    expect(screen.getByTestId("widget-grid")).toHaveTextContent("grid:Manager:1");
  });
});
