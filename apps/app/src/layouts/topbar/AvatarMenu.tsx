/**
 * AvatarMenu — menu tài khoản + logout ở topbar.
 * Confirm dirty-form guard trước khi logout.
 */
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { KeyRound, LogOut, User } from "lucide-react";
import { useAuthStore, logoutSession, getAuthRedirectUrl } from "@mediaos/web-core";
import { Avatar, cn } from "@mediaos/ui";
import { useLayoutStore } from "@/stores/layout.store";
import { DirtyFormConfirmDialog } from "../shared/DirtyFormConfirmDialog";

export function AvatarMenu() {
  const { t } = useTranslation(["common", "nav", "auth"]);
  const [open, setOpen] = React.useState(false);
  const [showDirtyConfirm, setShowDirtyConfirm] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const username = useAuthStore((s) => s.user?.fullName ?? s.username ?? "");
  const email = useAuthStore((s) => s.user?.email ?? "");
  const dirtyFormState = useLayoutStore((s) => s.dirtyFormState);
  const navigate = useNavigate();

  // Close on click outside
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Esc
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const doLogout = async () => {
    await logoutSession();
    window.location.href = getAuthRedirectUrl();
  };

  const handleLogoutClick = () => {
    setOpen(false);
    if (dirtyFormState) {
      setShowDirtyConfirm(true);
    } else {
      void doLogout();
    }
  };

  const handleProfileClick = () => {
    setOpen(false);
    // S2-FE-AUTH-6: "Tài khoản của tôi" trỏ /account/profile (đọc user+employee+roles từ /auth/me) —
    // TRƯỚC ĐÂY trỏ nhầm /home (Home Portal, không phải trang tài khoản).
    void navigate({ to: "/account/profile" as "/" });
  };

  const handleChangePasswordClick = () => {
    setOpen(false);
    void navigate({ to: "/account/change-password" as "/" });
  };

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu tài khoản"
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex items-center gap-2 rounded-lg px-1 py-1 text-chrome-foreground/90 transition-colors hover:bg-white/10"
        >
          <Avatar name={username} size="sm" className="bg-white/15 text-white" />
          <span className="hidden max-w-[8rem] truncate text-sm lg:block">{username}</span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-popover py-1 shadow-lg"
          >
            <div className="border-b border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">{username}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>

            <button
              role="menuitem"
              onClick={handleProfileClick}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-sm",
                "text-foreground hover:bg-accent",
              )}
            >
              <User className="h-4 w-4 text-muted-foreground" />
              {t("nav:myAccount")}
            </button>

            <button
              role="menuitem"
              onClick={handleChangePasswordClick}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-sm",
                "text-foreground hover:bg-accent",
              )}
            >
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              {t("auth:changePassword.heading")}
            </button>

            <div className="my-1 border-t border-border" />

            <button
              role="menuitem"
              onClick={handleLogoutClick}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-sm",
                "text-destructive hover:bg-destructive/10",
              )}
            >
              <LogOut className="h-4 w-4" />
              {t("nav:logout")}
            </button>
          </div>
        )}
      </div>

      <DirtyFormConfirmDialog
        open={showDirtyConfirm}
        message={
          dirtyFormState?.message ??
          "Bạn có thay đổi chưa lưu. Nếu đăng xuất, các thay đổi sẽ bị mất."
        }
        confirmLabel="Đăng xuất"
        onConfirm={() => {
          setShowDirtyConfirm(false);
          void doLogout();
        }}
        onCancel={() => setShowDirtyConfirm(false)}
      />
    </>
  );
}
