import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";

/**
 * Khung layout cho mọi route đã đăng nhập (operator plane). Sidebar + Outlet.
 * Các module operator (companies/flags/audit/db-ops…) sẽ thêm mục nav + route ở lane sau
 * (vd AC-1 thêm `/operator/companies`). `to` được TanStack Router kiểm kiểu nên chỉ liệt kê
 * route đã tồn tại.
 */
const NAV = [{ to: "/operator", key: "overview", icon: LayoutDashboard }] as const;

export function RootLayout() {
  const { t } = useTranslation("nav");
  const navigate = useNavigate();
  const email = useAuthStore((s) => s.user?.email ?? null);
  const logout = useAuthStore((s) => s.logout);

  const onLogout = () => {
    logout();
    void navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-muted/40">
        <div className="flex h-14 items-center px-4">
          <span className="font-semibold">{t("common:appName")}</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-2" aria-label={t("sidebarLabel")}>
          {NAV.map(({ to, key, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted [&.active]:bg-primary/10 [&.active]:font-medium [&.active]:text-primary"
            >
              <Icon className="size-4" aria-hidden="true" />
              {t(key)}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border px-4 py-3">
          <p className="mb-1.5 truncate text-xs text-muted-foreground">{email}</p>
          <Button variant="outline" size="sm" className="w-full" onClick={onLogout}>
            {t("logout")}
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
