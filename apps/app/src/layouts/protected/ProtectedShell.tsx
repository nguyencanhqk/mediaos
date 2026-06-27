/**
 * ProtectedShell — layout gốc cho mọi route yêu cầu đăng nhập.
 *
 * Flow (FRONTEND-05 §11):
 *   Session loading → ProtectedShellSkeleton
 *   401 / unauthenticated → redirect /login
 *   account locked / company inactive → render error state (không crash)
 *   success → GlobalTopbar + route content + AppSwitcher overlay
 *
 * Quy tắc:
 * - Route-level permission check đã xảy ra ở beforeLoad (router.tsx).
 *   Shell chỉ phụ trách session-level states.
 * - KHÔNG load dữ liệu nghiệp vụ ở đây.
 */
import * as React from "react";
import { useEffect } from "react";
import { Skeleton } from "@mediaos/ui";
import { ShieldX } from "lucide-react";
import { useAuthStore, getAuthRedirectUrl } from "@mediaos/web-core";
import { GlobalTopbar } from "../topbar/GlobalTopbar";
import { AppSwitcher } from "../home/AppSwitcher";
import { useLayoutStore } from "@/stores/layout.store";
import { useCurrentRouteMeta } from "@/hooks/use-current-route-meta";

// ---------------------------------------------------------------------------
// Shell loading skeleton
// ---------------------------------------------------------------------------
function ProtectedShellSkeleton() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Topbar skeleton */}
      <div className="flex h-14 shrink-0 items-center gap-3 bg-slate-900 px-4">
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
  const resetTransient = useLayoutStore((s) => s.resetTransientLayoutState);
  const routeMeta = useCurrentRouteMeta();

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

  // Still booting (isAuthenticated===false chưa có redirect)
  if (!isAuthenticated || !user) {
    return <ProtectedShellSkeleton />;
  }

  // Account-level checks (không phụ thuộc BE /me modules expansion)
  const userStatus = user.status as string;
  if (userStatus === "Inactive" || userStatus === "Locked") {
    return <AccountBlockedState />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <GlobalTopbar />
      <div className="flex flex-1 flex-col">{children}</div>
      {/* Global overlays — mounted once, visible via layout store */}
      <AppSwitcher />
    </div>
  );
}
