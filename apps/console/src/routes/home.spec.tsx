import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { HomePage } from "./home";
import { useAuthStore } from "@mediaos/web-core";

/**
 * S4-FE-NOTI-CONSOLE-BELL-1 — regression: `<NotificationBell/>` (@mediaos/ui) từng mount ở header
 * launcher, tiêu thụ `notificationApi` (web-core) trỏ route BE legacy đã gỡ ở PR #133
 * (PATCH /notifications/:id/read, /notifications/read-all) → chuông vỡ. Đảm bảo header KHÔNG còn
 * mount chuông đó, và phần còn lại của header (avatar/đăng xuất) vẫn nguyên vẹn.
 */

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    getHealth: vi.fn().mockResolvedValue({ status: "ok", service: "api" }),
  };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<HomePage />, { wrapper });
}

describe("HomePage — console launcher (S4-FE-NOTI-CONSOLE-BELL-1)", () => {
  afterEach(() => {
    useAuthStore.setState({ username: null });
    vi.clearAllMocks();
  });

  it("KHÔNG còn mount chuông thông báo cũ (route BE đã gỡ ở PR #133)", () => {
    useAuthStore.setState({ username: "demo" });
    renderPage();
    expect(screen.queryByRole("button", { name: /thông báo/i })).not.toBeInTheDocument();
  });

  it("header vẫn render avatar + nút đăng xuất (không vỡ khi gỡ chuông)", () => {
    useAuthStore.setState({ username: "demo" });
    renderPage();
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /đăng xuất/i })).toBeInTheDocument();
  });
});
