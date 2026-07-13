/**
 * GlobalTopbar — thanh điều hướng chung cho mọi route protected.
 *
 * Anatomy (FRONTEND-05 §12, UI-06 §9.3):
 *   [Mobile menu] [Logo/Home] [Current App] ........... [Apps] [Noti] [Avatar]
 *
 * Quy tắc:
 * - Home button check dirty-form guard trước khi navigate.
 * - App Switcher button: toggle overlay.
 * - Notification badge: chỉ render nếu user có NOTI.NOTIFICATION.VIEW_OWN.
 * - Nền bg-chrome = hằng số navy ở CẢ HAI theme (khung máy console không đổi khi
 *   bật đèn) → overlay white/* trên chrome là chrome-relative, hợp lệ.
 * - Shell khóa h-dvh nên topbar đứng yên sẵn — không cần sticky.
 */
import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Grid3x3, Menu } from "lucide-react";
import { cn, ThemeToggle } from "@mediaos/ui";
import { useLayoutStore } from "@/stores/layout.store";
import { useCurrentRouteMeta } from "@/hooks/use-current-route-meta";
import { AvatarMenu } from "./AvatarMenu";
import { DirtyFormConfirmDialog } from "../shared/DirtyFormConfirmDialog";
import { DynamicIcon } from "../workspace/DynamicIcon";
import { NotificationBadge } from "@/components/notifications/NotificationBadge";
import { APP_REGISTRY } from "@mediaos/web-core";

// Module accent colors mapped from registry icon — hiển thị trên chrome navy hằng số
// (không đổi theo theme) nên palette cố định là chủ đích; slate-400 đủ tương phản.
const MODULE_ACCENT: Record<string, string> = {
  DASH: "text-blue-500",
  HR: "text-indigo-500",
  ATT: "text-green-500",
  LEAVE: "text-orange-500",
  TASK: "text-cyan-500",
  NOTI: "text-pink-500",
  FOUNDATION: "text-slate-400",
  AUTH: "text-slate-400",
};

function CurrentAppIndicator() {
  const routeMeta = useCurrentRouteMeta();
  const { t } = useTranslation("nav");

  if (!routeMeta?.moduleCode) {
    return (
      <span className="hidden items-center gap-1.5 text-sm font-medium text-chrome-foreground/90 sm:flex">
        Trang chủ
      </span>
    );
  }

  const appEntry = APP_REGISTRY.find((a) => a.moduleCode === routeMeta.moduleCode);
  const icon = appEntry?.icon ?? "circle";
  const accentClass = MODULE_ACCENT[routeMeta.moduleCode] ?? "text-chrome-foreground/70";
  const nameKey = appEntry?.nameKey as Parameters<typeof t>[0] | undefined;
  const name = nameKey ? t(nameKey) : routeMeta.moduleCode;

  return (
    <span className="hidden items-center gap-1.5 text-sm font-medium text-chrome-foreground/90 sm:flex">
      <DynamicIcon name={icon} className={cn("h-4 w-4", accentClass)} />
      {name}
    </span>
  );
}

export function GlobalTopbar() {
  const { t } = useTranslation(["common", "nav"]);
  const { openMobileSidebar, toggleAppSwitcher, dirtyFormState } = useLayoutStore();
  const [showDirtyConfirm, setShowDirtyConfirm] = React.useState(false);
  const [pendingNav, setPendingNav] = React.useState<string | null>(null);
  const navigate = useNavigate();

  const handleHomeClick = (e: React.MouseEvent) => {
    if (dirtyFormState) {
      e.preventDefault();
      setPendingNav("/home");
      setShowDirtyConfirm(true);
    }
  };

  const confirmNav = () => {
    setShowDirtyConfirm(false);
    if (pendingNav) {
      void navigate({ to: pendingNav as "/" });
      setPendingNav(null);
    }
  };

  return (
    <>
      <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-chrome px-3 text-chrome-foreground sm:px-4">
        {/* Mobile menu toggle */}
        <button
          className="flex h-9 w-9 items-center justify-center rounded-lg text-chrome-foreground/80 transition-colors hover:bg-white/10 lg:hidden"
          onClick={openMobileSidebar}
          aria-label="Mở menu điều hướng"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Logo / Home */}
        <Link
          to="/home"
          onClick={handleHomeClick}
          className="flex items-center gap-2 rounded-lg px-2 py-1 text-chrome-foreground transition-colors hover:bg-white/10"
          aria-label="Về trang chủ"
        >
          <span className="brand-gradient-text font-display text-base font-bold">
            FUNTIME MEDIA
          </span>
        </Link>

        {/* Divider */}
        <span className="hidden h-5 w-px bg-white/20 sm:block" />

        {/* Current app indicator */}
        <CurrentAppIndicator />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right actions */}
        <div className="flex items-center gap-0.5">
          {/* App Switcher */}
          <button
            onClick={toggleAppSwitcher}
            className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-chrome-foreground/80 transition-colors hover:bg-white/10"
            aria-label="Mở danh sách ứng dụng"
            title="Danh sách ứng dụng (Ctrl+K)"
          >
            <Grid3x3 className="h-4.5 w-4.5" />
            <span className="hidden text-sm md:inline">{t("nav:overview")}</span>
          </button>

          {/* Chuyển giao diện sáng/tối */}
          <ThemeToggle />

          {/* Notification badge — tự gate read:notification (NOTI_ENGINE_PAIRS.READ), tự ẩn khi thiếu quyền */}
          <NotificationBadge />

          <div className="mx-1 hidden h-5 w-px bg-white/20 sm:block" />

          {/* Avatar menu */}
          <AvatarMenu />
        </div>
      </header>

      <DirtyFormConfirmDialog
        open={showDirtyConfirm}
        message={
          dirtyFormState?.message ??
          "Bạn có thay đổi chưa lưu. Nếu về trang chủ, các thay đổi sẽ bị mất."
        }
        confirmLabel="Về trang chủ"
        onConfirm={confirmNav}
        onCancel={() => setShowDirtyConfirm(false)}
      />
    </>
  );
}
