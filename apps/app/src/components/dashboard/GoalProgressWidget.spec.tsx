// @vitest-environment jsdom
/**
 * GoalProgressWidget tests (S5-GOAL-DASH-1). Phủ: deny-path (thiếu view:goal → KHÔNG render, KHÔNG
 * fetch) · empty/error(Degraded)/success · drill-down navigate("/goals/$goalId") · refresh gọi
 * getWidgetData(refresh:true).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { GoalProgressWidget } from "./GoalProgressWidget";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

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
        <GoalProgressWidget />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const ACTIVE_DTO = {
  widget_code: "GOAL_PROGRESS",
  widget_type: "Chart",
  status: "Active" as const,
  data: {
    items: [
      {
        departmentId: "dept-1",
        departmentName: "Phòng Kinh doanh",
        goalId: "goal-1",
        goalName: "Mục tiêu phòng Kinh doanh",
        progressPercent: 42,
        status: "Active",
      },
    ],
    summary: { totalDepartments: 1, avgProgressPercent: 42 },
  },
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-07-24T02:00:00.000Z",
  cache: { hit: false, ttl_seconds: 300, expires_at: "2026-07-24T02:05:00.000Z" },
  quick_actions: [],
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("GoalProgressWidget — gate (DASH_WIDGET_GATE_PAIR.GOAL_PROGRESS = view:goal)", () => {
  it("thiếu view:goal → KHÔNG render widget, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(/mục tiêu kỳ này/i)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });
});

describe("GoalProgressWidget — data states (có view:goal)", () => {
  beforeEach(() => setCaps({ "view:goal": true }));

  it("status Empty → hiện empty title", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Empty",
      data: null,
      empty_state: { message: "Chưa có mục tiêu phòng ban kỳ này" },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Chưa có mục tiêu phòng ban kỳ này")).toBeInTheDocument();
    });
  });

  it("status server Degraded → error state, KHÔNG render danh sách phòng ban", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Degraded",
      error_state: {
        code: "DASH-ERR-WIDGET-DEGRADED",
        message: "Dữ liệu tạm thời không đầy đủ",
        source_module: "GOAL",
        retryable: true,
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.queryByText("Phòng Kinh doanh")).not.toBeInTheDocument();
  });

  it("status Active → render tên phòng + % tiến độ; click item → navigate('/goals/$goalId')", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Phòng Kinh doanh")).toBeInTheDocument();
    });
    expect(screen.getByText("42%")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Phòng Kinh doanh"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/goals/$goalId",
      params: { goalId: "goal-1" },
    });
  });

  it("nút Làm mới gọi getWidgetData(refresh:true)", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Phòng Kinh doanh")).toBeInTheDocument();
    });
    mockGetWidgetData.mockClear();
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    fireEvent.click(screen.getByRole("button", { name: /làm mới/i }));
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        "GOAL_PROGRESS",
        expect.objectContaining({ refresh: true }),
      );
    });
  });
});
