// @vitest-environment jsdom
/**
 * PayrollBudgetWidget + PayrollAdvancePendingWidget (S15-PAYROLL-DASH-1, SPEC-11 §10.1b).
 *
 * Phủ: deny-path theo CẶP · **wildcard `*:*` KHÔNG mở được widget** (cả hai cặp NHẠY CẢM — lý do dùng
 * `useCanExact` chứ không <PermissionGate>) · **KHÔNG mượn chéo cặp của widget anh em** · empty/error/
 * parse-fail · «chưa lập kế hoạch» in `—` chứ KHÔNG in "0 ₫" · drill-down · refresh.
 *
 * ⚠ Cổng THẬT của cả hai widget (sàn scope 'Company') nằm ở BACKEND — xem
 * `apps/api/test/integration/dashboard-payroll-v2-widgets.int-spec.ts`. Ở FE chỉ chứng được gate PHỤ
 * theo CẶP vì `capabilities` không mang data_scope; đừng đọc các ca dưới đây thành "ai không thấy".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { PayrollBudgetWidget } from "./PayrollBudgetWidget";
import { PayrollAdvancePendingWidget } from "./PayrollAdvancePendingWidget";

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

function renderWidget(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
}

const envelope = (widget_code: string, over: Record<string, unknown>) => ({
  widget_code,
  widget_type: "Summary",
  status: "Active" as const,
  data: null,
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-09-18T01:00:00.000Z",
  cache: { hit: false, ttl_seconds: 300, expires_at: "2026-09-18T01:05:00.000Z" },
  quick_actions: [],
  ...over,
});

const BUDGET_DTO = envelope("PAYROLL_BUDGET", {
  data: {
    fiscalYear: 2026,
    plannedAmount: 250_000_000,
    actualAmount: 100_000_000,
    variance: 150_000_000,
    usagePct: 40,
  },
});

const ADVANCE_DTO = envelope("PAYROLL_ADVANCE_PENDING", { data: { total: 3 } });

const BUDGET_TITLE = /ngân sách lương năm/i;
const ADVANCE_TITLE = /tạm ứng chờ duyệt/i;

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
describe("PayrollBudgetWidget — gate PHỤ (cặp view:payroll-budget)", () => {
  it("thiếu cặp → KHÔNG render, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget(<PayrollBudgetWidget />);
    expect(screen.queryByText(BUDGET_TITLE)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  /**
   * Cặp NHẠY CẢM (mig 0571) — ở BE wildcard KHÔNG kế thừa `is_sensitive` nên server sẽ 403. Ai "sửa cho
   * đồng bộ với 3 widget wave OFFICE/RECRUIT" bằng <PermissionGate> (dùng `useCan`) sẽ làm ca này ĐỎ.
   */
  it("chỉ wildcard `*:*` → VẪN không render (useCanExact, không useCan)", () => {
    setCaps({ "*:*": true });
    renderWidget(<PayrollBudgetWidget />);
    expect(screen.queryByText(BUDGET_TITLE)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  it("cặp của widget ANH EM (view:payroll-advance) KHÔNG mở được — mỗi widget một cặp riêng", () => {
    setCaps({ "view:payroll-advance": true });
    renderWidget(<PayrollBudgetWidget />);
    expect(screen.queryByText(BUDGET_TITLE)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  it("có ĐÚNG cặp → mount + fetch (ca ALLOW đối chứng — deny ở trên không xanh rỗng)", async () => {
    setCaps({ "view:payroll-budget": true });
    mockGetWidgetData.mockResolvedValue(BUDGET_DTO);
    renderWidget(<PayrollBudgetWidget />);
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith("PAYROLL_BUDGET", expect.anything());
    });
    expect(screen.getByText(BUDGET_TITLE)).toBeInTheDocument();
  });
});

describe("PayrollBudgetWidget — data states", () => {
  beforeEach(() => setCaps({ "view:payroll-budget": true }));

  it("Active: in thực hiện + kế hoạch + chênh lệch + tỉ lệ dùng", async () => {
    mockGetWidgetData.mockResolvedValue(BUDGET_DTO);
    renderWidget(<PayrollBudgetWidget />);
    await waitFor(() => expect(screen.getByText(/100.000.000/)).toBeInTheDocument());
    expect(screen.getByText(/250.000.000/)).toBeInTheDocument();
    expect(screen.getByText(/\+150.000.000/)).toBeInTheDocument();
    expect(screen.getByText(/40%/)).toBeInTheDocument();
  });

  /**
   * CA TRỌNG TÂM: `plannedAmount === null` nghĩa là CHƯA LẬP kế hoạch, KHÔNG phải "kế hoạch 0 đồng".
   * `?? 0` ở component sẽ biến một sự thiếu vắng thành con số sai — ca này ĐỎ nếu ai đó thêm nó.
   */
  it("chưa lập kế hoạch (plannedAmount=null) ⇒ in `—`, KHÔNG in 0 ₫, và không vẽ thanh tiến độ", async () => {
    mockGetWidgetData.mockResolvedValue(
      envelope("PAYROLL_BUDGET", {
        data: {
          fiscalYear: 2026,
          plannedAmount: null,
          actualAmount: 100_000_000,
          variance: null,
          usagePct: null,
        },
      }),
    );
    renderWidget(<PayrollBudgetWidget />);
    await waitFor(() => expect(screen.getByText(/100.000.000/)).toBeInTheDocument());
    // Hai ô «Kế hoạch» + «Chênh lệch» đều `—`. KHÔNG dùng regex /0 ₫/ để bắt zero-fill: nó khớp cả
    // "100.000.000 ₫" của ô Thực hiện (bài học: matcher chuỗi con trên tiền luôn dính số khác).
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByTestId("payroll-budget-bar")).not.toBeInTheDocument();
    expect(screen.getByText(/chưa lập kế hoạch/i)).toBeInTheDocument();
  });

  it("vượt kế hoạch (usagePct > 100) ⇒ nhãn «Vượt kế hoạch», thanh KẸP ở 100% (số thật vẫn ở nhãn)", async () => {
    mockGetWidgetData.mockResolvedValue(
      envelope("PAYROLL_BUDGET", {
        data: {
          fiscalYear: 2026,
          plannedAmount: 100_000_000,
          actualAmount: 130_000_000,
          variance: -30_000_000,
          usagePct: 130,
        },
      }),
    );
    renderWidget(<PayrollBudgetWidget />);
    await waitFor(() => expect(screen.getByText(/vượt kế hoạch/i)).toBeInTheDocument());
    expect(screen.getByTestId("payroll-budget-bar").firstElementChild).toHaveStyle({
      width: "100%",
    });
    expect(screen.getByText(/−30.000.000/)).toBeInTheDocument();
  });

  it("Empty: hiện chữ của server, KHÔNG vẽ số", async () => {
    mockGetWidgetData.mockResolvedValue(
      envelope("PAYROLL_BUDGET", {
        status: "Empty",
        data: null,
        empty_state: { message: "Chưa lập ngân sách lương năm nay" },
      }),
    );
    renderWidget(<PayrollBudgetWidget />);
    await waitFor(() =>
      expect(screen.getByText(/chưa lập ngân sách lương năm nay/i)).toBeInTheDocument(),
    );
  });

  it("payload sai hình dạng ⇒ nhánh LỖI (không render số rác)", async () => {
    mockGetWidgetData.mockResolvedValue(
      envelope("PAYROLL_BUDGET", { data: { fiscalYear: "2026" } }),
    );
    renderWidget(<PayrollBudgetWidget />);
    await waitFor(() => expect(screen.getByText(/không thể tải dữ liệu/i)).toBeInTheDocument());
  });

  it("drill-down: bấm số → điều hướng /payroll/budgets", async () => {
    mockGetWidgetData.mockResolvedValue(BUDGET_DTO);
    renderWidget(<PayrollBudgetWidget />);
    await waitFor(() => expect(screen.getByText(/100.000.000/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /100.000.000/ }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/payroll/budgets" });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
describe("PayrollAdvancePendingWidget — gate PHỤ (cặp view:payroll-advance)", () => {
  it("thiếu cặp → KHÔNG render, KHÔNG fetch", () => {
    setCaps({});
    renderWidget(<PayrollAdvancePendingWidget />);
    expect(screen.queryByText(ADVANCE_TITLE)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  it("chỉ wildcard `*:*` → VẪN không render (cặp nhạy cảm)", () => {
    setCaps({ "*:*": true });
    renderWidget(<PayrollAdvancePendingWidget />);
    expect(screen.queryByText(ADVANCE_TITLE)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  it("cặp của widget ANH EM (view:payroll-budget) KHÔNG mở được", () => {
    setCaps({ "view:payroll-budget": true });
    renderWidget(<PayrollAdvancePendingWidget />);
    expect(screen.queryByText(ADVANCE_TITLE)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  /**
   * Cặp DUYỆT không phải cặp gate (SPEC-11 §10.1b — gate là cặp ĐỌC `view`). Ở BE mig 0571 §4.7 ép
   * approve ⇒ view nên người duyệt thật LUÔN có `view`; ca này ghim rằng FE không tự ý nới bằng cặp khác.
   */
  it("chỉ approve:payroll-advance → KHÔNG render (gate là cặp ĐỌC, không phải cặp DUYỆT)", () => {
    setCaps({ "approve:payroll-advance": true });
    renderWidget(<PayrollAdvancePendingWidget />);
    expect(screen.queryByText(ADVANCE_TITLE)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  it("có ĐÚNG cặp → mount + fetch + in con số", async () => {
    setCaps({ "view:payroll-advance": true });
    mockGetWidgetData.mockResolvedValue(ADVANCE_DTO);
    renderWidget(<PayrollAdvancePendingWidget />);
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith("PAYROLL_ADVANCE_PENDING", expect.anything());
    });
    // `waitFor` bọc CẢ phép đo số: lời gọi fetch xong trước, DOM của React Query render ở tick sau.
    await waitFor(() =>
      expect(screen.getByTestId("payroll-advance-pending-total")).toHaveTextContent("3"),
    );
  });
});

describe("PayrollAdvancePendingWidget — data states", () => {
  beforeEach(() => setCaps({ "view:payroll-advance": true }));

  it("Empty (0 đề nghị): chữ của server, KHÔNG in số 0 to đùng", async () => {
    mockGetWidgetData.mockResolvedValue(
      envelope("PAYROLL_ADVANCE_PENDING", {
        status: "Empty",
        data: null,
        empty_state: { message: "Không có tạm ứng chờ duyệt" },
      }),
    );
    renderWidget(<PayrollAdvancePendingWidget />);
    await waitFor(() =>
      expect(screen.getByText(/không có tạm ứng chờ duyệt/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("payroll-advance-pending-total")).not.toBeInTheDocument();
  });

  it("Degraded ⇒ nhánh LỖI", async () => {
    mockGetWidgetData.mockResolvedValue(
      envelope("PAYROLL_ADVANCE_PENDING", {
        status: "Degraded",
        data: null,
        error_state: { message: "Nguồn tạm thời không sẵn sàng" },
      }),
    );
    renderWidget(<PayrollAdvancePendingWidget />);
    await waitFor(() =>
      expect(screen.getByText(/nguồn tạm thời không sẵn sàng/i)).toBeInTheDocument(),
    );
  });

  it("drill-down: bấm → điều hướng /payroll/advances", async () => {
    mockGetWidgetData.mockResolvedValue(ADVANCE_DTO);
    renderWidget(<PayrollAdvancePendingWidget />);
    await waitFor(() =>
      expect(screen.getByTestId("payroll-advance-pending-total")).toHaveTextContent("3"),
    );
    fireEvent.click(screen.getByRole("button", { name: /3/ }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/payroll/advances" });
  });
});
