import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getHealth } from "@/lib/api";
import { channelsApi } from "@/lib/channels-api";
import { useCan } from "@/hooks/use-can";
import {
  HEALTH_COLORS,
  HEALTH_LABELS,
  PLATFORM_LABELS,
} from "@/components/channels/constants";
import { useAuthStore } from "@/stores/auth";

export function HomePage() {
  const { t } = useTranslation("home");
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
            {t("nav:logout")}
          </Button>
        </div>
      </header>

      <section className="rounded-xl border border-border p-6">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("apiStatus")}</h2>
        {health.isLoading && <p className="text-sm">{t("apiChecking")}</p>}
        {health.isError && (
          <p className="text-sm text-destructive">
            {t("apiErrorPrefix")}
            <code>pnpm dev</code>
            {t("apiErrorMid")}
            <code>docker compose up -d</code>
            {t("apiErrorSuffix")}
          </p>
        )}
        {health.data && (
          <p className="text-sm">
            <span className="font-medium text-primary">{health.data.status}</span> —{" "}
            {health.data.service}
          </p>
        )}
      </section>

      <RiskChannelsWidget />

      <p className="text-sm text-muted-foreground">
        Walking skeleton G1. Module nghiệp vụ bắt đầu từ G2 (RLS/tenant) → G4 (vòng đời video).
      </p>
    </div>
  );
}

/** Widget Dashboard "Kênh rủi ro" (G6-5) — health_status ∈ {risk, declining}. */
function RiskChannelsWidget() {
  const { t } = useTranslation("home");
  const canViewChannels = useCan("read", "channel");

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ["channels", { risk: true }],
    queryFn: () => channelsApi.listChannels({ risk: true }),
    enabled: canViewChannels,
  });

  if (!canViewChannels) return null;

  return (
    <section className="rounded-xl border border-border p-6">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{t("riskChannelsTitle")}</h2>

      {isLoading && <p className="text-sm">{t("common:loading")}</p>}
      {!isLoading && channels.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noRiskChannels")}</p>
      )}

      {channels.length > 0 && (
        <ul className="divide-y divide-border">
          {channels.map((c) => (
            <li key={c.id}>
              <Link
                to="/channels/$channelId"
                params={{ channelId: c.id }}
                className="flex items-center justify-between py-2.5 text-sm hover:underline"
              >
                <span className="font-medium">{c.name}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{PLATFORM_LABELS[c.platform]}</span>
                  {c.healthStatus && (
                    <span className={HEALTH_COLORS[c.healthStatus]}>
                      {HEALTH_LABELS[c.healthStatus]}
                      {c.healthScore != null ? ` · ${c.healthScore}` : ""}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
