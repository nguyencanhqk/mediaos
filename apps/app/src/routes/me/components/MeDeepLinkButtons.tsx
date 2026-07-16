/**
 * MeDeepLinkButtons — hàng nút deep-link dùng chung cho 3 trang "Công việc của tôi" + Thông báo
 * (ME-SCREEN-009..012, SPEC-09 §12.5). Điều hướng qua TanStack Router `navigate()` (client-side) — route
 * đích VẪN chạy `beforeLoad`/`<ProtectedRoute>` (module gốc TỰ kiểm quyền lại, ME KHÔNG bypass permission),
 * mirror MeQuickActions (ME-SCREEN-001).
 */
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent } from "@mediaos/ui";

export interface MeDeepLinkAction {
  key: string;
  label: string;
  icon: LucideIcon;
  path: string;
}

interface MeDeepLinkButtonsProps {
  title: string;
  actions: readonly MeDeepLinkAction[];
}

export function MeDeepLinkButtons({ title, actions }: MeDeepLinkButtonsProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
        <div className="flex flex-wrap gap-3">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={() => void navigate({ to: action.path as "/" })}
              className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-brand/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-muted text-brand">
                <action.icon className="h-4 w-4" strokeWidth={1.9} />
              </span>
              {action.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
