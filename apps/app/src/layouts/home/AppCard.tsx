/**
 * AppCard — card đại diện một app/module trong Home Portal và App Switcher.
 *
 * Visual states (UI-06 §11.3): default / hover / focus / active / locked / coming_soon / maintenance.
 * Click: gọi onSelect(app) — caller quyết định navigate hay dirty-form confirm.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Lock, AlertTriangle } from "lucide-react";
import { type AppRegistryItem, type ModuleStatus } from "@mediaos/web-core";
import { cn } from "@mediaos/ui";
import { DynamicIcon } from "../workspace/DynamicIcon";

const STATUS_BADGE: Partial<Record<ModuleStatus, { label: string; className: string }>> = {
  coming_soon: {
    label: "Sắp ra mắt",
    className: "bg-info-muted text-info",
  },
  maintenance: {
    label: "Bảo trì",
    className: "bg-warning-muted text-warning",
  },
  locked: {
    label: "Chưa kích hoạt",
    className: "bg-muted text-muted-foreground",
  },
};

// Accent per-module là palette cố định (nhận diện app); nền /10 hoạt động cả hai theme,
// text -600 chỉ đọc được trên nền sáng → thêm dark:-400 cho chế độ tối.
const MODULE_ACCENT_BG: Partial<Record<string, string>> = {
  DASH: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  HR: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  ATT: "bg-green-500/10 text-green-600 dark:text-green-400",
  LEAVE: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  TASK: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  NOTI: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  FOUNDATION: "bg-muted text-muted-foreground",
  AUTH: "bg-muted text-muted-foreground",
  // S5-ME-FE-1 — Personal Hub.
  ME: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

interface AppCardProps {
  app: AppRegistryItem;
  effectiveStatus: ModuleStatus;
  isCurrent?: boolean;
  onSelect: (app: AppRegistryItem) => void;
}

export function AppCard({ app, effectiveStatus, isCurrent, onSelect }: AppCardProps) {
  const { t } = useTranslation("nav");
  const isDisabled = effectiveStatus !== "active";
  const badge = STATUS_BADGE[effectiveStatus];
  const iconBg = MODULE_ACCENT_BG[app.moduleCode] ?? "bg-muted text-muted-foreground";

  const nameKey = app.nameKey as Parameters<typeof t>[0];
  const descKey = app.descKey as Parameters<typeof t>[0];
  const appName = t(nameKey);
  const appDesc = t(descKey);

  const handleClick = () => {
    if (!isDisabled) onSelect(app);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Enter" || e.key === " ") && !isDisabled) {
      e.preventDefault();
      onSelect(app);
    }
  };

  return (
    <div
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`${appName}${isDisabled ? ` — ${badge?.label ?? effectiveStatus}` : ""}${isCurrent ? " (đang mở)" : ""}`}
      aria-disabled={isDisabled}
      className={cn(
        "group relative flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center",
        "transition-all duration-150",
        !isDisabled &&
          "cursor-pointer hover:border-brand/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        isDisabled && "cursor-not-allowed opacity-50",
        isCurrent && "border-brand/40 bg-brand-muted/30",
      )}
    >
      {/* Status overlay icon */}
      {effectiveStatus === "locked" && (
        <span className="absolute right-2 top-2 text-muted-foreground">
          <Lock className="h-3 w-3" />
        </span>
      )}
      {effectiveStatus === "maintenance" && (
        <span className="absolute right-2 top-2 text-warning">
          <AlertTriangle className="h-3 w-3" />
        </span>
      )}

      {/* Icon */}
      <span className={cn("flex h-12 w-12 items-center justify-center rounded-xl", iconBg)}>
        <DynamicIcon name={app.icon} className="h-6 w-6" strokeWidth={1.75} />
      </span>

      {/* Name */}
      <span className="line-clamp-2 text-sm font-medium text-foreground">{appName}</span>

      {/* Description — desktop only */}
      <span className="hidden line-clamp-1 text-xs text-muted-foreground sm:block">{appDesc}</span>

      {/* Status badge */}
      {badge && (
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      )}

      {/* Current badge */}
      {isCurrent && (
        <span className="inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
          Đang mở
        </span>
      )}
    </div>
  );
}
