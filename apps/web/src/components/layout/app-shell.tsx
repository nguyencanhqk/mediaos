import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LayoutGrid, LogOut, Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { NotificationBell } from "@/components/notification-bell";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { BrandLogo } from "@/components/brand/brand-mark";
import { BRAND } from "@/lib/brand";
import { useAuthStore } from "@/stores/auth";

/**
 * Khung ứng dụng (chrome) cho các trang nghiệp vụ:
 * - Topbar navy: brand + tìm kiếm + lưới ứng dụng + thông báo + người dùng.
 * - Sidebar trắng nhóm theo category (AppSidebar).
 * Trang chủ launcher và /login KHÔNG dùng shell này (xem root-layout).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation(["common", "nav"]);
  const navigate = useNavigate();
  const username = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);

  const onLogout = () => {
    logout();
    void navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Topbar */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 bg-slate-900 px-3 text-slate-100 sm:px-4">
        <Link to="/" className="flex items-center pr-2" aria-label={BRAND.name}>
          <BrandLogo size="md" wordmarkText={BRAND.shortName} wordmarkClassName="hidden sm:inline" />
        </Link>

        {/* Tìm kiếm (presentational — global search nối ở bước sau) */}
        <div className="relative mx-auto hidden w-full max-w-md md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder={t("common:search")}
            aria-label={t("common:search")}
            className="h-9 w-full rounded-lg border border-white/10 bg-white/10 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-400 focus:border-white/20 focus:bg-white/15 focus:outline-none"
          />
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <Link
            to="/"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-200 transition-colors hover:bg-white/10"
            aria-label={t("nav:overview")}
            title={t("nav:overview")}
          >
            <LayoutGrid className="h-4.5 w-4.5" />
          </Link>

          <div className="text-slate-200">
            <NotificationBell />
          </div>

          <div className="mx-1.5 hidden h-6 w-px bg-white/10 sm:block" />

          <Avatar name={username} size="sm" className="bg-white/15 text-white" />
          <span className="ml-2 hidden max-w-[10rem] truncate text-sm text-slate-200 lg:block">
            {username}
          </span>
          <button
            onClick={onLogout}
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={t("nav:logout")}
            title={t("nav:logout")}
          >
            <LogOut className="h-4.5 w-4.5" />
          </button>
        </div>
      </header>

      {/* Body: sidebar + nội dung */}
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
