import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";
import { useAuthStore } from "@/stores/auth";

const NAV = [
  { to: "/", label: "Tổng quan" },
  { to: "/tasks", label: "Công việc" },
  { to: "/channels", label: "Kênh" },
  { to: "/settings/platform-accounts", label: "Tài khoản nền tảng" },
  { to: "/projects", label: "Dự án" },
  { to: "/content", label: "Nội dung" },
  { to: "/workflows/templates", label: "Quy trình" },
  { to: "/workflows/instances", label: "Tiến độ quy trình" },
  { to: "/org/departments", label: "Phòng ban" },
  { to: "/org/teams", label: "Nhóm" },
  { to: "/org/positions", label: "Chức vụ" },
  { to: "/org/employees", label: "Nhân sự" },
  { to: "/settings/company", label: "Cài đặt công ty" },
] as const;

export function RootLayout() {
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
          <span className="font-semibold">MediaOS</span>
          <NotificationBell />
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {NAV.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="block rounded-md px-3 py-2 text-sm hover:bg-muted [&.active]:bg-primary/10 [&.active]:font-medium [&.active]:text-primary"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border px-4 py-3">
          <p className="mb-1.5 truncate text-xs text-muted-foreground">{username}</p>
          <Button variant="outline" size="sm" className="w-full" onClick={onLogout}>
            Đăng xuất
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
