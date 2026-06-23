/**
 * ModuleSidebar — sidebar điều hướng riêng của module hiện tại.
 *
 * Quy tắc (FRONTEND-05 §16):
 * - Chỉ render item user CÓ quyền (filterSidebarItems).
 * - Active state qua pathname match.
 * - Expanded: icon + label + group header.
 * - Collapsed: chỉ icon + tooltip.
 * - Mobile: render trong MobileSidebarDrawer (không render ở đây).
 * - aria-current="page" cho item active.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import {
  filterSidebarItems,
  type ModuleCode,
  type SidebarItemMeta,
  type SessionContext,
  type PermissionChecker,
} from "@mediaos/web-core";
import { cn } from "@mediaos/ui";
import { getSidebarItems } from "./sidebar-registry";
import { DynamicIcon } from "./DynamicIcon";

interface ModuleSidebarProps {
  moduleCode: ModuleCode;
  session: SessionContext;
  permission: PermissionChecker;
  collapsed?: boolean;
  className?: string;
}

const GROUP_LABELS: Record<string, string> = {
  overview: "Tổng quan",
  operation: "Nghiệp vụ",
  management: "Quản lý",
  report: "Báo cáo",
  settings: "Thiết lập",
  admin: "Quản trị",
};

function SidebarItem({
  item,
  collapsed,
  isActive,
}: {
  item: SidebarItemMeta;
  collapsed: boolean;
  isActive: boolean;
}) {
  return (
    <Link
      to={item.path ?? "/"}
      aria-current={isActive ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        "text-slate-600 hover:bg-accent hover:text-foreground",
        isActive && "bg-brand-muted font-medium text-brand",
        collapsed && "justify-center px-2",
      )}
    >
      <DynamicIcon
        name={item.icon ?? "circle"}
        className={cn(
          "h-4.5 w-4.5 shrink-0",
          isActive ? "text-brand" : "text-slate-400 group-hover:text-slate-600",
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function GroupSection({
  group,
  items,
  collapsed,
  pathname,
}: {
  group: string;
  items: SidebarItemMeta[];
  collapsed: boolean;
  pathname: string;
}) {
  return (
    <div className="mt-4">
      {!collapsed && (
        <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {GROUP_LABELS[group] ?? group}
        </p>
      )}
      <div className="space-y-0.5">
        {items.map((item) => (
          <SidebarItem
            key={item.sidebarKey}
            item={item}
            collapsed={collapsed}
            isActive={
              item.path
                ? item.path === "/"
                  ? pathname === "/"
                  : pathname === item.path || pathname.startsWith(item.path + "/")
                : false
            }
          />
        ))}
      </div>
    </div>
  );
}

export function ModuleSidebar({
  moduleCode,
  session,
  permission,
  collapsed = false,
  className,
}: ModuleSidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const rawItems = getSidebarItems(moduleCode);
  const visibleItems = filterSidebarItems(rawItems, permission, session);

  // Nhóm item theo group
  const grouped = visibleItems.reduce<Record<string, SidebarItemMeta[]>>((acc, item) => {
    const g = item.group ?? "overview";
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  const groupOrder = ["overview", "operation", "management", "report", "settings", "admin"];
  const orderedGroups = [
    ...groupOrder.filter((g) => grouped[g]),
    ...Object.keys(grouped).filter((g) => !groupOrder.includes(g)),
  ];

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-card transition-all duration-200",
        collapsed ? "w-14" : "w-60",
        className,
      )}
    >
      <nav className="flex-1 overflow-y-auto px-2 py-4" aria-label="Module navigation">
        {visibleItems.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {collapsed ? "" : "Không có menu."}
          </p>
        ) : (
          orderedGroups.map((group) => (
            <GroupSection
              key={group}
              group={group}
              items={grouped[group]}
              collapsed={collapsed}
              pathname={pathname}
            />
          ))
        )}
      </nav>
    </aside>
  );
}
