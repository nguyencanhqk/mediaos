// @vitest-environment jsdom
/**
 * NotificationEventsPage tests (S4-FE-NOTI-2, UI-NOTI-SCREEN-004 / SPEC-08 §13.4 NOTI-SCREEN-005).
 * Phủ: [deny-path] useCanExact(view)=false → forbidden + listEvents KHÔNG gọi · render danh mục ·
 * gate toggle (update:notification-config thiếu → ẨN nút) · toggle + confirm → updateEvent đúng payload ·
 * error/empty state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { NotificationEventAdminItem } from "@mediaos/contracts";
import i18n from "@/i18n";

// S4-FE-NOTI-4 — trang có nút "Xem template" điều hướng qua useNavigate (mirror
// NotificationTargetLink.spec.tsx) — mock TOÀN BỘ @tanstack/react-router (page KHÔNG mount trong
// RouterProvider ở test này) để tránh useNavigate() throw ngoài Router context.
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCanExact: vi.fn(),
    notificationAdminApi: {
      listEvents: vi.fn(),
      updateEvent: vi.fn(),
    },
    notificationKeys: {
      ...actual.notificationKeys,
      events: (p?: unknown) => ["notifications", "admin-events", p],
    },
  };
});

import { useCanExact, notificationAdminApi } from "@mediaos/web-core";
import { NotificationEventsPage } from "./NotificationEventsPage";

const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockListEvents = notificationAdminApi.listEvents as ReturnType<typeof vi.fn>;
const mockUpdateEvent = notificationAdminApi.updateEvent as ReturnType<typeof vi.fn>;

const EVENT: NotificationEventAdminItem = {
  id: "evt-1",
  company_id: null,
  is_company_override: false,
  module_code: "TASK",
  event_code: "TASK_ASSIGNED",
  event_name: "Giao việc",
  description: "Thông báo khi giao việc mới",
  notification_type: "Task",
  default_priority: "Normal",
  default_channels: ["IN_APP"],
  dedupe_strategy: "None",
  dedupe_window_seconds: null,
  is_enabled: true,
  is_system_event: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={buildQC()}>
      <I18nextProvider i18n={i18n}>
        <NotificationEventsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/** canView khớp action 'view'; canUpdate khớp action 'update' — cả 2 CÙNG resourceType 'notification-config'. */
function mockCan(canView: boolean, canUpdate: boolean) {
  mockUseCanExact.mockImplementation((action: string) =>
    action === "view" ? canView : action === "update" ? canUpdate : false,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NotificationEventsPage — gate", () => {
  it("[deny-path] useCanExact('view','notification-config')=false → forbidden EmptyState, KHÔNG gọi listEvents", () => {
    mockCan(false, false);
    renderPage();

    expect(screen.getByText("Không có quyền xem cấu hình thông báo")).toBeInTheDocument();
    expect(mockListEvents).not.toHaveBeenCalled();
  });

  it("canView=true, canUpdate=false → render danh sách nhưng ẨN nút Bật/Tắt", async () => {
    mockCan(true, false);
    mockListEvents.mockResolvedValue([EVENT]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Giao việc")).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`event-toggle-${EVENT.id}`)).not.toBeInTheDocument();
  });
});

describe("NotificationEventsPage — data states", () => {
  it("empty → EmptyState danh mục trống", async () => {
    mockCan(true, true);
    mockListEvents.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Chưa có sự kiện thông báo nào")).toBeInTheDocument();
    });
  });

  it("lỗi fetch → error EmptyState + nút thử lại", async () => {
    mockCan(true, true);
    mockListEvents.mockRejectedValue(new Error("network"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Không thể tải danh mục sự kiện")).toBeInTheDocument();
    });
  });

  it("render danh mục + gọi listEvents với per_page tối đa (catalog nhỏ, 1 lần)", async () => {
    mockCan(true, true);
    mockListEvents.mockResolvedValue([EVENT]);
    renderPage();

    expect(mockListEvents).toHaveBeenCalledWith({ per_page: 100 });
    await waitFor(() => {
      expect(screen.getByText("TASK_ASSIGNED")).toBeInTheDocument();
    });
  });
});

describe("NotificationEventsPage — toggle + confirm", () => {
  it("click Tắt → mở ConfirmDialog → xác nhận gọi updateEvent(id, { is_enabled:false })", async () => {
    mockCan(true, true);
    mockListEvents.mockResolvedValue([EVENT]);
    mockUpdateEvent.mockResolvedValue({ ...EVENT, is_enabled: false });
    renderPage();

    const toggleBtn = await screen.findByTestId(`event-toggle-${EVENT.id}`);
    expect(toggleBtn).toHaveTextContent("Tắt");
    fireEvent.click(toggleBtn);

    // ConfirmDialog xuất hiện TRƯỚC khi gọi API (chưa mutate ngay khi click nút bảng).
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(mockUpdateEvent).not.toHaveBeenCalled();

    // Scope vào dialog — nút bảng CŨNG có nhãn "Tắt", tránh khớp nhầm.
    const confirmBtn = within(dialog).getByRole("button", { name: "Tắt" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockUpdateEvent).toHaveBeenCalledWith(EVENT.id, { is_enabled: false });
    });
  });

  it("huỷ confirm → KHÔNG gọi updateEvent, đóng dialog", async () => {
    mockCan(true, true);
    mockListEvents.mockResolvedValue([EVENT]);
    renderPage();

    const toggleBtn = await screen.findByTestId(`event-toggle-${EVENT.id}`);
    fireEvent.click(toggleBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// S4-FE-NOTI-4 — nút "Xem template" điều hướng → /notifications/templates?event=<event_code>
// (SPEC-08 §13.4). Nút LUÔN hiện (KHÔNG gate — chỉ là link, route đích tự chặn quyền).
// ---------------------------------------------------------------------------

describe("NotificationEventsPage — link 'xem template'", () => {
  it("click 'Xem template' → navigate({to: '/notifications/templates', search: {event: event_code}})", async () => {
    mockCan(true, false);
    mockListEvents.mockResolvedValue([EVENT]);
    renderPage();

    const link = await screen.findByTestId(`event-view-template-${EVENT.id}`);
    fireEvent.click(link);

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/notifications/templates",
        search: { event: EVENT.event_code },
      }),
    );
  });
});
