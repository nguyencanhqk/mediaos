import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
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
