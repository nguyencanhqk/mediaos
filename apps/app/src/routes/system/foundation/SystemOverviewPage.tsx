/**
 * SYSTEM-SCREEN-OVERVIEW (S2-FE-FND-1 · FND1-APP) — /system landing (THAY ModulePlaceholder).
 *
 * Thẻ tóm tắt hồ sơ công ty · cấu hình · người dùng/vai trò · tình trạng dịch vụ + link tới trang con.
 * Gate hiển thị theo cặp quyền ĐÃ SEED thật (KHÔNG nhãn-ma): mỗi thẻ chỉ hiện khi user có cặp tương ứng.
 * Route-level đã chặn qua ProtectedRoute (system.overview meta requiredAny FOUNDATION.SETTING.VIEW|AUTH.USER.VIEW);
 * ở đây nếu user không có bất kỳ cặp nào → ForbiddenState (fail-closed, không render thẻ trống).
 *
 * States: loading (company/health) · error (company/health) · empty · forbidden.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, Settings, Users, Shield, Activity, ArrowRight } from "lucide-react";
import { foundationApi, foundationKeys, getHealth, rootKeys, useCan } from "@mediaos/web-core";
import { PageHeader, EmptyState, Card, CardContent, Badge, Button } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "../constants";
import { FOUNDATION_ENGINE_PAIRS, FOUNDATION_PATH } from "./constants";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

// ---------------------------------------------------------------------------
// Summary card — link tới trang con (chỉ render khi có quyền)
// ---------------------------------------------------------------------------
function SummaryCard({
  icon: Icon,
  title,
  description,
  to,
  actionLabel,
  meta,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  to: string;
  actionLabel: string;
  meta?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
            <Icon className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
            {meta}
          </div>
        </div>
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link to={to as "/"}>
              {actionLabel}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Health card — tình trạng dịch vụ backend
// ---------------------------------------------------------------------------
function HealthCard({ t }: { t: TF }) {
  const { isLoading, isError } = useQuery({
    queryKey: [...rootKeys.auth, "health"],
    queryFn: getHealth,
    staleTime: 30_000,
    retry: false,
  });

  const status = isLoading
    ? { label: t("overview.cards.health.checking"), variant: "secondary" as const }
    : isError
      ? { label: t("overview.cards.health.error"), variant: "destructive" as const }
      : { label: t("overview.cards.health.ok"), variant: "default" as const };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
            <Activity className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {t("overview.cards.health.title")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("overview.cards.health.description")}
            </p>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function SystemOverviewPage() {
  const { t } = useTranslation("system");

  const canViewCompany = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_COMPANY.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_COMPANY.resourceType,
  );
  const canViewSetting = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_SETTING.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_SETTING.resourceType,
  );
  const canViewUser = useCan(
    SYSTEM_ENGINE_PAIRS.READ_USER.action,
    SYSTEM_ENGINE_PAIRS.READ_USER.resourceType,
  );
  const canViewRole = useCan(
    SYSTEM_ENGINE_PAIRS.READ_ROLE.action,
    SYSTEM_ENGINE_PAIRS.READ_ROLE.resourceType,
  );

  const hasAnyAccess = canViewCompany || canViewSetting || canViewUser || canViewRole;

  // Company summary — CHỈ fetch khi có quyền đọc (enabled=canViewCompany).
  const companyQuery = useQuery({
    queryKey: foundationKeys.company.current(),
    queryFn: foundationApi.getCompany,
    enabled: canViewCompany,
    staleTime: 30_000,
  });

  // ── Forbidden ────────────────────────────────────────────────────────────
  if (!hasAnyAccess) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("overview.forbidden.title")}
          description={t("overview.forbidden.description")}
        />
      </div>
    );
  }

  const companyName = companyQuery.data?.name ?? null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("overview.title")}
        description={t("overview.description")}
        icon={Settings}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {canViewCompany && (
          <SummaryCard
            icon={Building2}
            title={t("overview.cards.company.title")}
            description={t("overview.cards.company.description")}
            to={FOUNDATION_PATH.COMPANY}
            actionLabel={t("overview.cards.company.manage")}
            meta={
              companyName ? (
                <p className="truncate text-sm font-medium text-foreground">{companyName}</p>
              ) : companyQuery.isLoading ? (
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              ) : null
            }
          />
        )}

        {canViewSetting && (
          <SummaryCard
            icon={Settings}
            title={t("overview.cards.settings.title")}
            description={t("overview.cards.settings.description")}
            to={FOUNDATION_PATH.COMPANY_SETTINGS}
            actionLabel={t("overview.cards.settings.manage")}
          />
        )}

        {canViewUser && (
          <SummaryCard
            icon={Users}
            title={t("overview.cards.users.title")}
            description={t("overview.cards.users.description")}
            to="/system/users"
            actionLabel={t("overview.cards.users.manage")}
          />
        )}

        {canViewRole && (
          <SummaryCard
            icon={Shield}
            title={t("overview.cards.roles.title")}
            description={t("overview.cards.roles.description")}
            to="/system/roles"
            actionLabel={t("overview.cards.roles.manage")}
          />
        )}

        <HealthCard t={t} />
      </div>
    </div>
  );
}
