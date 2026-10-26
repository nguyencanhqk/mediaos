/**
 * MeSectionContents — nội dung "ok có dữ liệu" cho từng section của Tổng quan ME (ME-SCREEN-001).
 * Mỗi hàm CHỈ render đúng field server trả (BẤT BIẾN masking — client KHÔNG tự suy field bị ẩn).
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Badge } from "@mediaos/ui";
import { formatTime, useCan } from "@mediaos/web-core";
import type {
  MeHrSummary,
  MeAttendanceSummary,
  MeLeaveSummary,
  MeTaskSummary,
  MeNotificationSummary,
} from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "@/routes/tasks/constants";

export function HrSectionContent({ data }: { data: MeHrSummary }) {
  const { t } = useTranslation("me");
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium text-foreground">{data.positionName ?? "—"}</p>
      <p className="text-muted-foreground">{data.departmentName ?? "—"}</p>
      {data.startDate && (
        <p className="text-xs text-muted-foreground">
          {t("hr.startDate", { date: data.startDate })}
        </p>
      )}
    </div>
  );
}

export function AttendanceSectionContent({ data }: { data: MeAttendanceSummary }) {
  const { t } = useTranslation("me");
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium text-foreground">
        {data.checkInAt
          ? t("attendance.checkedInAt", { time: formatTime(data.checkInAt) })
          : t("attendance.empty")}
      </p>
      <p className="text-muted-foreground">
        {data.checkOutAt
          ? t("attendance.checkedOutAt", { time: formatTime(data.checkOutAt) })
          : t("attendance.notCheckedOut")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {data.shiftName && <Badge variant="outline">{data.shiftName}</Badge>}
        {data.isLate && <Badge variant="warning">{t("attendance.late")}</Badge>}
        {data.isEarlyLeave && <Badge variant="warning">{t("attendance.earlyLeave")}</Badge>}
      </div>
    </div>
  );
}

export function LeaveSectionContent({ data }: { data: MeLeaveSummary }) {
  const { t } = useTranslation("me");
  const totalRemaining = data.balances.reduce((sum, b) => sum + b.remainingDays, 0);
  const unit = data.balances[0]?.unit ?? "ngày";
  return (
    <div className="space-y-1 text-sm">
      <p className="text-2xl font-bold tabular-nums text-foreground">
        {totalRemaining} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
      </p>
      <p className="text-muted-foreground">
        {data.pendingRequestCount > 0
          ? t("leave.pendingRequests", { count: data.pendingRequestCount })
          : t("leave.noPendingRequests")}
      </p>
    </div>
  );
}

/**
 * S20-DASH-QUICKACTION-1 — badge số đếm mở đúng nhóm của «Việc của tôi». Số đếm của server
 * (`MeTaskSummary`, me-aggregation) dùng CÙNG quy tắc nhóm với màn đó trên MỌI nguồn (giao/tạo/theo dõi)
 * ⇒ link không kèm `source`. Số 0 hoặc thiếu `read:task` (màn đích sẽ từ chối) ⇒ badge tĩnh, không link chết.
 */
function TaskCountBadge({
  count,
  group,
  children,
}: {
  count: number;
  group: "today" | "overdue";
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const canOpen = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );
  const badge = (
    <Badge variant={count === 0 ? "outline" : group === "overdue" ? "danger" : "warning"}>
      {children}
    </Badge>
  );
  if (count === 0 || !canOpen) return badge;
  return (
    <button
      type="button"
      data-testid={`me-task-${group}-link`}
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => void navigate({ to: "/tasks/my-tasks", search: { group } })}
    >
      {badge}
    </button>
  );
}

export function TaskSectionContent({ data }: { data: MeTaskSummary }) {
  const { t } = useTranslation("me");
  return (
    <div className="flex flex-wrap gap-1.5 text-sm">
      <Badge variant="outline">{t("task.assigned", { count: data.assignedCount })}</Badge>
      <TaskCountBadge count={data.dueTodayCount} group="today">
        {t("task.dueToday", { count: data.dueTodayCount })}
      </TaskCountBadge>
      <TaskCountBadge count={data.overdueCount} group="overdue">
        {t("task.overdue", { count: data.overdueCount })}
      </TaskCountBadge>
    </div>
  );
}

export function NotificationSectionContent({ data }: { data: MeNotificationSummary }) {
  const { t } = useTranslation("me");
  return (
    <div className="space-y-1 text-sm">
      <p className="text-2xl font-bold tabular-nums text-foreground">{data.unreadCount}</p>
      <p className="text-muted-foreground">
        {t("notification.unread", { count: data.unreadCount })}
      </p>
    </div>
  );
}
