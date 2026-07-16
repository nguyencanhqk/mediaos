// @vitest-environment jsdom
/**
 * leave-public-holidays-route — S5-LEAVE-HOLIDAYS-MOVE-1 (re-home FE-only /system/public-holidays →
 * /leave/public-holidays). Đi qua SINGLETON `router` xuất từ "@/router" (route tree PRODUCTION) +
 * RouterProvider thật (mirror notifications-router-flow.spec.tsx) — mọi chân chạy qua beforeLoad/
 * ProtectedRoute thật, KHÔNG bypass guard. Chỉ mock `holidayApi` (network) + `myNotificationApi`
 * (GlobalTopbar badge fetch trên MỌI route module) — useCan/auth store/evaluateRouteAccess dùng THẬT.
 *
 * Chân phủ:
 *  mount     /leave/public-holidays (đủ view:foundation-holiday) → render PublicHolidaysPage THẬT
 *            (TÁI DÙNG component ở system/foundation, KHÔNG copy-paste) dưới module LEAVE.
 *  redirect  /system/public-holidays (đường dẫn CŨ) → REDIRECT sang /leave/public-holidays — bookmark/
 *            deep-link cũ không gãy.
 *  gate      thiếu view:foundation-holiday → route ALLOW nhưng nội dung page tự ẩn (forbidden EmptyState
 *            trong PublicHolidaysPage) — page-level gate, KHÔNG đổi permission/BE.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { I18nextProvider } from "react-i18next";
import { useAuthStore, holidayApi, myNotificationApi } from "@mediaos/web-core";
import i18n from "@/i18n";
import { router } from "@/router";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    holidayApi: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
    // GlobalTopbar (mount ở MỌI route module qua ProtectedShell) tự fetch badge — mock network,
    // mirror notifications-router-flow.spec.tsx (tránh network thật trong jsdom).
    myNotificationApi: {
      list: vi.fn(),
      dropdown: vi.fn(),
      unreadCount: vi.fn(),
      detail: vi.fn(),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
      remove: vi.fn(),
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

describe("S5-LEAVE-HOLIDAYS-MOVE-1 — /leave/public-holidays route (qua router THẬT)", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    vi.clearAllMocks();
    vi.mocked(myNotificationApi.dropdown).mockResolvedValue({ unread_count: 0, items: [] });
    vi.mocked(myNotificationApi.unreadCount).mockResolvedValue({
      unread_count: 0,
      high_priority_unread_count: 0,
      urgent_unread_count: 0,
      last_notification_at: null,
    });
    vi.mocked(myNotificationApi.list).mockResolvedValue([]);
  });

  it("render PublicHolidaysPage THẬT dưới module LEAVE (view:foundation-holiday đủ quyền)", async () => {
    login({ "view:foundation-holiday": true });
    vi.mocked(holidayApi.list).mockResolvedValue([]);

    await router.navigate({ to: "/leave/public-holidays" as "/" });
    const view = renderApp();

    // Tiêu đề trang (PageHeader h1) — component TÁI DÙNG nguyên vẹn từ system/foundation.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ngày nghỉ lễ" })).toBeInTheDocument(),
    );
    // Assert riêng bằng waitFor (KHÔNG dựa vào timing của assertion heading ở trên) — h1 render đồng bộ
    // ngay khi canView===true, TRƯỚC KHI useHolidays() query thật sự gọi holidayApi.list (async).
    await waitFor(() => expect(holidayApi.list).toHaveBeenCalled());
    expect(router.state.location.pathname).toBe("/leave/public-holidays");

    view.unmount();
  });

  it("/system/public-holidays (đường dẫn CŨ) REDIRECT sang /leave/public-holidays — bookmark không gãy", async () => {
    login({ "view:foundation-holiday": true });
    vi.mocked(holidayApi.list).mockResolvedValue([]);

    await router.navigate({ to: "/system/public-holidays" as "/" });
    const view = renderApp();

    await waitFor(() => expect(router.state.location.pathname).toBe("/leave/public-holidays"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ngày nghỉ lễ" })).toBeInTheDocument(),
    );

    view.unmount();
  });

  it("thiếu view:foundation-holiday → route-level SHOW_403 (ProtectedRoute chặn, PublicHolidaysPage KHÔNG mount)", async () => {
    login({}); // không có view:foundation-holiday

    await router.navigate({ to: "/leave/public-holidays" as "/" });
    const view = renderApp();

    await waitFor(() =>
      expect(screen.getByText("Bạn không có quyền truy cập trang này.")).toBeInTheDocument(),
    );
    expect(holidayApi.list).not.toHaveBeenCalled();

    view.unmount();
  });
});
