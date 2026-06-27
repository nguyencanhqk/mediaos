/**
 * ModuleWorkspaceLayout — layout làm việc cho mọi module nghiệp vụ.
 *
 * Compose từ:
 * - ModuleSidebar (desktop fixed, tablet/mobile drawer)
 * - MainContentShell (breadcrumb + page header + children)
 *
 * Quy tắc (FRONTEND-05 §15):
 * - Nhận moduleCode → lấy sidebar registry → filterSidebarItems theo quyền.
 * - Kiểm tra module status (locked/maintenance/hidden) → render state tương ứng.
 * - Module workspace KHÔNG hard-code role.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  createPermissionChecker,
  type ModuleCode,
  type SessionContext,
  type UserPermission,
} from "@mediaos/web-core";
import { useAuthStore } from "@mediaos/web-core";
import { cn } from "@mediaos/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ModuleSidebar } from "./ModuleSidebar";
import { MobileSidebarDrawer } from "./MobileSidebarDrawer";
import { useLayoutStore } from "@/stores/layout.store";
import { LockedModuleState, ModuleMaintenanceState, ModuleNotFoundState } from "./WorkspaceStates";

// Module display names cho state messages
const MODULE_NAMES: Partial<Record<ModuleCode, string>> = {
  DASH: "Dashboard",
  HR: "Nhân sự",
  ATT: "Chấm công",
  LEAVE: "Nghỉ phép",
  TASK: "Công việc",
  NOTI: "Thông báo",
  FOUNDATION: "Hệ thống",
  AUTH: "Tài khoản & Phân quyền",
};

interface ModuleWorkspaceLayoutProps {
  moduleCode: ModuleCode;
  children: React.ReactNode;
  className?: string;
}

function buildPermissionCheckerFromStore(): ReturnType<typeof createPermissionChecker> {
  const caps = useAuthStore.getState().capabilities;
  const userPermissions: UserPermission[] = Object.entries(caps)
    .filter(([, v]) => v)
    .map(([key]) => ({ permission: key, scopes: [] }));
  return createPermissionChecker(userPermissions);
}

function buildSessionFromStore(): SessionContext {
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
    // TODO(BE): wire company/modules khi /auth/me trả đủ
    company: null,
    modules: [],
  };
}

export function ModuleWorkspaceLayout({
  moduleCode,
  children,
  className,
}: ModuleWorkspaceLayoutProps) {
  const { isSidebarCollapsed, isMobileSidebarOpen, toggleSidebarCollapsed, closeMobileSidebar } =
    useLayoutStore();

  const { t } = useTranslation("nav");

  // Build permission checker + session từ auth store (sync — đã có từ bootstrapSession)
  const permission = React.useMemo(buildPermissionCheckerFromStore, []);
  const session = React.useMemo(buildSessionFromStore, []);

  // TODO(BE): khi modules wire đủ, uncomment kiểm tra module status từ session.
  // Hiện modules=[] nên mọi module đều không có status trong session.
  // Guard route đã handle SHOW_404/SHOW_DISABLED ở tầng beforeLoad.
  // Layout chỉ cần fallback gracefully.
  const mod = session.modules.find((m) => m.moduleCode === moduleCode);
  const moduleStatus = mod?.status;

  if (moduleStatus === "hidden") {
    return <ModuleNotFoundState />;
  }
  if (moduleStatus === "locked" || moduleStatus === "coming_soon") {
    return <LockedModuleState moduleName={MODULE_NAMES[moduleCode]} />;
  }
  if (moduleStatus === "maintenance") {
    return <ModuleMaintenanceState moduleName={MODULE_NAMES[moduleCode]} />;
  }

  const moduleName = t(`app.${moduleCode.toLowerCase()}` as Parameters<typeof t>[0], {
    defaultValue: MODULE_NAMES[moduleCode] ?? moduleCode,
  });

  return (
    <div className={cn("flex min-h-[calc(100vh-3.5rem)]", className)}>
      {/* Desktop sidebar */}
      <ModuleSidebar
        moduleCode={moduleCode}
        session={session}
        permission={permission}
        collapsed={isSidebarCollapsed}
        className="hidden lg:flex"
      />

      {/* Mobile/tablet sidebar drawer */}
      <MobileSidebarDrawer open={isMobileSidebarOpen} onClose={closeMobileSidebar}>
        <ModuleSidebar
          moduleCode={moduleCode}
          session={session}
          permission={permission}
          collapsed={false}
          className="flex h-full w-full"
        />
      </MobileSidebarDrawer>

      {/* Desktop sidebar collapse toggle */}
      <button
        onClick={toggleSidebarCollapsed}
        className="fixed bottom-6 z-20 hidden h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground lg:flex"
        style={{ left: isSidebarCollapsed ? "2.25rem" : "13.5rem" }}
        aria-label={isSidebarCollapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
        title={isSidebarCollapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
      >
        {isSidebarCollapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Main content */}
      <main className="min-w-0 flex-1 overflow-auto" aria-label={`${moduleName} — nội dung chính`}>
        {children}
      </main>
    </div>
  );
}
