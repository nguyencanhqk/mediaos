import React, { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { PayrollInsuranceIssue } from "@mediaos/contracts";
import { ROUTE_REGISTRY, useAuthStore, type RouteMeta } from "@mediaos/web-core";
import { evaluateRouteFromStore } from "@/layouts/protected/ProtectedRoute";
import { RouteLoadingState } from "@/layouts/protected/RouteStates";
import { PAYROLL_SIDEBAR } from "@/layouts/workspace/sidebar-registry";
import { ForbiddenPage } from "@/routes/forbidden";
import { pickFirstAllowedPath, sidebarLeafPaths } from "./payroll-root-redirect";

const PayrollOverviewPage = React.lazy(() =>
  import("./PayrollOverviewPage").then((m) => ({ default: m.PayrollOverviewPage })),
);

export const PAYROLL_ROOT_PATH = "/payroll";

function firstOpenablePayrollPath(): string | null {
  return pickFirstAllowedPath(
    sidebarLeafPaths(PAYROLL_SIDEBAR),
    (path) => {
      const meta = ROUTE_REGISTRY.find((r) => r.path === path);
      return meta !== undefined && evaluateRouteFromStore(meta).action === "ALLOW";
    },
    PAYROLL_ROOT_PATH,
  );
}

/**
 * S15-PAYROLL-FE-4 — lối vào `/payroll` (SPEC-11 §9.1 PAY-SCREEN-015).
 *
 * Vỏ route (router) chỉ đòi `access:payroll`; ở đây mới đánh giá meta THẬT của Tổng quan
 * (`access:payroll` + `view:payroll-report` — đúng `ROUTE_REGISTRY` và mục sidebar):
 *  - ALLOW ⇒ nạp LAZY trang Tổng quan (recharts nằm trong chunk đó, người bị chuyển hướng không tải nó);
 *  - thiếu cặp ⇒ `navigate(replace)` tới lá sidebar PAYROLL ĐẦU TIÊN mà họ mở được — kế toán chỉ lập kỳ bấm
 *    «Tiền lương» là vào việc của mình, không thấy trang 403;
 *  - không lá nào mở được ⇒ trang 403 như mọi route khác (không đẩy vòng vòng).
 */
export function PayrollRootEntry({
  overviewMeta,
  onOpenPeriod,
  onOpenEmployees,
}: {
  overviewMeta: RouteMeta;
  onOpenPeriod: (periodId: string) => void;
  onOpenEmployees: (issue: PayrollInsuranceIssue) => void;
}) {
  const navigate = useNavigate();
  // Đăng ký nghe store quyền: `evaluateRouteFromStore` đọc snapshot, hook này buộc render lại khi
  // capabilities đổi giữa phiên.
  useAuthStore((s) => s.capabilities);
  const decision = evaluateRouteFromStore(overviewMeta);
  const target = decision.action === "ALLOW" ? null : firstOpenablePayrollPath();

  useEffect(() => {
    if (target !== null) void navigate({ to: target as "/", replace: true });
  }, [target, navigate]);

  if (decision.action === "ALLOW") {
    return (
      <React.Suspense fallback={<RouteLoadingState />}>
        <PayrollOverviewPage onOpenPeriod={onOpenPeriod} onOpenEmployees={onOpenEmployees} />
      </React.Suspense>
    );
  }
  if (target !== null) return <RouteLoadingState />;
  return <ForbiddenPage reason={decision.reason} />;
}
