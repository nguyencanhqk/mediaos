/**
 * MeQuickActions — "Tiện ích" (ME-SCREEN-001, SPEC-09 §10.1). Deep-link tới route module gốc ĐÃ build —
 * điều hướng qua TanStack Router `navigate()` (client-side, KHÔNG `window.location`) nên route đích VẪN
 * chạy `beforeLoad`/`<ProtectedRoute meta>` — module gốc TỰ kiểm quyền lại (§12.5, mirror
 * `NotificationTargetLink`). ME KHÔNG bypass permission của module đích.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { UserCog, KeyRound, Clock, CalendarPlus, CheckSquare, Bell } from "lucide-react";
import { Card, CardContent } from "@mediaos/ui";
import { ME_QUICK_ACTION_PATHS } from "../constants";

interface QuickAction {
  key: string;
  labelKey: string;
  icon: typeof UserCog;
  path: string;
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    key: "edit-profile",
    labelKey: "quickActions.editProfile",
    icon: UserCog,
    path: ME_QUICK_ACTION_PATHS.EDIT_PROFILE,
  },
  {
    key: "change-password",
    labelKey: "quickActions.changePassword",
    icon: KeyRound,
    path: ME_QUICK_ACTION_PATHS.CHANGE_PASSWORD,
  },
  {
    key: "check-in-out",
    labelKey: "quickActions.checkInOut",
    icon: Clock,
    path: ME_QUICK_ACTION_PATHS.CHECK_IN_OUT,
  },
  {
    key: "create-leave",
    labelKey: "quickActions.createLeave",
    icon: CalendarPlus,
    path: ME_QUICK_ACTION_PATHS.CREATE_LEAVE,
  },
  {
    key: "my-tasks",
    labelKey: "quickActions.myTasks",
    icon: CheckSquare,
    path: ME_QUICK_ACTION_PATHS.MY_TASKS,
  },
  {
    key: "notifications",
    labelKey: "quickActions.notifications",
    icon: Bell,
    path: ME_QUICK_ACTION_PATHS.NOTIFICATIONS,
  },
];

export function MeQuickActions() {
  const { t } = useTranslation("me");
  const navigate = useNavigate();

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          {t("quickActions.title")}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={() => void navigate({ to: action.path as "/" })}
              className="flex flex-col items-center gap-2 rounded-xl border border-border p-3 text-center transition-colors hover:border-brand/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-muted text-brand">
                <action.icon className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="line-clamp-2 text-xs font-medium text-foreground">
                {t(action.labelKey as Parameters<typeof t>[0])}
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
