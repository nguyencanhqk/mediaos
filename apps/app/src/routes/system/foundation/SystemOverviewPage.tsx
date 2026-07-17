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
import {
  Building2,
  Settings,
  Users,
  Shield,
  Activity,
  ArrowRight,
  CalendarDays,
  Archive,
  FileSearch,
  FileClock,
} from "lucide-react";
import { foundationApi, foundationKeys, getHealth, rootKeys, useCan } from "@mediaos/web-core";
import { PageHeader, EmptyState, Card, CardContent, Badge, Button } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "../constants";
import { FOUNDATION_ENGINE_PAIRS, FOUNDATION_PATH } from "./constants";
// S5-LEAVE-HOLIDAYS-MOVE-1 — màn Ngày nghỉ lễ dời sang /leave/public-holidays; link Quick-access ở đây
// trỏ THẲNG path mới (tránh 1 hop redirect qua /system/public-holidays cũ).
import { LEAVE_PATHS } from "@/routes/leave/constants";
// S2-FE-FND-7 (RC2) — cặp ENGINE THẬT view:audit-log (seed mig 0340, AuditController enforce). Dùng CHUNG
// nguồn với AuditLogsPage + route system.audit-logs (KHÔNG re-derive orphan view:foundation-audit-log).
import { AUDIT_LOG_VIEW, AUDIT_LOGS_PATH } from "./audit-logs/constants";

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
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link to={FOUNDATION_PATH.HEALTH as "/"}>
              {t("overview.cards.health.manage")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
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
  // S2-FE-FND-4 — cặp seed thật mig 0435 (view:foundation-holiday, is_sensitive=false).
  const canViewHoliday = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_HOLIDAY.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_HOLIDAY.resourceType,
  );
  // S2-FE-FND-6 — cặp seed thật mig 0435 (S2-FND-BE-3): view:foundation-retention /
  // view:foundation-file-access-log (cả 2 KHÔNG sensitive → company-admin có sẵn).
  const canViewRetention = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_RETENTION.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_RETENTION.resourceType,
  );
  const canViewFileAccessLog = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_FILE_ACCESS_LOG.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_FILE_ACCESS_LOG.resourceType,
  );
  // S2-FE-FND-7 (RC2) — cặp view:audit-log nằm trong SYSTEM_APP_PERMISSIONS (route /system ALLOW persona
  // chỉ-audit-log). Thiếu ở hasAnyAccess ⇒ soft-403 landing dù route-guard cho qua → thêm để khớp visibility.
  const canViewAuditLog = useCan(AUDIT_LOG_VIEW.action, AUDIT_LOG_VIEW.resourceType);

  const hasAnyAccess =
    canViewCompany ||
    canViewSetting ||
    canViewUser ||
    canViewRole ||
    canViewHoliday ||
    canViewRetention ||
    canViewFileAccessLog ||
    canViewAuditLog;

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

        {canViewHoliday && (
          <SummaryCard
            icon={CalendarDays}
            title={t("overview.cards.holidays.title")}
            description={t("overview.cards.holidays.description")}
            to={LEAVE_PATHS.PUBLIC_HOLIDAYS}
            actionLabel={t("overview.cards.holidays.manage")}
          />
        )}

        {canViewRetention && (
          <SummaryCard
            icon={Archive}
            title={t("overview.cards.retention.title")}
            description={t("overview.cards.retention.description")}
            to={FOUNDATION_PATH.RETENTION}
            actionLabel={t("overview.cards.retention.manage")}
          />
        )}

        {canViewFileAccessLog && (
          <SummaryCard
            icon={FileSearch}
            title={t("overview.cards.fileAccessLogs.title")}
            description={t("overview.cards.fileAccessLogs.description")}
            to={FOUNDATION_PATH.FILE_ACCESS_LOGS}
            actionLabel={t("overview.cards.fileAccessLogs.manage")}
          />
        )}

        {canViewAuditLog && (
          <SummaryCard
            icon={FileClock}
            title={t("overview.cards.auditLogs.title")}
            description={t("overview.cards.auditLogs.description")}
            to={AUDIT_LOGS_PATH}
            actionLabel={t("overview.cards.auditLogs.manage")}
          />
        )}

        <HealthCard t={t} />
      </div>
    </div>
  );
}
