import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, configureToast, showApiErrorToast, useAuthStore } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import "@/i18n";
import { RootLayout } from "./root-layout";

/**
 * S5-BRAND-FE-2: RootLayout nay dùng useConsoleBranding (favicon động) ⇒ cần QueryClientProvider.
 * Client MỚI mỗi lần render + retry:false để test không dính cache/lỗi mạng chéo nhau.
 */
function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RootLayout />
    </QueryClientProvider>,
  );
}

/**
 * S4-FE-NOTI-CONSOLE-BELL-1 — regression: slot `notifications` của AppShell từng gắn
 * `<NotificationBell/>` (@mediaos/ui), tiêu thụ `notificationApi` (web-core) trỏ route BE legacy đã
 * gỡ ở PR #133 (PATCH /notifications/:id/read, /notifications/read-all) → chuông vỡ. Đảm bảo shell
 * KHÔNG còn mount chuông đó và vẫn render bình thường (nav + nội dung route con).
 */

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
    Outlet: () => <div data-testid="outlet-content" />,
    useRouterState: () => "/home",
  };
});

describe("RootLayout — console shell (S4-FE-NOTI-CONSOLE-BELL-1)", () => {
  it("KHÔNG còn mount chuông thông báo cũ (route BE đã gỡ ở PR #133)", () => {
    renderLayout();
    expect(screen.queryByRole("button", { name: /thông báo/i })).not.toBeInTheDocument();
  });

  it("shell vẫn render bình thường (không vỡ khi gỡ chuông)", () => {
    renderLayout();
    expect(screen.getByTestId("outlet-content")).toBeInTheDocument();
  });
});

/**
 * S20-FE-TOAST-2 — console có thông báo nổi (trước đây showApiErrorToast chỉ rơi vào console) và thông báo
 * của người trước KHÔNG còn khi người khác dùng tiếp (đăng xuất · hết phiên · đổi phiên tại chỗ). Dây nối
 * thật: configureToast(toast của @mediaos/ui) → ranh giới phiên của web-core → toast.clear().
 */
describe("RootLayout — thông báo nổi + dọn khi đổi người dùng (S20-FE-TOAST-2)", () => {
  const USER_A = { id: "u-a", companyId: "co-1", email: "a@demo.local", fullName: "A", status: "active" };
  const USER_B = { id: "u-b", companyId: "co-1", email: "b@demo.local", fullName: "B", status: "active" };
  const serverBusy = () => new ApiError({ message: "Không lưu được cấu hình của A", kind: "SERVER", status: 500 });
  const region = () => screen.getByRole("region", { name: "Thông báo" });

  beforeEach(() => {
    act(() => useAuthStore.getState().setUser(USER_A, {}));
    configureToast(toast);
  });
  afterEach(() => {
    act(() => toast.clear());
    cleanup();
    configureToast(null);
    useAuthStore.getState().logout();
  });

  it("Toaster mount ĐÚNG một lần; showApiErrorToast hiện trong vùng assertive", () => {
    renderLayout();
    act(() => showApiErrorToast(serverBusy()));

    expect(document.querySelectorAll('[data-slot="toaster"]')).toHaveLength(1);
    expect(within(region()).getByRole("alert")).toHaveTextContent("Không lưu được cấu hình của A");
  });

  it("A đăng xuất rồi B đăng nhập ⇒ B KHÔNG thấy thông báo của A", () => {
    renderLayout();
    act(() => showApiErrorToast(serverBusy()));
    expect(region()).toHaveTextContent("Không lưu được cấu hình của A");

    act(() => useAuthStore.getState().logout());
    act(() => useAuthStore.getState().setUser(USER_B, {}));

    expect(region()).not.toHaveTextContent("Không lưu được cấu hình của A");
    expect(within(region()).queryByRole("button", { name: "Đóng thông báo" })).toBeNull();
  });

  it("đổi phiên tại chỗ A → B (không qua đăng xuất) ⇒ thông báo của A biến mất", () => {
    renderLayout();
    act(() => toast.warning("Phiên của A sắp hết hạn"));
    expect(region()).toHaveTextContent("Phiên của A sắp hết hạn");

    act(() => useAuthStore.getState().setUser(USER_B, {}));

    expect(region()).not.toHaveTextContent("Phiên của A sắp hết hạn");
  });
});
