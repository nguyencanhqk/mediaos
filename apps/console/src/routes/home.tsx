import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogOut, Search } from "lucide-react";
import { Avatar, NotificationBell } from "@mediaos/ui";
import { cn } from "@/lib/utils";
import { getHealth, logoutSession } from "@mediaos/web-core";
import { BrandLogo } from "@/components/brand/brand-mark";
import { SignalBar } from "@/components/brand/signal-bar";
import { BRAND, BRAND_SYSTEM_LABEL } from "@/lib/brand";
import { NAV_CATEGORIES, NAV_ITEMS, type NavCategory } from "@/lib/nav";
import { useAuthStore } from "@mediaos/web-core";

type Filter = "all" | NavCategory;

/**
 * Trang chủ — bộ khởi chạy ứng dụng (app launcher) kiểu "Phòng điều khiển".
 * Áp ngôn ngữ thiết kế từ apps/auth: nền navy + lưới mờ, wordmark gradient phổ Funtime,
 * thanh tín hiệu on-air, chấm TRỰC TUYẾN. Behavior giữ nguyên (search/chip/health/logout).
 */
export function HomePage() {
  const { t } = useTranslation(["home", "nav", "common"]);
  const username = useAuthStore((s) => s.username);

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    retry: false,
    refetchInterval: 30_000,
  });

  // FS-1b: đăng xuất TOÀN CỤC — thu hồi cả họ refresh token + xoá cookie (server) → xoá store → điều hướng
  // về app đăng nhập trung tâm. Mọi subdomain app mất phiên ở lần refresh kế (SSO logout).
  const onLogout = () => {
    void logoutSession();
  };

  // App tách (FS-4) chỉ có subset category → chỉ render chip của các category THỰC SỰ có app,
  // tránh chip "ma" lọc ra rỗng gây hiểu nhầm app hỏng (silent-failure gate).
  const visibleCategories = useMemo(
    () => NAV_CATEGORIES.filter((c) => NAV_ITEMS.some((it) => it.category === c.id)),
    [],
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NAV_ITEMS.filter((it) => {
      if (filter !== "all" && it.category !== filter) return false;
      if (q && !t(`nav:${it.labelKey}`).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [filter, query, t]);

  return (
    <div className="control-room-bg min-h-screen text-foreground">
      {/* Header — panel navy mờ kính */}
      <header className="sticky top-0 z-20 border-b border-border/70 bg-card/70 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <BrandLogo size="md" wordmarkText={BRAND.shortName} wordmarkClassName="text-lg" />

          <div className="relative mx-auto hidden w-full max-w-sm sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("home:searchApps")}
              aria-label={t("home:searchApps")}
              className="h-9 w-full rounded-lg border border-border bg-background/60 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
            <Avatar name={username} size="sm" />
            <span className="ml-1.5 hidden max-w-[10rem] truncate text-sm text-muted-foreground md:block">
              {username}
            </span>
            <button
              onClick={onLogout}
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={t("nav:logout")}
              title={t("nav:logout")}
            >
              <LogOut className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Hero — bàn điều khiển: greeting + wordmark gradient + thanh tín hiệu */}
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.25em] text-muted-foreground">
              {BRAND_SYSTEM_LABEL}
            </p>
            <h1 className="brand-gradient-text mt-2 inline-block font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {BRAND.name}
            </h1>
            <div className="brand-gradient-line mt-1.5 h-0.5 w-56 max-w-full rounded-full opacity-80" />
            <p className="mt-3 text-sm text-muted-foreground">
              {t("home:greeting", { name: username ?? "" })}
            </p>
          </div>
          <div className="hidden lg:block">
            <SignalBar />
          </div>
        </div>

        {/* Category chips */}
        <div className="mb-6 flex flex-wrap gap-2">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            {t("common:all")}
          </Chip>
          {visibleCategories.map((c) => (
            <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
              {t(`nav:${c.labelKey}`)}
            </Chip>
          ))}
        </div>

        {/* App grid */}
        {items.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{t("home:noApps")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={item.to}
                  className="group flex flex-col items-center gap-2.5 rounded-xl p-3 text-center transition-colors hover:bg-card"
                >
                  <span
                    className={cn(
                      "flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm ring-1 ring-white/5 transition-transform group-hover:-translate-y-0.5 group-hover:shadow-md group-hover:shadow-black/40",
                      item.tile,
                    )}
                  >
                    <Icon className="h-7 w-7" strokeWidth={1.75} />
                  </span>
                  <span className="text-[13px] font-medium leading-tight text-foreground/90">
                    {t(`nav:${item.labelKey}`)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {/* Footer: trạng thái hệ thống — chấm TRỰC TUYẾN nhịp như on-air */}
        <footer className="mt-12 flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              health.isLoading
                ? "bg-muted-foreground/40"
                : health.data
                  ? "live-dot bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60"
                  : "bg-destructive shadow-[0_0_8px] shadow-destructive/60",
            )}
          />
          <span>
            {health.isLoading
              ? t("home:apiChecking")
              : health.data
                ? `${t("home:apiStatus")}: ${health.data.status} — ${health.data.service}`
                : t("home:apiOffline")}
          </span>
        </footer>
      </main>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-brand/60 bg-brand/15 text-brand"
          : "border-border bg-card/60 text-muted-foreground hover:border-brand/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
