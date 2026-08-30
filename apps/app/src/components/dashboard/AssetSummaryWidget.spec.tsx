// @vitest-environment jsdom
/**
 * AssetSummaryWidget tests (S11-OFFICE-DASH-1). Phủ: deny-path (thiếu view:asset → KHÔNG render, KHÔNG
 * fetch) · empty/error(Degraded)/parse-fail · tổng + phân rã theo trạng thái/loại lấy TỪ SERVER (FE KHÔNG
 * tự cộng) · cảnh báo bảo trì chỉ hiện khi > 0 · drill-down navigate("/assets") · refresh.
 *
 * ⚠ Cổng THẬT của widget này (sàn scope 'Department', SPEC-13 §482) nằm ở BACKEND — xem
 * `apps/api/test/integration/dashboard-office-widgets.int-spec.ts`. Ở FE chỉ chứng được gate PHỤ theo CẶP,
 * vì `capabilities` không mang data_scope. Đừng đọc các ca dưới đây như bằng chứng "nhân viên không thấy".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { AssetSummaryWidget } from "./AssetSummaryWidget";

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
        <AssetSummaryWidget />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const ACTIVE_DTO = {
  widget_code: "ASSET_SUMMARY",
  widget_type: "Summary",
  status: "Active" as const,
  data: {
    summary: { total: 12, maintenanceDueSoon: 3 },
    byStatus: { "In Stock": 5, Assigned: 6, "Under Maintenance": 1 },
    byCategory: [
      { categoryId: "cat-1", code: "LAPTOP", name: "Máy tính xách tay", total: 8, assigned: 6 },
      { categoryId: "cat-2", code: "CHAIR", name: "Ghế văn phòng", total: 4, assigned: 0 },
    ],
  },
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-08-30T01:00:00.000Z",
  cache: { hit: false, ttl_seconds: 300, expires_at: "2026-08-30T01:05:00.000Z" },
  quick_actions: [],
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("AssetSummaryWidget — gate PHỤ (DASH_WIDGET_GATE_PAIR.ASSET_SUMMARY = view:asset)", () => {
  it("thiếu view:asset → KHÔNG render widget, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(/thống kê tài sản/i)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  it("cặp KHÁC (view:room) KHÔNG mở được widget này", () => {
    setCaps({ "view:room": true });
    renderWidget();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });
});

describe("AssetSummaryWidget — data states (có view:asset)", () => {
  beforeEach(() => setCaps({ "view:asset": true }));

  it("status Empty → hiện empty message của SERVER", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Empty",
      data: null,
      empty_state: { message: "Chưa có tài sản trong phạm vi của bạn" },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Chưa có tài sản trong phạm vi của bạn")).toBeInTheDocument();
    });
  });

  it("status server Degraded → error state, KHÔNG render số liệu", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Degraded",
      error_state: {
        code: "DASH-ERR-WIDGET-DEGRADED",
        message: "Dữ liệu tạm thời không đầy đủ",
        source_module: "ASSET",
        retryable: true,
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.queryByText("Máy tính xách tay")).not.toBeInTheDocument();
  });

  it("data sai hình (byStatus là chuỗi) → error state, KHÔNG render nửa vời", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      data: { ...ACTIVE_DTO.data, byStatus: { "In Stock": "nhiều" } },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.queryByText("Máy tính xách tay")).not.toBeInTheDocument();
    });
  });

  it("status Active → render tổng CỦA SERVER + phân rã theo trạng thái/loại", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("12")).toBeInTheDocument();
    });
    expect(screen.getByText("In Stock")).toBeInTheDocument();
    expect(screen.getByText("Assigned")).toBeInTheDocument();
    expect(screen.getByText("Máy tính xách tay")).toBeInTheDocument();
    expect(screen.getByText("Ghế văn phòng")).toBeInTheDocument();
  });

  it("cảnh báo bảo trì hiện khi maintenanceDueSoon > 0, ẨN khi = 0", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    const first = renderWidget();
    await waitFor(() => {
      expect(screen.getByText(/sắp đến hạn bảo trì/i)).toBeInTheDocument();
    });
    first.unmount();

    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      data: { ...ACTIVE_DTO.data, summary: { total: 12, maintenanceDueSoon: 0 } },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Máy tính xách tay")).toBeInTheDocument();
    });
    expect(screen.queryByText(/sắp đến hạn bảo trì/i)).not.toBeInTheDocument();
  });

  it("click 1 dòng loại → navigate('/assets')", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Máy tính xách tay")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Máy tính xách tay"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/assets" });
  });

  it("nút Làm mới gọi getWidgetData(refresh:true)", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Máy tính xách tay")).toBeInTheDocument();
    });
    mockGetWidgetData.mockClear();
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    fireEvent.click(screen.getByRole("button", { name: /làm mới/i }));
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        "ASSET_SUMMARY",
        expect.objectContaining({ refresh: true }),
      );
    });
  });
});
