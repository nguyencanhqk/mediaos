/**
 * S16-SOCIAL-FE-1 — thanh tab ngang thay cho rail trái khi <1024px (UI-07 §34b.3, plan D4).
 *
 * UI-07 §34b.3 loại **drawer** một cách tường minh: _"không dùng drawer… thanh tab ngang rẻ hơn và
 * không nuốt một lớp tương tác"_. Đây là khác biệt CÓ CHỦ ĐÍCH với `ModuleWorkspaceLayout` (nơi
 * mobile dùng `MobileSidebarDrawer`) — đừng "thống nhất" hai cái lại.
 *
 * ⚠️ NGUỒN MỤC LÀ MỘT, KHÔNG PHẢI HAI: tab bar đọc CÙNG `SIDEBAR_REGISTRY[moduleCode]` rồi CÙNG
 * `filterSidebarItems` như rail trái. Khai một danh sách tab thứ hai là tạo hai nguồn sự thật cho
 * một câu hỏi ("người này được thấy những mục nào") và chắc chắn trôi — cũng là cách đánh mất cổng
 * «forbidden = ẩn» (SPEC-16 §14) mà `filterSidebarItems` đang giữ.
 *
 * Chỉ render mục **cấp 1 có `path`**: thanh ngang không có chỗ cho cây con, và một tab mở ra menu
 * con trên màn hình hẹp chính là "một lớp tương tác" mà §34b.3 vừa loại bỏ.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { filterSidebarItems, type ModuleCode, type SidebarItemMeta } from "@mediaos/web-core";
import { cn } from "@mediaos/ui";
import { getSidebarItems } from "@/layouts/workspace/sidebar-registry";
import { isPathActive } from "@/layouts/workspace/ModuleSidebar";
import { DynamicIcon } from "@/layouts/workspace/DynamicIcon";
import { buildPortalPermissionChecker, buildPortalSession } from "./portal-session";

interface PortalTabBarProps {
  moduleCode: ModuleCode;
  className?: string;
}

export function PortalTabBar({
  moduleCode,
  className,
}: PortalTabBarProps): React.ReactElement | null {
  const { t } = useTranslation("social");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const session = buildPortalSession();
  const permission = buildPortalPermissionChecker();
  // ⚠️ Thứ tự tham số là (items, permission, session) — KHÔNG phải (items, session, permission).
  // Cả hai đều là object nên hoán vị KHÔNG đỏ typecheck; nó chỉ làm mọi mục biến mất lúc chạy.
  const items: SidebarItemMeta[] = filterSidebarItems(
    getSidebarItems(moduleCode),
    permission,
    session,
  ).filter((item) => Boolean(item.path));

  // Không mục nào thấy được ⇒ KHÔNG vẽ thanh rỗng. Một dải `sticky` cao 48px không có gì bên trong
  // vẫn ăn chỗ ở đầu màn hình hẹp và đẩy nội dung xuống mà không giải thích được vì sao.
  if (items.length === 0) return null;

  return (
    <nav
      aria-label={t("portal.tabBarAria")}
      data-testid="portal-tab-bar"
      className={cn(
        "sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-border bg-background px-2 py-2",
        className,
      )}
    >
      {items.map((item) => {
        const active = isPathActive(pathname, item.path);
        return (
          <Link
            key={item.sidebarKey}
            to={item.path!}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {item.icon && <DynamicIcon name={item.icon} className="h-4 w-4" />}
            <span className="whitespace-nowrap">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
