/**
 * S16-SOCIAL-FE-1 — rail TRÁI của cổng thông tin (UI-07 §34b, plan D11).
 *
 * Gồm: thẻ danh tính (avatar · tên · link «Trang cá nhân») + `ModuleSidebar` **dùng chung của cả hệ**.
 *
 * ┌─ D11 — vì sao KHÔNG viết sidebar riêng cho portal ────────────────────────────────────────────┐
 * │ Portal khác `ModuleWorkspaceLayout` ở **KHUNG CHỨA**, không khác ở **LUẬT HIỂN THỊ**. Viết rail │
 * │ riêng là phải hiện thực lại `filterSidebarItems` (gate quyền + module status) bằng tay, và mất │
 * │ luôn cổng snapshot đang ghim cây điều hướng của 14 module. Luật «forbidden = ẨN mục» (SPEC-16   │
 * │ §14) khi đó thành một lời hứa không ai kiểm.                                                   │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Component này render CẢ HAI hình dạng responsive và để CSS chọn: `ModuleSidebar` (`hidden lg:flex`)
 * cho ≥1024px và `PortalTabBar` (`lg:hidden`) cho dưới đó. Gói chung một cây DOM là cách giữ đúng
 * thứ tự DOM `leftRail → feed → rightRail` mà D4 đòi, mà không cần một dòng `order-*` nào.
 */
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Avatar, cn } from "@mediaos/ui";
import { useAuthStore, type ModuleCode } from "@mediaos/web-core";
import { ModuleSidebar } from "@/layouts/workspace/ModuleSidebar";
import { buildPortalPermissionChecker, buildPortalSession } from "./portal-session";
import { PortalTabBar } from "./PortalTabBar";

interface PortalLeftRailProps {
  moduleCode: ModuleCode;
  className?: string;
}

export function PortalLeftRail({ moduleCode, className }: PortalLeftRailProps): React.ReactElement {
  const { t } = useTranslation("social");
  const user = useAuthStore((s) => s.user);

  const session = buildPortalSession();
  const permission = buildPortalPermissionChecker();

  /**
   * Tên hiển thị: `fullName` → `email` → chuỗi rỗng cho `Avatar` tự sinh chữ cái đầu.
   *
   * ⚠️ KHÔNG bịa "Người dùng" làm mặc định ở ĐÂY: thẻ này nói "bạn là ai", nên một nhãn giả làm
   * người dùng tưởng phiên đang đăng nhập nhầm. Rỗng thì hiện email — thứ luôn có thật.
   */
  const displayName = user?.fullName ?? user?.email ?? "";

  return (
    <>
      {/* ≥1024px — rail dọc 240px. `w-60` = 240px, khớp cột `240px` của grid ở PortalLayout. */}
      <div className={cn("hidden w-60 shrink-0 flex-col gap-3 py-4 lg:flex", className)}>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3">
          {/*
            KHÔNG truyền `src`: `useAuthStore.user` chỉ có `{id, companyId, email, fullName, status}`
            — **không có `avatarUrl`** (`packages/web-core/src/stores/auth.ts:4-10`). Truyền một khoá
            không tồn tại sẽ là `undefined` im lặng chứ không đỏ, nên nói rõ ở đây: thẻ này hiện chữ
            cái đầu, và ảnh đại diện thật là việc của một WO có đường tải `/me` (avatar own-scope).
          */}
          <Avatar name={displayName} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
            <Link
              to="/feed/profiles/me"
              className="rounded text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("portal.myProfile")}
            </Link>
          </div>
        </div>

        <ModuleSidebar
          moduleCode={moduleCode}
          session={session}
          permission={permission}
          collapsed={false}
          className="flex min-h-0 flex-1"
        />
      </div>

      {/* <1024px — thanh tab ngang (UI-07 §34b.3: KHÔNG drawer). */}
      <PortalTabBar moduleCode={moduleCode} className="lg:hidden" />
    </>
  );
}
