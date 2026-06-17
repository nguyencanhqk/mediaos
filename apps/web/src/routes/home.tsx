import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, LogOut } from "lucide-react";
import { Avatar, NotificationBell } from "@mediaos/ui";
import { cn } from "@/lib/utils";
import { getHealth, logoutSession, useAuthStore } from "@mediaos/web-core";
import { BrandLogo, BrandWordmark } from "@/components/brand/brand-mark";
import { BRAND } from "@/lib/brand";
import { LAUNCHER_APPS, hasAnyCapability } from "@/lib/launcher-apps";

/**
 * Launcher root-domain (FS-5) — apps/web không còn route nghiệp vụ; trang chủ chỉ là bệ phóng tới 3 product
 * app trên subdomain riêng. Link TUYỆT ĐỐI cross-origin (`<a>` reloadDocument). Mỗi tile gate theo capability
 * (SSO cùng phiên → đổi app không login lại). App đích vẫn tự enforce permission ở route của nó.
 */
export function HomePage() {
  const { t } = useTranslation(["home", "nav", "common"]);
  const username = useAuthStore((s) => s.username);
  const capabilities = useAuthStore((s) => s.capabilities);

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

  // Chỉ hiện app user có quyền vào (anyOf, wildcard giống useCan). Tính 1 lần theo capabilities map.
  const visibleApps = useMemo(
    () => LAUNCHER_APPS.filter((app) => hasAnyCapability(capabilities, app.anyOf)),
    [capabilities],
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <BrandLogo size="md" wordmarkText={BRAND.shortName} wordmarkClassName="text-lg" />

          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
            <Avatar name={username} size="sm" />
            <span className="ml-1.5 hidden max-w-[10rem] truncate text-sm text-slate-600 md:block">
              {username}
            </span>
            <button
              type="button"
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

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Hero */}
        <div className="mb-8">
          <p className="text-sm text-slate-500">{t("home:greeting", { name: username ?? "" })}</p>
          <h1 className="mt-1 inline-block">
            <BrandWordmark text={BRAND.name} className="text-2xl font-bold sm:text-3xl" />
          </h1>
          <div className="brand-gradient-line mt-1 h-0.5 w-56 max-w-full rounded-full opacity-80" />
          <p className="mt-2 text-sm text-slate-500">{t("home:subtitle")}</p>
        </div>

        {/* App cards */}
        {visibleApps.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center text-sm text-slate-500">
            {t("home:noAppsForRole")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleApps.map((app) => {
              const Icon = app.icon;
              return (
                <a
                  key={app.id}
                  href={app.url}
                  className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-slate-900/5",
                        app.tile,
                      )}
                    >
                      <Icon className="h-6 w-6" strokeWidth={1.75} />
                    </span>
                    <ArrowUpRight className="h-5 w-5 text-slate-300 transition-colors group-hover:text-brand" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-800">
                      {t(`home:${app.nameKey}`)}
                    </h2>
                    <p className="mt-1 text-sm leading-snug text-slate-500">
                      {t(`home:${app.descKey}`)}
                    </p>
                  </div>
                  <span className="mt-1 text-xs font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">
                    {t("home:openApp")} →
                  </span>
                </a>
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
