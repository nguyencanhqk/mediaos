/**
 * ProtectedRoute — wrapper hợp thức hóa kết quả route-guard cho 1 route nghiệp vụ.
 *
 * Vai trò (FRONTEND-03 §14): đọc auth store → dựng SessionContext + PermissionChecker → gọi
 * `evaluateRouteAccess(meta)` → render đúng TRẠNG THÁI theo `action`:
 *   - SHOW_LOADING      → skeleton (đang bootstrap phiên)
 *   - REDIRECT_LOGIN    → điều hướng về app đăng nhập trung tâm (không render nội dung)
 *   - SHOW_403          → ForbiddenPage(reason)  (NO_PERMISSION / USER_INACTIVE / …)
 *   - SHOW_DISABLED     → trạng thái module bị khóa
 *   - SHOW_404          → NotFound  (chỉ khi modules ĐÃ populated — xem ghi chú dưới)
 *   - ALLOW             → children
 *
 * GHI CHÚ (chống false-404): `evaluateRouteAccess` trả SHOW_404 khi `session.modules` rỗng. Hiện
 * `/auth/me` CHƯA expand danh sách module → `buildSession()` để `modules: []`. Nếu enforce SHOW_404
 * cứng thì MỌI route module sẽ 404. Vì vậy: khi `modules` rỗng, ta BỎ QUA gating module-status và chỉ
 * enforce nhánh permission (cổng thật vẫn ở server). Khi BE trả modules → gating module hoạt động đầy đủ.
 *
 * Bất biến: đây CHỈ là tầng hiển thị (UX). Server vẫn là cổng phân quyền thật — guard này không cấp quyền.
 */
import type { ReactElement, ReactNode } from "react";
import {
  evaluateRouteAccess,
  getAuthRedirectUrl,
  useAuthStore,
  type DataScope,
  type RouteMeta,
  type SessionContext,
  type RouteGuardResult,
  createPermissionChecker,
} from "@mediaos/web-core";
import { ForbiddenPage } from "@/routes/forbidden";
import {
  RouteDisabledState,
  RouteLoadingState,
  RouteNotFoundState,
} from "@/layouts/protected/RouteStates";

// ---------------------------------------------------------------------------
// SessionContext + PermissionChecker từ auth store
// ---------------------------------------------------------------------------

/** Dựng SessionContext từ auth store. company/modules để trống tới khi /me expand (TODO BE). */
export function buildSessionFromStore(): SessionContext {
  const state = useAuthStore.getState();
  return {
    status: state.isAuthenticated ? "authenticated" : "unauthenticated",
    user: state.user
      ? {
          id: state.user.id,
          email: state.user.email,
          status: (state.user.status as NonNullable<SessionContext["user"]>["status"]) ?? "Active",
          companyId: state.user.companyId,
        }
      : null,
    company: null,
    modules: [],
  };
}

/** Dựng PermissionChecker từ capabilities (cặp engine action:resourceType) trong auth store. */
export function buildPermissionCheckerFromStore() {
  const caps = useAuthStore.getState().capabilities;
  const userPermissions = Object.entries(caps)
    .filter(([, v]) => v)
    .map(([key]) => ({ permission: key, scopes: [] as DataScope[] }));
  return createPermissionChecker(userPermissions);
}

/**
 * Đánh giá quyền truy cập route từ store. Khi `modules` rỗng (chưa expand), bỏ qua moduleCode để tránh
 * false-404 — chỉ giữ nhánh permission/session/user-status.
 */
export function evaluateRouteFromStore(meta: RouteMeta): RouteGuardResult {
  const session = buildSessionFromStore();
  const permission = buildPermissionCheckerFromStore();
  const effectiveMeta: RouteMeta =
    session.modules.length === 0 ? { ...meta, moduleCode: undefined } : meta;
  return evaluateRouteAccess(session, effectiveMeta, permission);
}

// ---------------------------------------------------------------------------
// ProtectedRoute
// ---------------------------------------------------------------------------

interface ProtectedRouteProps {
  meta: RouteMeta;
  children: ReactNode;
  /** Override điều hướng (test inject để khỏi đụng window.location). */
  onRedirect?: (href: string) => void;
}

/**
 * Bọc 1 route nghiệp vụ: tính guard result và render trạng thái tương ứng.
 * Trả về children CHỈ khi action === "ALLOW".
 */
export function ProtectedRoute({ meta, children, onRedirect }: ProtectedRouteProps): ReactElement {
  const result = evaluateRouteFromStore(meta);

  switch (result.action) {
    case "ALLOW":
      return <>{children}</>;
    case "SHOW_LOADING":
      return <RouteLoadingState />;
    case "REDIRECT_LOGIN": {
      const href = getAuthRedirectUrl();
      if (onRedirect) onRedirect(href);
      else if (typeof window !== "undefined") window.location.href = href;
      return <RouteLoadingState />;
    }
    case "SHOW_403":
      return <ForbiddenPage reason={result.reason} />;
    case "SHOW_DISABLED":
      return <RouteDisabledState reason={result.reason} />;
    case "SHOW_404":
      return <RouteNotFoundState />;
    default:
      return <ForbiddenPage reason={result.reason} />;
  }
}
