// @vitest-environment jsdom
/**
 * HrOverviewWidget tests (S4-FE-DASH-2, DASH-WIDGET-004). Phủ: deny-path (thiếu read:employee → KHÔNG
 * render, KHÔNG fetch) · empty/error(Degraded)/success (headcount + byStatus, KHÔNG lương/PII) · refresh.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { HrOverviewWidget } from "./HrOverviewWidget";

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
        <HrOverviewWidget />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const ACTIVE_DTO = {
  widget_code: "HR_OVERVIEW",
  widget_type: "Summary",
  status: "Active" as const,
  data: {
    summary: { headcount: 42 },
    byStatus: { Active: 40, "On Leave": 2 },
    byOrgUnit: { "Phòng Kỹ thuật": 20, "Phòng Kinh doanh": 22 },
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

describe("HrOverviewWidget — gate (DASH_WIDGET_GATE_PAIR.HR_OVERVIEW = read:employee)", () => {
  it("thiếu read:employee → KHÔNG render widget, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(/tổng quan nhân sự/i)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });
});

describe("HrOverviewWidget — data states (có read:employee)", () => {
  beforeEach(() => setCaps({ "read:employee": true }));

  it("status Empty → hiện empty title", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Empty",
      data: null,
      empty_state: { message: "Chưa có nhân sự" },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Chưa có nhân sự")).toBeInTheDocument();
    });
  });

  it("status server Degraded → error state (§16.7)", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Degraded",
      error_state: {
        code: "DASH-ERR-WIDGET-DEGRADED",
        message: "Dữ liệu tạm thời không đầy đủ",
        source_module: "HR",
        retryable: true,
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });

  it("status Active → render headcount + byStatus (KHÔNG lương/PII) + nút Làm mới", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText(/salary|lương/i)).not.toBeInTheDocument();
    mockGetWidgetData.mockClear();
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    fireEvent.click(screen.getByRole("button", { name: /làm mới/i }));
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        "HR_OVERVIEW",
        expect.objectContaining({ refresh: true }),
      );
    });
  });
});
