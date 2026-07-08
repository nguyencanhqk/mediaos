import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  PlusCircle,
  ListChecks,
  Wallet,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import type {
  LeaveBalanceView,
  LeaveRequestListItemView,
  LeaveManagementListItemView,
} from "@mediaos/contracts";
import { leaveApi, leaveKeys, useCan } from "@mediaos/web-core";
import {
  PageHeader,
  EmptyState,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
} from "@mediaos/ui";
import { LeaveBalanceCard } from "./MyLeaveBalancePage";
import {
  LEAVE_ENGINE_PAIRS,
  LEAVE_PATHS,
  LEAVE_STATUS,
  LEAVE_OVERVIEW_RECENT_SIZE,
  LEAVE_LOW_BALANCE_THRESHOLD,
  LEAVE_OVERDUE_PENDING_DAYS,
} from "./constants";

// ── Helpers ─────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Đơn Pending quá hạn khi submittedAt cũ hơn ngưỡng ngày (dữ liệu cross-read, gate view:leave). */
function isOverduePending(submittedAt: string | null): boolean {
  if (!submittedAt) return false;
  const submitted = new Date(submittedAt).getTime();
  if (Number.isNaN(submitted)) return false;
  return Date.now() - submitted > LEAVE_OVERDUE_PENDING_DAYS * MS_PER_DAY;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  [LEAVE_STATUS.DRAFT]: "secondary",
  [LEAVE_STATUS.PENDING]: "default",
  [LEAVE_STATUS.APPROVED]: "default",
  [LEAVE_STATUS.REJECTED]: "destructive",
  [LEAVE_STATUS.CANCELLED]: "outline",
  [LEAVE_STATUS.REVOKED]: "destructive",
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("leave");
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
      {t(`status.${status}`, { defaultValue: status })}
    </Badge>
  );
}

function periodLabel(start: string, end: string): string {
  return start === end ? start : `${start} → ${end}`;
}

// ── Row (dòng compact tái dùng cho recent + pending) ──────────────────────────────

interface OverviewRowProps {
  primary: string;
  secondary: string;
  status: string;
  onClick: () => void;
  ariaLabel: string;
}

