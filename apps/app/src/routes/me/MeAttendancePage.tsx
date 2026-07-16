/**
 * MeAttendancePage — ME-SCREEN-009 "Chấm công của tôi" (SPEC-09 §8.1/§8.2, route "/me/attendance").
 *
 * Đọc DUY NHẤT `GET /me/attendance-summary` (meApi.getAttendanceSummary) — section-envelope RIÊNG
 * `{status, data}` (§13), KHÔNG gọi endpoint bảng ATT nguồn trực tiếp (§7.5 "ME KHÔNG thay trang nguồn").
 * Deep-link sang `/attendance/today` (check-in/out) và `/attendance/my-records` (bảng công đầy đủ) —
 * route đích TỰ gate lại (mirror MeQuickActions, KHÔNG bypass permission).
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Clock, CalendarClock, RefreshCw } from "lucide-react";
import { meApi, meKeys, useCan } from "@mediaos/web-core";
import { EmptyState, Button, Skeleton, PageHeader } from "@mediaos/ui";
import { MeSectionCard } from "./components/MeSectionCard";
import { AttendanceSectionContent } from "./components/MeSectionContents";
import { MeDeepLinkButtons } from "./components/MeDeepLinkButtons";
import { ME_ACCESS_PAIR, ME_QUICK_ACTION_PATHS } from "./constants";

function MeAttendancePageInner() {
  const { t } = useTranslation("me");
  const { t: tc } = useTranslation("common");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: meKeys.attendanceSummary(),
    queryFn: meApi.getAttendanceSummary,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full max-w-xl rounded-xl" />
      </div>
    );
  }

  // Lỗi TRANSPORT (network/parse) — khác section.status='error' (business, từ response 200 hợp lệ).
  if (isError || !data) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("attendancePage.error.title")}
          description={t("attendancePage.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("attendancePage.title")}
        description={t("attendancePage.description")}
        icon={Clock}
      />

      <MeSectionCard
        title={t("attendance.title")}
        icon={Clock}
        isPageLoading={false}
        section={data}
        onRetry={() => void refetch()}
        isEmpty={(d) => !d.checkInAt}
        emptyTitle={t("attendance.empty")}
        className="max-w-xl"
      >
        {(d) => <AttendanceSectionContent data={d} />}
      </MeSectionCard>

      <MeDeepLinkButtons
        title={t("attendancePage.linksTitle")}
        actions={[
          {
            key: "check-in-out",
            label: t("quickActions.checkInOut"),
            icon: Clock,
            path: ME_QUICK_ACTION_PATHS.CHECK_IN_OUT,
          },
          {
            key: "my-records",
            label: t("attendancePage.myRecords"),
            icon: CalendarClock,
            path: ME_QUICK_ACTION_PATHS.MY_ATTENDANCE_RECORDS,
          },
        ]}
      />
    </div>
  );
}

export function MeAttendancePage() {
  const { t } = useTranslation("me");
  const canAccess = useCan(ME_ACCESS_PAIR.action, ME_ACCESS_PAIR.resourceType);

  if (!canAccess) {
    return (
      <div className="p-6">
        <EmptyState title={t("forbidden.title")} description={t("forbidden.description")} />
      </div>
    );
  }

  return <MeAttendancePageInner />;
}
