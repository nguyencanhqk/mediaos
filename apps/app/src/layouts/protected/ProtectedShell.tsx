/**
 * ProtectedShell — layout gốc cho mọi route yêu cầu đăng nhập.
 *
 * Flow (FRONTEND-05 §11):
 *   Session loading → ProtectedShellSkeleton
 *   401 / unauthenticated → redirect /login
 *   account locked / company inactive → render error state (không crash)
 *   mustSetupTwoFactor (AUTH-003, S2-FE-AUTH-6) → điều hướng /account/setup-2fa (BE đã enforce ở
 *     TwoFactorEnforcementGuard — đây là UX, KHÔNG phải cổng quyền thật)
 *   success → GlobalTopbar + route content + AppSwitcher overlay
 *
 * Quy tắc:
 * - Route-level permission check đã xảy ra ở beforeLoad (router.tsx).
 *   Shell chỉ phụ trách session-level states.
 * - KHÔNG load dữ liệu nghiệp vụ ở đây.
 */
import * as React from "react";
import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Skeleton } from "@mediaos/ui";
import { ShieldX } from "lucide-react";
import { useAuthStore, getAuthRedirectUrl, useFavicon } from "@mediaos/web-core";
import { GlobalTopbar } from "../topbar/GlobalTopbar";
import { AppSwitcher } from "../home/AppSwitcher";
import { useLayoutStore } from "@/stores/layout.store";
import { useCurrentRouteMeta } from "@/hooks/use-current-route-meta";
import { useBrandingQuery } from "@/hooks/use-branding";
import { ACCOUNT_SETUP_2FA_PATH, SETUP_2FA_PATHS } from "@/routes/account/constants";

// ---------------------------------------------------------------------------
// Shell loading skeleton
// ---------------------------------------------------------------------------
function ProtectedShellSkeleton() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Topbar skeleton */}
      <div className="flex h-14 shrink-0 items-center gap-3 bg-chrome px-4">
        <Skeleton className="h-6 w-16 bg-white/10" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-8 rounded-full bg-white/10" />
      </div>
      {/* Content skeleton */}
      <div className="flex flex-1 items-center justify-center">
        <div className="space-y-3 text-center">
          <Skeleton className="mx-auto h-6 w-48" />
          <Skeleton className="mx-auto h-4 w-32" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error states
// ---------------------------------------------------------------------------
function AccountBlockedState() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <ShieldX className="h-8 w-8 text-destructive" />
      </span>
      <h1 className="text-lg font-semibold text-foreground">Tài khoản bị vô hiệu hóa</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Tài khoản của bạn đang bị khóa hoặc vô hiệu hóa. Vui lòng liên hệ quản trị viên.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
interface ProtectedShellProps {
  children: React.ReactNode;
}

export function ProtectedShell({ children }: ProtectedShellProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const mustSetupTwoFactor = useAuthStore((s) => s.mustSetupTwoFactor);
  const resetTransient = useLayoutStore((s) => s.resetTransientLayoutState);
  const routeMeta = useCurrentRouteMeta();
  const navigate = useNavigate();

  // S5-BRAND-FE-2 — favicon động theo thương hiệu công ty. Đặt ở shell (không ở từng trang) để mọi route
  // đã đăng nhập đều áp. Fail-soft: chưa đặt/lỗi → giữ favicon tĩnh /favicon.svg (useFavicon tự khôi phục).
  useFavicon(useBrandingQuery().data?.favicon?.url ?? null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Reset transient layout state on route change
  useEffect(() => {
    resetTransient();
  }, [routeMeta?.routeKey, resetTransient]);

  // bootstrapSession() đã chạy trước khi mount (main.tsx).
  // Nếu isAuthenticated===false ở đây → phiên hỏng giữa chừng → redirect.
  useEffect(() => {
    if (!isAuthenticated) {
      window.location.href = getAuthRedirectUrl();
    }
  }, [isAuthenticated]);

  // AUTH-003 — role/company ép 2FA (BE TwoFactorEnforcementGuard) nhưng user CHƯA enroll: buộc điều
  // hướng màn enroll TRƯỚC khi vào bất kỳ route nào khác (kể cả /home). Loại trừ MỌI mount của chính
  // trang enroll (shell /account/setup-2fa + ME /me/security/2fa) để tránh vòng lặp redirect — cổng
  // quyền THẬT vẫn ở server, đây chỉ là UX.
  const forcedToSetupTwoFactor = mustSetupTwoFactor && !SETUP_2FA_PATHS.includes(pathname);
  useEffect(() => {
    if (forcedToSetupTwoFactor) {
      void navigate({ to: ACCOUNT_SETUP_2FA_PATH as "/" });
    }
  }, [forcedToSetupTwoFactor, navigate]);

  // Still booting (isAuthenticated===false chưa có redirect)
  if (!isAuthenticated || !user) {
    return <ProtectedShellSkeleton />;
  }

  // Account-level checks (không phụ thuộc BE /me modules expansion)
  const userStatus = user.status as string;
  if (userStatus === "Inactive" || userStatus === "Locked") {
    return <AccountBlockedState />;
  }

  // Redirect tới /account/setup-2fa đang bay — không flash nội dung protected trước khi điều hướng.
  if (forcedToSetupTwoFactor) {
    return <ProtectedShellSkeleton />;
  }

  return (
    // Mô hình cuộn app-frame: shell khóa h-dvh, chrome đứng yên, phần cuộn nằm TRONG
    // vùng nội dung (ModuleWorkspaceLayout <main> / HomePortalLayout) — không cuộn document.
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <GlobalTopbar />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {/* Global overlays — mounted once, visible via layout store */}
      <AppSwitcher />
    </div>
  );
}