function OverviewRow({ primary, secondary, status, onClick, ariaLabel }: OverviewRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-accent/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{primary}</p>
        <p className="truncate text-xs text-muted-foreground">{secondary}</p>
      </div>
      <StatusBadge status={status} />
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ── Skeleton dùng chung cho các section list ──────────────────────────────────────

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

// ── Quick actions ─────────────────────────────────────────────────────────────────

interface QuickActionsProps {
  canCreate: boolean;
  canView: boolean;
  onNavigate: (to: string) => void;
}

function QuickActions({ canCreate, canView, onNavigate }: QuickActionsProps) {
  const { t } = useTranslation("leave");
  const actions: Array<{ key: string; label: string; icon: typeof Wallet; to: string }> = [
    {
      key: "my-balances",
      label: t("overview.hub.quickActions.myBalances"),
      icon: Wallet,
      to: LEAVE_PATHS.MY_BALANCES,
    },
    {
      key: "my-requests",
      label: t("overview.hub.quickActions.myRequests"),
      icon: ListChecks,
      to: LEAVE_PATHS.MY_REQUESTS,
    },
    {
      key: "calendar",
      label: t("overview.hub.quickActions.calendar"),
      icon: CalendarDays,
      to: LEAVE_PATHS.CALENDAR,
    },
  ];
  if (canCreate) {
    actions.unshift({
      key: "create",
      label: t("overview.hub.quickActions.createRequest"),
      icon: PlusCircle,
      to: LEAVE_PATHS.CREATE,
    });
  }
  if (canView) {
    actions.push({
      key: "approvals",
      label: t("overview.hub.quickActions.approvals"),
      icon: CheckCircle2,
      to: LEAVE_PATHS.APPROVALS,
    });
  }

  return (
    <section aria-label={t("overview.hub.quickActions.title")}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => onNavigate(a.to)}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-brand/40 hover:bg-accent/40"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
                <Icon className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <span className="text-sm font-medium text-foreground">{a.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Warning cards ─────────────────────────────────────────────────────────────────

interface WarningBannerProps {
  testId: string;
  message: string;
}

function WarningBanner({ testId, message }: WarningBannerProps) {
  return (
    <div
      data-testid={testId}
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4"
    >
      <AlertTriangle
        className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground"
        strokeWidth={1.9}
      />
      <p className="text-sm text-warning-foreground">{message}</p>
    </div>
  );
}

// ── Section shells ─────────────────────────────────────────────────────────────────

interface SectionCardProps {
  testId: string;
  title: string;
  icon: typeof Wallet;
  onViewAll?: () => void;
  viewAllLabel?: string;
  children: ReactNode;
}

function SectionCard({
  testId,
  title,
  icon: Icon,
  onViewAll,
  viewAllLabel,
  children,
}: SectionCardProps) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-brand" strokeWidth={1.9} />
          {title}
        </CardTitle>
        {onViewAll && viewAllLabel && (
          <Button variant="ghost" size="sm" onClick={onViewAll}>
            {viewAllLabel}
          </Button>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

export function LeaveOverviewPage() {
  const { t } = useTranslation("leave");
  const navigate = useNavigate();
  const go = (to: string) => void navigate({ to: to as "/" });

  // Cổng self-service (cặp engine THẬT mig 0455 — KHÔNG hard-code role):
  const canViewBalance = useCan(
    LEAVE_ENGINE_PAIRS.VIEW_OWN_BALANCE.action,
    LEAVE_ENGINE_PAIRS.VIEW_OWN_BALANCE.resourceType,
  );
  const canViewOwn = useCan(
    LEAVE_ENGINE_PAIRS.VIEW_OWN_REQUEST.action,
    LEAVE_ENGINE_PAIRS.VIEW_OWN_REQUEST.resourceType,
  );
  const canCreate = useCan(
    LEAVE_ENGINE_PAIRS.CREATE_REQUEST.action,
    LEAVE_ENGINE_PAIRS.CREATE_REQUEST.resourceType,
  );
  // Cổng CROSS-READ (đọc chéo, SENSITIVE) — view:leave TRỰC TIẾP (KHÔNG approve:leave, KHÔNG qua
  // PERMISSION_CODE_TO_PAIR). Mirror LeaveApprovalPage: section pending + query listRequests gate cùng cặp.
  const canView = useCan(
    LEAVE_ENGINE_PAIRS.VIEW_REQUEST.action,
    LEAVE_ENGINE_PAIRS.VIEW_REQUEST.resourceType,
  );

  const balancesQuery = useQuery({
    queryKey: leaveKeys.balances.my(),
    queryFn: () => leaveApi.getMyBalances(),
    enabled: canViewBalance,
    staleTime: 60_000,
  });

  // Recent — page/pageSize (contract leaveRequestListQuerySchema chỉ có page/pageSize; per_page bị strip).
  const recentParams = { page: 1, pageSize: LEAVE_OVERVIEW_RECENT_SIZE };
  const recentQuery = useQuery({
    queryKey: leaveKeys.requests.my(recentParams),
    queryFn: () => leaveApi.listMyRequests(recentParams),
    enabled: canViewOwn,
    staleTime: 30_000,
  });

  // Pending approvals — CROSS-READ, chỉ chạy khi canView (enabled) ⇒ employee thường KHÔNG nổ 403.
  const pendingParams = {
    page: 1,
    pageSize: LEAVE_OVERVIEW_RECENT_SIZE,
    status: LEAVE_STATUS.PENDING,
  };
  const pendingQuery = useQuery({
    queryKey: leaveKeys.requests.list(pendingParams),
    queryFn: () => leaveApi.listRequests(pendingParams),
    enabled: canView,
    staleTime: 30_000,
  });

  const balances: LeaveBalanceView[] = balancesQuery.data ?? [];
  const recentItems: LeaveRequestListItemView[] = recentQuery.data?.items ?? [];
  const pendingItems: LeaveManagementListItemView[] = pendingQuery.data?.items ?? [];

  const lowBalances = balances.filter((b) => b.remainingDays <= LEAVE_LOW_BALANCE_THRESHOLD);
  // Cảnh báo quá hạn CHỈ khi có quyền đọc chéo — KHÔNG dùng nguồn cross-read cho employee thường.
  const overdueCount = canView
    ? pendingItems.filter((p) => isOverduePending(p.submittedAt)).length
    : 0;

  const year = new Date().getFullYear();
  const hasWarnings = (canViewBalance && lowBalances.length > 0) || (canView && overdueCount > 0);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("overview.title")}
        description={`${t("overview.description")} — ${t("overview.currentYear", { year })}`}
        icon={CalendarDays}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => go(LEAVE_PATHS.CREATE)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              {t("overview.createRequest")}
            </Button>
          ) : undefined
        }
      />

      {/* ── Cảnh báo ── */}
      {hasWarnings && (
        <div className="grid gap-3 sm:grid-cols-2">
          {canViewBalance && lowBalances.length > 0 && (
            <WarningBanner
              testId="warning-low-balance"
              message={t("overview.hub.warnings.lowBalance", {
                count: lowBalances.length,
                threshold: LEAVE_LOW_BALANCE_THRESHOLD,
              })}
            />
          )}
          {canView && overdueCount > 0 && (
            <WarningBanner
              testId="warning-overdue"
              message={t("overview.hub.warnings.overdue", {
                count: overdueCount,
                days: LEAVE_OVERDUE_PENDING_DAYS,
              })}
            />
          )}
        </div>
      )}

      {/* ── Thao tác nhanh ── */}
      <QuickActions canCreate={canCreate} canView={canView} onNavigate={go} />

      {/* ── Số dư phép (self-service) ── */}
      {canViewBalance && (
        <SectionCard
          testId="section-balance-summary"
          title={t("overview.hub.balanceSummary.title")}
          icon={Wallet}
          onViewAll={() => go(LEAVE_PATHS.MY_BALANCES)}
          viewAllLabel={t("overview.hub.balanceSummary.viewAll")}
        >
          {balancesQuery.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" aria-hidden />
              ))}
            </div>
          ) : balancesQuery.isError ? (
            <EmptyState
              title={t("overview.error.title")}
              description={t("overview.error.description")}
              action={
                <Button variant="outline" size="sm" onClick={() => void balancesQuery.refetch()}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t("actions.retry", { ns: "common" })}
                </Button>
              }
            />
          ) : balances.length === 0 ? (
            <EmptyState
              title={t("overview.empty.title")}
              description={t("overview.empty.description")}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {balances.map((b) => (
                <LeaveBalanceCard key={b.id} balance={b} />
              ))}
            </div>
          )}
        </SectionCard>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Đơn nghỉ gần đây (self-service) ── */}
        {canViewOwn && (
          <SectionCard
            testId="section-recent-requests"
            title={t("overview.hub.recent.title")}
            icon={ListChecks}
            onViewAll={() => go(LEAVE_PATHS.MY_REQUESTS)}
            viewAllLabel={t("overview.hub.recent.viewAll")}
          >
            {recentQuery.isLoading ? (
              <ListSkeleton />
            ) : recentQuery.isError ? (
              <EmptyState
                title={t("overview.hub.recent.errorTitle")}
                description={t("overview.hub.recent.error")}
              />
            ) : recentItems.length === 0 ? (
              <EmptyState
                title={t("overview.hub.recent.emptyTitle")}
                description={t("overview.hub.recent.empty")}
              />
            ) : (
              <div className="space-y-1">
                {recentItems.map((r) => (
                  <OverviewRow
                    key={r.id}
                    primary={r.leaveTypeName ?? "—"}
                    secondary={periodLabel(r.startDate, r.endDate)}
                    status={r.status}
                    onClick={() => go(LEAVE_PATHS.DETAIL(r.id))}
                    ariaLabel={t("myRequests.actions.view")}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Đơn chờ tôi duyệt (CROSS-READ, gate view:leave) ── */}
        {canView && (
          <SectionCard
            testId="section-pending-approvals"
            title={t("overview.hub.pending.title")}
            icon={CheckCircle2}
            onViewAll={() => go(LEAVE_PATHS.APPROVALS)}
            viewAllLabel={t("overview.hub.pending.viewAll")}
          >
            {pendingQuery.isLoading ? (
              <ListSkeleton />
            ) : pendingQuery.isError ? (
              <EmptyState
                title={t("overview.hub.pending.errorTitle")}
                description={t("overview.hub.pending.error")}
              />
            ) : pendingItems.length === 0 ? (
              <EmptyState
                title={t("overview.hub.pending.emptyTitle")}
                description={t("overview.hub.pending.empty")}
              />
            ) : (
              <div className="space-y-1">
                {pendingItems.map((p) => (
                  <OverviewRow
                    key={p.id}
                    primary={p.requester.fullName ?? p.requester.employeeCode ?? "—"}
                    secondary={`${p.leaveTypeName ?? "—"} · ${periodLabel(p.startDate, p.endDate)}`}
                    status={p.status}
                    onClick={() => go(LEAVE_PATHS.APPROVALS)}
                    ariaLabel={t("approval.actions.view")}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
}
