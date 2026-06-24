/**
 * AppSwitcher — overlay chuyển module nhanh từ mọi màn protected.
 *
 * Responsive (UI-06 §13):
 * - Desktop: center modal (max-w-2xl).
 * - Mobile: fullscreen overlay.
 *
 * Quy tắc:
 * - Chỉ hiện app user có quyền (getVisibleApps).
 * - Dirty-form guard trước khi navigate sang app khác.
 * - Focus trap + Esc đóng + Ctrl+K toggle.
 * - App current: hiện badge "Đang mở".
 */
import * as React from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { X, Search } from "lucide-react";
import {
  APP_REGISTRY,
  getVisibleApps,
  createPermissionChecker,
  type AppRegistryItem,
  type SessionContext,
  type UserPermission,
} from "@mediaos/web-core";
import { useAuthStore } from "@mediaos/web-core";
import { Skeleton, cn } from "@mediaos/ui";
import { useLayoutStore } from "@/stores/layout.store";
import { AppCard } from "./AppCard";
import { DirtyFormConfirmDialog } from "../shared/DirtyFormConfirmDialog";

function buildSession(): SessionContext {
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

function buildPermission() {
  const caps = useAuthStore.getState().capabilities;
  const perms: UserPermission[] = Object.entries(caps)
    .filter(([, v]) => v)
    .map(([key]) => ({ permission: key, scopes: [] }));
  return createPermissionChecker(perms);
}

// Simple normalise for search (remove diacritics + lowercase)
function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function useAppSwitcherApps() {
  return React.useMemo(() => {
    const session = buildSession();
    const permission = buildPermission();
    return getVisibleApps(APP_REGISTRY, session, permission);
  }, []);
}

interface AppSwitcherGridProps {
  apps: AppRegistryItem[];
  currentModuleCode?: string;
  onSelect: (app: AppRegistryItem) => void;
}

function AppSwitcherGrid({ apps, currentModuleCode, onSelect }: AppSwitcherGridProps) {
  if (apps.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Không tìm thấy ứng dụng phù hợp.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {apps.map((app) => (
        <AppCard
          key={app.appKey}
          app={app}
          effectiveStatus={app.status}
          isCurrent={app.moduleCode === currentModuleCode}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function AppSwitcherSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
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
  );
}

export function AppSwitcher() {
  const { isAppSwitcherOpen, closeAppSwitcher, dirtyFormState } = useLayoutStore();
  const [query, setQuery] = React.useState("");
  const [pendingApp, setPendingApp] = React.useState<AppRegistryItem | null>(null);
  const [showDirtyConfirm, setShowDirtyConfirm] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const apps = useAppSwitcherApps();

  // Resolve current module code from pathname
  const currentModuleCode = React.useMemo(() => {
    const match = APP_REGISTRY.find((a) => a.rootPath !== "/" && pathname.startsWith(a.rootPath));
    return match?.moduleCode;
  }, [pathname]);

  // Filter by search query
  const filteredApps = React.useMemo(() => {
    if (!query.trim()) return apps;
    const q = normalise(query);
    return apps.filter((app) => {
      const name = normalise(app.nameKey);
      const code = normalise(app.moduleCode);
      const aliases = (app.aliases ?? []).map(normalise);
      return name.includes(q) || code.includes(q) || aliases.some((a) => a.includes(q));
    });
  }, [apps, query]);

  // Open/close effects
  React.useEffect(() => {
    if (isAppSwitcherOpen) {
      setQuery("");
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [isAppSwitcherOpen]);

  // Esc to close
  React.useEffect(() => {
    if (!isAppSwitcherOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAppSwitcher();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isAppSwitcherOpen, closeAppSwitcher]);

  // Ctrl+K global shortcut
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        useLayoutStore.getState().toggleAppSwitcher();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const doNavigate = (app: AppRegistryItem) => {
    closeAppSwitcher();
    void navigate({ to: app.defaultRoute as "/" });
  };

  const handleSelect = (app: AppRegistryItem) => {
    if (app.moduleCode === currentModuleCode) {
      closeAppSwitcher();
      return;
    }
    if (dirtyFormState) {
      setPendingApp(app);
      setShowDirtyConfirm(true);
    } else {
      doNavigate(app);
    }
  };

  if (!isAppSwitcherOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={closeAppSwitcher}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Danh sách ứng dụng"
        className={cn(
          "fixed z-50 flex flex-col bg-background shadow-2xl",
          // Mobile: fullscreen
          "inset-0",
          // Desktop: centered modal
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
          "sm:h-auto sm:max-h-[80vh] sm:w-full sm:max-w-2xl sm:rounded-xl sm:border sm:border-border",
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm ứng dụng…"
            aria-label="Tìm kiếm ứng dụng"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            onClick={closeAppSwitcher}
            aria-label="Đóng danh sách ứng dụng"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* App grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {apps.length === 0 ? (
            <AppSwitcherSkeleton />
          ) : (
            <AppSwitcherGrid
              apps={filteredApps}
              currentModuleCode={currentModuleCode}
              onSelect={handleSelect}
            />
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Nhấn <kbd className="rounded bg-muted px-1 py-0.5 font-mono">Esc</kbd> để đóng ·{" "}
          <kbd className="rounded bg-muted px-1 py-0.5 font-mono">Ctrl+K</kbd> để mở/đóng
        </div>
      </div>

      <DirtyFormConfirmDialog
        open={showDirtyConfirm}
        message={
          dirtyFormState?.message ??
          "Bạn có thay đổi chưa lưu. Nếu chuyển ứng dụng, các thay đổi có thể bị mất."
        }
        confirmLabel="Chuyển ứng dụng"
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
