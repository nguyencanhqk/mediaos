/**
 * HomePortalLayout — màn đầu tiên sau đăng nhập.
 *
 * Hiển thị (UI-06 §9–§10):
 * - Welcome section (tên user).
 * - "Ứng dụng của tôi" — getVisibleApps() lọc theo permission.
 * - Loading skeleton / empty state / error state.
 *
 * Quy tắc:
 * - KHÔNG load dữ liệu nghiệp vụ (employee list, leave records…).
 * - Visibility app theo permission — KHÔNG hard-code role.
 * - Dirty-form guard khi navigate sang app.
 */
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  APP_REGISTRY,
  getVisibleApps,
  createPermissionChecker,
  type AppRegistryItem,
  type SessionContext,
  type UserPermission,
} from "@mediaos/web-core";
import { useAuthStore } from "@mediaos/web-core";
import { Skeleton, EmptyState, cn } from "@mediaos/ui";
import { LayoutGrid, AlertCircle } from "lucide-react";
import { useLayoutStore } from "@/stores/layout.store";
import { AppCard } from "./AppCard";
import { DirtyFormConfirmDialog } from "../shared/DirtyFormConfirmDialog";

// ---------------------------------------------------------------------------
// Helpers (sync — không cần API vì registry + capabilities đã có từ bootstrap)
// ---------------------------------------------------------------------------

function buildVisibleApps(): AppRegistryItem[] {
  const state = useAuthStore.getState();
  const session: SessionContext = {
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
  const perms: UserPermission[] = Object.entries(state.capabilities)
    .filter(([, v]) => v)
    .map(([key]) => ({ permission: key, scopes: [] }));
  const permission = createPermissionChecker(perms);
  return getVisibleApps(APP_REGISTRY, session, permission);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HomePortalSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-2 rounded-xl border border-border p-4"
          >
            <Skeleton className="h-12 w-12 rounded-xl" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function HomePortalError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <AlertCircle className="h-10 w-10 text-destructive/60" />
      <p className="text-sm font-medium text-foreground">Không tải được danh sách ứng dụng.</p>
      <button
        onClick={onRetry}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Thử lại
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function HomePortalLayout() {
  const navigate = useNavigate();
  const username = useAuthStore((s) => s.user?.fullName ?? s.username ?? "");
  const { dirtyFormState } = useLayoutStore();
  const [pendingApp, setPendingApp] = React.useState<AppRegistryItem | null>(null);
  const [showDirtyConfirm, setShowDirtyConfirm] = React.useState(false);

  // Use React Query so loading/error states are explicit (staleTime=Infinity — sync from store)
  const appsQuery = useQuery({
    queryKey: ["home-portal", "visible-apps"],
    queryFn: buildVisibleApps,
    staleTime: Infinity,
  });

  const handleSelect = (app: AppRegistryItem) => {
    if (app.status !== "active") return;
    if (dirtyFormState) {
      setPendingApp(app);
      setShowDirtyConfirm(true);
    } else {
      void navigate({ to: app.defaultRoute as "/" });
    }
  };

  const doNavigate = (app: AppRegistryItem) => {
    void navigate({ to: app.defaultRoute as "/" });
  };

  const activeApps = (appsQuery.data ?? []).filter((a) => a.status === "active");
  const inactiveApps = (appsQuery.data ?? []).filter((a) => a.status !== "active");

  return (
    <>
      <div className="min-h-[calc(100vh-3.5rem)] bg-background">
        {/* Gradient hero strip */}
        <div className="control-room-bg px-6 py-8 sm:px-10">
          <p className="text-sm font-medium text-muted-foreground">Xin chào,</p>
          <h1 className="brand-gradient-text font-display mt-1 text-2xl font-bold tracking-tight">
            {username || "…"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Bạn muốn làm gì hôm nay?</p>
        </div>

        {/* Content */}
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          {appsQuery.isPending && <HomePortalSkeleton />}

          {appsQuery.isError && <HomePortalError onRetry={() => void appsQuery.refetch()} />}

          {appsQuery.isSuccess && (
            <div className="space-y-8">
              {/* My Apps section */}
              <section aria-labelledby="my-apps-heading">
                <h2
                  id="my-apps-heading"
                  className="mb-4 flex items-center gap-2 text-sm font-semibold text-muted-foreground"
                >
                  <LayoutGrid className="h-4 w-4" />
                  Ứng dụng của tôi
                </h2>

                {activeApps.length === 0 ? (
                  <EmptyState
                    title="Tài khoản của bạn chưa được cấp quyền sử dụng ứng dụng nào."
                    description="Vui lòng liên hệ quản trị viên công ty để được cấp quyền."
                    className="rounded-xl border border-border"
                  />
                ) : (
                  <div
                    className={cn(
                      "grid gap-4",
                      "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6",
                    )}
                  >
                    {activeApps.map((app) => (
                      <AppCard
                        key={app.appKey}
                        app={app}
                        effectiveStatus={app.status}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Other apps (coming_soon / locked / maintenance) */}
              {inactiveApps.length > 0 && (
                <section aria-labelledby="other-apps-heading">
                  <h2
                    id="other-apps-heading"
                    className="mb-4 text-sm font-semibold text-muted-foreground"
                  >
                    Ứng dụng khác
                  </h2>
                  <div
                    className={cn(
                      "grid gap-4",
                      "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6",
                    )}
                  >
                    {inactiveApps.map((app) => (
                      <AppCard
                        key={app.appKey}
                        app={app}
                        effectiveStatus={app.status}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      <DirtyFormConfirmDialog
        open={showDirtyConfirm}
        message={
          dirtyFormState?.message ??
          "Bạn có thay đổi chưa lưu. Nếu mở ứng dụng khác, các thay đổi có thể bị mất."
        }
        confirmLabel="Mở ứng dụng"
        onConfirm={() => {
          setShowDirtyConfirm(false);
          if (pendingApp) doNavigate(pendingApp);
          setPendingApp(null);
        }}
        onCancel={() => {
          setShowDirtyConfirm(false);
          setPendingApp(null);
        }}
      />
    </>
  );
}
