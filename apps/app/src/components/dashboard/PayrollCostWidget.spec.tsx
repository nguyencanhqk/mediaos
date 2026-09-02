// @vitest-environment jsdom
/**
 * PayrollCostWidget tests (S13-PAYROLL-DASH-1). Phủ: deny-path theo CẶP (thiếu view-line:payroll-period →
 * KHÔNG render, KHÔNG fetch) · **wildcard `*:*` KHÔNG mở được widget** (cặp NHẠY CẢM — đây là lý do
 * component gate bằng `useCanExact` chứ không <PermissionGate>) · cặp payroll KHÁC không mở được ·
 * empty/error(Degraded)/parse-fail · render tổng net/gross/headcount + nhãn trạng thái kỳ LẤY TỪ SERVER ·
 * **tiền bị mask (null) in `—` chứ KHÔNG in "0 ₫"** · drill-down navigate("/payroll/periods") · refresh.
 *
 * ⚠ Cổng THẬT của widget này (sàn scope 'Company' — latestSummaryTx SUM toàn company) nằm ở BACKEND — xem
 * `apps/api/test/integration/dashboard-payroll-cost.int-spec.ts`. Ở FE chỉ chứng được gate PHỤ theo CẶP,
 * vì `capabilities` không mang data_scope. Đừng đọc các ca dưới đây như bằng chứng "ai không thấy".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { PayrollCostWidget } from "./PayrollCostWidget";

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
        <PayrollCostWidget />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const ACTIVE_DTO = {
  widget_code: "PAYROLL_COST",
  widget_type: "Summary",
  status: "Active" as const,
  data: {
    period: {
      payrollPeriodId: "11111111-1111-4111-8111-111111111111",
      periodMonth: "2026-08",
      status: "Calculated",
    },
    summary: { headcount: 12, totalGross: 480_000_000, totalNet: 432_000_000 },
  },
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-09-01T01:00:00.000Z",
  cache: { hit: false, ttl_seconds: 300, expires_at: "2026-09-01T01:05:00.000Z" },
  quick_actions: [],
};

const WIDGET_TITLE = /chi phí lương kỳ/i;

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("PayrollCostWidget — gate PHỤ (DASH_WIDGET_GATE_PAIR.PAYROLL_COST = view-line:payroll-period)", () => {
  it("thiếu view-line:payroll-period → KHÔNG render widget, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(WIDGET_TITLE)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  /**
   * CA TRỌNG TÂM của WO này. `<PermissionGate>` gọi `useCan`, vốn cho wildcard "*:*" đi qua; nhưng ở BE
   * wildcard KHÔNG kế thừa cặp `is_sensitive` (mig 0565) ⇒ server sẽ 403. Nếu ai đó "sửa cho đồng bộ với
   * 3 widget wave trước" bằng cách đổi sang <PermissionGate>, ca này ĐỎ ngay — đó là mục đích của nó.
   */
  it("chỉ có wildcard toàn phần → VẪN không render (cặp nhạy cảm, useCanExact chứ không useCan)", () => {
    setCaps({ "*:*": true });
    renderWidget();
    expect(screen.queryByText(WIDGET_TITLE)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  it("cặp PAYROLL KHÁC (view:payroll-period — cặp KHÔNG chở tiền) không mở được widget", () => {
    setCaps({ "view:payroll-period": true });
    renderWidget();
    expect(screen.queryByText(WIDGET_TITLE)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  it("có ĐÚNG cặp → widget mount và fetch (ca ALLOW đối chứng — deny ở trên không xanh rỗng)", async () => {
    setCaps({ "view-line:payroll-period": true });
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith("PAYROLL_COST", expect.anything());
    });
    expect(screen.getByText(WIDGET_TITLE)).toBeInTheDocument();
  });
});

describe("PayrollCostWidget — data states (có view-line:payroll-period)", () => {
  beforeEach(() => setCaps({ "view-line:payroll-period": true }));

  it("status Empty (công ty chưa có kỳ lương) → hiện empty message của SERVER", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Empty",
      data: null,
      empty_state: { message: "Chưa có kỳ lương nào" },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Chưa có kỳ lương nào")).toBeInTheDocument();
    });
  });

  it("status server Degraded → error state, KHÔNG render số tiền", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Degraded",
      error_state: {
        code: "DASH-ERR-WIDGET-DEGRADED",
        message: "Dữ liệu tạm thời không đầy đủ",
        source_module: "PAYROLL",
        retryable: true,
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.queryByText("Tổng thu nhập")).not.toBeInTheDocument();
  });

  it("data sai hình (headcount là chuỗi) → error state HIỆN RA, KHÔNG render nửa vời", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      data: { ...ACTIVE_DTO.data, summary: { ...ACTIVE_DTO.data.summary, headcount: "mười hai" } },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Không thể tải dữ liệu")).toBeInTheDocument();
    });
    expect(screen.queryByText("Tổng thu nhập")).not.toBeInTheDocument();
  });

  it("status Active → render net/gross/headcount + nhãn trạng thái kỳ + tháng, TỪ SERVER", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Số nhân sự")).toBeInTheDocument();
    });
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Kỳ 2026-08")).toBeInTheDocument();
    // Nhãn trạng thái lấy từ namespace payroll (một enum, một bộ nhãn) — KHÔNG in mã thô "Calculated".
    expect(screen.getByText("Đã tính")).toBeInTheDocument();
    expect(screen.queryByText("Calculated")).not.toBeInTheDocument();
    // Tiền: khớp con số server gửi (FE KHÔNG tự cộng lại) — so theo phần chữ số, bỏ ký hiệu ₫/dấu ngăn.
    const digits = screen
      .getAllByText(/\d{1,3}([.,]\d{3})+/)
      .map((el) => (el.textContent ?? "").replace(/\D/g, ""));
    expect(digits.some((s) => s.includes("432000000"))).toBe(true);
    expect(digits.some((s) => s.includes("480000000"))).toBe(true);
  });

  /**
   * MASK = VẮNG KHOÁ (SPEC-11 §18). Handler chuyển vế vắng thành `null`; FE PHẢI in `—`.
   * In "0 ₫" ở đây là biến «không có quyền xem» thành một con số SAI mà đọc được — chính cái
   * `formatPayrollMoney` sinh ra để chặn.
   */
  it("tiền bị mask (totalGross/totalNet = null) → in dấu gạch, TUYỆT ĐỐI không in 0 đồng", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      data: {
        ...ACTIVE_DTO.data,
        summary: { headcount: 12, totalGross: null, totalNet: null },
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Số nhân sự")).toBeInTheDocument();
    });
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/^\s*0\s*₫\s*$/)).not.toBeInTheDocument();
    // headcount vẫn hiện — mask chỉ ăn vế TIỀN, không ăn phép đếm.
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("click khối số → navigate('/payroll/periods') — KHÔNG deep-link vào chi tiết kỳ (cặp gate khác)", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Số nhân sự")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Số nhân sự"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/payroll/periods" });
  });

  it("nút Làm mới gọi getWidgetData(refresh:true)", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Số nhân sự")).toBeInTheDocument();
    });
    mockGetWidgetData.mockClear();
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    fireEvent.click(screen.getByRole("button", { name: /làm mới/i }));
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        "PAYROLL_COST",
        expect.objectContaining({ refresh: true }),
      );
    });
  });
});
