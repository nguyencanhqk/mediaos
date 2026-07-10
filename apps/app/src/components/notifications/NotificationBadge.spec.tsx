// @vitest-environment jsdom
/**
 * NotificationBadge tests (S4-FE-NOTI-1). Phủ: deny-path (useCan false → ẩn HOÀN TOÀN, KHÔNG fetch) ·
 * hiện số unread từ GET /notifications/unread-count (KHÔNG gọi list()) · lỗi fetch → count=0 (KHÔNG vỡ
 * topbar) · click mở dropdown.
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
  useCan: vi.fn(),
  myNotificationApi: {
    unreadCount: vi.fn(),
    dropdown: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
  notificationKeys: {
    unreadCount: () => ["notifications", "unread-count"],
    dropdown: (p?: unknown) => ["notifications", "dropdown", p],
  },
  notificationInvalidation: {
    markRead: (id: string) => [["notifications", "detail", id]],
    markAllRead: () => [["notifications", "list"]],
  },
}));

import { useCan, myNotificationApi } from "@mediaos/web-core";
import { NotificationBadge } from "./NotificationBadge";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockUnreadCount = myNotificationApi.unreadCount as ReturnType<typeof vi.fn>;
const mockDropdown = myNotificationApi.dropdown as ReturnType<typeof vi.fn>;

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderBadge() {
  const qc = buildQC();
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <NotificationBadge />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
  mockUnreadCount.mockResolvedValue({
    unread_count: 0,
    high_priority_unread_count: 0,
    urgent_unread_count: 0,
    last_notification_at: null,
  });
  mockDropdown.mockResolvedValue({ unread_count: 0, items: [] });
});

describe("NotificationBadge — gate (deny-path)", () => {
  it("useCan(read, notification) = false → KHÔNG render gì, KHÔNG gọi unreadCount()", () => {
    mockUseCan.mockReturnValue(false);
    const { container } = renderBadge();
    expect(container.firstChild).toBeNull();
    expect(mockUnreadCount).not.toHaveBeenCalled();
  });
});

describe("NotificationBadge — count", () => {
  it("hiện số unread_count từ GET /notifications/unread-count", async () => {
    mockUnreadCount.mockResolvedValue({
      unread_count: 3,
      high_priority_unread_count: 0,
      urgent_unread_count: 0,
      last_notification_at: null,
    });
    renderBadge();
    await waitFor(() => {
      expect(screen.getByText("3")).toBeTruthy();
    });
  });

  it("count=0 → KHÔNG hiện badge số (chỉ hiện chuông)", async () => {
    renderBadge();
    await waitFor(() => {
      expect(mockUnreadCount).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("0")).toBeNull();
  });

  it("lỗi fetch unread-count → count=0, KHÔNG throw / KHÔNG vỡ topbar", async () => {
    mockUnreadCount.mockRejectedValue(new Error("network"));
    renderBadge();
    await waitFor(() => {
      expect(mockUnreadCount).toHaveBeenCalled();
    });
    expect(screen.getByLabelText(/thông báo/i)).toBeTruthy();
  });

  it("99+ khi unread_count > 99", async () => {
    mockUnreadCount.mockResolvedValue({
      unread_count: 150,
      high_priority_unread_count: 0,
      urgent_unread_count: 0,
      last_notification_at: null,
    });
    renderBadge();
    await waitFor(() => {
      expect(screen.getByText("99+")).toBeTruthy();
    });
  });
});

describe("NotificationBadge — dropdown toggle", () => {
  it("click chuông → mở dropdown, gọi dropdown() (KHÔNG list())", async () => {
    renderBadge();
    const bell = screen.getByLabelText(/thông báo/i);
    fireEvent.click(bell);
    await waitFor(() => {
      expect(mockDropdown).toHaveBeenCalledTimes(1);
    });
  });
});
