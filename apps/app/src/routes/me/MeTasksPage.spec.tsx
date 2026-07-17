// @vitest-environment jsdom
/**
 * MeTasksPage tests (S5-ME-FE-3, ME-SCREEN-011). Phủ: forbidden · loading · lỗi transport + thử lại ·
 * mọi section status (§13) · counts assigned/dueToday/overdue KHÔNG tự tính lại · deep-link CHỈ trỏ
 * ME_QUICK_ACTION_PATHS.MY_TASKS (§7.5 — KHÔNG gọi endpoint bảng TASK nguồn nào khác, KHÔNG thay trang
 * My Tasks).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { MeTaskSection } from "@mediaos/contracts";
import i18n from "@/i18n";
import { ME_QUICK_ACTION_PATHS } from "./constants";
import { MeTasksPage } from "./MeTasksPage";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, meApi: { getTaskSummary: vi.fn() } };
});

import { meApi } from "@mediaos/web-core";
const mockGetSummary = meApi.getTaskSummary as ReturnType<typeof vi.fn>;

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
        <MeTasksPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("MeTasksPage — gate (access:me)", () => {
  it("thiếu access:me → forbidden, KHÔNG gọi meApi.getTaskSummary", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(mockGetSummary).not.toHaveBeenCalled();
  });
});

describe("MeTasksPage — data states (có access:me)", () => {
  beforeEach(() => setCaps({ "access:me": true }));

  it("loading → skeleton, KHÔNG hiện nội dung", () => {
    mockGetSummary.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(/được giao/i)).not.toBeInTheDocument();
  });

  it("lỗi transport → error + thử lại gọi lại API", async () => {
    mockGetSummary.mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không tải được dữ liệu công việc/i)).toBeInTheDocument();
    });
    mockGetSummary.mockClear();
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: { assignedCount: 5, dueTodayCount: 2, overdueCount: 1 },
    } satisfies MeTaskSection);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetSummary).toHaveBeenCalled());
  });

  it("section status='ok' → render counts + deep-link đúng path", async () => {
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: { assignedCount: 5, dueTodayCount: 2, overdueCount: 1 },
    } satisfies MeTaskSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/5 được giao/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/2 đến hạn hôm nay/i)).toBeInTheDocument();
    expect(screen.getByText(/1 quá hạn/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Task của tôi"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: ME_QUICK_ACTION_PATHS.MY_TASKS });
    expect(mockGetSummary).toHaveBeenCalledTimes(1);
  });

  it("section status='ok' + counts=0 → hiện emptyTitle", async () => {
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: { assignedCount: 0, dueTodayCount: 0, overdueCount: 0 },
    } satisfies MeTaskSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/bạn chưa có công việc nào/i)).toBeInTheDocument();
    });
  });

  it("section status='forbidden' → hiện thông điệp thiếu quyền mục", async () => {
    mockGetSummary.mockResolvedValue({ status: "forbidden", data: null } satisfies MeTaskSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không có quyền xem mục này/i)).toBeInTheDocument();
    });
  });

  it("section status='module_disabled' → hiện thông điệp module chưa bật", async () => {
    mockGetSummary.mockResolvedValue({
      status: "module_disabled",
      data: null,
    } satisfies MeTaskSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/chưa được bật/i)).toBeInTheDocument();
    });
  });

  it("section status='unlinked_employee' → hiện thông điệp cần liên kết hồ sơ", async () => {
    mockGetSummary.mockResolvedValue({
      status: "unlinked_employee",
      data: null,
    } satisfies MeTaskSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/cần liên kết hồ sơ nhân viên/i)).toBeInTheDocument();
    });
  });

  it("section status='error' (degraded) → hiện lỗi mục + nút thử lại", async () => {
    mockGetSummary.mockResolvedValue({ status: "error", data: null } satisfies MeTaskSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không tải được dữ liệu/i)).toBeInTheDocument();
    });
    mockGetSummary.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetSummary).toHaveBeenCalled());
  });
});
