// @vitest-environment jsdom
/**
 * notifications-router-flow — S4-FE-NOTI-1-WIRE (vòng sửa). Đội 3 FAIL vòng trước vì /notifications
 * vẫn render ModulePlaceholder + GlobalTopbar vẫn dùng <a href> tĩnh — KHÔNG cách nào chứng minh flow
 * chạy được trong app thật. Spec này đi qua SINGLETON `router` xuất từ "@/router" (route tree PRODUCTION,
 * KHÔNG dựng lại router con) + RouterProvider thật — mọi chân đều chạy qua beforeLoad/ProtectedRoute thật
 * của route đích (KHÔNG bypass guard). Chỉ mock `myNotificationApi` (network); useCan/auth store/
 * evaluateRouteAccess dùng THẬT — quyền dùng CẶP ENGINE SEED THẬT (mig 0481/0483), KHÔNG hard-code role.
 *
 * Chân phủ:
 *  list→detail  click 1 dòng ở NotificationListPage (route /notifications, ĐÃ wire — không còn
 *               ModulePlaceholder) → điều hướng /notifications/$id (route MỚI) → NotificationDetailPage
 *               gọi detail(id, {auto_mark_read:true})
 *  dropdown     click chuông (NotificationBadge THẬT, mount trong GlobalTopbar THẬT — không còn <a> tĩnh)
 *               → mở dropdown → click 1 dòng chưa đọc → mark-read TRƯỚC khi điều hướng → tới target_url
 *               (/tasks/my-tasks) — route đích TỰ chạy beforeLoad/ProtectedRoute lại (module gốc kiểm
 *               quyền lại, KHÔNG bỏ guard)
 *  fallback     lỗi fetch unread-count + danh sách rỗng → topbar KHÔNG vỡ (chuông/avatar vẫn còn),
 *               EmptyState hiện đúng chỗ (không throw/trắng trang)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { I18nextProvider } from "react-i18next";
import { useAuthStore, myNotificationApi } from "@mediaos/web-core";
import type {
  MyNotificationListItem,
  MyNotificationDetail,
  MyNotificationDropdownItem,
  MyNotificationUnreadCountResponse,
  MyNotificationMarkReadResponse,
} from "@mediaos/contracts";
import i18n from "@/i18n";
import { router } from "@/router";

// Giữ store/useCan/evaluateRouteAccess/ROUTE_REGISTRY THẬT từ web-core; CHỈ stub bề mặt myNotificationApi
// (network) — mirror pattern test/leave-flow-smoke.spec.tsx. taskCoreApi.getMyTasks CŨNG stub (network) vì
// target_url điều hướng tới /tasks/my-tasks — route đích nay là MyTasksPage THẬT (S4-FE-TASK-2, không còn
// ModulePlaceholder) nên tự fetch GET /tasks/my khi mount; KHÔNG mock sẽ gọi network thật trong jsdom.
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    myNotificationApi: {
      list: vi.fn(),
      dropdown: vi.fn(),
      unreadCount: vi.fn(),
      detail: vi.fn(),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
      remove: vi.fn(),
    },
    taskCoreApi: {
      getMyTasks: vi.fn().mockResolvedValue([]),
    },
  };
});

function login(capabilities: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities,
    user: {
      id: "u1",
      email: "user@demo.local",
      fullName: "Người dùng",
      status: "Active",
      companyId: "co-1",
    },
    username: "user@demo.local",
    accessToken: "a",
    refreshToken: null,
  });
}

// Cặp engine THẬT (mig 0481/0483, NOTI_ENGINE_PAIRS trong constants.ts) — key store.capabilities.
const NOTI_CAPS: Record<string, boolean> = {
  "read:notification": true,
  "mark_read:notification": true,
  "mark_all_read:notification": true,
  "delete:notification": true,
};

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const LIST_ITEM: MyNotificationListItem = {
  notification_id: "n1",
  title: "Đơn nghỉ phép đã duyệt",
  short_content: "Đơn nghỉ phép của bạn đã được duyệt",
  notification_type: "leave_approved",
  priority: "Normal",
  status: "Unread",
  is_read: false,
  source_module: "LEAVE",
  event_code: "LEAVE-EVT-01",
  target_module: "LEAVE",
  target_type: "leave_request",
  target_id: "11111111-1111-1111-1111-111111111111",
  target_url: "/leave/me/requests/11111111-1111-1111-1111-111111111111",
  created_at: "2026-07-01T02:00:00.000Z",
  read_at: null,
};

const DETAIL: MyNotificationDetail = {
  notification_id: "n1",
  title: LIST_ITEM.title,
  content: "Nội dung chi tiết: đơn nghỉ phép đã được quản lý duyệt.",
  short_content: LIST_ITEM.short_content,
  notification_type: "leave_approved",
  priority: "Normal",
  status: "Read",
  is_read: true,
  source_module: "LEAVE",
  event_code: "LEAVE-EVT-01",
  target: {
    target_module: "LEAVE",
    target_type: "leave_request",
    target_id: LIST_ITEM.target_id,
    target_url: null,
  },
  payload: null,
  created_at: LIST_ITEM.created_at,
  read_at: "2026-07-01T03:00:00.000Z",
};

const UNREAD_COUNT_OK: MyNotificationUnreadCountResponse = {
  unread_count: 1,
  high_priority_unread_count: 0,
  urgent_unread_count: 0,
  last_notification_at: LIST_ITEM.created_at,
};

const DROPDOWN_ITEM: MyNotificationDropdownItem = {
  notification_id: "n2",
  title: "Có công việc mới giao cho bạn",
  short_content: "Bạn được giao 1 công việc mới",
  notification_type: "task_assigned",
  priority: "High",
  status: "Unread",
  is_read: false,
  target_url: "/tasks/my-tasks",
  created_at: "2026-07-09T01:00:00.000Z",
};

const MARK_READ_RESPONSE: MyNotificationMarkReadResponse = {
  notification_id: "n2",
  status: "Read",
  read_at: "2026-07-10T00:00:00.000Z",
};

describe("NOTI router-wire flow (S4-FE-NOTI-1-WIRE) — qua router THẬT + GlobalTopbar THẬT", () => {
  beforeEach(async () => {
    useAuthStore.getState().logout();
    vi.clearAllMocks();
    vi.mocked(myNotificationApi.dropdown).mockResolvedValue({ unread_count: 0, items: [] });
    vi.mocked(myNotificationApi.unreadCount).mockResolvedValue(UNREAD_COUNT_OK);
    vi.mocked(myNotificationApi.list).mockResolvedValue([]);
  });

  it("route /notifications render NotificationListPage THẬT (KHÔNG còn ModulePlaceholder) — click 1 dòng → điều hướng /notifications/$id → detail(auto_mark_read=true)", async () => {
    login(NOTI_CAPS);
    vi.mocked(myNotificationApi.list).mockResolvedValue([LIST_ITEM]);
    vi.mocked(myNotificationApi.detail).mockResolvedValue(DETAIL);

    await router.navigate({ to: "/notifications" as "/" });
    const view = renderApp();

    // KHÔNG còn placeholder "đang xây dựng" — route đã wire NotificationListPage thật.
    await waitFor(() => expect(screen.getByText(LIST_ITEM.title)).toBeInTheDocument());
    expect(screen.queryByText(/đang xây dựng/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(LIST_ITEM.title));

    await waitFor(() => expect(router.state.location.pathname).toBe("/notifications/n1"));
    await waitFor(() =>
      expect(myNotificationApi.detail).toHaveBeenCalledWith("n1", { auto_mark_read: true }),
    );
    await waitFor(() => expect(screen.getByText(DETAIL.content)).toBeInTheDocument());

    view.unmount();
  });

  it("chuông header là NotificationBadge THẬT (KHÔNG còn <a> tĩnh) — mở dropdown → click chưa đọc → mark-read TRƯỚC → điều hướng target_url, module gốc /tasks/my-tasks tự kiểm quyền lại", async () => {
    login({ ...NOTI_CAPS, "read:task": true });
    vi.mocked(myNotificationApi.dropdown).mockResolvedValue({
      unread_count: 1,
      items: [DROPDOWN_ITEM],
    });
    vi.mocked(myNotificationApi.markRead).mockResolvedValue(MARK_READ_RESPONSE);

    await router.navigate({ to: "/notifications" as "/" });
    const view = renderApp();

    // Exact match — "Thông báo — nội dung chính" (main content region) cũng khớp regex /thông báo/i,
    // nên dùng chuỗi exact của chuông (t("badge.ariaLabel")).
    const bell = await screen.findByLabelText("Thông báo");
    fireEvent.click(bell);

    await waitFor(() => expect(screen.getByText(DROPDOWN_ITEM.title)).toBeInTheDocument());
    fireEvent.click(screen.getByText(DROPDOWN_ITEM.title));

    await waitFor(() => expect(myNotificationApi.markRead).toHaveBeenCalledWith("n2"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/tasks/my-tasks"));
    // Route đích (module TASK, khác NOTI) TỰ chạy beforeLoad/ProtectedRoute lại — không bypass guard.
    // KHÔNG còn placeholder "đang xây dựng" — S4-FE-TASK-2 đã wire MyTasksPage thật (getMyTasks mock ở
    // trên). Dùng role "heading" (PageHeader <h1>) — sidebar cũng có link cùng text "Việc của tôi".
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /việc của tôi/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/đang xây dựng/i)).not.toBeInTheDocument();

    view.unmount();
  });

  it("lỗi fetch unread-count + danh sách rỗng → topbar KHÔNG vỡ (chuông + menu tài khoản vẫn còn), EmptyState hiện đúng chỗ", async () => {
    login(NOTI_CAPS);
    vi.mocked(myNotificationApi.unreadCount).mockRejectedValue(new Error("network"));
    vi.mocked(myNotificationApi.list).mockResolvedValue([]);

    await router.navigate({ to: "/notifications" as "/" });
    const view = renderApp();

    await waitFor(() => expect(myNotificationApi.unreadCount).toHaveBeenCalled());
    // Topbar nguyên vẹn dù badge lỗi — không crash, không màn trắng.
    expect(screen.getByLabelText("Thông báo")).toBeInTheDocument();
    expect(screen.getByLabelText("Menu tài khoản")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Bạn chưa có thông báo mới")).toBeInTheDocument());

    view.unmount();
  });
});
