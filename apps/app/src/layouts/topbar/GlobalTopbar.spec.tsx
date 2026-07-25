// @vitest-environment jsdom
/**
 * GlobalTopbar — icon-only button accessible-name smoke (S5-QA-REG-1 §15.4: Screen reader —
 * "Icon-only button có aria-label"). GlobalTopbar mount ở MỌI route protected (không riêng 1 module)
 * nên soi ở đây phủ chung cho toàn bộ P0 screen dùng vỏ app.
 *
 * KHÔNG lặp lại hành vi click/điều hướng của từng nút con — AvatarMenu/NotificationBadge/BrandLogo/
 * AppSwitcher đã có spec riêng cho phần đó. Bài này CHỈ khoá accessible-name của các control icon-only
 * cấp topbar (mobile-menu/app-switcher/theme-toggle/notification-bell/home-link).
 *
 * `window.matchMedia` không tồn tại mặc định trong jsdom — ThemeToggle (qua useTheme) gọi nó để resolve
 * theme 'system'; mock theo mẫu packages/ui/src/hooks/use-theme.spec.ts để nhãn nút xác định
 * (không phụ thuộc fallback fail-soft ngầm).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode, MouseEventHandler } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { useLayoutStore } from "@/stores/layout.store";
import { GlobalTopbar } from "./GlobalTopbar";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      children,
      to,
      onClick,
      ...rest
    }: {
      children: ReactNode;
      to: string;
      onClick?: MouseEventHandler;
      [key: string]: unknown;
    }) => (
      <a href={to} onClick={onClick} {...rest}>
        {children}
      </a>
    ),
    useNavigate: () => vi.fn(),
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: "/hr/employees" } }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    brandingApi: { getBranding: vi.fn(() => Promise.resolve({ logo: null, favicon: null })) },
    meApi: { ...actual.meApi, getAvatar: vi.fn(() => Promise.resolve(null)) },
    myNotificationApi: {
      ...actual.myNotificationApi,
      unreadCount: vi.fn(() =>
        Promise.resolve({
          unread_count: 0,
          high_priority_unread_count: 0,
          urgent_unread_count: 0,
          last_notification_at: null,
        }),
      ),
    },
  };
});

function mockMatchMedia(matchesDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark") ? matchesDark : !matchesDark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function renderTopbar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GlobalTopbar />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // OS light (matches=false trên query 'dark') → resolvedTheme='light' xác định, độc lập máy chạy CI.
  mockMatchMedia(false);
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: { "read:notification": true },
    user: {
      id: "u1",
      email: "a@demo.local",
      fullName: "Nguyễn Văn A",
      status: "Active",
      companyId: "co1",
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  useAuthStore.setState({ isAuthenticated: false, user: null, capabilities: {} });
  useLayoutStore.setState({
    isSidebarCollapsed: false,
    isMobileSidebarOpen: false,
    isAppSwitcherOpen: false,
    topbarSearchOpen: false,
    dirtyFormState: null,
  });
});

describe("GlobalTopbar — mọi nút đều có accessible name", () => {
  it("quét TẤT CẢ nút trong topbar: không có nút icon trần (0 accessible name)", async () => {
    renderTopbar();
    const buttons = await screen.findAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).toHaveAccessibleName();
    }
  });
});

describe("GlobalTopbar — nhãn cụ thể theo từng control icon-only", () => {
  it("nút mở menu di động (icon-only, chỉ hiện <lg) có aria-label", () => {
    renderTopbar();
    expect(screen.getByRole("button", { name: "Mở menu điều hướng" })).toBeInTheDocument();
  });

  it("nút Chuyển đổi ứng dụng (icon + nhãn chữ CHỈ hiện ≥md) vẫn có aria-label bất kể breakpoint", () => {
    renderTopbar();
    expect(screen.getByRole("button", { name: "Mở danh sách ứng dụng" })).toBeInTheDocument();
  });

  it("nút chuyển giao diện sáng/tối (icon-only) có aria-label mô tả hành động", () => {
    renderTopbar();
    // resolvedTheme mặc định 'light' (mock matchMedia ở trên) → nhãn mời chuyển sang tối.
    expect(screen.getByRole("button", { name: "Chuyển giao diện tối" })).toBeInTheDocument();
  });

  it("chuông thông báo (icon-only) có aria-label", () => {
    renderTopbar();
    expect(screen.getByRole("button", { name: /thông báo/i })).toBeInTheDocument();
  });

  it("liên kết Trang chủ/logo có accessible name (KHÔNG phải icon trần dù chỉ có ảnh/wordmark)", () => {
    renderTopbar();
    expect(screen.getByRole("link", { name: "Về trang chủ" })).toBeInTheDocument();
  });
});
