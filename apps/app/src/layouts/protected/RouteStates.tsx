/**
 * Trạng thái route phụ — loading / disabled / not-found — tách nhỏ để ProtectedRoute DRY.
 * Mọi text qua i18n (namespace "nav"); không hard-code chuỗi rải rác.
 */
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@mediaos/ui";

/** SHOW_LOADING — phiên đang bootstrap / điều hướng. */
export function RouteLoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-96 flex-col items-center justify-center gap-3 p-8"
    >
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-32" />
    </div>
  );
}

/** SHOW_DISABLED — module/feature bị khóa hoặc bảo trì. */
export function RouteDisabledState({ reason }: { reason?: string }) {
  const { t } = useTranslation("nav");
  const reasonText =
    reason === "FEATURE_DISABLED"
      ? t("forbidden.reason.FEATURE_DISABLED")
      : t("forbidden.reason.MODULE_DISABLED");
  return (
    <div className="flex min-h-96 flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Lock className="h-7 w-7 text-muted-foreground" />
      </span>
      <p className="max-w-sm text-sm text-muted-foreground">{reasonText}</p>
      <Link
        to="/"
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t("forbidden.goHome")}
      </Link>
    </div>
  );
}

/** SHOW_404 — route/module không tồn tại trong phiên user. */
export function RouteNotFoundState() {
  const { t } = useTranslation("nav");
  return (
    <div className="flex min-h-96 flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-6xl font-bold text-muted-foreground/30">404</span>
      <p className="max-w-sm text-sm text-muted-foreground">{t("routeTitle.notFound")}</p>
      <Link
        to="/"
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t("forbidden.goHome")}
      </Link>
    </div>
  );
}
