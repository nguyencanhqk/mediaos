// @vitest-environment jsdom
/**
 * NotificationsWidget tests (S4-FE-DASH-1, DASH-WIDGET-007). Phủ: deny-path (thiếu read:notification) ·
 * empty · success (unread summary + danh sách + deep-link target_url an toàn).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { NotificationsWidget } from "./NotificationsWidget";

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
        <NotificationsWidget />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("NotificationsWidget — gate (read:notification)", () => {
  it("thiếu read:notification → KHÔNG render, KHÔNG fetch", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(/thông báo mới/i)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });
});

describe("NotificationsWidget — data states (có read:notification)", () => {
  beforeEach(() => setCaps({ "read:notification": true }));

  it("status Empty → 'Bạn không có thông báo mới'", async () => {
    mockGetWidgetData.mockResolvedValue({
      widget_code: "NOTIFICATIONS",
      widget_type: "List",
      status: "Empty",
      data: null,
      empty_state: { message: "Bạn không có thông báo mới" },
      error_state: null,
      last_updated_at: null,
      cache: null,
      quick_actions: [],
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Bạn không có thông báo mới")).toBeInTheDocument();
    });
  });

  it("status Active → unread summary + render danh sách + deep-link target_url an toàn + footer 'Cập nhật lúc' (cache hit)", async () => {
    mockGetWidgetData.mockResolvedValue({
      widget_code: "NOTIFICATIONS",
      widget_type: "List",
      status: "Active",
      data: {
        items: [
          {
            id: "n-1",
            title: "Task sắp đến hạn",
            shortContent: "Task TASK-1 sắp đến hạn",
            priority: "Normal",
            status: "Unread",
            isRead: false,
            targetUrl: "/tasks/task-1",
            createdAt: "2026-07-11T07:00:00.000Z",
          },
        ],
        summary: { total: 1, unread: 1 },
      },
      empty_state: null,
      error_state: null,
      last_updated_at: "2026-07-11T08:00:00.000Z",
      cache: { hit: true, ttl_seconds: 60, expires_at: "2026-07-11T08:01:00.000Z" },
      quick_actions: [],
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Task sắp đến hạn")).toBeInTheDocument();
    });
    expect(screen.getByText("1/1 chưa đọc")).toBeInTheDocument();
    // NotificationTargetLink render <button> khi target_url an toàn (nội bộ, bắt đầu "/").
    expect(screen.getByRole("button", { name: /task sắp đến hạn/i })).toBeInTheDocument();
    expect(screen.getByText(/Cập nhật lúc/i)).toBeInTheDocument();
  });

  it("status server Degraded → error state (§16.7, KHÔNG render danh sách thông báo)", async () => {
    mockGetWidgetData.mockResolvedValue({
      widget_code: "NOTIFICATIONS",
      widget_type: "List",
      status: "Degraded",
      data: null,
      empty_state: null,
      error_state: {
        code: "DASH-ERR-WIDGET-DEGRADED",
        message: "Dữ liệu tạm thời không đầy đủ",
        source_module: "NOTI",
        retryable: true,
      },
      last_updated_at: null,
      cache: null,
      quick_actions: [],
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
    expect(screen.queryByText(/chưa đọc/i)).not.toBeInTheDocument();
  });

  it("status server Error (module nguồn lỗi) → error state, KHÔNG lộ stack trace", async () => {
    mockGetWidgetData.mockResolvedValue({
      widget_code: "NOTIFICATIONS",
      widget_type: "List",
      status: "Error",
      data: null,
      empty_state: null,
      error_state: {
        code: "DASH-ERR-WIDGET-SOURCE",
        message: "Không thể tải dữ liệu từ module Thông báo",
        source_module: "NOTI",
        retryable: true,
      },
      last_updated_at: null,
      cache: null,
      quick_actions: [],
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Không thể tải dữ liệu từ module Thông báo")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
  });
});
