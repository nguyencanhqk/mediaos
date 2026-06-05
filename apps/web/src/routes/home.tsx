import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { getHealth } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

export function HomePage() {
  const navigate = useNavigate();
  const username = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);

  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    retry: false,
    refetchInterval: 15_000,
  });

  const onLogout = () => {
    logout();
    void navigate({ to: "/login" });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">MediaOS</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{username}</span>
          <Button variant="outline" size="sm" onClick={onLogout}>
            Đăng xuất
          </Button>
        </div>
      </header>

      <section className="rounded-xl border border-border p-6">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Trạng thái API</h2>
        {health.isLoading && <p className="text-sm">Đang kiểm tra…</p>}
        {health.isError && (
          <p className="text-sm text-destructive">
            Không kết nối được API. Chạy <code>pnpm dev</code> và <code>docker compose up -d</code>.
          </p>
        )}
        {health.data && (
          <p className="text-sm">
            <span className="font-medium text-primary">{health.data.status}</span> —{" "}
            {health.data.service}
          </p>
        )}
      </section>

      <p className="text-sm text-muted-foreground">
        Walking skeleton G1. Module nghiệp vụ bắt đầu từ G2 (RLS/tenant) → G4 (vòng đời video).
      </p>
    </div>
  );
}
