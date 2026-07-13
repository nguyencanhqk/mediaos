/**
 * WorkspaceStates — tập hợp state components cho ModuleWorkspaceLayout:
 * loading skeleton, locked module, maintenance, not found.
 */
import { Link } from "@tanstack/react-router";
import { Skeleton } from "@mediaos/ui";
import { Lock, AlertTriangle, Search } from "lucide-react";

// ---------------------------------------------------------------------------
// WorkspaceSkeleton — loading state
// ---------------------------------------------------------------------------
export function WorkspaceSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 animate-pulse">
      {/* Sidebar skeleton */}
      <div className="hidden w-60 shrink-0 border-r border-border bg-card lg:block">
        <div className="space-y-2 px-3 py-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-4/5" />
          <Skeleton className="h-8 w-3/5" />
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex-1 p-6">
        <Skeleton className="mb-4 h-8 w-48" />
        <Skeleton className="mb-2 h-4 w-96" />
        <Skeleton className="h-4 w-72" />
        <div className="mt-8 space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LockedModuleState — module bị khóa
// ---------------------------------------------------------------------------
export function LockedModuleState({ moduleName }: { moduleName?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Lock className="h-8 w-8 text-muted-foreground" />
      </span>
      <h2 className="text-lg font-semibold text-foreground">
        {moduleName ? `${moduleName} chưa được kích hoạt` : "Module chưa được kích hoạt"}
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Module này chưa được kích hoạt cho công ty của bạn. Vui lòng liên hệ quản trị viên.
      </p>
      <Link
        to="/home"
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Về trang chủ
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModuleMaintenanceState — module đang bảo trì
// ---------------------------------------------------------------------------
export function ModuleMaintenanceState({ moduleName }: { moduleName?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
        <AlertTriangle className="h-8 w-8 text-amber-600" />
      </span>
      <h2 className="text-lg font-semibold text-foreground">
        {moduleName ? `${moduleName} đang bảo trì` : "Module đang bảo trì"}
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Ứng dụng đang được bảo trì. Vui lòng thử lại sau.
      </p>
      <Link
        to="/home"
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Về trang chủ
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModuleNotFoundState — module hidden / 404
// ---------------------------------------------------------------------------
export function ModuleNotFoundState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Search className="h-8 w-8 text-muted-foreground" />
      </span>
      <h2 className="text-lg font-semibold text-foreground">Không tìm thấy trang</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Trang này không tồn tại hoặc bạn không có quyền truy cập.
      </p>
      <Link
        to="/home"
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Về trang chủ
      </Link>
    </div>
  );
}
