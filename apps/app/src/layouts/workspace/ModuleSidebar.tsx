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
 *   localStorage (tập «KHÁC MẶC ĐỊNH» — xem S15-UI-SHELL-1 bên dưới).
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

/**
 * S15-UI-SHELL-1 (UI-07 §9.5) — nhánh có mục ĐANG ACTIVE **nằm bên trong** thì phải MỞ, kể cả khi
 * `defaultCollapsed: true`: vào `/payroll/statutory-rates` mà nhóm «Thiết lập» vẫn gập là người dùng
 * không nhìn thấy chính chỗ mình đang đứng.
 *
 * ⚠️ CỐ Ý loại CHÍNH nó khỏi phép đo (chỉ soi CON cháu). Nhánh tự nó active vẫn hiện nguyên khi gập —
 * cái bị giấu là con cháu, không phải nó — nên ép mở ở đó chỉ làm chết cái chevron mà người dùng TASK
 * vẫn đang dùng để gập nhánh `/tasks` (S5-TASK-NAV-TREE-1, có spec neo).
 */
export function hasActiveDescendant(item: SidebarItemMeta, pathname: string): boolean {
  return (item.children ?? []).some(
    (child) => isPathActive(pathname, child.path) || hasActiveDescendant(child, pathname),
  );
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
  isBranchFlipped,
  onToggleBranch,
}: {
  item: SidebarItemMeta;
  collapsed: boolean;
  pathname: string;
  depth: number;
  isBranchFlipped: (key: string) => boolean;
  onToggleBranch: (key: string) => void;
}) {
  const children = item.children ?? [];
  // `collapsible` CHỈ dùng để TẮT chevron (`false` = nhóm tĩnh, con luôn hiện). Mặc định là gập được —
  // ngược với bản v1.0 của UI-07, và UI-07 §9.4 đã được sửa theo: 3 cấp cây TASK (S5-TASK-NAV-TREE-1)
  // đang chạy KHÔNG khai cờ này, đổi mặc định là giết cây đó.
  const hasChildren = children.length > 0;
  const isCollapsible = hasChildren && item.collapsible !== false;
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

  // Nhóm tĩnh (`collapsible: false`): con LUÔN hiện, không chevron — không có gì để gập thì không
  // được vẽ nút gập.
  const forcedOpen = !isCollapsible || hasActiveDescendant(item, pathname);
  // Tập lưu ở localStorage là tập «KHÁC MẶC ĐỊNH», không phải tập «đang gập». Với nhánh mặc-định-mở
  // (mọi nhánh có trước S15) hai cách đọc TRÙNG nhau ⇒ dữ liệu cũ trong máy người dùng vẫn đúng.
  const flipped = isBranchFlipped(item.sidebarKey);
  const defaultOpen = item.defaultCollapsed !== true;
  const isOpen = forcedOpen || (flipped ? !defaultOpen : defaultOpen);
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
        {isCollapsible ? (
          <button
            type="button"
            aria-expanded={isOpen}
            // Nhánh đang chứa mục ACTIVE bị GHIM MỞ (§9.5) ⇒ nút vô hiệu + nói lý do, thay vì để một
            // nút bấm-vào-không-có-gì. Rời khỏi nhánh là nút sống lại.
            disabled={forcedOpen}
            title={forcedOpen ? "Nhóm đang chứa mục bạn xem" : undefined}
            aria-label={`${isOpen ? "Thu gọn" : "Mở rộng"} ${item.label}`}
            onClick={() => onToggleBranch(item.sidebarKey)}
            className="rounded p-1 text-muted-foreground/70 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")}
            />
          </button>
        ) : (
          // Giữ chỗ đúng bề rộng chevron để nhóm tĩnh thẳng hàng với nhóm gập được.
          <span className="h-5 w-5 shrink-0" aria-hidden />
        )}
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
        ) : isCollapsible ? (
          // Hàng ĐẠI DIỆN NHÓM (không có màn riêng) — bấm cả hàng cũng gập/mở, cùng cổng `forcedOpen`
          // với chevron để hai điều khiển không nói hai điều khác nhau.
          <button
            type="button"
            aria-expanded={isOpen}
            disabled={forcedOpen}
            title={forcedOpen ? "Nhóm đang chứa mục bạn xem" : undefined}
            onClick={() => onToggleBranch(item.sidebarKey)}
            className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent"
          >
            {rowLabel}
          </button>
        ) : (
          // Nhóm tĩnh không có màn riêng ⇒ chỉ là NHÃN, không phải nút (nút không làm gì là nút chết).
          <span className="flex flex-1 items-center gap-2 px-2 py-1.5 text-sm font-medium text-muted-foreground">
            {rowLabel}
          </span>
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
              isBranchFlipped={isBranchFlipped}
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
  isBranchFlipped,
  onToggleBranch,
}: {
  group: string;
  items: SidebarItemMeta[];
  collapsed: boolean;
  pathname: string;
  isBranchFlipped: (key: string) => boolean;
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
            isBranchFlipped={isBranchFlipped}
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
  // Khoá localStorage GIỮ NGUYÊN tên cũ: với nhánh mặc-định-mở (mọi nhánh trước S15) thì «đang gập»
  // và «khác mặc định» là CÙNG một tập ⇒ đổi khoá chỉ làm mất trạng thái đang có trong máy người dùng.
  const { has: isBranchFlipped, toggle: toggleBranch } = usePersistedSet(
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
              isBranchFlipped={isBranchFlipped}
              onToggleBranch={toggleBranch}
            />
          ))
        )}
        {Extension && !collapsed && <Extension />}
      </nav>
    </aside>
  );
}
