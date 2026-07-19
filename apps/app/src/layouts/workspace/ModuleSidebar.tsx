/**
 * ModuleSidebar — sidebar điều hướng riêng của module hiện tại.
 *
 * Quy tắc (FRONTEND-05 §16):
 * - Chỉ render item user CÓ quyền (filterSidebarItems).
 * - Active state qua pathname match.
 * - Expanded: icon + label + group header.
 * - Collapsed: chỉ icon + tooltip (chỉ cấp 1 — cây con không render được ở icon-mode).
 * - Mobile: render trong MobileSidebarDrawer (không render ở đây).
 * - aria-current="page" cho item active.
 *
 * S5-TASK-NAV-TREE-1 (đợt B):
 * - Dựng CÂY ĐỆ QUY từ `SidebarItemMeta.children` (web-core registry.ts — filterSidebarItems đã lọc
 *   đệ quy sẵn, trước đây chỉ nơi này không đọc children). Gập/mở từng nhánh, GIỮ trạng thái qua
 *   localStorage (lưu tập ĐANG GẬP — mặc định là MỞ).
 * - Khe cắm extension theo module (sidebar-extensions.ts): section động cần data runtime (cây phòng
 *   ban + dự án của TASK) sống ở component riêng — registry tĩnh không ôm React Query.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  filterSidebarItems,
  type ModuleCode,
  type SidebarItemMeta,
  type SessionContext,
  type PermissionChecker,
} from "@mediaos/web-core";
import { cn } from "@mediaos/ui";
import { getSidebarItems } from "./sidebar-registry";
import { getSidebarExtension } from "./sidebar-extensions";
import { usePersistedSet } from "./use-persisted-set";
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
  "master-data": "Dữ liệu gốc",
  management: "Quản lý",
  report: "Báo cáo",
  settings: "Thiết lập",
  admin: "Quản trị",
};

/** Active-match dùng CHUNG cho item tĩnh + lá dự án của TaskSidebarTree — 1 định nghĩa duy nhất. */
export function isPathActive(pathname: string, path: string | undefined): boolean {
  if (!path) return false;
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(path + "/");
}

function SidebarLeaf({
  item,
  collapsed,
  isActive,
  depth,
}: {
  item: SidebarItemMeta;
  collapsed: boolean;
  isActive: boolean;
  depth: number;
}) {
  return (
    <Link
      to={item.path ?? "/"}
      aria-current={isActive ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
        isActive && "bg-brand-muted font-medium text-brand",
        collapsed && "justify-center px-2",
        !collapsed && depth > 0 && "py-1.5",
      )}
    >
      <DynamicIcon
        name={item.icon ?? "circle"}
        className={cn(
          "h-4.5 w-4.5 shrink-0",
          isActive ? "text-brand" : "text-muted-foreground/70 group-hover:text-foreground",
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

/** Node đệ quy: leaf = Link; có children = hàng (Link|button) + chevron gập/mở + nhánh con thụt lề. */
function SidebarNode({
  item,
  collapsed,
  pathname,
  depth,
  isBranchCollapsed,
  onToggleBranch,
}: {
  item: SidebarItemMeta;
  collapsed: boolean;
  pathname: string;
  depth: number;
  isBranchCollapsed: (key: string) => boolean;
  onToggleBranch: (key: string) => void;
}) {
  const children = item.children ?? [];
  const hasChildren = children.length > 0;
  const isActive = isPathActive(pathname, item.path);

  // Icon-mode: chỉ cấp 1 dạng icon — không render nhánh con (không có chỗ cho label/cây).
  // Node cha KHÔNG có path cũng bỏ (không render <Link to={undefined}> chết — không gập/mở được ở icon-mode).
  if (collapsed) {
    if (depth > 0 || !item.path) return null;
    return <SidebarLeaf item={item} collapsed isActive={isActive} depth={depth} />;
  }

  if (!hasChildren) {
    return <SidebarLeaf item={item} collapsed={false} isActive={isActive} depth={depth} />;
  }

  const isOpen = !isBranchCollapsed(item.sidebarKey);
  const rowLabel = (
    <>
      <DynamicIcon
        name={item.icon ?? "circle"}
        className={cn("h-4.5 w-4.5 shrink-0", isActive ? "text-brand" : "text-muted-foreground/70")}
      />
      <span className="truncate">{item.label}</span>
    </>
  );

  return (
    <div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "Thu gọn" : "Mở rộng"} ${item.label}`}
          onClick={() => onToggleBranch(item.sidebarKey)}
          className="rounded p-1 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")} />
        </button>
        {item.path ? (
          <Link
            to={item.path}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
              "text-muted-foreground hover:bg-accent hover:text-foreground",
              isActive && "bg-brand-muted font-medium text-brand",
            )}
          >
            {rowLabel}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onToggleBranch(item.sidebarKey)}
            className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {rowLabel}
          </button>
        )}
      </div>
      {isOpen && (
        <div className="ml-3 space-y-0.5 border-l border-border pl-1.5">
          {children.map((child) => (
            <SidebarNode
              key={child.sidebarKey}
              item={child}
              collapsed={false}
              pathname={pathname}
              depth={depth + 1}
              isBranchCollapsed={isBranchCollapsed}
              onToggleBranch={onToggleBranch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupSection({
  group,
  items,
  collapsed,
  pathname,
  isBranchCollapsed,
  onToggleBranch,
}: {
  group: string;
  items: SidebarItemMeta[];
  collapsed: boolean;
  pathname: string;
  isBranchCollapsed: (key: string) => boolean;
  onToggleBranch: (key: string) => void;
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
          <SidebarNode
            key={item.sidebarKey}
            item={item}
            collapsed={collapsed}
            pathname={pathname}
            depth={0}
            isBranchCollapsed={isBranchCollapsed}
            onToggleBranch={onToggleBranch}
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
  const { has: isBranchCollapsed, toggle: toggleBranch } = usePersistedSet(
    `mediaos.sidebar.collapsed:${moduleCode}`,
  );
  const Extension = getSidebarExtension(moduleCode);

  // Nhóm item theo group
  const grouped = visibleItems.reduce<Record<string, SidebarItemMeta[]>>((acc, item) => {
    const g = item.group ?? "overview";
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  const groupOrder = [
    "overview",
    "operation",
    "master-data",
    "management",
    "report",
    "settings",
    "admin",
  ];
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
        {/* Empty-state GIỮ NGUYÊN dù có extension — extension có thể tự ẨN (thiếu quyền) nên không
            được coi "có extension = có nội dung" (finding gate đợt B). */}
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
              isBranchCollapsed={isBranchCollapsed}
              onToggleBranch={toggleBranch}
            />
          ))
        )}
        {Extension && !collapsed && <Extension />}
      </nav>
    </aside>
  );
}
