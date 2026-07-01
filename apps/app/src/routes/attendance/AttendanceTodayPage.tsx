/**
 * AttendanceTodayPage — ATT-SCREEN-001 Chấm công hôm nay.
 * S3-FE-ATT-1: GET /attendance/today + check-in/check-out + mọi state (loading/error/empty/forbidden).
 * Gate: useCan("view-own","attendance") — server là cổng thật; FE gate chỉ ẩn UI, không bỏ request.
 * KHÔNG hard-code permission/role/leave-logic — server quyết định allowedActions + disabledReason.
 */
import { useTranslation } from "react-i18next";
import { RefreshCw, ClipboardCheck } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Skeleton } from "@mediaos/ui";
import { ATT_ENGINE_PAIRS } from "./constants";
import { useAttendanceToday } from "./hooks/useAttendanceToday";
import { AttendanceStatusCard } from "./AttendanceStatusCard";
import { CheckInOutActions } from "./CheckInOutActions";

// ── Loading skeleton ───────────────────────────────────────────────────────────

function TodayLoadingSkeleton() {
  return (
    <div className="space-y-4" data-testid="today-loading">
      <Skeleton className="h-[180px] w-full rounded-xl" />
      <Skeleton className="h-[120px] w-full rounded-xl" />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function AttendanceTodayPage() {
  const { t } = useTranslation("attendance");

  // Permission gate: VIEW_OWN để xem màn hôm nay — server là cổng thật, FE gate ẩn UI.
  const canView = useCan(ATT_ENGINE_PAIRS.VIEW_OWN.action, ATT_ENGINE_PAIRS.VIEW_OWN.resourceType);

  const { data, isLoading, isError, refetch } = useAttendanceToday(canView);

  // ── Forbidden ────────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("today.forbidden.title")}
          description={t("today.forbidden.description")}
        />
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={t("today.title")} icon={ClipboardCheck} />
        <TodayLoadingSkeleton />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={t("today.title")} icon={ClipboardCheck} />
        <EmptyState
          title={t("today.error.title")}
          description={t("today.error.description")}
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

  // ── No employee linked ────────────────────────────────────────────────────────
  if (!data.employee) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={t("today.title")} icon={ClipboardCheck} />
        <EmptyState title={t("today.empty.title")} description={t("today.noEmployee")} />
      </div>
    );
  }

  // ── Data ─────────────────────────────────────────────────────────────────────
  const workDate = new Date(data.workDate).toLocaleDateString("vi-VN");

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("today.title")}
        description={t("today.description", { date: workDate })}
        icon={ClipboardCheck}
      />

      {/* Trạng thái + ca làm việc */}
      <AttendanceStatusCard data={data} />

      {/* Check-in / Check-out */}
      <CheckInOutActions data={data} />
    </div>
  );
}
