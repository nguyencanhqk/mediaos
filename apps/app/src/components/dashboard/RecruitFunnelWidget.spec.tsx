// @vitest-environment jsdom
/**
 * RecruitFunnelWidget tests (S12-RECRUIT-DASH-1). Phủ: deny-path (thiếu view:candidate → KHÔNG render,
 * KHÔNG fetch) · empty/error(Degraded)/parse-fail · zero-fill ĐỦ 6 bậc phễu (stage vắng trong byStage vẫn
 * hiện với 0) · tổng + số vị trí mở lấy TỪ SERVER (FE KHÔNG tự cộng) · drill-down navigate
 * ("/recruit/pipeline") · refresh.
 *
 * ⚠ Cổng THẬT của widget này (sàn scope 'Company' — summaryTx đếm TOÀN company) nằm ở BACKEND — xem
 * `apps/api/test/integration/dashboard-recruit-funnel.int-spec.ts`. Ở FE chỉ chứng được gate PHỤ theo CẶP,
 * vì `capabilities` không mang data_scope. Đừng đọc các ca dưới đây như bằng chứng "ai không thấy".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { RecruitFunnelWidget } from "./RecruitFunnelWidget";

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
        <RecruitFunnelWidget />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

// byStage CỐ Ý thiếu Screening/Hired/Rejected — server chỉ trả stage CÓ hồ sơ; widget phải zero-fill.
const ACTIVE_DTO = {
  widget_code: "RECRUIT_FUNNEL",
  widget_type: "Chart",
  status: "Active" as const,
  data: {
    byStage: { New: 4, Interview: 2, Offer: 1 },
    summary: { totalCandidates: 7, openJobOpenings: 3 },
  },
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-08-31T01:00:00.000Z",
  cache: { hit: false, ttl_seconds: 300, expires_at: "2026-08-31T01:05:00.000Z" },
  quick_actions: [],
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("RecruitFunnelWidget — gate PHỤ (DASH_WIDGET_GATE_PAIR.RECRUIT_FUNNEL = view:candidate)", () => {
  it("thiếu view:candidate → KHÔNG render widget, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(/phễu tuyển dụng/i)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  it("cặp KHÁC (view:job-opening) KHÔNG mở được widget này — không fetch, không mount", () => {
    setCaps({ "view:job-opening": true });
    renderWidget();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
    expect(screen.queryByText(/phễu tuyển dụng/i)).not.toBeInTheDocument();
  });
});

describe("RecruitFunnelWidget — data states (có view:candidate)", () => {
  beforeEach(() => setCaps({ "view:candidate": true }));

  it("status Empty → hiện empty message của SERVER", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Empty",
      data: null,
      empty_state: { message: "Chưa có vị trí đang mở hay ứng viên trong phễu" },
    });
    renderWidget();
    await waitFor(() => {
      expect(
        screen.getByText("Chưa có vị trí đang mở hay ứng viên trong phễu"),
      ).toBeInTheDocument();
    });
  });

  it("status server Degraded → error state, KHÔNG render số liệu", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Degraded",
      error_state: {
        code: "DASH-ERR-WIDGET-DEGRADED",
        message: "Dữ liệu tạm thời không đầy đủ",
        source_module: "RECRUIT",
        retryable: true,
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.queryByText("Sàng lọc")).not.toBeInTheDocument();
  });

  it("data sai hình (byStage là chuỗi) → error state HIỆN RA, KHÔNG render nửa vời", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      data: { ...ACTIVE_DTO.data, byStage: { New: "nhiều" } },
    });
    renderWidget();
    // PHẢI thấy error UI (không chỉ "vắng số liệu" — widget trắng câm cũng vắng số liệu).
    await waitFor(() => {
      expect(screen.getByText("Không thể tải dữ liệu")).toBeInTheDocument();
    });
    expect(screen.queryByText("Sàng lọc")).not.toBeInTheDocument();
  });

  it("status Active → render tổng + vị trí mở CỦA SERVER, zero-fill ĐỦ 6 bậc phễu", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("7")).toBeInTheDocument();
    });
    expect(screen.getByText(/3 vị trí đang mở/i)).toBeInTheDocument();
    // Đủ 6 bậc — kể cả stage server KHÔNG trả (Screening/Hired/Rejected) vẫn hiện (với 0).
    for (const label of ["Mới", "Sàng lọc", "Phỏng vấn", "Offer", "Đã tuyển", "Từ chối"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("4")).toBeInTheDocument(); // New
    expect(screen.getByText("2")).toBeInTheDocument(); // Interview
  });

  it("click 1 bậc phễu → navigate('/recruit/pipeline')", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Sàng lọc")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Sàng lọc"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/recruit/pipeline" });
  });

  it("nút Làm mới gọi getWidgetData(refresh:true)", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Sàng lọc")).toBeInTheDocument();
    });
    mockGetWidgetData.mockClear();
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    fireEvent.click(screen.getByRole("button", { name: /làm mới/i }));
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        "RECRUIT_FUNNEL",
        expect.objectContaining({ refresh: true }),
      );
    });
  });
});
