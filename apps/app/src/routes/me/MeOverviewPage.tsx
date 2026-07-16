/**
 * MeOverviewPage — ME-SCREEN-001 "Tổng quan cá nhân" (SPEC-09 §9/§10.1). Route "/me" (S5-ME-FE-1).
 *
 * Đọc DUY NHẤT `GET /me/overview` (meApi.getOverview): identity + 5 section fail-soft (hr/attendance/
 * leave/task/notification) — mỗi section mang trạng thái RIÊNG (§13), 1 nguồn lỗi KHÔNG phá cả trang
 * (§18.2, mirror DashboardMePage/WidgetCard). ME KHÔNG tự tính lại dữ liệu — chỉ hiển thị ĐÚNG field
 * server trả (BẤT BIẾN masking, CLAUDE.md §2/§5).
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Clock, CalendarDays, KanbanSquare, Bell, Briefcase, RefreshCw } from "lucide-react";
import { meApi, meKeys, useCan } from "@mediaos/web-core";
import { EmptyState, Button, Skeleton } from "@mediaos/ui";
import { MeIdentityBanner } from "./components/MeIdentityBanner";
import { MeSectionCard } from "./components/MeSectionCard";
import {
  HrSectionContent,
  AttendanceSectionContent,
  LeaveSectionContent,
  TaskSectionContent,
  NotificationSectionContent,
} from "./components/MeSectionContents";
import { MeActionNeededCard, MePendingApprovalCard } from "./components/MeActionBlocks";
import { MeQuickActions } from "./components/MeQuickActions";
import { ME_ACCESS_PAIR } from "./constants";

function MeOverviewSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function MeOverviewPageInner() {
  const { t } = useTranslation("me");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: meKeys.overview(),
    queryFn: meApi.getOverview,
    staleTime: 30_000,
  });

  if (isLoading) return <MeOverviewSkeleton />;

  if (isError || !data) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("error.title")}
          description={t("error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <MeIdentityBanner identity={data.identity} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MeSectionCard
          title={t("attendance.title")}
          icon={Clock}
          isPageLoading={false}
          section={data.attendance}
          isEmpty={(d) => !d.checkInAt}
          emptyTitle={t("attendance.empty")}
        >
          {(d) => <AttendanceSectionContent data={d} />}
        </MeSectionCard>

        <MeSectionCard
          title={t("leave.title")}
          icon={CalendarDays}
          isPageLoading={false}
          section={data.leave}
          isEmpty={(d) => d.balances.length === 0}
          emptyTitle={t("leave.empty")}
        >
          {(d) => <LeaveSectionContent data={d} />}
        </MeSectionCard>

        <MeSectionCard
          title={t("task.title")}
          icon={KanbanSquare}
          isPageLoading={false}
          section={data.task}
          isEmpty={(d) => d.assignedCount === 0 && d.dueTodayCount === 0 && d.overdueCount === 0}
          emptyTitle={t("task.empty")}
        >
          {(d) => <TaskSectionContent data={d} />}
        </MeSectionCard>

        <MeSectionCard
          title={t("notification.title")}
          icon={Bell}
          isPageLoading={false}
          section={data.notification}
          isEmpty={(d) => d.unreadCount === 0}
          emptyTitle={t("notification.empty")}
        >
          {(d) => <NotificationSectionContent data={d} />}
        </MeSectionCard>

        <MeSectionCard
          title={t("hr.title")}
          icon={Briefcase}
          isPageLoading={false}
          section={data.hr}
          emptyTitle={t("hr.empty")}
        >
          {(d) => <HrSectionContent data={d} />}
        </MeSectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <MeActionNeededCard isPageLoading={false} section={data.task} />
        <MePendingApprovalCard isPageLoading={false} section={data.leave} />
      </div>

      <MeQuickActions />
    </div>
  );
}

export function MeOverviewPage() {
  const { t } = useTranslation("me");
  const canAccess = useCan(ME_ACCESS_PAIR.action, ME_ACCESS_PAIR.resourceType);

  if (!canAccess) {
    return (
      <div className="p-6">
        <EmptyState title={t("forbidden.title")} description={t("forbidden.description")} />
      </div>
    );
  }

  return <MeOverviewPageInner />;
}
