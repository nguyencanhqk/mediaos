// @vitest-environment jsdom
/**
 * MeLeavePage tests (S5-ME-FE-3, ME-SCREEN-010). Phủ: forbidden · loading · lỗi transport + thử lại ·
 * mọi section status (§13) · bảng rút gọn số dư phép KHÔNG tự tính lại (§7.4, chỉ render field server trả)
 * · deep-link CHỈ trỏ ME_QUICK_ACTION_PATHS.MY_LEAVE_REQUESTS, KHÔNG gọi endpoint bảng LEAVE nguồn nào khác.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { MeLeaveSection } from "@mediaos/contracts";
import i18n from "@/i18n";
import { ME_QUICK_ACTION_PATHS } from "./constants";
import { MeLeavePage } from "./MeLeavePage";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, meApi: { getLeaveSummary: vi.fn() } };
});

import { meApi } from "@mediaos/web-core";
const mockGetSummary = meApi.getLeaveSummary as ReturnType<typeof vi.fn>;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "t@demo.local",
      fullName: "Trần Văn Test",
      status: "Active",
      companyId: "co1",
    },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MeLeavePage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("MeLeavePage — gate (access:me)", () => {
  it("thiếu access:me → forbidden, KHÔNG gọi meApi.getLeaveSummary", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(mockGetSummary).not.toHaveBeenCalled();
  });
});

describe("MeLeavePage — data states (có access:me)", () => {
  beforeEach(() => setCaps({ "access:me": true }));

  it("loading → skeleton, KHÔNG hiện nội dung", () => {
    mockGetSummary.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(/nghỉ phép của tôi/i)).not.toBeInTheDocument();
  });

  it("lỗi transport → error + thử lại gọi lại API", async () => {
    mockGetSummary.mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không tải được dữ liệu nghỉ phép/i)).toBeInTheDocument();
    });
    mockGetSummary.mockClear();
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: {
        balances: [
          { leaveTypeCode: "ANNUAL", leaveTypeName: "Phép năm", remainingDays: 8, unit: "ngày" },
        ],
        pendingRequestCount: 1,
      },
    } satisfies MeLeaveSection);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetSummary).toHaveBeenCalled());
  });

  it("section status='ok' → render bảng số dư (KHÔNG tự tính lại) + deep-link đúng path", async () => {
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: {
        balances: [
          { leaveTypeCode: "ANNUAL", leaveTypeName: "Phép năm", remainingDays: 8, unit: "ngày" },
          { leaveTypeCode: "SICK", leaveTypeName: "Phép ốm", remainingDays: 3, unit: "ngày" },
        ],
        pendingRequestCount: 2,
      },
    } satisfies MeLeaveSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Phép năm")).toBeInTheDocument();
    });
    expect(screen.getByText("Phép ốm")).toBeInTheDocument();
    expect(screen.getByText(/8 ngày/)).toBeInTheDocument();
    expect(screen.getByText(/2 đơn đang chờ duyệt/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Đơn nghỉ của tôi"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: ME_QUICK_ACTION_PATHS.MY_LEAVE_REQUESTS });
    expect(mockGetSummary).toHaveBeenCalledTimes(1);
  });

  it("section status='ok' + balances rỗng → hiện emptyTitle", async () => {
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: { balances: [], pendingRequestCount: 0 },
    } satisfies MeLeaveSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/chưa có số dư phép/i)).toBeInTheDocument();
    });
  });

  it("section status='forbidden' → hiện thông điệp thiếu quyền mục", async () => {
    mockGetSummary.mockResolvedValue({ status: "forbidden", data: null } satisfies MeLeaveSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không có quyền xem mục này/i)).toBeInTheDocument();
    });
  });

  it("section status='module_disabled' → hiện thông điệp module chưa bật", async () => {
    mockGetSummary.mockResolvedValue({
      status: "module_disabled",
      data: null,
    } satisfies MeLeaveSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/chưa được bật/i)).toBeInTheDocument();
    });
  });

  it("section status='unlinked_employee' → hiện thông điệp cần liên kết hồ sơ", async () => {
    mockGetSummary.mockResolvedValue({
      status: "unlinked_employee",
      data: null,
    } satisfies MeLeaveSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/cần liên kết hồ sơ nhân viên/i)).toBeInTheDocument();
    });
  });

  it("section status='error' (degraded) → hiện lỗi mục + nút thử lại", async () => {
    mockGetSummary.mockResolvedValue({ status: "error", data: null } satisfies MeLeaveSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không tải được dữ liệu/i)).toBeInTheDocument();
    });
    mockGetSummary.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetSummary).toHaveBeenCalled());
  });
});
