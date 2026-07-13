import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, LogOut, Search } from "lucide-react";
import { useAuthStore, type NavItem } from "@mediaos/web-core";
import { Avatar } from "../ui/avatar";
import { ThemeToggle } from "../ui/theme-toggle";
import { AppSidebar } from "./app-sidebar";

interface AppShellProps {
  children: React.ReactNode;
  /** Nav items cho sidebar — mỗi app truyền subset của mình. */
  navItems: readonly NavItem[];
  /**
   * Khối thương hiệu góc trái (thường bọc Link về trang chủ). Mỗi app tự cấp branding
   * của nó → shell không phụ thuộc thương hiệu cụ thể.
   */
  brand?: React.ReactNode;
  /**
   * Điều khiển thông báo ở topbar. Mỗi app tự cấp (gắn với feature notification của nó)
   * → shell không kéo theo notification-api.
   */
  notifications?: React.ReactNode;
}

/**
 * Khung ứng dụng (chrome) cho các trang nghiệp vụ:
 * - Topbar chrome navy (hằng số cả hai theme): brand + tìm kiếm + lưới ứng dụng + thông báo + người dùng.
 * - Sidebar bg-card nhóm theo category (AppSidebar) — tự đổi theo theme.
 * - Mô hình cuộn app-frame: shell khóa h-dvh, CHỈ <main> cuộn (chrome đứng yên);
 *   đổi route → reset scroll về đầu trang.
 * Trang chủ launcher và /login KHÔNG dùng shell này (xem root-layout).
 */
export function AppShell({ children, navItems, brand, notifications }: AppShellProps) {
  const { t } = useTranslation(["common", "nav"]);
  const navigate = useNavigate();
  const username = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mainRef = React.useRef<HTMLElement>(null);

  // Cuộn nằm TRONG <main> (không phải document) → router không tự reset; tự đưa về đầu.
  // typeof-guard: jsdom (test) không có Element.scrollTo.
  React.useEffect(() => {
    if (typeof mainRef.current?.scrollTo === "function") {
      mainRef.current.scrollTo({ top: 0 });
    }
  }, [pathname]);

  const onLogout = () => {
    logout();
    void navigate({ to: "/login" });
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Topbar — bg-chrome là hằng số navy cả hai theme; overlay white/* là chrome-relative */}
      <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-chrome px-3 text-chrome-foreground sm:px-4">
        {brand}

        {/* Tìm kiếm (presentational — global search nối ở bước sau) */}
        <div className="relative mx-auto hidden w-full max-w-md md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-chrome-foreground/50" />
          <input
            type="search"
            placeholder={t("common:search")}
            aria-label={t("common:search")}
            className="h-9 w-full rounded-lg border border-white/10 bg-white/10 pl-9 pr-3 text-sm text-chrome-foreground placeholder:text-chrome-foreground/50 focus:border-white/20 focus:bg-white/15 focus:outline-none"
          />
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <Link
            to="/"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-chrome-foreground/80 transition-colors hover:bg-white/10"
            aria-label={t("nav:overview")}
            title={t("nav:overview")}
          >
            <LayoutGrid className="h-4.5 w-4.5" />
          </Link>

          <ThemeToggle />

          <div className="text-chrome-foreground/80">{notifications}</div>

          <div className="mx-1.5 hidden h-6 w-px bg-white/10 sm:block" />

          <Avatar name={username} size="sm" className="bg-white/15 text-white" />
          <span className="ml-2 hidden max-w-[10rem] truncate text-sm text-chrome-foreground/90 lg:block">
            {username}
          </span>
          <button
            onClick={onLogout}
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-chrome-foreground/70 transition-colors hover:bg-white/10 hover:text-chrome-foreground"
            aria-label={t("nav:logout")}
            title={t("nav:logout")}
          >
            <LogOut className="h-4.5 w-4.5" />
          </button>
        </div>
      </header>

      {/* Body: sidebar + nội dung — min-h-0 để hàng flex nhận đúng chiều cao còn lại */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar items={navItems} />
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {children}
        </main>
      </div>
    </div>
  );
}
