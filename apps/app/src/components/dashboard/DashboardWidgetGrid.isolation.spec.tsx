// @vitest-environment jsdom
/**
 * DashboardWidgetGrid — cô lập lỗi cấp Grid (S4-FE-DASH-1-FIX).
 *
 * Khác với DashboardWidgetGrid.spec.tsx (mock cả 3 widget con thành <div> placeholder để test riêng
 * việc sắp xếp/lọc), spec này render CÁC WIDGET THẬT (MyTasksWidget/TaskAlertsWidget — KHÔNG mock) để
 * chứng minh trực tiếp: 1 widget server trả status Degraded/Error KHÔNG làm sập hay ẩn widget khác
 * trong cùng grid (§13.1/§16.2.6 "widget lỗi không làm sập toàn dashboard").
 *
 * Chỉ mock `dashboardApi.getWidgetData` (theo widget_code trả DTO khác nhau) — PermissionGate/useCan
 * dùng THẬT (mirror pattern MyTasksWidget.spec.tsx).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { DashboardWidgetSummaryDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { DashboardWidgetGrid } from "./DashboardWidgetGrid";

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

function widget(code: string, order: number): DashboardWidgetSummaryDto {
  return {
    widget_code: code,
    widget_name: code,
    widget_type: "List",
    source_modules: ["TASK"],
    data_scope: "Own",
    layout: { order },
    data: null,
    last_updated_at: null,
  };
}

function renderGrid() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <DashboardWidgetGrid
          widgets={[widget("MY_TASKS", 10), widget("TASK_ALERTS", 20)]}
          dashboardType="Employee"
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const ACTIVE_MY_TASKS_DTO = {
  widget_code: "MY_TASKS",
  widget_type: "List",
  status: "Active" as const,
  data: {
    items: [
      {
        id: "t-1",
        title: "Viết báo cáo tuần",
        status: "In Progress",
        priority: "High",
        dueAt: "2026-07-12T09:00:00.000Z",
        isOverdue: false,
        projectName: "Dự án Alpha",
      },
    ],
    summary: { total: 1 },
  },
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-07-11T08:00:00.000Z",
  cache: { hit: true, ttl_seconds: 60, expires_at: "2026-07-11T08:01:00.000Z" },
  quick_actions: [],
};

const DEGRADED_TASK_ALERTS_DTO = {
  widget_code: "TASK_ALERTS",
  widget_type: "Alert",
  status: "Degraded" as const,
  data: null,
  empty_state: null,
  error_state: {
    code: "DASH-ERR-WIDGET-DEGRADED",
    message: "Dữ liệu tạm thời không đầy đủ",
    source_module: "TASK",
    retryable: true,
  },
  last_updated_at: null,
  cache: null,
  quick_actions: [],
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
  // Cả MY_TASKS lẫn TASK_ALERTS đều gate bằng read:task (DASH_WIDGET_GATE_PAIR) — 1 cap đủ cho cả 2.
  setCaps({ "read:task": true });
  mockGetWidgetData.mockImplementation((widgetCode: string) => {
    if (widgetCode === "MY_TASKS") return Promise.resolve(ACTIVE_MY_TASKS_DTO);
    if (widgetCode === "TASK_ALERTS") return Promise.resolve(DEGRADED_TASK_ALERTS_DTO);
    return Promise.reject(new Error(`unexpected widget_code trong test: ${widgetCode}`));
  });
});

describe("DashboardWidgetGrid — cô lập lỗi (1 widget Degraded, 1 widget Active)", () => {
  it("render KHÔNG throw/crash khi 1 widget Degraded nằm cạnh 1 widget Active", async () => {
    expect(() => renderGrid()).not.toThrow();
  });

  it("widget MY_TASKS (Active) vẫn hiển thị đầy đủ dữ liệu — KHÔNG bị ảnh hưởng bởi TASK_ALERTS lỗi", async () => {
    renderGrid();
    await waitFor(() => {
      expect(screen.getByText("Viết báo cáo tuần")).toBeInTheDocument();
    });
    expect(screen.getByText("Dự án Alpha")).toBeInTheDocument();
    expect(screen.getByText("Việc của tôi hôm nay")).toBeInTheDocument();
  });

  it("widget TASK_ALERTS (Degraded) hiển thị error state cục bộ — KHÔNG kéo theo lỗi ở MY_TASKS", async () => {
    renderGrid();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.getByText("Task cần chú ý")).toBeInTheDocument();
    // Cả 2 tiêu đề widget đều mount song song trong cùng grid — chứng minh lỗi 1 widget không lan.
    expect(screen.getByText("Việc của tôi hôm nay")).toBeInTheDocument();
    // Đúng 1 nút "Thử lại" (chỉ widget lỗi hiện), widget Active không hiện nút này.
    expect(screen.getAllByRole("button", { name: /thử lại/i })).toHaveLength(1);
  });
});
