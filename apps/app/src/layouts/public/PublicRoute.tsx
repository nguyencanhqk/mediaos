/**
 * PublicRoute — bề mặt CÔNG KHAI (vd: login shell) trong apps/app. Ngược với ProtectedRoute:
 *   - đã đăng nhập  → điều hướng RỜI khỏi trang công khai (về landing)
 *   - chưa đăng nhập → render children (form public)
 *
 * Bất biến: chỉ là tầng hiển thị/điều hướng UX — không cấp/khóa quyền (server là cổng thật).
 */
import type { ReactElement, ReactNode } from "react";
import { useAuthStore } from "@mediaos/web-core";

interface PublicRouteProps {
  children: ReactNode;
  /** Đích điều hướng khi user đã đăng nhập (mặc định "/"). */
  redirectTo?: string;
  /** Override điều hướng (test inject để khỏi đụng window.location). */
  onRedirect?: (href: string) => void;
}

export function PublicRoute({
  children,
  redirectTo = "/",
  onRedirect,
}: PublicRouteProps): ReactElement | null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isAuthenticated) {
    if (onRedirect) onRedirect(redirectTo);
    else if (typeof window !== "undefined") window.location.href = redirectTo;
    return null;
  }

  return <>{children}</>;
}
