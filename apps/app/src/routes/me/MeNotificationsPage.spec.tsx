// @vitest-environment jsdom
/**
 * MeNotificationsPage tests (S5-ME-FE-3, ME-SCREEN-012). Phủ: forbidden · loading · lỗi transport summary +
 * thử lại · mọi section status của getNotificationSummary (§13) · danh sách gần đây TÁI DÙNG
 * myNotificationApi.list (own-scope, độc lập query — 1 nguồn lỗi KHÔNG phá phần còn lại §18.2) · deep-link
 * "Xem tất cả" trỏ ĐÚNG /notifications.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { MeNotificationSection, MyNotificationListItem } from "@mediaos/contracts";
import i18n from "@/i18n";
import { ME_QUICK_ACTION_PATHS } from "./constants";
import { MeNotificationsPage } from "./MeNotificationsPage";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    meApi: { getNotificationSummary: vi.fn() },
    myNotificationApi: { list: vi.fn() },
  };
});

import { meApi, myNotificationApi } from "@mediaos/web-core";
const mockGetSummary = meApi.getNotificationSummary as ReturnType<typeof vi.fn>;
const mockList = myNotificationApi.list as ReturnType<typeof vi.fn>;

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
        <MeNotificationsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const LIST_ITEM: MyNotificationListItem = {
  notification_id: "n1",
  title: "Bạn được giao task mới",
  short_content: "Task ABC cần hoàn thành trước 20/07",
  notification_type: "Task",
  priority: "Normal",
  status: "Unread",
  is_read: false,
  source_module: "TASK",
  event_code: "task.assigned",
  target_module: "TASK",
  target_type: "task",
  target_id: "t1",
  target_url: "/tasks/my-tasks",
  created_at: "2026-07-16T01:00:00.000Z",
  read_at: null,
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
  mockList.mockResolvedValue([]);
});

describe("MeNotificationsPage — gate (access:me)", () => {
  it("thiếu access:me → forbidden, KHÔNG gọi meApi.getNotificationSummary", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(mockGetSummary).not.toHaveBeenCalled();
  });
});

describe("MeNotificationsPage — data states (có access:me)", () => {
  beforeEach(() => setCaps({ "access:me": true }));

  it("loading summary → skeleton, KHÔNG hiện nội dung", () => {
    mockGetSummary.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(/thông báo của tôi/i)).not.toBeInTheDocument();
  });

  it("lỗi transport summary → error + thử lại gọi lại API", async () => {
    mockGetSummary.mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không tải được thông báo/i)).toBeInTheDocument();
    });
    mockGetSummary.mockClear();
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: {
        unreadCount: 3,
        highPriorityUnreadCount: 1,
        urgentUnreadCount: 0,
        lastNotificationAt: null,
      },
    } satisfies MeNotificationSection);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetSummary).toHaveBeenCalled());
  });

  it("section status='ok' → render unread count + danh sách gần đây + deep-link Xem tất cả", async () => {
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: {
        unreadCount: 3,
        highPriorityUnreadCount: 1,
        urgentUnreadCount: 0,
        lastNotificationAt: null,
      },
    } satisfies MeNotificationSection);
    mockList.mockResolvedValue([LIST_ITEM]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/3 chưa đọc/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Bạn được giao task mới")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Xem tất cả thông báo"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: ME_QUICK_ACTION_PATHS.NOTIFICATIONS });
    expect(mockGetSummary).toHaveBeenCalledTimes(1);
  });

  it("danh sách gần đây rỗng → hiện emptyTitle riêng (KHÔNG phá card summary)", async () => {
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: {
        unreadCount: 0,
        highPriorityUnreadCount: 0,
        urgentUnreadCount: 0,
        lastNotificationAt: null,
      },
    } satisfies MeNotificationSection);
    mockList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không có thông báo nào/i)).toBeInTheDocument();
    });
  });

  it("danh sách gần đây lỗi → hiện lỗi RIÊNG khối đó, summary vẫn render (§18.2)", async () => {
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: {
        unreadCount: 3,
        highPriorityUnreadCount: 1,
        urgentUnreadCount: 0,
        lastNotificationAt: null,
      },
    } satisfies MeNotificationSection);
    mockList.mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/3 chưa đọc/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/không tải được danh sách gần đây/i)).toBeInTheDocument();
    });
  });

  it("section status='forbidden' → hiện thông điệp thiếu quyền mục", async () => {
    mockGetSummary.mockResolvedValue({
      status: "forbidden",
      data: null,
    } satisfies MeNotificationSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không có quyền xem mục này/i)).toBeInTheDocument();
    });
  });

  it("section status='module_disabled' → hiện thông điệp module chưa bật", async () => {
    mockGetSummary.mockResolvedValue({
      status: "module_disabled",
      data: null,
    } satisfies MeNotificationSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/chưa được bật/i)).toBeInTheDocument();
    });
  });

  it("section status='error' (degraded) → hiện lỗi mục + nút thử lại", async () => {
    mockGetSummary.mockResolvedValue({
      status: "error",
      data: null,
    } satisfies MeNotificationSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không tải được dữ liệu/i)).toBeInTheDocument();
    });
    mockGetSummary.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetSummary).toHaveBeenCalled());
  });
});
