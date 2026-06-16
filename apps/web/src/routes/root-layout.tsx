import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";
import { useAuthStore } from "@/stores/auth";

const NAV = [
  { to: "/", key: "overview" },
  { to: "/tasks", key: "tasks" },
  { to: "/tasks/board", key: "taskBoard" },
  { to: "/channels", key: "channels" },
  { to: "/settings/platform-accounts", key: "platformAccounts" },
  { to: "/projects", key: "projects" },
  { to: "/content", key: "content" },
  { to: "/workflows/templates", key: "workflows" },
  { to: "/workflows/instances", key: "workflowInstances" },
  { to: "/org/departments", key: "departments" },
  { to: "/org/teams", key: "teams" },
  { to: "/org/positions", key: "positions" },
  { to: "/org/employees", key: "employees" },
  { to: "/hr/attendance", key: "attendance" },
  { to: "/hr/adjustments", key: "adjustments" },
  { to: "/hr/leave", key: "leave" },
  { to: "/payroll/salary-profiles", key: "salaryProfiles" },
  { to: "/payroll/periods", key: "payrollPeriods" },
  { to: "/payroll/payslips", key: "payslips" },
  { to: "/settings/company", key: "companySettings" },
] as const;

export function RootLayout() {
  const { t } = useTranslation("nav");
  const navigate = useNavigate();
  const username = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);

  const onLogout = () => {
    logout();
    void navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-muted/40">
        <div className="flex h-14 items-center justify-between px-4">
          <span className="font-semibold">{t("common:appName")}</span>
          <NotificationBell />
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {NAV.map(({ to, key }) => (
            <Link
              key={to}
              to={to}
              className="block rounded-md px-3 py-2 text-sm hover:bg-muted [&.active]:bg-primary/10 [&.active]:font-medium [&.active]:text-primary"
            >
              {t(key)}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border px-4 py-3">
          <p className="mb-1.5 truncate text-xs text-muted-foreground">{username}</p>
          <Button variant="outline" size="sm" className="w-full" onClick={onLogout}>
            {t("logout")}
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
