import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogOut, Search } from "lucide-react";
import { Avatar } from "@mediaos/ui";
import { cn } from "@/lib/utils";
import { getHealth, logoutSession } from "@mediaos/web-core";
import { BrandLogo, BrandWordmark } from "@/components/brand/brand-mark";
import { BRAND } from "@/lib/brand";
import { NAV_CATEGORIES, NAV_ITEMS, type NavCategory } from "@/lib/nav";
import { useAuthStore } from "@mediaos/web-core";

type Filter = "all" | NavCategory;

/** Trang chủ — bộ khởi chạy ứng dụng (app launcher) kiểu MISA AMIS. */
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

  // App tách (FS-2) chỉ có subset category → chỉ render chip của các category THỰC SỰ có app,
  // tránh chip "ma" (work/goals/process/system) lọc ra rỗng gây hiểu nhầm app hỏng (silent-failure gate).
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
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <BrandLogo size="md" wordmarkText={BRAND.shortName} wordmarkClassName="text-lg" />

          <div className="relative mx-auto hidden w-full max-w-sm sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("home:searchApps")}
              aria-label={t("home:searchApps")}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Avatar name={username} size="sm" />
            <span className="ml-1.5 hidden max-w-[10rem] truncate text-sm text-slate-600 md:block">
              {username}
            </span>
            <button
              onClick={onLogout}
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              aria-label={t("nav:logout")}
              title={t("nav:logout")}
            >
              <LogOut className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Hero */}
        <div className="mb-7">
          <p className="text-sm text-slate-500">
            {t("home:greeting", { name: username ?? "" })}
          </p>
          <h1 className="mt-1 inline-block">
            <BrandWordmark
              text={BRAND.name}
              className="text-2xl font-bold sm:text-3xl"
            />
          </h1>
          <div className="brand-gradient-line mt-1 h-0.5 w-56 max-w-full rounded-full opacity-80" />
          <p className="mt-2 text-sm text-slate-500">{BRAND.slogan}</p>
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
          <p className="py-16 text-center text-sm text-slate-500">{t("home:noApps")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={item.to}
                  className="group flex flex-col items-center gap-2.5 rounded-xl p-3 text-center transition-colors hover:bg-white"
                >
                  <span
                    className={cn(
                      "flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm ring-1 ring-slate-900/5 transition-transform group-hover:-translate-y-0.5 group-hover:shadow-md",
                      item.tile,
                    )}
                  >
                    <Icon className="h-7 w-7" strokeWidth={1.75} />
                  </span>
                  <span className="text-[13px] font-medium leading-tight text-slate-700">
                    {t(`nav:${item.labelKey}`)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {/* Footer: trạng thái hệ thống */}
        <footer className="mt-12 flex items-center gap-2 text-xs text-slate-400">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              health.isLoading ? "bg-slate-300" : health.data ? "bg-emerald-500" : "bg-red-500",
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
          ? "border-transparent bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
      )}
    >
      {children}
    </button>
  );
}
