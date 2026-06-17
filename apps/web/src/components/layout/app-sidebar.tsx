import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItemsByCategory } from "@/lib/nav";

/**
 * Sidebar điều hướng — nền trắng, nhóm theo category (NAV registry),
 * mỗi mục có icon + active state xanh (viền trái + nền brand-muted).
 */
export function AppSidebar() {
  const { t } = useTranslation("nav");
  const groups = navItemsByCategory();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {/* Tổng quan (trang chủ launcher) */}
        <Link
          to="/"
          className={cn(
            "mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent",
            "[&.active]:bg-brand-muted [&.active]:text-brand",
          )}
          activeOptions={{ exact: true }}
        >
          <Home className="h-4.5 w-4.5" />
          {t("overview")}
        </Link>

        {groups.map(({ meta, items }) => (
          <div key={meta.id} className="mt-4">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t(meta.labelKey)}
            </p>
            <div className="space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    to={item.to}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-accent hover:text-foreground",
                      "[&.active]:bg-brand-muted [&.active]:font-medium [&.active]:text-brand",
                    )}
                  >
                    <Icon className="h-4.5 w-4.5 shrink-0 text-slate-400 group-hover:text-slate-600 group-[.active]:text-brand" />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
