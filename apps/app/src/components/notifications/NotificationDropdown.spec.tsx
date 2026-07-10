// @vitest-environment jsdom
/**
 * NotificationDropdown tests (S4-FE-NOTI-1, NOTI-API-002). Phủ: loading/error/empty ("Bạn chưa có thông
 * báo mới") · render N dòng latest từ GET /notifications/dropdown (KHÔNG list()) · click dòng → mark-read
 * (nếu unread) + onNavigate() · "Xem tất cả" → onNavigate().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => true),
  myNotificationApi: {
    dropdown: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
  notificationKeys: {
    dropdown: (p?: unknown) => ["notifications", "dropdown", p],
  },
  notificationInvalidation: {
    markRead: (id: string) => [
      ["notifications", "list"],
      ["notifications", "detail", id],
    ],
    markAllRead: () => [["notifications", "list"]],
  },
}));

import { myNotificationApi } from "@mediaos/web-core";
import { NotificationDropdown } from "./NotificationDropdown";

const mockDropdown = myNotificationApi.dropdown as ReturnType<typeof vi.fn>;
const mockMarkRead = myNotificationApi.markRead as ReturnType<typeof vi.fn>;

function renderDropdown(onNavigate = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onNavigate,
    ...render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <NotificationDropdown onNavigate={onNavigate} />
        </I18nextProvider>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkRead.mockResolvedValue({ notification_id: "n1", status: "Read", read_at: "now" });
});

describe("NotificationDropdown — states", () => {
  it("empty → 'Bạn chưa có thông báo mới'", async () => {
    mockDropdown.mockResolvedValue({ unread_count: 0, items: [] });
    renderDropdown();
    await waitFor(() => {
      expect(screen.getByText("Bạn chưa có thông báo mới")).toBeTruthy();
    });
  });

  it("lỗi fetch → thông điệp lỗi (KHÔNG throw)", async () => {
    mockDropdown.mockRejectedValue(new Error("network"));
    renderDropdown();
    await waitFor(() => {
      expect(screen.getByText(/không thể tải thông báo/i)).toBeTruthy();
    });
  });

  it("render latest N item từ dropdown() (KHÔNG gọi list())", async () => {
    mockDropdown.mockResolvedValue({
      unread_count: 1,
      items: [
        {
          notification_id: "n1",
          title: "Bạn có task mới",
          short_content: "Bạn được giao TASK-1",
          notification_type: "Task",
          priority: "Normal",
          status: "Unread",
          is_read: false,
          target_url: "/tasks/task-1",
          created_at: "2026-07-01T09:00:00.000Z",
        },
      ],
    });
    renderDropdown();
    await waitFor(() => {
      expect(screen.getByText("Bạn có task mới")).toBeTruthy();
    });
  });
});

describe("NotificationDropdown — click hành vi", () => {
  const UNREAD_ITEM = {
    unread_count: 1,
    items: [
      {
        notification_id: "n1",
        title: "Bạn có task mới",
        short_content: "Bạn được giao TASK-1",
        notification_type: "Task",
        priority: "Normal",
        status: "Unread",
        is_read: false,
        target_url: "/tasks/task-1",
        created_at: "2026-07-01T09:00:00.000Z",
      },
    ],
  };

  it("click dòng chưa đọc có target_url an toàn → mark-read + onNavigate()", async () => {
    mockDropdown.mockResolvedValue(UNREAD_ITEM);
    const { onNavigate } = renderDropdown();
    const row = await screen.findByText("Bạn có task mới");
    fireEvent.click(row.closest("button") as HTMLElement);
    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith("n1");
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("bấm 'Xem tất cả' → onNavigate()", async () => {
    mockDropdown.mockResolvedValue({ unread_count: 0, items: [] });
    const { onNavigate } = renderDropdown();
    const viewAll = await screen.findByText(/xem tất cả/i);
    fireEvent.click(viewAll);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
