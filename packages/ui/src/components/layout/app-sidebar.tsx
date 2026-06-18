import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Home } from "lucide-react";
import { navItemsGrouped, type NavItem } from "@mediaos/web-core";
import { cn } from "../../lib/utils";

interface AppSidebarProps {
  /** Nav items hiển thị — mỗi app truyền subset của mình. */
  items: readonly NavItem[];
}

const NAV_LINK_CLASS = cn(
  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-accent hover:text-foreground",
  "[&.active]:bg-brand-muted [&.active]:font-medium [&.active]:text-brand",
);

function NavLink({ item, t }: { item: NavItem; t: (key: string) => string }) {
  const Icon = item.icon;
  return (
    <Link key={item.id} to={item.to} className={NAV_LINK_CLASS}>
      <Icon className="h-4.5 w-4.5 shrink-0 text-slate-400 group-hover:text-slate-600 group-[.active]:text-brand" />
      <span className="truncate">{t(item.labelKey)}</span>
    </Link>
  );
}

/**
 * Sidebar điều hướng — nền trắng, nhóm theo category (NAV registry),
 * mỗi mục có icon + active state xanh (viền trái + nền brand-muted).
 *
 * Hỗ trợ sidebar 2 cấp: item có `subcategory` hiển thị dưới header nhỏ bên trong category.
 * Item KHÔNG có `subcategory` hiển thị phẳng trực tiếp dưới category — tương thích ngược.
 */
export function AppSidebar({ items }: AppSidebarProps) {
  const { t } = useTranslation("nav");
  const groups = navItemsGrouped(items);

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

        {groups.map(({ meta, flat, subgroups }) => {
          const hasContent = flat.length > 0 || subgroups.length > 0;
          if (!hasContent) return null;
          return (
            <div key={meta.id} className="mt-4">
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(meta.labelKey)}
              </p>
              <div className="space-y-0.5">
                {/* Items phẳng (không có subcategory) — giống hành vi cũ */}
                {flat.map((item) => (
                  <NavLink key={item.id} item={item} t={t} />
                ))}
                {/* Subgroups 2 cấp */}
                {subgroups.map(({ subcategory, items: subItems }) => (
                  <div key={subcategory} className="mt-2">
                    <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                      {subcategory}
                    </p>
                    {subItems.map((item) => (
                      <NavLink key={item.id} item={item} t={t} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
