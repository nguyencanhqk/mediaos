// @vitest-environment jsdom
/**
 * MyTasksWidget tests (S4-FE-DASH-1, DASH-WIDGET-002). Phủ: deny-path (thiếu read:task → KHÔNG render,
 * KHÔNG fetch) · loading/error/empty/success · refresh gọi getWidgetData(refresh:true).
 *
 * Giữ web-core THẬT (useCan/PermissionGate/useAuthStore) — chỉ stub `dashboardApi` (mirror
 * LeaveTypesPage.spec.tsx pattern: setCaps() điều khiển gate, KHÔNG mock useCan/PermissionGate tay).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { MyTasksWidget } from "./MyTasksWidget";

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
        <MyTasksWidget />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const ACTIVE_DTO = {
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
  cache: { hit: false, ttl_seconds: 60, expires_at: "2026-07-11T08:01:00.000Z" },
  quick_actions: [],
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("MyTasksWidget — gate (DASH_WIDGET_GATE_PAIR.MY_TASKS = read:task)", () => {
  it("thiếu read:task → KHÔNG render widget, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(/việc của tôi hôm nay/i)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });
});

describe("MyTasksWidget — data states (có read:task)", () => {
  beforeEach(() => setCaps({ "read:task": true }));

  it("loading → hiện shell (tiêu đề) trước khi data về", async () => {
    mockGetWidgetData.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWidget();
    expect(screen.getByText("Việc của tôi hôm nay")).toBeInTheDocument();
  });

  it("status Empty → hiện empty title", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Empty",
      data: null,
      empty_state: { message: "Hôm nay bạn chưa có task cần xử lý" },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Hôm nay bạn chưa có task cần xử lý")).toBeInTheDocument();
    });
  });

  it("lỗi fetch → error state + nút thử lại", async () => {
    mockGetWidgetData.mockRejectedValue(new Error("network"));
    renderWidget();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
    });
  });

  it("status server Degraded → error state (§16.7, KHÔNG render danh sách)", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Degraded",
      error_state: {
        code: "DASH-ERR-WIDGET-DEGRADED",
        message: "Dữ liệu tạm thời không đầy đủ",
        source_module: "TASK",
        retryable: true,
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
    expect(screen.queryByText("Viết báo cáo tuần")).not.toBeInTheDocument();
  });

  it("status server Error → error state (module nguồn lỗi, KHÔNG lộ stack trace)", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Error",
      data: null,
      error_state: {
        code: "DASH-ERR-WIDGET-SOURCE",
        message: "Không thể tải dữ liệu từ module Task",
        source_module: "TASK",
        retryable: true,
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Không thể tải dữ liệu từ module Task")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
  });

  it("status Active → render danh sách task + footer 'Cập nhật lúc' (last_updated_at, cache hit)", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      cache: { hit: true, ttl_seconds: 60, expires_at: "2026-07-11T08:01:00.000Z" },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Viết báo cáo tuần")).toBeInTheDocument();
    });
    expect(screen.getByText("Dự án Alpha")).toBeInTheDocument();
    expect(screen.getByText(/Cập nhật lúc/i)).toBeInTheDocument();
  });

  it("nút Làm mới → gọi getWidgetData('MY_TASKS', { refresh: true, ... })", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Viết báo cáo tuần")).toBeInTheDocument();
    });
    mockGetWidgetData.mockClear();
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    fireEvent.click(screen.getByRole("button", { name: /làm mới/i }));
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        "MY_TASKS",
        expect.objectContaining({ refresh: true }),
      );
    });
  });
});
